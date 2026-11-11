import {
  type GithubAvailableRepo,
  GithubError,
  type GithubRepo,
  type GithubStatus,
  type Issue,
  keyBetween,
  type Project,
  type ProjectIconChoices,
  type ProjectIconFile,
  parsePullRequestRefs,
  PROJECT_COLORS,
  projectKeyFor,
  type PullRequest,
  wouldCycle
} from "@gradient/domain"
import { Context, Effect, Layer, Option, Queue, Schedule, Semaphore, Stream } from "effect"
import type { SqlError } from "effect/sql"
import { ServerConfig } from "../config.ts"
import { Db } from "../db/Db.ts"
import { Mutations, type Origin, type TxContext } from "../sync/Mutations.ts"
import { GithubAuth, type Viewer } from "./GithubAuth.ts"
import { type GhComment, type GhIssue, GithubClient, type IssueWrite, labelColor, labelName } from "./GithubClient.ts"
import { autoIcon, iconCandidates, MAX_ICON_BYTES, type RepoFile } from "./icons.ts"
import { diff, fromGithub, fromIssue, resolveState, type Shadow } from "./mapping.ts"

interface LinkRow {
  readonly issueId: string
  readonly repoId: string
  readonly ghNumber: number
  readonly ghId: number | null
  readonly ghUpdatedAt: string
  readonly shadow: Shadow
  /** The GitHub blockers of this issue that map to Gradient issues, as of the last sync. NULL: never read. */
  readonly blockedBy: ReadonlyArray<BlockerShadow> | null
}

/** One GitHub blocker that Gradient knows as an issue. */
interface BlockerShadow {
  readonly ghId: number
  readonly issueId: string
}

/** "https://github.com/acme/web/issues/12" → acme, web, 12. */
const coordsFromUrl = (url: string) => {
  const m = url.match(/\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)\/?$/)
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : null
}

/** "https://api.github.com/repos/acme/web/issues/12" → 12. */
const issueNumberOf = (issueUrl: string) => Number(issueUrl.match(/\/issues\/(\d+)\/?$/)?.[1] ?? Number.NaN)

const pullRequestState = (gh: GhIssue): PullRequest["state"] =>
  gh.pull_request?.merged_at ? "merged" : gh.state === "closed" ? "closed" : gh.draft ? "draft" : "open"

/** How often "auto" icons are looked up again while polling. Linking and "Sync now" always look. */
const ICON_CHECK_INTERVAL_MS = 60 * 60 * 1000
/** A repository's file list is reused this long, so opening the picker and saving read it once. */
const FILES_TTL_MS = 60 * 1000

export type IconChoice =
  | { readonly mode: "auto" }
  | { readonly mode: "none" }
  | { readonly mode: "repo"; readonly path: string }

const sameIcon = (a: ProjectIconFile | null, b: ProjectIconFile | null) => a?.path === b?.path && a?.sha === b?.sha
const toIconFile = (f: RepoFile | null | undefined): ProjectIconFile | null => (f ? { path: f.path, sha: f.sha } : null)

const fallbackColors = ["#8b8d98", "#e5484d", "#f76b15", "#ffc53d", "#46a758", "#0090ff", "#8e4ec6", "#d6409f"]

export class GithubSync extends Context.Service<GithubSync, {
  readonly status: Effect.Effect<GithubStatus>
  /** Link a repo to a project (or to a new project named after it) and import its issues. */
  linkRepo(input: {
    teamId: string
    projectId: string | null
    projectName?: string | undefined
    projectKey?: string | undefined
    owner: string
    name: string
    pushExisting: boolean
  }): Effect.Effect<{ projectId: string; imported: number; pushed: number }, GithubError>
  unlinkRepo(repoId: string): Effect.Effect<void, GithubError>
  /** Pull changes for one repo now, then push anything queued. */
  syncNow(repoId: string): Effect.Effect<void, GithubError>
  /** Apply one issue or pull request as GitHub sees it (from a webhook, poll or import). */
  ingest(repo: GithubRepo, gh: GhIssue): Effect.Effect<"created" | "updated" | "unchanged" | "skipped" | "pull_request">
  /**
   * Store a comment as GitHub sees it. Comments on pull requests, or on issues
   * Gradient does not have, are skipped.
   */
  ingestComment(repo: GithubRepo, gh: GhComment): Effect.Effect<"comment" | "unchanged" | "skipped">
  /** A comment was deleted on GitHub. */
  removeComment(repo: GithubRepo, ghId: number): Effect.Effect<void>
  /** Read what blocks one linked issue on GitHub and apply the difference. */
  pullDependencies(repo: GithubRepo, ghNumber: number): Effect.Effect<void, GithubError>
  /** Push every due outbox entry to GitHub. */
  readonly flushOutbox: Effect.Effect<number>
  /** Repositories the connected account can link, for the repo picker. */
  readonly availableRepos: Effect.Effect<ReadonlyArray<GithubAvailableRepo>, GithubError>
  /** The images in a project's repository that can be its icon, and the one "auto" picks. */
  projectIcons(projectId: string): Effect.Effect<ProjectIconChoices, GithubError>
  /** Choose a project's icon, looking the file up in its repository. */
  setProjectIcon(
    projectId: string,
    choice: IconChoice,
    options: { readonly origin: Origin; readonly actorId: string | null }
  ): Effect.Effect<Project, GithubError>
  /** Look the icon of a repository's project up again ("auto" follows the favicon; a picked file follows its path). */
  refreshIcon(repo: GithubRepo): Effect.Effect<void, GithubError>
  /** The bytes of a file in a linked repository, cached by blob sha. */
  fileBytes(repoId: string, sha: string): Effect.Effect<Uint8Array, GithubError>
}>()("gradient/GithubSync") {
  static readonly layer = Layer.effect(
    GithubSync,
    Effect.gen(function*() {
      const config = yield* ServerConfig
      const db = yield* Db
      const gh = yield* GithubClient
      const auth = yield* GithubAuth
      const mutations = yield* Mutations
      const sql = db.sql
      // One flush at a time: two concurrent pushes of a new issue would create it twice on GitHub.
      const flushLock = yield* Semaphore.make(1)

      const getLink = (issueId: string) =>
        sql`SELECT * FROM github_issue_link WHERE issue_id = ${issueId}`.pipe(Effect.map((rows) => rows[0] && toLink(rows[0])))
      const getLinkByNumber = (repoId: string, n: number) =>
        sql`SELECT * FROM github_issue_link WHERE repo_id = ${repoId} AND gh_number = ${n}`.pipe(
          Effect.map((rows) => rows[0] && toLink(rows[0]))
        )
      const putLink = (issueId: string, repoId: string, issue: GhIssue) =>
        sql`INSERT INTO github_issue_link (issue_id, repo_id, gh_number, gh_id, gh_url, gh_updated_at, shadow)
            VALUES (${issueId}, ${repoId}, ${issue.number}, ${issue.id ?? null}, ${issue.html_url}, ${issue.updated_at},
                    ${JSON.stringify(fromGithub(issue))})
            ON CONFLICT (issue_id) DO UPDATE SET gh_updated_at = excluded.gh_updated_at, shadow = excluded.shadow,
                                                gh_url = excluded.gh_url, gh_id = COALESCE(excluded.gh_id, gh_id)`
      const putBlockedBy = (issueId: string, blockers: ReadonlyArray<BlockerShadow>) =>
        sql`UPDATE github_issue_link SET blocked_by_shadow = ${JSON.stringify(blockers)} WHERE issue_id = ${issueId}`
      const enqueue = (issueId: string) =>
        sql`INSERT INTO github_outbox (issue_id, enqueued_at, next_attempt_at) VALUES (${issueId}, ${Date.now()}, ${Date.now()})
            ON CONFLICT (issue_id) DO UPDATE SET next_attempt_at = excluded.next_attempt_at, attempts = 0`

      /** Find or create the Gradient user for a GitHub login. */
      const ensureUser = (tx: TxContext, login: string | null, avatarUrl: string | null) =>
        Effect.gen(function*() {
          if (!login) return null
          const existing = yield* db.getUserByLogin(login)
          if (existing) return existing.id
          const id = Bun.randomUUIDv7()
          yield* db.putUser({ id, name: login, githubLogin: login, avatarUrl, role: null })
          tx.touch("user", id)
          return id
        })

      /** Map GitHub label names to Gradient label ids, creating labels that are missing. */
      const ensureLabels = (tx: TxContext, teamId: string, gh: GhIssue) =>
        Effect.gen(function*() {
          const existing = yield* db.labelsForTeam(teamId)
          const ids: Array<string> = []
          for (const raw of gh.labels) {
            const name = labelName(raw)
            const found = existing.find((l) => l.name.toLowerCase() === name.toLowerCase())
            if (found) {
              ids.push(found.id)
              continue
            }
            const color = labelColor(raw)
            const label = {
              id: Bun.randomUUIDv7(),
              teamId,
              name,
              color: color ? `#${color}` : fallbackColors[existing.length % fallbackColors.length]!
            }
            yield* db.putLabel(label)
            existing.push(label)
            tx.touch("label", label.id)
            ids.push(label.id)
          }
          return ids
        })

      /** Store a pull request as GitHub sees it. Issues pick it up through the refs in its title and body. */
      const ingestPullRequest = (repo: GithubRepo, gh: GhIssue) =>
        mutations.transact({ origin: "github", actorId: null }, (tx) =>
          Effect.gen(function*() {
            const rows = yield* sql`SELECT * FROM pull_request WHERE repo_id = ${repo.id} AND number = ${gh.number}`
            const existing = rows[0]
            if (existing && gh.updated_at < (existing.gh_updated_at as string)) return
            const refs = parsePullRequestRefs(repo, gh.title, gh.body)
            const next = {
              title: gh.title,
              url: gh.html_url,
              state: pullRequestState(gh),
              author: gh.user?.login ?? null,
              closes: JSON.stringify(refs.closes),
              mentions: JSON.stringify(refs.mentions)
            }
            const same = existing && (Object.keys(next) as Array<keyof typeof next>).every((k) => existing[k] === next[k])
            if (existing && same) {
              yield* sql`UPDATE pull_request SET gh_updated_at = ${gh.updated_at} WHERE id = ${existing.id as string}`
              return
            }
            const id = (existing?.id as string | undefined) ?? Bun.randomUUIDv7()
            yield* sql`INSERT INTO pull_request (id, team_id, repo_id, number, title, url, state, author, closes, mentions,
                                                gh_updated_at, updated_at)
                       VALUES (${id}, ${repo.teamId}, ${repo.id}, ${gh.number}, ${next.title}, ${next.url}, ${next.state},
                               ${next.author}, ${next.closes}, ${next.mentions}, ${gh.updated_at}, ${tx.now})
                       ON CONFLICT (id) DO UPDATE SET title = excluded.title, url = excluded.url, state = excluded.state,
                         author = excluded.author, closes = excluded.closes, mentions = excluded.mentions,
                         gh_updated_at = excluded.gh_updated_at, updated_at = excluded.updated_at`
            tx.touch("pullRequest", id)
          })).pipe(Effect.as("pull_request" as const))

      /** Store a comment as GitHub sees it, on the Gradient issue linked to its GitHub issue. */
      const ingestComment = (repo: GithubRepo, gh: GhComment) =>
        mutations.transact({ origin: "github", actorId: null }, (tx) =>
          Effect.gen(function*() {
            const link = yield* getLinkByNumber(repo.id, issueNumberOf(gh.issue_url))
            if (!link) return "skipped" as const
            const rows = yield* sql`SELECT * FROM issue_comment WHERE repo_id = ${repo.id} AND gh_id = ${gh.id}`
            const existing = rows[0]
            if (existing && gh.updated_at < (existing.gh_updated_at as string)) return "unchanged" as const
            const next = {
              issue_id: link.issueId,
              author: gh.user?.login ?? null,
              author_avatar_url: gh.user?.avatar_url ?? null,
              body: gh.body ?? "",
              url: gh.html_url
            }
            const same = existing && (Object.keys(next) as Array<keyof typeof next>).every((k) => existing[k] === next[k])
            if (existing && same) {
              yield* sql`UPDATE issue_comment SET gh_updated_at = ${gh.updated_at} WHERE id = ${existing.id as string}`
              return "unchanged" as const
            }
            const id = (existing?.id as string | undefined) ?? Bun.randomUUIDv7()
            const issue = yield* db.getIssue(link.issueId)
            if (!issue) return "skipped" as const
            yield* sql`INSERT INTO issue_comment (id, team_id, issue_id, repo_id, gh_id, author, author_avatar_url, body, url,
                                                 created_at, updated_at, gh_updated_at)
                       VALUES (${id}, ${issue.teamId}, ${next.issue_id}, ${repo.id}, ${gh.id}, ${next.author},
                               ${next.author_avatar_url}, ${next.body}, ${next.url}, ${Date.parse(gh.created_at)},
                               ${Date.parse(gh.updated_at)}, ${gh.updated_at})
                       ON CONFLICT (id) DO UPDATE SET issue_id = excluded.issue_id, author = excluded.author,
                         author_avatar_url = excluded.author_avatar_url, body = excluded.body, url = excluded.url,
                         updated_at = excluded.updated_at, gh_updated_at = excluded.gh_updated_at`
            tx.touch("issueComment", id)
            return "comment" as const
          })).pipe(Effect.map((r) => r.value), Effect.orDie)

      const removeComment = (repo: GithubRepo, ghId: number) =>
        mutations.transact({ origin: "github", actorId: null }, (tx) =>
          Effect.gen(function*() {
            const rows = yield* sql`DELETE FROM issue_comment WHERE repo_id = ${repo.id} AND gh_id = ${ghId} RETURNING id`
            for (const row of rows) tx.touch("issueComment", row.id as string, "delete")
          })).pipe(Effect.asVoid, Effect.orDie)

      /** The Gradient issue a GitHub issue (from a dependency list) is linked to, if any. */
      const linkedIssueFor = (gh: GhIssue) =>
        Effect.gen(function*() {
          const coords = coordsFromUrl(gh.html_url)
          if (!coords) return undefined
          const repo = yield* db.repoByName(coords.owner, coords.repo)
          if (!repo) return undefined
          const link = yield* getLinkByNumber(repo.id, coords.number)
          if (link && link.ghId === null && gh.id !== undefined) {
            yield* sql`UPDATE github_issue_link SET gh_id = ${gh.id} WHERE issue_id = ${link.issueId}`
          }
          return link
        })

      /**
       * Apply GitHub's "blocked by" list of one linked issue: blockers that are
       * new since the shadow become relations, blockers that left the shadow
       * lose theirs. Blockers Gradient does not know stay out of the shadow, so
       * they are picked up once their issue arrives and never removed by a push.
       */
      const applyBlockedBy = (link: LinkRow, blockers: ReadonlyArray<GhIssue>) =>
        mutations.transact({ origin: "github", actorId: null }, (tx) =>
          Effect.gen(function*() {
            const current = (yield* getLink(link.issueId)) ?? link
            const shadow = current.blockedBy ?? []
            const blocked = yield* db.getIssue(link.issueId)
            if (!blocked) return
            const known: Array<BlockerShadow> = []
            for (const gh of blockers) {
              const blockerLink = yield* linkedIssueFor(gh)
              if (!blockerLink || gh.id === undefined) continue
              known.push({ ghId: gh.id, issueId: blockerLink.issueId })
            }
            for (const b of known) {
              if (shadow.some((s) => s.ghId === b.ghId)) continue
              const blocker = yield* db.getIssue(b.issueId)
              if (!blocker || blocker.teamId !== blocked.teamId) continue
              const existing = yield* db.relationBetween(blocker.id, blocked.id)
              if (existing?.type === "blocks" && existing.issueId === blocker.id) continue
              if (existing) {
                if (existing.type === "blocks") continue // the other way round: keep Gradient's
                yield* db.deleteRelation(existing.id)
                tx.touch("issueRelation", existing.id, "delete")
              }
              if (wouldCycle(yield* db.relationsForTeam(blocked.teamId), blocker.id, blocked.id)) continue
              const id = Bun.randomUUIDv7()
              yield* db.putRelation({
                id,
                teamId: blocked.teamId,
                type: "blocks",
                issueId: blocker.id,
                relatedIssueId: blocked.id,
                createdAt: tx.now
              })
              tx.touch("issueRelation", id)
            }
            for (const gone of shadow) {
              if (known.some((b) => b.ghId === gone.ghId)) continue
              const existing = yield* db.relationBetween(gone.issueId, blocked.id)
              if (existing?.type === "blocks" && existing.issueId === gone.issueId) {
                yield* db.deleteRelation(existing.id)
                tx.touch("issueRelation", existing.id, "delete")
              }
            }
            yield* putBlockedBy(blocked.id, known)
          }))

      const pullDependencies = (repo: GithubRepo, ghNumber: number) =>
        Effect.gen(function*() {
          const link = yield* getLinkByNumber(repo.id, ghNumber).pipe(Effect.orDie)
          if (!link) return
          const blockers = yield* gh.listBlockedBy(repo.owner, repo.name, ghNumber)
          yield* applyBlockedBy(link, blockers).pipe(Effect.orDie)
        })

      /**
       * After an issue came in: read its blockers when GitHub reports some, or
       * when we knew of some (they may be gone). An issue that has none and
       * never had any costs no request.
       */
      const syncDependenciesOf = (repo: GithubRepo, issue: GhIssue) =>
        Effect.gen(function*() {
          const link = yield* getLinkByNumber(repo.id, issue.number).pipe(Effect.orDie)
          if (!link) return
          const summary = issue.issue_dependencies_summary
          const total = summary?.total_blocked_by ?? summary?.blocked_by
          const knew = (link.blockedBy?.length ?? 0) > 0
          if ((total ?? 0) > 0 || knew) return yield* pullDependencies(repo, issue.number)
          if (total === 0 && link.blockedBy === null) yield* putBlockedBy(link.issueId, []).pipe(Effect.orDie)
        }).pipe(
          Effect.catchTag("GithubError", (e) => Effect.logWarning(`Reading dependencies of #${issue.number} failed`, e.message))
        )

      const ingest = (repo: GithubRepo, issue: GhIssue) =>
        Effect.gen(function*() {
          if (issue.pull_request !== undefined) return yield* ingestPullRequest(repo, issue)
          const incoming = fromGithub(issue)
          const outcome = yield* mutations.transact({ origin: "github", actorId: null }, (tx) =>
            Effect.gen(function*() {
              const link = yield* getLinkByNumber(repo.id, issue.number)
              // An older event that arrives late must not undo a newer state.
              if (link && issue.updated_at < link.ghUpdatedAt) return "unchanged" as const
              const states = yield* db.statesForTeam(repo.teamId)

              if (!link) {
                const state = resolveState(states, undefined, incoming)
                const id = Bun.randomUUIDv7()
                const number = (yield* db.nextIssueNumber(repo.teamId))!
                const top = yield* db.topSortOrder(repo.teamId)
                const viewerId = (yield* db.getMeta("viewer_id"))!
                const creatorId = (yield* ensureUser(tx, issue.user?.login ?? null, issue.user?.avatar_url ?? null)) ??
                  viewerId
                const assignee = issue.assignees?.[0]
                const created: Issue = {
                  id,
                  teamId: repo.teamId,
                  projectId: repo.projectId,
                  number,
                  title: incoming.title,
                  description: incoming.body,
                  stateId: state.id,
                  priority: 0,
                  assigneeId: yield* ensureUser(tx, assignee?.login ?? null, assignee?.avatar_url ?? null),
                  creatorId,
                  labelIds: yield* ensureLabels(tx, repo.teamId, issue),
                  sortOrder: keyBetween(top ?? null, null),
                  github: null,
                  createdAt: tx.now,
                  updatedAt: tx.now,
                  archivedAt: null
                }
                yield* db.putIssue(created)
                yield* putLink(id, repo.id, issue)
                tx.touch("team", repo.teamId)
                tx.touch("issue", id)
                return "created" as const
              }

              const changed = diff(link.shadow, incoming)
              yield* putLink(link.issueId, repo.id, issue)
              if (changed.length === 0) return "unchanged" as const
              const current = yield* db.getIssue(link.issueId)
              if (!current) return "skipped" as const
              let next: Issue = { ...current, updatedAt: tx.now }
              for (const field of changed) {
                switch (field) {
                  case "title":
                    next = { ...next, title: incoming.title }
                    break
                  case "body":
                    next = { ...next, description: incoming.body }
                    break
                  case "state": {
                    const currentState = states.find((s) => s.id === current.stateId)
                    next = { ...next, stateId: resolveState(states, currentState, incoming).id }
                    break
                  }
                  case "labels":
                    next = { ...next, labelIds: yield* ensureLabels(tx, repo.teamId, issue) }
                    break
                  case "assignee": {
                    const a = issue.assignees?.[0]
                    next = { ...next, assigneeId: yield* ensureUser(tx, a?.login ?? null, a?.avatar_url ?? null) }
                    break
                  }
                }
              }
              yield* db.putIssue(next)
              tx.touch("issue", next.id)
              return "updated" as const
            })
          )
          return outcome.value
        }).pipe(Effect.orDie)

      /** Compare an issue with its shadow and push only what differs. */
      const pushIssue = (issueId: string) =>
        Effect.gen(function*() {
          const issue = yield* db.getIssue(issueId)
          if (!issue) return
          const repo = yield* db.repoForIssue(issue)
          if (!repo) return
          const state = (yield* db.getState(issue.stateId))!
          const labels = yield* db.labelsForTeam(issue.teamId)
          const assignee = issue.assigneeId ? yield* db.getUser(issue.assigneeId) : undefined
          const desired = fromIssue(issue, { state, labels, assignee })
          const link = yield* getLink(issue.id)

          if (!link) {
            if (issue.archivedAt !== null) return
            const created = yield* gh.createIssue(repo.owner, repo.name, {
              title: desired.title,
              body: desired.body,
              labels: desired.labels,
              assignees: desired.assignee ? [desired.assignee] : []
            })
            const final = desired.state === "closed"
              ? yield* gh.updateIssue(repo.owner, repo.name, created.number, {
                state: "closed",
                state_reason: desired.stateReason
              })
              : created
            yield* mutations.transact({ origin: "github", actorId: null }, (tx) =>
              Effect.gen(function*() {
                yield* putLink(issue.id, repo.id, final)
                yield* putBlockedBy(issue.id, [])
                tx.touch("issue", issue.id)
                // Issues it blocks can now point at it on GitHub.
                const blocks = yield* sql`SELECT related_issue_id FROM issue_relation
                                          WHERE type = 'blocks' AND issue_id = ${issue.id}`
                for (const row of blocks) {
                  const target = yield* db.getIssue(row.related_issue_id as string)
                  if (target && (yield* db.repoForIssue(target))) yield* enqueue(target.id)
                }
              }))
            yield* pushBlockedBy(issue.id)
            return
          }

          const changed = diff(link.shadow, desired)
          if (changed.length === 0) return yield* pushBlockedBy(issue.id)
          const body: { -readonly [K in keyof IssueWrite]: IssueWrite[K] } = {}
          for (const field of changed) {
            if (field === "title") body.title = desired.title
            if (field === "body") body.body = desired.body
            if (field === "state") {
              body.state = desired.state
              body.state_reason = desired.state === "closed" ? desired.stateReason : "reopened"
            }
            if (field === "labels") body.labels = desired.labels
            if (field === "assignee") body.assignees = desired.assignee ? [desired.assignee] : []
          }
          const updated = yield* gh.updateIssue(repo.owner, repo.name, link.ghNumber, body)
          yield* mutations.transact({ origin: "github", actorId: null }, () => putLink(issue.id, repo.id, updated))
          yield* pushBlockedBy(issue.id)
        })

      /** The GitHub id of a linked issue, read from GitHub once when an older link lacks it. */
      const ghIdOf = (link: LinkRow) =>
        Effect.gen(function*() {
          if (link.ghId !== null) return link.ghId
          const repo = yield* db.getRepo(link.repoId)
          if (!repo) return null
          const fresh = yield* gh.getIssue(repo.owner, repo.name, link.ghNumber)
          if (fresh.id === undefined) return null
          yield* sql`UPDATE github_issue_link SET gh_id = ${fresh.id} WHERE issue_id = ${link.issueId}`
          return fresh.id
        })

      /**
       * Make GitHub's "blocked by" list of an issue match its Gradient blockers,
       * diffing against the shadow. Blockers that are not on GitHub yet are
       * skipped; creating them queues this issue again.
       */
      const pushBlockedBy = (issueId: string) =>
        Effect.gen(function*() {
          let link = yield* getLink(issueId)
          if (!link) return
          const repo = yield* db.getRepo(link.repoId)
          if (!repo) return
          const gradientBlockers = Effect.gen(function*() {
            const out: Array<BlockerShadow> = []
            const rows = yield* sql`SELECT issue_id FROM issue_relation WHERE type = 'blocks' AND related_issue_id = ${issueId}`
            for (const row of rows) {
              const blockerLink = yield* getLink(row.issue_id as string)
              if (!blockerLink) continue
              const ghId = yield* ghIdOf(blockerLink)
              if (ghId !== null) out.push({ ghId, issueId: blockerLink.issueId })
            }
            return out
          })
          let desired = yield* gradientBlockers
          // Nothing to say and nothing known: no request (servers without dependencies keep working).
          if (desired.length === 0 && (link.blockedBy?.length ?? 0) === 0) return
          if (link.blockedBy === null) {
            // Learn what GitHub has first, so its own blockers are adopted (as relations) rather than removed.
            yield* pullDependencies(repo, link.ghNumber)
            link = (yield* getLink(issueId))!
            desired = yield* gradientBlockers
          }
          const ghNumber = link.ghNumber
          // Write the shadow after every call, so a failure part-way leaves it true.
          let shadow = [...(link.blockedBy ?? [])]
          for (const b of desired) {
            if (shadow.some((s) => s.ghId === b.ghId)) continue
            yield* gh.addBlockedBy(repo.owner, repo.name, ghNumber, b.ghId).pipe(
              // GitHub may already have it (added there since our last read): re-read, so the retry knows.
              Effect.tapError(() => pullDependencies(repo, ghNumber).pipe(Effect.ignore))
            )
            shadow = [...shadow, b]
            yield* putBlockedBy(issueId, shadow)
          }
          for (const s of [...shadow]) {
            if (desired.some((b) => b.ghId === s.ghId)) continue
            yield* gh.removeBlockedBy(repo.owner, repo.name, ghNumber, s.ghId)
            shadow = shadow.filter((x) => x.ghId !== s.ghId)
            yield* putBlockedBy(issueId, shadow)
          }
        })

      const flushRound = Effect.gen(function*() {
        const now = Date.now()
        const due = yield* sql`SELECT * FROM github_outbox WHERE next_attempt_at <= ${now}
                               ORDER BY enqueued_at LIMIT 50`
        let pushed = 0
        for (const row of due) {
          const issueId = row.issue_id as string
          const stamp = row.next_attempt_at as number
          const attempts = Number(row.attempts)
          const result = yield* Effect.exit(pushIssue(issueId))
          if (result._tag === "Success") {
            pushed++
            // Keep the row if the issue changed again while we were pushing.
            yield* sql`DELETE FROM github_outbox WHERE issue_id = ${issueId} AND next_attempt_at = ${stamp}`
          } else {
            const message = String(result.cause)
            const delay = Math.min(2 ** attempts * 2_000, 5 * 60_000)
            yield* Effect.logWarning(`GitHub push for ${issueId} failed, retrying in ${delay}ms`, message)
            yield* sql`UPDATE github_outbox SET attempts = attempts + 1, last_error = ${message},
                       next_attempt_at = ${Date.now() + delay}
                       WHERE issue_id = ${issueId} AND next_attempt_at = ${stamp}`
          }
        }
        return pushed
      })

      // A push can queue more (an issue created on GitHub frees what it blocks), so go a few rounds.
      const flushOutbox = Effect.gen(function*() {
        let pushed = 0
        for (let round = 0; round < 3; round++) {
          const n = yield* flushRound
          pushed += n
          if (n === 0) break
        }
        return pushed
      }).pipe(flushLock.withPermits(1), Effect.orDie)

      const setRepoStatus = (repo: GithubRepo, error: string | null, announce: boolean) =>
        mutations.transact({ origin: "github", actorId: null }, (tx) =>
          Effect.gen(function*() {
            yield* sql`UPDATE github_repo SET last_synced_at = ${error ? repo.lastSyncedAt : Date.now()},
                       last_error = ${error} WHERE id = ${repo.id}`
            if (announce || error !== repo.lastError) tx.touch("githubRepo", repo.id)
          }))

      /**
       * Page through the repository's comments updated since the last poll, like
       * issues. Deletions do not show up here; the issue_comment webhook brings them.
       */
      const pollComments = (repo: GithubRepo, options: { full: boolean }) =>
        Effect.gen(function*() {
          const rows = yield* sql`SELECT comments_since, comments_etag FROM github_repo WHERE id = ${repo.id}`
          const since = options.full ? null : ((rows[0]?.comments_since as string | null) ?? null)
          const etag = options.full ? null : ((rows[0]?.comments_etag as string | null) ?? null)
          let page = 1
          let newest = since
          let firstEtag: string | null = etag
          while (true) {
            const result = yield* gh.listComments(repo.owner, repo.name, { since, etag: page === 1 ? etag : null, page })
            if (result._tag === "NotModified") break
            if (page === 1) firstEtag = result.etag
            for (const comment of result.comments) {
              yield* ingestComment(repo, comment)
              if (!newest || comment.updated_at > newest) newest = comment.updated_at
            }
            if (!result.hasNext) break
            page++
          }
          const keepEtag = newest === since ? firstEtag : null
          yield* sql`UPDATE github_repo SET comments_since = ${newest}, comments_etag = ${keepEtag} WHERE id = ${repo.id}`
        })

      /** Page through issues updated since the last poll. 304s are free against the rate limit. */
      const pollRepo = (repo: GithubRepo, options: { full: boolean }) =>
        Effect.gen(function*() {
          const rows = yield* sql`SELECT poll_etag, poll_since FROM github_repo WHERE id = ${repo.id}`
          const since = options.full ? null : ((rows[0]?.poll_since as string | null) ?? null)
          const etag = options.full ? null : ((rows[0]?.poll_etag as string | null) ?? null)
          let page = 1
          let newest = since
          let firstEtag: string | null = etag
          let created = 0
          let changed = 0
          const seen: Array<GhIssue> = []
          while (true) {
            const result = yield* gh.listIssues(repo.owner, repo.name, { since, etag: page === 1 ? etag : null, page })
            if (result._tag === "NotModified") break
            if (page === 1) firstEtag = result.etag
            for (const issue of result.issues) {
              const outcome = yield* ingest(repo, issue)
              if (outcome === "created") created++
              if (outcome === "updated") changed++
              if (outcome !== "pull_request") seen.push(issue)
              if (!newest || issue.updated_at > newest) newest = issue.updated_at
            }
            if (!result.hasNext) break
            page++
          }
          // Dependencies once every issue of this poll exists, so blockers resolve in any order.
          for (const issue of seen) yield* syncDependenciesOf(repo, issue)
          // Comments last, so the issues they are on exist.
          yield* pollComments(repo, options)
          // The ETag only applies to the exact URL, so drop it when `since` moves.
          const keepEtag = newest === since ? firstEtag : null
          yield* sql`UPDATE github_repo SET poll_since = ${newest}, poll_etag = ${keepEtag} WHERE id = ${repo.id}`
          yield* setRepoStatus(repo, null, created + changed > 0)
          return { created, changed }
        }).pipe(
          Effect.tapError((e) => setRepoStatus(repo, e.message, true).pipe(Effect.orDie)),
          Effect.catchTag("SqlError", Effect.die)
        )

      // Icons: the repository's file list, a little cached, and when each repo was last checked.
      const filesCache = new Map<string, { at: number; files: ReadonlyArray<RepoFile> }>()
      const iconCheckedAt = new Map<string, number>()
      const filesOf = (repo: GithubRepo, options: { fresh: boolean }) =>
        Effect.gen(function*() {
          const cached = filesCache.get(repo.id)
          if (!options.fresh && cached && Date.now() - cached.at < FILES_TTL_MS) return cached.files
          const files = yield* gh.listFiles(repo.owner, repo.name)
          filesCache.set(repo.id, { at: Date.now(), files })
          return files
        })

      /** Set a project's icon if its mode is still `mode`, so a choice made meanwhile wins. */
      const putIcon = (projectId: string, mode: Project["iconMode"], icon: ProjectIconFile | null) =>
        mutations.transact({ origin: "system", actorId: null }, (tx) =>
          Effect.gen(function*() {
            const project = yield* db.getProject(projectId)
            if (!project || project.iconMode !== mode || sameIcon(project.icon, icon)) return
            yield* db.putProject({ ...project, icon })
            tx.touch("project", projectId)
          })).pipe(Effect.asVoid)

      const refreshIcon = (repo: GithubRepo) =>
        Effect.gen(function*() {
          iconCheckedAt.set(repo.id, Date.now())
          const project = yield* db.getProject(repo.projectId).pipe(Effect.orDie)
          if (!project || project.iconMode === "none") return
          const files = yield* filesOf(repo, { fresh: true })
          if (project.iconMode === "auto") return yield* putIcon(project.id, "auto", toIconFile(autoIcon(files)))
          // A picked file follows its path; when it is gone, the last version stays.
          const file = files.find((f) => f.path === project.icon?.path)
          if (file) yield* putIcon(project.id, "repo", toIconFile(file))
        }).pipe(Effect.catchTag("SqlError", Effect.die))

      const projectIcons = (projectId: string) =>
        Effect.gen(function*() {
          const repo = yield* db.repoForProject(projectId).pipe(Effect.orDie)
          if (!repo) return yield* new GithubError({ message: "The project has no linked repository to take an icon from." })
          const files = yield* filesOf(repo, { fresh: false })
          return {
            auto: toIconFile(autoIcon(files)),
            images: iconCandidates(files).map((f) => ({ path: f.path, sha: f.sha, size: f.size }))
          }
        })

      const setProjectIcon = (
        projectId: string,
        choice: IconChoice,
        options: { readonly origin: Origin; readonly actorId: string | null }
      ) =>
        Effect.gen(function*() {
          const project = yield* db.getProject(projectId).pipe(Effect.orDie)
          if (!project) return yield* new GithubError({ message: "Unknown project." })
          let icon: ProjectIconFile | null = null
          if (choice.mode !== "none") {
            const repo = yield* db.repoForProject(projectId).pipe(Effect.orDie)
            if (!repo) {
              return yield* new GithubError({
                message: `Link a GitHub repository to "${project.name}" first: project icons come from its files.`
              })
            }
            const files = yield* filesOf(repo, { fresh: true })
            if (choice.mode === "auto") {
              icon = toIconFile(autoIcon(files))
            } else {
              const path = choice.path.trim().replace(/^\.?\//, "")
              const images = iconCandidates(files)
              const file = images.find((f) => f.path === path) ??
                images.find((f) => f.path.toLowerCase() === path.toLowerCase())
              if (!file) {
                const tooBig = files.find((f) => f.path === path && f.size > MAX_ICON_BYTES)
                const list = images.slice(0, 15).map((f) => `"${f.path}"`).join(", ")
                return yield* new GithubError({
                  message: tooBig
                    ? `${path} is larger than ${MAX_ICON_BYTES / 1024} KB.`
                    : `No image "${path}" in ${repo.owner}/${repo.name}. ` +
                      (list ? `Images: ${list}${images.length > 15 ? `, and ${images.length - 15} more` : ""}.` : "It has no images.")
                })
              }
              icon = toIconFile(file)
            }
          }
          yield* mutations.apply(
            { origin: options.origin, actorId: options.actorId },
            [{ _tag: "ProjectUpdate", id: projectId, patch: { iconMode: choice.mode, icon } }]
          ).pipe(Effect.mapError((e) => new GithubError({ message: e.message })))
          return (yield* db.getProject(projectId).pipe(Effect.orDie))!
        })

      const fileBytes = (repoId: string, sha: string) =>
        Effect.gen(function*() {
          const cached = yield* db.getBlob(repoId, sha)
          if (cached) return cached
          const repo = yield* db.getRepo(repoId)
          if (!repo) return yield* new GithubError({ message: "Repository is not linked." })
          // Only the project's icon and images the picker offers: never other files, never huge ones.
          const project = yield* db.getProject(repo.projectId)
          if (project?.icon?.sha !== sha && !iconCandidates(yield* filesOf(repo, { fresh: false })).some((f) => f.sha === sha)) {
            return yield* new GithubError({ message: "Not an image of this repository." })
          }
          const bytes = yield* gh.getBlob(repo.owner, repo.name, sha)
          if (bytes.byteLength > MAX_ICON_BYTES) return yield* new GithubError({ message: "The file is too large." })
          const now = Date.now()
          yield* db.putBlob(repoId, sha, bytes, now)
          // Keep the project's icon; let files only seen in the picker go after a day.
          yield* db.pruneBlobs(repoId, project?.icon?.sha ?? null, now - 24 * 60 * 60 * 1000)
          return bytes
        }).pipe(Effect.catchTag("SqlError", Effect.die))

      const pollAll = Effect.gen(function*() {
        for (const repo of yield* db.githubRepos.pipe(Effect.orDie)) {
          yield* pollRepo(repo, { full: false }).pipe(Effect.ignore)
          if (Date.now() - (iconCheckedAt.get(repo.id) ?? 0) >= ICON_CHECK_INTERVAL_MS) {
            yield* refreshIcon(repo).pipe(Effect.ignore)
          }
        }
      })

      /** Link the local user to the GitHub account in use, so assignees map both ways. */
      const adoptViewer = (viewer: Viewer) =>
        mutations.transact({ origin: "system", actorId: null }, (tx) =>
          Effect.gen(function*() {
            const viewerId = yield* db.getMeta("viewer_id")
            const me = viewerId ? yield* db.getUser(viewerId) : undefined
            if (!me || me.githubLogin?.toLowerCase() === viewer.login.toLowerCase()) return
            // Someone else already has this login (an assignee imported earlier): leave both alone.
            if (yield* db.getUserByLogin(viewer.login)) return
            yield* db.putUser({ ...me, githubLogin: viewer.login, avatarUrl: viewer.avatarUrl ?? me.avatarUrl })
            tx.touch("user", me.id)
          })).pipe(Effect.asVoid, Effect.orDie)

      const adoptCurrentViewer = Effect.gen(function*() {
        const viewer = yield* auth.viewer
        if (viewer) yield* adoptViewer(viewer)
      })

      if (config.github.enabled) {
        yield* adoptCurrentViewer

        // Outbound worker: wakes on each queued change, and every few seconds for retries.
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.gen(function*() {
              yield* Effect.race(Queue.take(mutations.outboxSignal), Effect.sleep("5 seconds"))
              yield* Effect.sleep("150 millis") // coalesce bursts of edits into one PATCH
              // Without a token, queued changes wait for a sign-in instead of burning retries.
              if (gh.ready()) yield* flushOutbox
            })
          )
        )
        // Inbound poller: the safety net when webhooks are not forwarded.
        yield* Effect.forkScoped(
          Effect.suspend(() => (gh.ready() ? pollAll : Effect.void)).pipe(
            Effect.repeat(Schedule.spaced(`${config.github.pollIntervalSeconds} seconds`))
          )
        )
        // After a sign-in: link the account, catch up on GitHub, and push what waited.
        yield* Effect.forkScoped(
          Stream.fromPubSub(auth.changes).pipe(
            Stream.runForEach(() =>
              Effect.gen(function*() {
                yield* adoptCurrentViewer
                if (!gh.ready()) return
                yield* pollAll
                yield* flushOutbox
              })
            )
          )
        )
      }

      /** The project a repo links to: the given one, an unlinked one with the same name, or a new one. */
      const projectFor = (input: {
        teamId: string
        projectId: string | null
        projectName?: string | undefined
        projectKey?: string | undefined
        name: string
      }) =>
        Effect.gen(function*() {
          const projects = yield* db.projectsForTeam(input.teamId)
          if (input.projectId) {
            const project = projects.find((p) => p.id === input.projectId)
            if (!project) return yield* new GithubError({ message: "Unknown project." })
            return project.id
          }
          const wanted = (input.projectName?.trim() || input.name).trim()
          const same = projects.find((p) => p.name.toLowerCase() === wanted.toLowerCase())
          if (same) {
            if (yield* db.repoForProject(same.id)) {
              return yield* new GithubError({ message: `Project "${same.name}" already syncs with another repository.` })
            }
            return same.id
          }
          const id = Bun.randomUUIDv7()
          // Keys are unique across the workspace.
          const taken = [...(yield* db.teams).map((t) => t.key), ...(yield* db.projects).map((p) => p.key)]
          yield* mutations.apply({ origin: "system", actorId: null }, [{
            _tag: "ProjectCreate",
            id,
            teamId: input.teamId,
            key: input.projectKey?.trim().toUpperCase() ||
              projectKeyFor(wanted, taken),
            name: wanted,
            color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length]!
          }]).pipe(Effect.mapError((e) => new GithubError({ message: e.message })))
          return id
        })

      const linkRepo = (input: {
        teamId: string
        projectId: string | null
        projectName?: string | undefined
        projectKey?: string | undefined
        owner: string
        name: string
        pushExisting: boolean
      }) =>
        Effect.gen(function*() {
          const owner = input.owner.trim()
          const name = input.name.trim()
          if (!(yield* db.getTeam(input.teamId))) return yield* new GithubError({ message: "Unknown team." })
          const existing = yield* db.repoByName(owner, name)
          if (existing) {
            const project = yield* db.getProject(existing.projectId)
            return yield* new GithubError({
              message: `${owner}/${name} is already linked${project ? ` to the project "${project.name}"` : ""}.`
            })
          }
          if (input.projectId && (yield* db.repoForProject(input.projectId))) {
            return yield* new GithubError({ message: "This project already syncs with a repository. Unlink it first." })
          }
          // Check the repo before creating anything.
          yield* gh.getRepo(owner, name)
          const projectId = yield* projectFor({ ...input, name })
          const id = Bun.randomUUIDv7()
          yield* mutations.transact({ origin: "system", actorId: null }, (tx) =>
            Effect.gen(function*() {
              yield* sql`INSERT INTO github_repo (id, team_id, project_id, owner, name, created_at)
                         VALUES (${id}, ${input.teamId}, ${projectId}, ${owner}, ${name}, ${tx.now})`
              tx.touch("githubRepo", id)
            }))
          const repo = (yield* db.getRepo(id))!
          const { created } = yield* pollRepo(repo, { full: true })
          // A missing icon never fails the link.
          yield* refreshIcon(repo).pipe(Effect.ignore)
          let pushed = 0
          if (input.pushExisting) {
            const now = Date.now()
            const unlinked = yield* sql`SELECT i.id FROM issue i LEFT JOIN github_issue_link l ON l.issue_id = i.id
                                        WHERE i.project_id = ${projectId} AND l.issue_id IS NULL AND i.archived_at IS NULL`
            for (const row of unlinked) {
              yield* sql`INSERT OR IGNORE INTO github_outbox (issue_id, enqueued_at, next_attempt_at)
                         VALUES (${row.id as string}, ${now}, ${now})`
            }
            pushed = yield* flushOutbox
          }
          return { projectId, imported: created, pushed }
        }).pipe(Effect.catchTag("SqlError", Effect.die))

      const unlinkRepo = (repoId: string) =>
        mutations.transact({ origin: "system", actorId: null }, (tx) =>
          Effect.gen(function*() {
            const repo = yield* db.getRepo(repoId)
            if (!repo) return
            const linked = yield* sql`SELECT issue_id FROM github_issue_link WHERE repo_id = ${repoId}`
            yield* sql`DELETE FROM github_outbox WHERE issue_id IN (
                         SELECT issue_id FROM github_issue_link WHERE repo_id = ${repoId}
                         UNION SELECT id FROM issue WHERE project_id = ${repo.projectId})`
            yield* sql`DELETE FROM github_issue_link WHERE repo_id = ${repoId}`
            const prs = yield* sql`DELETE FROM pull_request WHERE repo_id = ${repoId} RETURNING id`
            for (const row of prs) tx.touch("pullRequest", row.id as string, "delete")
            const comments = yield* sql`DELETE FROM issue_comment WHERE repo_id = ${repoId} RETURNING id`
            for (const row of comments) tx.touch("issueComment", row.id as string, "delete")
            yield* sql`DELETE FROM github_repo WHERE id = ${repoId}`
            tx.touch("githubRepo", repoId, "delete")
            // Its files are out of reach now: back to the cube, and to "auto" for the next repo.
            const project = yield* db.getProject(repo.projectId)
            if (project && (project.icon || project.iconMode === "repo")) {
              yield* db.putProject({ ...project, iconMode: project.iconMode === "repo" ? "auto" : project.iconMode, icon: null })
              tx.touch("project", project.id)
            }
            filesCache.delete(repoId)
            iconCheckedAt.delete(repoId)
            for (const row of linked) tx.touch("issue", row.issue_id as string)
          })).pipe(Effect.asVoid, Effect.catchTag("SqlError", Effect.die))

      const syncNow = (repoId: string) =>
        Effect.gen(function*() {
          const repo = yield* db.getRepo(repoId).pipe(Effect.orDie)
          if (!repo) return yield* new GithubError({ message: "Repository is not linked." })
          yield* pollRepo(repo, { full: false })
          yield* refreshIcon(repo).pipe(Effect.ignore)
          yield* flushOutbox
        })

      return GithubSync.of({
        status: Effect.gen(function*() {
          const viewer = yield* auth.viewer
          return {
            tokenSource: yield* auth.source,
            login: viewer?.login ?? null,
            avatarUrl: viewer?.avatarUrl ?? null,
            signIn: {
              available: auth.signInAvailable,
              installUrl: auth.installUrl,
              pending: yield* auth.pending
            },
            notice: yield* auth.notice,
            webhookSecretSet: Option.isSome(config.github.webhookSecret),
            pollIntervalSeconds: config.github.pollIntervalSeconds
          }
        }),
        linkRepo,
        unlinkRepo,
        syncNow,
        ingest,
        ingestComment,
        removeComment,
        pullDependencies,
        flushOutbox,
        availableRepos: Effect.suspend(() => gh.availableRepos),
        projectIcons,
        setProjectIcon,
        refreshIcon,
        fileBytes
      })
    })
  )
}

const toLink = (r: Record<string, unknown>): LinkRow => ({
  issueId: r.issue_id as string,
  repoId: r.repo_id as string,
  ghNumber: Number(r.gh_number),
  ghId: r.gh_id === null || r.gh_id === undefined ? null : Number(r.gh_id),
  ghUpdatedAt: r.gh_updated_at as string,
  shadow: JSON.parse(r.shadow as string) as Shadow,
  blockedBy: typeof r.blocked_by_shadow === "string" ? (JSON.parse(r.blocked_by_shadow) as Array<BlockerShadow>) : null
})

export type { SqlError }
