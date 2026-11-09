import { identifier, type Issue, keyBetween, type Mutation, type Priority, uuidv7 } from "@gradient/domain"
import { Effect, Layer } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { ServerConfig } from "../config.ts"
import { Db } from "../db/Db.ts"
import { Mutations } from "../sync/Mutations.ts"
import { GradientToolkit, type IssueDetail, type IssueSummary, ToolError } from "./tools.ts"

const PRIORITY_NAMES: Record<Priority, string> = { 0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low" }
const PRIORITY_VALUES: Record<string, Priority> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 }
const fail = (message: string) => Effect.fail(new ToolError({ message }))
const iso = (ms: number) => new Date(ms).toISOString()

export const mcpUrl = (config: { host: string; port: number }) =>
  `http://${config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host}:${config.port}/mcp`

const INSTRUCTIONS = `Gradient is the user's issue tracker. Issues have identifiers like GRD-12.
Call describe_workspace once to learn workflow states, labels and people, then use those names.
Writes show up live in the user's app and sync to GitHub when a repo is linked, so keep titles short and specific, and put detail in the description (markdown).`

const SKILL = `---
name: gradient
description: Track work in Gradient, the user's issue tracker. Use when planning, starting, finishing or reporting on work, or when the user mentions an issue like GRD-12.
---

# Working with Gradient

1. Call \`describe_workspace\` once per session. It lists the workflow states in
   order, the labels and the people. Use those exact names.
2. Before creating an issue, \`list_issues\` with a \`query\` to avoid duplicates.
3. Titles: short and specific, in the imperative ("Fix crash when saving offline").
   Put context, reproduction steps and acceptance criteria in the description.
4. When you start on an issue, move it to the first "started" state and assign
   it to "me". When the work is in review, use the review state if the team has
   one. Move it to a "completed" state only when the change has landed.
5. Mention the identifier (GRD-12) in branch names, commit messages and pull
   request titles, so the work links back.
6. Never mass-edit or archive issues you did not create unless the user asks.
`

const ToolHandlers = GradientToolkit.toLayer(
  Effect.gen(function*() {
    const db = yield* Db
    const mutations = yield* Mutations
    const config = yield* ServerConfig

    /** Everything needed to translate between names and ids. Small enough to load per call. */
    const workspace = Effect.gen(function*() {
      const team = (yield* db.teams)[0]
      if (!team) return yield* fail("No team exists yet.")
      const viewerId = (yield* db.getMeta("viewer_id"))!
      const states = yield* db.statesForTeam(team.id)
      const labels = yield* db.labelsForTeam(team.id)
      const users = yield* db.users
      const repo = yield* db.repoForTeam(team.id)
      return { team, viewerId, states, labels, users, repo }
    }).pipe(Effect.catchTag("SqlError", Effect.die))
    type Workspace = Effect.Success<typeof workspace>

    const names = (list: ReadonlyArray<{ name: string }>) => list.map((x) => `"${x.name}"`).join(", ")

    const resolveState = (ws: Workspace, name: string) => {
      const n = name.trim().toLowerCase()
      const state = ws.states.find((s) => s.name.toLowerCase() === n) ?? ws.states.find((s) => s.type === n)
      return state ? Effect.succeed(state) : fail(`Unknown state "${name}". Valid: ${names(ws.states)}.`)
    }
    const resolvePerson = (ws: Workspace, who: string) => {
      const n = who.trim().replace(/^@/, "").toLowerCase()
      if (n === "none" || n === "") return Effect.succeed(null)
      if (n === "me") return Effect.succeed(ws.viewerId)
      const user = ws.users.find((u) => u.name.toLowerCase() === n || u.githubLogin?.toLowerCase() === n)
      return user ? Effect.succeed(user.id) : fail(`Unknown person "${who}". Valid: "me", ${names(ws.users)}.`)
    }
    const resolveLabels = (ws: Workspace, list: ReadonlyArray<string>) =>
      Effect.forEach(list, (name) => {
        const label = ws.labels.find((l) => l.name.toLowerCase() === name.trim().toLowerCase())
        return label ? Effect.succeed(label.id) : fail(`Unknown label "${name}". Valid: ${names(ws.labels)}.`)
      })
    const findIssue = (ws: Workspace, ref: string) =>
      Effect.gen(function*() {
        const match = ref.trim().match(/^([a-z]+)-(\d+)$/i)
        const issues = yield* db.issuesForTeam(ws.team.id).pipe(Effect.orDie)
        const issue = match && match[1]!.toLowerCase() === ws.team.key.toLowerCase()
          ? issues.find((i) => i.number === Number(match[2]))
          : issues.find((i) => i.id === ref)
        return issue ?? (yield* fail(`No issue "${ref}". Identifiers look like ${ws.team.key}-12.`))
      })

    const summary = (ws: Workspace, issue: Issue): IssueSummary => ({
      id: identifier(ws.team, issue),
      title: issue.title,
      state: ws.states.find((s) => s.id === issue.stateId)?.name ?? "?",
      priority: PRIORITY_NAMES[issue.priority],
      assignee: ws.users.find((u) => u.id === issue.assigneeId)?.name ?? null,
      labels: issue.labelIds.flatMap((id) => ws.labels.find((l) => l.id === id)?.name ?? []),
      github: issue.github?.url ?? null,
      updated: iso(issue.updatedAt)
    })
    const detail = (ws: Workspace, issue: Issue): IssueDetail => ({
      ...summary(ws, issue),
      description: issue.description,
      creator: ws.users.find((u) => u.id === issue.creatorId)?.name ?? "unknown",
      created: iso(issue.createdAt),
      archived: issue.archivedAt !== null,
      url: `http://${config.host}:${config.port}/issue/${identifier(ws.team, issue)}`
    })

    const apply = (ws: Workspace, list: ReadonlyArray<Mutation>) =>
      mutations.apply({ origin: "mcp", actorId: ws.viewerId, clientTxId: null }, list).pipe(
        Effect.mapError((e) => new ToolError({ message: e.message }))
      )
    const reload = (ws: Workspace, id: string) =>
      db.getIssue(id).pipe(
        Effect.orDie,
        Effect.flatMap((issue) => (issue ? Effect.succeed(detail(ws, issue)) : fail("The issue disappeared.")))
      )

    const isOpen = (ws: Workspace, issue: Issue) => {
      const type = ws.states.find((s) => s.id === issue.stateId)?.type
      return type !== "completed" && type !== "canceled"
    }
    const rank = (ws: Workspace, issue: Issue) =>
      [issue.priority === 0 ? 5 : issue.priority, ws.states.findIndex((s) => s.id === issue.stateId) * -1] as const

    return GradientToolkit.of({
      describe_workspace: Effect.fn("mcp.describe_workspace")(function*() {
        const ws = yield* workspace
        const issues = yield* db.issuesForTeam(ws.team.id).pipe(Effect.orDie)
        return {
          team: { key: ws.team.key, name: ws.team.name },
          you: ws.users.find((u) => u.id === ws.viewerId)?.name ?? "me",
          states: ws.states.map((s) => ({ name: s.name, type: s.type })),
          labels: ws.labels.map((l) => l.name),
          people: ws.users.map((u) => ({ name: u.name, githubLogin: u.githubLogin })),
          githubRepo: ws.repo ? `${ws.repo.owner}/${ws.repo.name}` : null,
          openIssues: issues.filter((i) => i.archivedAt === null && isOpen(ws, i)).length
        }
      }),

      list_issues: Effect.fn("mcp.list_issues")(function*(input) {
        const ws = yield* workspace
        let issues = yield* db.issuesForTeam(ws.team.id).pipe(Effect.orDie)
        if (!input.include_archived) issues = issues.filter((i) => i.archivedAt === null)
        const state = (input.state ?? "open").trim().toLowerCase()
        if (state === "open") issues = issues.filter((i) => isOpen(ws, i))
        else if (state !== "all") {
          const byName = ws.states.find((s) => s.name.toLowerCase() === state)
          const ids = byName ? [byName.id] : ws.states.filter((s) => s.type === state).map((s) => s.id)
          if (ids.length === 0) return yield* fail(`Unknown state "${input.state}". Use "open", "all", ${names(ws.states)} or a type.`)
          issues = issues.filter((i) => ids.includes(i.stateId))
        }
        if (input.assignee !== undefined) {
          const who = yield* resolvePerson(ws, input.assignee)
          issues = issues.filter((i) => i.assigneeId === who)
        }
        if (input.label !== undefined) {
          const [labelId] = yield* resolveLabels(ws, [input.label])
          issues = issues.filter((i) => i.labelIds.includes(labelId!))
        }
        if (input.query) {
          const q = input.query.toLowerCase()
          issues = issues.filter((i) => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
        }
        issues.sort((a, b) => {
          const [pa, sa] = rank(ws, a)
          const [pb, sb] = rank(ws, b)
          return pa - pb || sa - sb || b.updatedAt - a.updatedAt
        })
        const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
        return { total: issues.length, issues: issues.slice(0, limit).map((i) => summary(ws, i)) }
      }),

      get_issue: Effect.fn("mcp.get_issue")(function*({ id }) {
        const ws = yield* workspace
        return detail(ws, yield* findIssue(ws, id))
      }),

      create_issue: Effect.fn("mcp.create_issue")(function*(input) {
        const ws = yield* workspace
        if (input.title.trim() === "") return yield* fail("A title is required.")
        const state = input.state
          ? yield* resolveState(ws, input.state)
          : ws.states.find((s) => s.type === "unstarted") ?? ws.states[0]!
        const id = uuidv7()
        const top = yield* db.topSortOrder(ws.team.id).pipe(Effect.orDie)
        yield* apply(ws, [{
          _tag: "IssueCreate",
          id,
          teamId: ws.team.id,
          title: input.title.trim(),
          description: input.description ?? "",
          stateId: state.id,
          priority: PRIORITY_VALUES[input.priority ?? "none"]!,
          assigneeId: input.assignee !== undefined ? yield* resolvePerson(ws, input.assignee) : null,
          labelIds: input.labels ? yield* resolveLabels(ws, input.labels) : [],
          sortOrder: keyBetween(top ?? null, null)
        }])
        return yield* reload(ws, id)
      }),

      update_issue: Effect.fn("mcp.update_issue")(function*(input) {
        const ws = yield* workspace
        const issue = yield* findIssue(ws, input.id)
        const patch: { -readonly [K in keyof Extract<Mutation, { _tag: "IssueUpdate" }>["patch"]]: any } = {}
        if (input.title !== undefined) patch.title = input.title
        if (input.description !== undefined) patch.description = input.description
        if (input.state !== undefined) patch.stateId = (yield* resolveState(ws, input.state)).id
        if (input.priority !== undefined) patch.priority = PRIORITY_VALUES[input.priority]
        if (input.assignee !== undefined) patch.assigneeId = yield* resolvePerson(ws, input.assignee)
        if (input.labels || input.add_labels || input.remove_labels) {
          let ids = input.labels ? yield* resolveLabels(ws, input.labels) : [...issue.labelIds]
          for (const id of yield* resolveLabels(ws, input.add_labels ?? [])) if (!ids.includes(id)) ids.push(id)
          const remove = yield* resolveLabels(ws, input.remove_labels ?? [])
          ids = ids.filter((id) => !remove.includes(id))
          patch.labelIds = ids
        }
        const list: Array<Mutation> = []
        if (Object.keys(patch).length > 0) list.push({ _tag: "IssueUpdate", id: issue.id, patch })
        if (input.archived === true && issue.archivedAt === null) list.push({ _tag: "IssueArchive", id: issue.id })
        if (input.archived === false && issue.archivedAt !== null) list.push({ _tag: "IssueUnarchive", id: issue.id })
        if (list.length > 0) yield* apply(ws, list)
        return yield* reload(ws, issue.id)
      })
    })
  })
)

/** Gradient over MCP (Streamable HTTP) at /mcp, with its tools and a usage skill. */
export const McpRoute = McpServer.layerHttp({
  name: "gradient",
  version: "0.1.0",
  description: "Gradient issue tracker",
  instructions: INSTRUCTIONS,
  path: "/mcp",
  protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
  registrations: Layer.mergeAll(
    McpServer.toolkit(GradientToolkit),
    McpServer.skill({ uri: "skill://gradient/SKILL.md", files: { "SKILL.md": SKILL } })
  ).pipe(Layer.provide(ToolHandlers))
})

