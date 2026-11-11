import {
  applyIssueMutation,
  applyLabelMutation,
  applyProjectMutation,
  applyRelationMutation,
  applyTeamMutation,
  identifier,
  type Issue,
  isProjectIconPath,
  isValidProjectKey,
  isValidTeamKey,
  type Delta,
  type ModelName,
  type Mutation,
  MutationRejected,
  uuidv7,
  wouldCycle
} from "@gradient/domain"
import { Context, Effect, Layer, Queue, Semaphore } from "effect"
import type { SqlError } from "effect/sql"
import { Db } from "../db/Db.ts"
import { DEFAULT_LABELS, DEFAULT_STATES } from "../db/defaults.ts"
import { Hub } from "./Hub.ts"

/**
 * Who made a change: the app (`client`), an agent over MCP (`mcp`), the GitHub
 * sync, or the server itself. `github` writes never go back out to GitHub;
 * every other origin queues an outbound sync when the issue has a repo: the one
 * it is linked to, or its project's.
 */
export type Origin = "client" | "mcp" | "github" | "system"

export interface TxContext {
  readonly now: number
  readonly origin: Origin
  readonly actorId: string | null
  /** Record that a row changed, so it is logged and broadcast after commit. */
  touch(model: ModelName, id: string, op?: "upsert" | "delete"): void
  /**
   * Queue an issue for an outbound GitHub sync without changing its row, e.g.
   * when its "blocked by" list changed. Ignored for `github` writes.
   */
  enqueue(issueId: string): void
}

export interface TxOptions {
  readonly origin: Origin
  readonly actorId: string | null
  readonly clientTxId?: string | null
}

const reject = (message: string) => Effect.fail(new MutationRejected({ message }))

export class Mutations extends Context.Service<Mutations, {
  /**
   * Run `body` in one SQL transaction. Every row it `touch`es is read back,
   * appended to the sync log and broadcast once the transaction commits.
   * Writes are serialized, so syncIds are published in commit order.
   */
  transact<A, E>(
    options: TxOptions,
    body: (tx: TxContext) => Effect.Effect<A, E | SqlError.SqlError, Db>
  ): Effect.Effect<{ readonly value: A; readonly syncId: number }, E>
  /** Validate and apply client-shaped mutations. Idempotent per clientTxId. */
  apply(
    options: TxOptions,
    mutations: ReadonlyArray<Mutation>
  ): Effect.Effect<{ readonly syncId: number }, MutationRejected>
  /** Issue ids whose GitHub copy needs an update. The outbox worker reads this. */
  readonly outboxSignal: Queue.Queue<void>
}>()("gradient/Mutations") {
  static readonly layer = Layer.effect(
    Mutations,
    Effect.gen(function*() {
      const db = yield* Db
      const hub = yield* Hub
      const lock = yield* Semaphore.make(1)
      const outboxSignal = yield* Queue.sliding<void>(1)

      const transact = <A, E>(
        options: TxOptions,
        body: (tx: TxContext) => Effect.Effect<A, E | SqlError.SqlError, Db>
      ) =>
        Effect.gen(function*() {
          const touched = new Map<string, { model: ModelName; id: string; op: "upsert" | "delete" }>()
          const outbound = new Set<string>()
          const tx: TxContext = {
            now: Date.now(),
            origin: options.origin,
            actorId: options.actorId,
            touch: (model, id, op = "upsert") => touched.set(`${model}:${id}`, { model, id, op }),
            enqueue: (issueId) => outbound.add(issueId)
          }
          const clientTxId = options.clientTxId ?? null
          const { value, deltas, queuedOutbound } = yield* db.sql.withTransaction(
            Effect.gen(function*() {
              const value = yield* body(tx)
              const deltas: Array<Delta> = []
              let queuedOutbound = false
              for (const { model, id, op } of touched.values()) {
                const entity = op === "delete" ? undefined : yield* db.loadEntity(model, id)
                if (op === "delete" || !entity) {
                  const syncId = yield* db.appendLog({
                    model, modelId: id, op: "delete", data: null, clientTxId,
                    origin: options.origin, actorId: options.actorId, now: tx.now
                  })
                  deltas.push({ _tag: "Delete", syncId, clientTxId, model, id })
                } else {
                  const syncId = yield* db.appendLog({
                    model, modelId: id, op: "upsert", data: entity, clientTxId,
                    origin: options.origin, actorId: options.actorId, now: tx.now
                  })
                  deltas.push({ _tag: "Upsert", syncId, clientTxId, entity })
                }
                if (model === "issue" && entity?.model === "issue") outbound.add(id)
              }
              if (options.origin !== "github") {
                for (const id of outbound) {
                  const issue = yield* db.getIssue(id)
                  if (!issue || !(yield* db.repoForIssue(issue))) continue
                  yield* db.sql`INSERT INTO github_outbox (issue_id, enqueued_at, next_attempt_at)
                                VALUES (${id}, ${tx.now}, ${tx.now})
                                ON CONFLICT (issue_id) DO UPDATE SET next_attempt_at = excluded.next_attempt_at,
                                                                     attempts = 0`
                  queuedOutbound = true
                }
              }
              return { value, deltas, queuedOutbound }
            }).pipe(Effect.provideService(Db, db))
          )
          yield* hub.publish(deltas)
          if (queuedOutbound) yield* Queue.offer(outboxSignal, undefined)
          const syncId = deltas.at(-1)?.syncId ?? (yield* db.lastSyncId)
          return { value, syncId }
        }).pipe(
          lock.withPermits(1),
          Effect.catchTag("SqlError", Effect.die)
        ) as Effect.Effect<{ value: A; syncId: number }, E>

      const applyOne = (tx: TxContext, m: Mutation) =>
        Effect.gen(function*() {
          // System writes (seed, GitHub import) have no actor; credit the local user.
          const actorId = tx.actorId ?? (yield* db.getMeta("viewer_id")) ?? "unknown"
          const checkRefs = Effect.fnUntraced(function*(teamId: string, fields: {
            stateId?: string | undefined
            labelIds?: ReadonlyArray<string> | undefined
            assigneeId?: string | null | undefined
            projectId?: string | null | undefined
            title?: string | undefined
          }) {
            if (fields.title !== undefined && fields.title.trim() === "") return yield* reject("Title is required")
            if (fields.projectId) {
              const project = yield* db.getProject(fields.projectId)
              if (!project || project.teamId !== teamId) return yield* reject("Unknown project")
            }
            if (fields.stateId !== undefined) {
              const state = yield* db.getState(fields.stateId)
              if (!state || state.teamId !== teamId) return yield* reject("Unknown workflow state")
            }
            for (const labelId of fields.labelIds ?? []) {
              const label = yield* db.getLabel(labelId)
              if (!label || label.teamId !== teamId) return yield* reject("Unknown label")
            }
            if (fields.assigneeId) {
              if (!(yield* db.getUser(fields.assigneeId))) return yield* reject("Unknown assignee")
            }
          })

          /**
           * Every key prefixes identifiers (TES-12), so a key is unique across
           * the workspace: no two teams, no two projects, and no team and
           * project share one.
           */
          const keyTaken = Effect.fnUntraced(function*(key: string, self: { team?: string; project?: string }) {
            const team = yield* db.getTeamByKey(key)
            if (team && team.id !== self.team) return `the team "${team.name}"`
            const project = (yield* db.projects).find((p) => p.key === key && p.id !== self.project)
            if (project) return `the project "${project.name}"`
            return null
          })

          /** Changes by people (the app, agents) are checked against the actor's role; the server's own are not. */
          const byPerson = tx.origin === "client" || tx.origin === "mcp"
          const actor = byPerson && tx.actorId ? yield* db.getUser(tx.actorId) : undefined
          const isAdmin = actor?.role === "admin"
          /** Admins, and members of the team, manage it. */
          const checkManages = Effect.fnUntraced(function*(teamId: string, what: string) {
            if (!byPerson || isAdmin) return
            if (!tx.actorId || !(yield* db.membership(teamId, tx.actorId))) {
              return yield* reject(`Only members of the team and admins can ${what}`)
            }
          })

          const checkProjectName = Effect.fnUntraced(function*(teamId: string, name: string, self?: string) {
            if (name.trim() === "") return yield* reject("A project needs a name")
            const clash = (yield* db.projectsForTeam(teamId)).find(
              (p) => p.id !== self && p.name.toLowerCase() === name.trim().toLowerCase()
            )
            if (clash) return yield* reject(`Project "${clash.name}" already exists`)
          })

          const checkProjectKey = Effect.fnUntraced(function*(teamId: string, key: string, self?: string) {
            if (!isValidProjectKey(key)) {
              return yield* reject(`"${key}" is not a valid key: 2–5 capital letters or digits, starting with a letter`)
            }
            const team = yield* db.getTeam(teamId)
            if (team && team.key.toUpperCase() === key) return yield* reject(`"${key}" is the team's own key`)
            const clash = yield* keyTaken(key, self ? { project: self } : {})
            if (clash) return yield* reject(`The key "${key}" is taken by ${clash}`)
          })

          const checkTeamName = Effect.fnUntraced(function*(name: string, self?: string) {
            if (name.trim() === "") return yield* reject("A team needs a name")
            const clash = (yield* db.teams).find((t) => t.id !== self && t.name.toLowerCase() === name.trim().toLowerCase())
            if (clash) return yield* reject(`Team "${clash.name}" already exists`)
          })

          const checkTeamKey = Effect.fnUntraced(function*(key: string, self?: string) {
            if (!isValidTeamKey(key)) {
              return yield* reject(`"${key}" is not a valid key: 2–5 capital letters or digits, starting with a letter`)
            }
            const clash = yield* keyTaken(key, self ? { team: self } : {})
            if (clash) return yield* reject(`The key "${key}" is taken by ${clash}`)
          })

          /** "TES-12", for error messages. */
          const name = (issue: Issue) =>
            Effect.gen(function*() {
              const team = yield* db.getTeam(issue.teamId)
              const project = issue.projectId ? yield* db.getProject(issue.projectId) : undefined
              return team ? identifier(team, issue, project) : issue.title
            })

          switch (m._tag) {
            case "TeamCreate": {
              if (byPerson && !actor?.role) return yield* reject("Only people with an account can create teams")
              if (yield* db.getTeam(m.id)) return yield* reject("Team already exists")
              yield* checkTeamName(m.name)
              yield* checkTeamKey(m.key)
              yield* db.putTeam({ ...applyTeamMutation(undefined, m)!, name: m.name.trim() })
              tx.touch("team", m.id)
              for (const [position, state] of DEFAULT_STATES.entries()) {
                const id = uuidv7()
                yield* db.putState({ id, teamId: m.id, name: state.name, type: state.type, position, color: state.color })
                tx.touch("workflowState", id)
              }
              for (const label of DEFAULT_LABELS) {
                const id = uuidv7()
                yield* db.putLabel({ id, teamId: m.id, name: label.name, color: label.color })
                tx.touch("label", id)
              }
              if (actor) {
                const memberId = uuidv7()
                yield* db.putTeamMember({ id: memberId, teamId: m.id, userId: actor.id, createdAt: tx.now })
                tx.touch("teamMember", memberId)
              }
              return
            }
            case "TeamUpdate": {
              const current = yield* db.getTeam(m.id)
              if (!current) return yield* reject("Team not found")
              yield* checkManages(current.id, "change it")
              if (m.patch.name !== undefined) yield* checkTeamName(m.patch.name, current.id)
              if (m.patch.key !== undefined) yield* checkTeamKey(m.patch.key, current.id)
              const next = applyTeamMutation(current, m)!
              yield* db.putTeam({ ...next, name: next.name.trim() })
              tx.touch("team", m.id)
              return
            }
            case "TeamDelete": {
              const current = yield* db.getTeam(m.id)
              if (!current) return
              if (byPerson && !isAdmin) return yield* reject("Only admins can delete a team")
              if ((yield* db.teams).length === 1) return yield* reject("The last team cannot be deleted")
              const repo = (yield* db.githubRepos).find((r) => r.teamId === m.id)
              if (repo) return yield* reject(`Unlink ${repo.owner}/${repo.name} first`)
              const issues = yield* db.sql`SELECT COUNT(*) AS n FROM issue WHERE team_id = ${m.id}`
              const count = Number(issues[0]?.n ?? 0)
              if (count > 0) {
                return yield* reject(`${current.name} still has ${count} issue${count === 1 ? "" : "s"}. Delete them first`)
              }
              for (const member of yield* db.membersOfTeam(m.id)) tx.touch("teamMember", member.id, "delete")
              for (const project of yield* db.projectsForTeam(m.id)) {
                yield* db.deleteProject(project.id)
                tx.touch("project", project.id, "delete")
              }
              for (const label of yield* db.labelsForTeam(m.id)) tx.touch("label", label.id, "delete")
              for (const state of yield* db.statesForTeam(m.id)) tx.touch("workflowState", state.id, "delete")
              yield* db.sql`DELETE FROM label WHERE team_id = ${m.id}`
              yield* db.sql`DELETE FROM workflow_state WHERE team_id = ${m.id}`
              // Memberships go with the team (the foreign key cascades).
              yield* db.deleteTeam(m.id)
              tx.touch("team", m.id, "delete")
              return
            }
            case "TeamMemberAdd": {
              const team = yield* db.getTeam(m.teamId)
              if (!team) return yield* reject("Unknown team")
              const user = yield* db.getUser(m.userId)
              if (!user) return yield* reject("Unknown person")
              if (!user.role) return yield* reject(`${user.name} has no account. Invite them first`)
              if (m.userId !== tx.actorId) yield* checkManages(team.id, "add people to it")
              if (yield* db.membership(team.id, user.id)) return yield* reject(`${user.name} is already in ${team.name}`)
              if (yield* db.getTeamMember(m.id)) return yield* reject("Membership already exists")
              yield* db.putTeamMember({ id: m.id, teamId: team.id, userId: user.id, createdAt: tx.now })
              tx.touch("teamMember", m.id)
              return
            }
            case "TeamMemberRemove": {
              const current = yield* db.getTeamMember(m.id)
              if (!current) return
              if (current.userId !== tx.actorId) yield* checkManages(current.teamId, "remove people from it")
              yield* db.deleteTeamMember(m.id)
              tx.touch("teamMember", m.id, "delete")
              return
            }
            case "ProjectCreate": {
              if (!(yield* db.getTeam(m.teamId))) return yield* reject("Unknown team")
              if (yield* db.getProject(m.id)) return yield* reject("Project already exists")
              yield* checkProjectName(m.teamId, m.name)
              yield* checkProjectKey(m.teamId, m.key)
              const project = applyProjectMutation(undefined, m, { now: tx.now })!
              yield* db.putProject({ ...project, name: project.name.trim() })
              tx.touch("project", m.id)
              return
            }
            case "ProjectUpdate": {
              const current = yield* db.getProject(m.id)
              if (!current) return yield* reject("Project not found")
              if (m.patch.name !== undefined) yield* checkProjectName(current.teamId, m.patch.name, current.id)
              if (m.patch.key !== undefined) yield* checkProjectKey(current.teamId, m.patch.key, current.id)
              const next = applyProjectMutation(current, m, { now: tx.now })!
              if (m.patch.icon) {
                if (!isProjectIconPath(m.patch.icon.path)) return yield* reject(`${m.patch.icon.path} is not an image`)
                if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(m.patch.icon.sha)) return yield* reject("Invalid file sha")
                if (!(yield* db.repoForProject(m.id))) {
                  return yield* reject("Link a GitHub repository first: project icons come from its files")
                }
              }
              if (next.iconMode === "repo" && !next.icon) return yield* reject("Pick a file for the project icon")
              yield* db.putProject({ ...next, name: next.name.trim() })
              tx.touch("project", m.id)
              // Identifiers of its issues change with the key; clients derive them, so no issue rows change.
              return
            }
            case "ProjectDelete": {
              const current = yield* db.getProject(m.id)
              if (!current) return
              const repo = yield* db.repoForProject(m.id)
              if (repo) return yield* reject(`Unlink ${repo.owner}/${repo.name} from this project first`)
              const issues = yield* db.sql`SELECT id FROM issue WHERE project_id = ${m.id}`
              yield* db.sql`UPDATE issue SET project_id = NULL, updated_at = ${tx.now} WHERE project_id = ${m.id}`
              yield* db.deleteProject(m.id)
              for (const row of issues) tx.touch("issue", row.id as string)
              tx.touch("project", m.id, "delete")
              return
            }
            case "IssueCreate": {
              if (!(yield* db.getTeam(m.teamId))) return yield* reject("Unknown team")
              if (yield* db.getIssue(m.id)) return yield* reject("Issue already exists")
              yield* checkRefs(m.teamId, m)
              const number = (yield* db.nextIssueNumber(m.teamId))!
              const issue = applyIssueMutation(undefined, m, { now: tx.now, actorId, number })!
              yield* db.putIssue({ ...issue, title: issue.title.trim() })
              tx.touch("team", m.teamId)
              tx.touch("issue", m.id)
              return
            }
            case "IssueUpdate":
            case "IssueArchive":
            case "IssueUnarchive": {
              const current = yield* db.getIssue(m.id)
              if (!current) return yield* reject("Issue not found")
              if (m._tag === "IssueUpdate") yield* checkRefs(current.teamId, m.patch)
              const next = applyIssueMutation(current, m, { now: tx.now, actorId })!
              yield* db.putIssue({ ...next, title: next.title.trim() })
              tx.touch("issue", m.id)
              return
            }
            case "IssueDelete": {
              if (!(yield* db.getIssue(m.id))) return
              for (const r of yield* db.relationsOf(m.id)) {
                yield* db.deleteRelation(r.id)
                tx.touch("issueRelation", r.id, "delete")
                // What it blocked is free now, on GitHub too.
                if (r.type === "blocks" && r.issueId === m.id) tx.enqueue(r.relatedIssueId)
              }
              // Its comments go with it (the foreign key cascades); tell clients.
              const comments = yield* db.sql`SELECT id FROM issue_comment WHERE issue_id = ${m.id}`
              for (const c of comments) tx.touch("issueComment", c.id as string, "delete")
              const linked = yield* db.sql`SELECT id FROM linked_pull_request WHERE issue_id = ${m.id}`
              for (const l of linked) tx.touch("linkedPullRequest", l.id as string, "delete")
              yield* db.deleteIssue(m.id)
              tx.touch("issue", m.id, "delete")
              return
            }
            case "RelationCreate": {
              if (yield* db.getRelation(m.id)) return yield* reject("Relation already exists")
              const from = yield* db.getIssue(m.issueId)
              const to = yield* db.getIssue(m.relatedIssueId)
              if (!from || !to) return yield* reject("Issue not found")
              if (from.teamId !== m.teamId || to.teamId !== m.teamId) {
                return yield* reject("Only issues of the same team can be related")
              }
              if (from.id === to.id) return yield* reject("An issue cannot relate to itself")
              const existing = yield* db.relationBetween(from.id, to.id)
              if (existing) {
                return yield* reject(`${yield* name(from)} and ${yield* name(to)} are already related`)
              }
              if (m.type === "blocks" && wouldCycle(yield* db.relationsForTeam(m.teamId), from.id, to.id)) {
                return yield* reject(
                  `${yield* name(to)} already blocks ${yield* name(from)}, directly or through other issues`
                )
              }
              yield* db.putRelation(applyRelationMutation(undefined, m, { now: tx.now })!)
              tx.touch("issueRelation", m.id)
              if (m.type === "blocks") tx.enqueue(m.relatedIssueId)
              return
            }
            case "RelationDelete": {
              const current = yield* db.getRelation(m.id)
              if (!current) return
              yield* db.deleteRelation(m.id)
              tx.touch("issueRelation", m.id, "delete")
              if (current.type === "blocks") tx.enqueue(current.relatedIssueId)
              return
            }
            case "LabelCreate": {
              if (!(yield* db.getTeam(m.teamId))) return yield* reject("Unknown team")
              const existing = (yield* db.labelsForTeam(m.teamId)).find(
                (l) => l.name.toLowerCase() === m.name.trim().toLowerCase()
              )
              if (existing) return yield* reject(`Label "${existing.name}" already exists`)
              yield* db.putLabel({ ...applyLabelMutation(m)!, name: m.name.trim() })
              tx.touch("label", m.id)
              return
            }
          }
        })

      const apply = (options: TxOptions, mutations: ReadonlyArray<Mutation>) =>
        Effect.gen(function*() {
          if (options.clientTxId) {
            const seen = yield* db.syncIdForClientTx(options.clientTxId).pipe(Effect.orDie)
            if (seen !== null) return { syncId: seen }
          }
          const { syncId } = yield* transact(options, (tx) =>
            Effect.forEach(mutations, (m) => applyOne(tx, m), { discard: true }))
          return { syncId }
        })

      return Mutations.of({ transact, apply, outboxSignal })
    })
  )
}
