import { type Issue, keyBetween, PROJECT_COLORS } from "@gradient/domain"
import { Effect } from "effect"
import { ServerConfig } from "./config.ts"
import { Db } from "./db/Db.ts"
import { DEFAULT_LABELS, DEFAULT_STATES } from "./db/defaults.ts"
import { Mutations } from "./sync/Mutations.ts"

const SAMPLE: ReadonlyArray<{
  title: string
  state: string
  priority: Issue["priority"]
  labels: ReadonlyArray<string>
  mine?: boolean
  description?: string
  project?: string
}> = [
  { title: "Sync engine: replay deltas after reconnect", state: "In Progress", priority: 1, labels: ["Feature"], mine: true, project: "Sync engine" },
  { title: "Two-way GitHub sync for issue labels", state: "In Progress", priority: 2, labels: ["Feature"], mine: true, project: "Sync engine" },
  { title: "Theme presets and custom colors", state: "In Review", priority: 3, labels: ["Improvement"], mine: true, project: "App" },
  { title: "Keyboard shortcut to create an issue", state: "Todo", priority: 3, labels: ["Improvement"], project: "App" },
  { title: "Issue list jumps when a row updates", state: "Todo", priority: 2, labels: ["Bug"], project: "App" },
  { title: "Command palette", state: "Backlog", priority: 4, labels: ["Feature"], project: "App" },
  { title: "Board view grouped by state", state: "Backlog", priority: 0, labels: ["Feature"], project: "App" },
  { title: "Comments, synced with GitHub", state: "Backlog", priority: 3, labels: ["Feature"], project: "Sync engine" },
  { title: "Set up the repository", state: "Done", priority: 0, labels: ["Chore"], mine: true },
  {
    title: "Welcome to Gradient",
    state: "Todo",
    priority: 0,
    labels: [],
    description:
      "Press **C** anywhere to create an issue. Group issues into projects from the sidebar; a project can link a GitHub repository, and its issues then sync both ways."
  }
]

/** Creates the default team, workflow and local user on first start. */
export const seed = Effect.gen(function*() {
  const db = yield* Db
  const config = yield* ServerConfig
  const mutations = yield* Mutations
  if ((yield* db.teams).length > 0) return

  yield* mutations.transact({ origin: "system", actorId: null }, (tx) =>
    Effect.gen(function*() {
      const teamId = Bun.randomUUIDv7()
      const viewerId = Bun.randomUUIDv7()
      yield* db.putTeam({ id: teamId, key: "GRD", name: "Gradient", issueCounter: 0 })
      tx.touch("team", teamId)
      // No role until an account takes this user over (the first account becomes its admin).
      yield* db.putUser({ id: viewerId, name: process.env.GRADIENT_USER_NAME ?? "Me", githubLogin: null, avatarUrl: null, role: null })
      yield* db.setMeta("viewer_id", viewerId)
      tx.touch("user", viewerId)
      const memberId = Bun.randomUUIDv7()
      yield* db.putTeamMember({ id: memberId, teamId, userId: viewerId, createdAt: tx.now })
      tx.touch("teamMember", memberId)

      const stateIds = new Map<string, string>()
      for (const [position, s] of DEFAULT_STATES.entries()) {
        const id = Bun.randomUUIDv7()
        stateIds.set(s.name, id)
        yield* db.putState({ id, teamId, name: s.name, type: s.type, position, color: s.color })
        tx.touch("workflowState", id)
      }
      const labelIds = new Map<string, string>()
      for (const l of DEFAULT_LABELS) {
        const id = Bun.randomUUIDv7()
        labelIds.set(l.name, id)
        yield* db.putLabel({ id, teamId, name: l.name, color: l.color })
        tx.touch("label", id)
      }
      if (!config.seedSampleData) return

      // Two sample projects, so the sidebar shows how issues are grouped.
      const projectIds = new Map<string, string>()
      for (const [i, [name, key]] of [["Sync engine", "SYN"], ["App", "APP"]].entries()) {
        const id = Bun.randomUUIDv7()
        projectIds.set(name!, id)
        yield* db.putProject({ id, teamId, key: key!, name: name!, color: PROJECT_COLORS[i]!, iconMode: "auto", icon: null, createdAt: tx.now })
        tx.touch("project", id)
      }

      let sortOrder: string | null = null
      for (const [index, sample] of SAMPLE.entries()) {
        const id = Bun.randomUUIDv7()
        const number = (yield* db.nextIssueNumber(teamId))!
        sortOrder = keyBetween(sortOrder, null)
        const at = tx.now - (SAMPLE.length - index) * 3_600_000
        yield* db.putIssue({
          id,
          teamId,
          projectId: sample.project ? projectIds.get(sample.project)! : null,
          number,
          title: sample.title,
          description: sample.description ?? "",
          stateId: stateIds.get(sample.state)!,
          priority: sample.priority,
          assigneeId: sample.mine ? viewerId : null,
          creatorId: viewerId,
          labelIds: sample.labels.map((l) => labelIds.get(l)!),
          sortOrder,
          github: null,
          createdAt: at,
          updatedAt: at,
          archivedAt: null
        })
        tx.touch("issue", id)
      }
    }))
}).pipe(Effect.orDie)
