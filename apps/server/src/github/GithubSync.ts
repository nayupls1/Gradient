import {
  type GithubAvailableRepo,
  GithubError,
  type GithubRepo,
  type GithubStatus,
  type Issue,
  keyBetween,
  PROJECT_COLORS
} from "@gradient/domain"
import { Context, Effect, Layer, Option, Queue, Schedule, Semaphore, Stream } from "effect"
import type { SqlError } from "effect/sql"
import { ServerConfig } from "../config.ts"
import { Db } from "../db/Db.ts"
import { Mutations, type TxContext } from "../sync/Mutations.ts"
import { GithubAuth, type Viewer } from "./GithubAuth.ts"
import { type GhIssue, GithubClient, type IssueWrite, labelColor, labelName } from "./GithubClient.ts"
import { diff, fromGithub, fromIssue, resolveState, type Shadow } from "./mapping.ts"

interface LinkRow {
  readonly issueId: string
  readonly repoId: string
  readonly ghNumber: number
  readonly ghUpdatedAt: string
  readonly shadow: Shadow
}

const fallbackColors = ["#8b8d98", "#e5484d", "#f76b15", "#ffc53d", "#46a758", "#0090ff", "#8e4ec6", "#d6409f"]

export class GithubSync extends Context.Service<GithubSync, {
  readonly status: Effect.Effect<GithubStatus>
  /** Link a repo to a project (or to a new project named after it) and import its issues. */
  linkRepo(input: {
    teamId: string
    projectId: string | null
    projectName?: string | undefined
    owner: string
    name: string
    pushExisting: boolean
  }): Effect.Effect<{ projectId: string; imported: number; pushed: number }, GithubError>
  unlinkRepo(repoId: string): Effect.Effect<void, GithubError>
  /** Pull changes for one repo now, then push anything queued. */
  syncNow(repoId: string): Effect.Effect<void, GithubError>
  /** Apply one issue as GitHub sees it (from a webhook, poll or import). */
  ingest(repo: GithubRepo, gh: GhIssue): Effect.Effect<"created" | "updated" | "unchanged" | "skipped">
  /** Push every due outbox entry to GitHub. */
  readonly flushOutbox: Effect.Effect<number>
  /** Repositories the connected account can link, for the repo picker. */
  readonly availableRepos: Effect.Effect<ReadonlyArray<GithubAvailableRepo>, GithubError>
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
        sql`INSERT INTO github_issue_link (issue_id, repo_id, gh_number, gh_url, gh_updated_at, shadow)
            VALUES (${issueId}, ${repoId}, ${issue.number}, ${issue.html_url}, ${issue.updated_at},
                    ${JSON.stringify(fromGithub(issue))})
            ON CONFLICT (issue_id) DO UPDATE SET gh_updated_at = excluded.gh_updated_at, shadow = excluded.shadow,
                                                gh_url = excluded.gh_url`

      /** Find or create the Gradient user for a GitHub login. */
      const ensureUser = (tx: TxContext, login: string | null, avatarUrl: string | null) =>
        Effect.gen(function*() {
          if (!login) return null
          const existing = yield* db.getUserByLogin(login)
          if (existing) return existing.id
          const id = Bun.randomUUIDv7()
          yield* db.putUser({ id, name: login, githubLogin: login, avatarUrl })
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

      const ingest = (repo: GithubRepo, issue: GhIssue) =>
        Effect.gen(function*() {
          if (issue.pull_request !== undefined) return "skipped" as const
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
                tx.touch("issue", issue.id)
              }))
            return
          }

          const changed = diff(link.shadow, desired)
          if (changed.length === 0) return
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
        })

      const flushOutbox = Effect.gen(function*() {
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
      }).pipe(flushLock.withPermits(1), Effect.orDie)

      const setRepoStatus = (repo: GithubRepo, error: string | null, announce: boolean) =>
        mutations.transact({ origin: "github", actorId: null }, (tx) =>
          Effect.gen(function*() {
            yield* sql`UPDATE github_repo SET last_synced_at = ${error ? repo.lastSyncedAt : Date.now()},
                       last_error = ${error} WHERE id = ${repo.id}`
            if (announce || error !== repo.lastError) tx.touch("githubRepo", repo.id)
          }))

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
          while (true) {
            const result = yield* gh.listIssues(repo.owner, repo.name, { since, etag: page === 1 ? etag : null, page })
            if (result._tag === "NotModified") break
            if (page === 1) firstEtag = result.etag
            for (const issue of result.issues) {
              const outcome = yield* ingest(repo, issue)
              if (outcome === "created") created++
              if (outcome === "updated") changed++
              if (!newest || issue.updated_at > newest) newest = issue.updated_at
            }
            if (!result.hasNext) break
            page++
          }
          // The ETag only applies to the exact URL, so drop it when `since` moves.
          const keepEtag = newest === since ? firstEtag : null
          yield* sql`UPDATE github_repo SET poll_since = ${newest}, poll_etag = ${keepEtag} WHERE id = ${repo.id}`
          yield* setRepoStatus(repo, null, created + changed > 0)
          return { created, changed }
        }).pipe(
          Effect.tapError((e) => setRepoStatus(repo, e.message, true).pipe(Effect.orDie)),
          Effect.catchTag("SqlError", Effect.die)
        )

      const pollAll = Effect.gen(function*() {
        for (const repo of yield* db.githubRepos.pipe(Effect.orDie)) {
          yield* pollRepo(repo, { full: false }).pipe(Effect.ignore)
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
      const projectFor = (input: { teamId: string; projectId: string | null; projectName?: string | undefined; name: string }) =>
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
          yield* mutations.apply({ origin: "system", actorId: null }, [{
            _tag: "ProjectCreate",
            id,
            teamId: input.teamId,
            name: wanted,
            color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length]!
          }]).pipe(Effect.mapError((e) => new GithubError({ message: e.message })))
          return id
        })

      const linkRepo = (input: {
        teamId: string
        projectId: string | null
        projectName?: string | undefined
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
            yield* sql`DELETE FROM github_repo WHERE id = ${repoId}`
            tx.touch("githubRepo", repoId, "delete")
            for (const row of linked) tx.touch("issue", row.issue_id as string)
          })).pipe(Effect.asVoid, Effect.catchTag("SqlError", Effect.die))

      const syncNow = (repoId: string) =>
        Effect.gen(function*() {
          const repo = yield* db.getRepo(repoId).pipe(Effect.orDie)
          if (!repo) return yield* new GithubError({ message: "Repository is not linked." })
          yield* pollRepo(repo, { full: false })
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
        flushOutbox,
        availableRepos: Effect.suspend(() => gh.availableRepos)
      })
    })
  )
}

const toLink = (r: Record<string, unknown>): LinkRow => ({
  issueId: r.issue_id as string,
  repoId: r.repo_id as string,
  ghNumber: Number(r.gh_number),
  ghUpdatedAt: r.gh_updated_at as string,
  shadow: JSON.parse(r.shadow as string) as Shadow
})

export type { SqlError }
