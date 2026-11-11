import {
  CurrentViewer,
  identifier,
  isOpenBlocker,
  type Issue,
  type Project,
  keyBetween,
  type Mutation,
  parseIdentifier,
  type Priority,
  PROJECT_COLORS,
  projectKeyFor,
  pullRequestRefersTo,
  type Reference,
  type Team,
  teamKeyFor,
  teamKeys,
  textReferences,
  invitePath,
  uuidv7
} from "@gradient/domain"
import { Effect, Layer, Option } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { Members } from "../auth/Members.ts"
import { ServerConfig } from "../config.ts"
import { Db } from "../db/Db.ts"
import { GithubAuth } from "../github/GithubAuth.ts"
import { GithubSync } from "../github/GithubSync.ts"
import { Mutations } from "../sync/Mutations.ts"
import { GradientToolkit, type IssueDetail, type IssueSummary, ToolError } from "./tools.ts"

const PRIORITY_NAMES: Record<Priority, string> = { 0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low" }
const PRIORITY_VALUES: Record<string, Priority> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 }
const fail = (message: string) => Effect.fail(new ToolError({ message }))
const iso = (ms: number) => new Date(ms).toISOString()

export const mcpUrl = (config: { host: string; port: number }) =>
  `http://${config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host}:${config.port}/mcp`

const INSTRUCTIONS = `Gradient is the user's issue tracker. Issues have identifiers like TES-12: the key of their project (or of their team, GRD, when they have none) and a number.
The workspace has teams; each has its own workflow states, labels and projects. Tools work in your first team unless you pass \`team\`; tools that take an identifier find its team themselves.
Call describe_workspace once to learn teams, workflow states, labels, people and projects, then use those names.
Put issues in the project they belong to; a project with a linked repo syncs its issues to GitHub.
Record dependencies with link_issues ("blocked_by"); get_issue shows blockers, the pull requests that refer to an issue, its comments and what it mentions.
Writes show up live in the user's app and sync to GitHub when a repo is linked, so keep titles short and specific, and put detail in the description (markdown).`

const SKILL = `---
name: gradient
description: Track work in Gradient, the user's issue tracker. Use when planning, starting, finishing or reporting on work, or when the user mentions an issue like GRD-12 or TES-4.
---

# Working with Gradient

1. Call \`describe_workspace\` once per session. It lists the teams, the workflow
   states in order, the labels and the people. Use those exact names. Pass
   \`team\` to work in a team other than your first.
2. Before creating an issue, \`list_issues\` with a \`query\` to avoid duplicates.
3. Titles: short and specific, in the imperative ("Fix crash when saving offline").
   Put context, reproduction steps and acceptance criteria in the description.
4. When you start on an issue, move it to the first "started" state and assign
   it to "me". When the work is in review, use the review state if the team has
   one. Move it to a "completed" state only when the change has landed.
5. Mention the identifier (GRD-12) in commit messages and pull request titles
   or bodies, so the pull request shows on the issue. "Fixes #12" in a pull
   request body links it to the GitHub issue too.
6. When one issue cannot finish before another, \`link_issues\` with
   "blocked_by". Prefer issues with \`blocked: false\` when picking what to do
   next (\`list_issues\` with \`blocked: false\`).
7. Never mass-edit or archive issues you did not create unless the user asks.
8. To bring a new person in, an admin can \`invite_person\`: hand the link to the
   user to send on. Add people who already have an account with
   \`add_team_member\`.
`

const ToolHandlers = GradientToolkit.toLayer(
  Effect.gen(function*() {
    const db = yield* Db
    const mutations = yield* Mutations
    const config = yield* ServerConfig
    const auth = yield* GithubAuth
    const github = yield* GithubSync
    const members = yield* Members

    /** The user behind the agent key of this request (resolved by RequireApiKey). */
    const viewerId = Effect.gen(function*() {
      const viewer = yield* Effect.serviceOption(CurrentViewer)
      if (Option.isNone(viewer)) return yield* fail("Not signed in: send an agent key from your Gradient profile.")
      return viewer.value.userId
    })

    const teamList = (teams: ReadonlyArray<Team>) => teams.map((t) => `"${t.name}" (${t.key})`).join(", ")

    /**
     * The team a tool works in: the one named (by name or key), else the
     * caller's first team by name, else the first team.
     */
    const resolveTeam = (ref: string | undefined, userId: string) =>
      Effect.gen(function*() {
        const teams = yield* db.teams
        if (teams.length === 0) return yield* fail("No team exists yet. Call create_team.")
        if (ref !== undefined && ref.trim() !== "") {
          const n = ref.trim().toLowerCase()
          const team = teams.find((t) => t.key.toLowerCase() === n || t.name.toLowerCase() === n)
          return team ?? (yield* fail(`Unknown team "${ref}". Valid: ${teamList(teams)}.`))
        }
        const mine = new Set((yield* db.teamsOfUser(userId)).map((m) => m.teamId))
        return teams.find((t) => mine.has(t.id)) ?? teams[0]!
      }).pipe(Effect.catchTag("SqlError", Effect.die))

    /** Everything needed to translate between names and ids in one team. Small enough to load per call. */
    const workspace = (teamRef?: string) =>
      Effect.gen(function*() {
        const viewer = yield* viewerId
        const team = yield* resolveTeam(teamRef, viewer)
        const states = yield* db.statesForTeam(team.id)
        const labels = yield* db.labelsForTeam(team.id)
        const users = yield* db.users
        const projects = yield* db.projectsForTeam(team.id)
        const repos = (yield* db.githubRepos).filter((r) => r.teamId === team.id)
        const relations = yield* db.relationsForTeam(team.id)
        const pullRequests = yield* db.pullRequestsForTeam(team.id)
        const issues = yield* db.issuesForTeam(team.id)
        const comments = yield* db.commentsForTeam(team.id)
        const linkedPullRequests = yield* db.linkedPullRequestsForTeam(team.id)
        const keys = teamKeys(team, projects)
        return {
          team,
          viewerId: viewer,
          states,
          labels,
          users,
          projects,
          repos,
          relations,
          pullRequests,
          linkedPullRequests,
          comments,
          issues,
          keys
        }
      }).pipe(Effect.catchTag("SqlError", Effect.die))

    /** The workspace of the team an identifier belongs to: GRD-12 by the team key, TES-12 by a project's. */
    const workspaceForIssue = (ref: string) =>
      Effect.gen(function*() {
        const parsed = parseIdentifier(ref)
        if (parsed) {
          const team = (yield* db.getTeamByKey(parsed.key)) ??
            (yield* db.getTeam((yield* db.projects).find((p) => p.key === parsed.key)?.teamId ?? ""))
          if (team) return yield* workspace(team.key)
        } else {
          const issue = yield* db.getIssue(ref)
          const team = issue ? yield* db.getTeam(issue.teamId) : undefined
          if (team) return yield* workspace(team.key)
        }
        return yield* workspace()
      }).pipe(Effect.catchTag("SqlError", Effect.die))

    /** With no team named, a project's name picks its team, when only one team has a project of that name. */
    const teamForProject = (team: string | undefined, project: string | undefined) =>
      Effect.gen(function*() {
        if (team !== undefined || project === undefined) return team
        const n = project.trim().toLowerCase()
        const owners = [...new Set((yield* db.projects).filter((p) => p.name.toLowerCase() === n).map((p) => p.teamId))]
        return owners.length === 1 ? (yield* db.getTeam(owners[0]!))?.key : undefined
      }).pipe(Effect.catchTag("SqlError", Effect.die))
    type Workspace = Effect.Success<ReturnType<typeof workspace>>

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
    const resolveProject = (ws: Workspace, name: string) => {
      const n = name.trim().toLowerCase()
      if (n === "none" || n === "") return Effect.succeed(null)
      const project = ws.projects.find((p) => p.name.toLowerCase() === n)
      return project
        ? Effect.succeed(project.id)
        : fail(`Unknown project "${name}". Valid: ${ws.projects.length ? names(ws.projects) + ", " : ""}"none".`)
    }
    const repoName = (ws: Workspace, projectId: string) => {
      const repo = ws.repos.find((r) => r.projectId === projectId)
      return repo ? `${repo.owner}/${repo.name}` : null
    }
    /** "TES-12" or "GRD-12": any key of the team or its projects, then the team-wide number. */
    const findIssue = (ws: Workspace, ref: string) =>
      Effect.gen(function*() {
        const parsed = parseIdentifier(ref)
        const keys = new Set([ws.team.key.toUpperCase(), ...ws.projects.map((p) => p.key)])
        const issues = ws.issues
        const issue = parsed && keys.has(parsed.key)
          ? issues.find((i) => i.number === parsed.number)
          : issues.find((i) => i.id === ref)
        const example = ws.projects[0] ? `${ws.projects[0].key}-12 or ${ws.team.key}-12` : `${ws.team.key}-12`
        return issue ?? (yield* fail(`No issue "${ref}". Identifiers look like ${example}.`))
      })

    const stateType = (ws: Workspace, issue: Issue) => ws.states.find((s) => s.id === issue.stateId)?.type
    const byId = (ws: Workspace, id: string) => ws.issues.find((i) => i.id === id)
    const blockersOf = (ws: Workspace, issue: Issue) =>
      ws.relations.flatMap((r) => (r.type === "blocks" && r.relatedIssueId === issue.id ? byId(ws, r.issueId) ?? [] : []))
    const isBlocked = (ws: Workspace, issue: Issue) =>
      blockersOf(ws, issue).some((b) => isOpenBlocker(b, stateType(ws, b)))
    const keyOf = (ws: Workspace, issue: Issue) =>
      identifier(ws.team, issue, ws.projects.find((p) => p.id === issue.projectId))
    const related = (ws: Workspace, list: ReadonlyArray<Issue>) =>
      list.map((i) => ({ id: keyOf(ws, i), title: i.title, state: ws.states.find((s) => s.id === i.stateId)?.name ?? "?" }))

    const summary = (ws: Workspace, issue: Issue): IssueSummary => ({
      id: identifier(ws.team, issue, ws.projects.find((p) => p.id === issue.projectId)),
      title: issue.title,
      state: ws.states.find((s) => s.id === issue.stateId)?.name ?? "?",
      priority: PRIORITY_NAMES[issue.priority],
      assignee: ws.users.find((u) => u.id === issue.assigneeId)?.name ?? null,
      labels: issue.labelIds.flatMap((id) => ws.labels.find((l) => l.id === id)?.name ?? []),
      project: ws.projects.find((p) => p.id === issue.projectId)?.name ?? null,
      github: issue.github?.url ?? null,
      blocked: isBlocked(ws, issue),
      updated: iso(issue.updatedAt)
    })
    const sameRepo = (a: { owner: string; repo: string }, owner: string, name: string) =>
      a.owner.toLowerCase() === owner.toLowerCase() && a.repo.toLowerCase() === name.toLowerCase()
    /** Where `#12` points in an issue's text: its GitHub copy's repository, else its project's. */
    const refContext = (ws: Workspace, issue: Issue) => {
      if (issue.github) return { owner: issue.github.owner, repo: issue.github.repo }
      const repo = ws.repos.find((r) => r.projectId === issue.projectId)
      return repo ? { owner: repo.owner, repo: repo.name } : null
    }
    /** What an issue's description and comments mention, each target once, never the issue itself. */
    const mentions = (ws: Workspace, issue: Issue, comments: ReadonlyArray<{ body: string }>): IssueDetail["mentions"] => {
      const context = refContext(ws, issue)
      const seen = new Set<string>([issue.id])
      const out: Array<IssueDetail["mentions"][number]> = []
      const resolve = (ref: Reference) => {
        if (ref.kind === "identifier") {
          if (!ws.keys.has(ref.key.toUpperCase())) return
          const found = ws.issues.find((i) => i.number === ref.number)
          if (found && !seen.has(found.id)) {
            seen.add(found.id)
            out.push({ kind: "issue", ref: keyOf(ws, found), title: found.title, state: ws.states.find((s) => s.id === found.stateId)?.name ?? null, url: found.github?.url ?? null })
          }
          return
        }
        const name = `${ref.owner}/${ref.repo}#${ref.number}`
        const synced = ws.issues.find((i) => i.github && i.github.number === ref.number && sameRepo(i.github, ref.owner, ref.repo))
        if (synced) {
          if (seen.has(synced.id)) return
          seen.add(synced.id)
          out.push({ kind: "issue", ref: keyOf(ws, synced), title: synced.title, state: ws.states.find((s) => s.id === synced.stateId)?.name ?? null, url: synced.github!.url })
          return
        }
        if (seen.has(name.toLowerCase())) return
        seen.add(name.toLowerCase())
        const repo = ws.repos.find((r) => sameRepo(ref, r.owner, r.name))
        const pr = (repo && ws.pullRequests.find((p) => p.repoId === repo.id && p.number === ref.number)) ??
          ws.linkedPullRequests.find((l) => l.number === ref.number && sameRepo(ref, l.owner, l.repo))
        out.push(
          pr
            ? { kind: "pull_request", ref: name, title: pr.title, state: pr.state, url: pr.url }
            : { kind: "github", ref: name, title: null, state: null, url: `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.number}` }
        )
      }
      for (const text of [issue.description, ...comments.map((c) => c.body)]) {
        for (const { ref } of textReferences(text, context)) resolve(ref)
      }
      return out
    }

    /**
     * The pull requests of an issue, each once: the ones that close it or mention
     * its identifier, and its GitHub "Development" list (any repository).
     */
    const pullRequestsOf = (ws: Workspace, issue: Issue): IssueDetail["pull_requests"] => {
      const out = new Map<string, IssueDetail["pull_requests"][number]>()
      for (const pr of ws.pullRequests) {
        if (!pullRequestRefersTo(pr, issue, ws.keys)) continue
        const repo = ws.repos.find((r) => r.id === pr.repoId)
        const name = repo ? `${repo.owner}/${repo.name}` : "?"
        out.set(`${name}#${pr.number}`.toLowerCase(), { repo: name, number: pr.number, title: pr.title, state: pr.state, url: pr.url })
      }
      for (const l of ws.linkedPullRequests) {
        const key = `${l.owner}/${l.repo}#${l.number}`.toLowerCase()
        if (l.issueId !== issue.id || out.has(key)) continue
        out.set(key, { repo: `${l.owner}/${l.repo}`, number: l.number, title: l.title, state: l.state, url: l.url })
      }
      return [...out.values()]
    }

    const detail = (ws: Workspace, issue: Issue): IssueDetail => ({
      ...summary(ws, issue),
      blocked_by: related(ws, blockersOf(ws, issue)),
      blocks: related(
        ws,
        ws.relations.flatMap((r) => (r.type === "blocks" && r.issueId === issue.id ? byId(ws, r.relatedIssueId) ?? [] : []))
      ),
      related: related(
        ws,
        ws.relations.flatMap((r) =>
          r.type !== "related"
            ? []
            : r.issueId === issue.id
            ? byId(ws, r.relatedIssueId) ?? []
            : r.relatedIssueId === issue.id
            ? byId(ws, r.issueId) ?? []
            : []
        )
      ),
      pull_requests: pullRequestsOf(ws, issue),
      description: issue.description,
      comments: ws.comments.filter((c) => c.issueId === issue.id).map((c) => ({
        author: c.author,
        body: c.body,
        created: iso(c.createdAt),
        url: c.url
      })),
      mentions: mentions(ws, issue, ws.comments.filter((c) => c.issueId === issue.id)),
      creator: ws.users.find((u) => u.id === issue.creatorId)?.name ?? "unknown",
      created: iso(issue.createdAt),
      archived: issue.archivedAt !== null,
      url: `http://${config.host}:${config.port}/issue/${identifier(ws.team, issue, ws.projects.find((p) => p.id === issue.projectId))}`
    })

    const apply = (ws: Workspace, list: ReadonlyArray<Mutation>) =>
      mutations.apply({ origin: "mcp", actorId: ws.viewerId, clientTxId: null }, list).pipe(
        Effect.mapError((e) => new ToolError({ message: e.message }))
      )
    /** The issue as it is now, read with a fresh workspace so new relations show. */
    const reload = (id: string) =>
      Effect.gen(function*() {
        const row = yield* db.getIssue(id).pipe(Effect.orDie)
        const team = row ? yield* db.getTeam(row.teamId).pipe(Effect.orDie) : undefined
        const ws = yield* workspace(team?.key)
        const issue = ws.issues.find((i) => i.id === id)
        return issue ? detail(ws, issue) : yield* fail("The issue disappeared.")
      })

    /** Where people open the app: GRADIENT_URL, else this server. */
    const appUrl = Option.isSome(config.auth.url)
      ? config.auth.url.value.replace(/\/$/, "")
      : `http://${config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host}:${config.port}`

    const applyAs = (actorId: string, list: ReadonlyArray<Mutation>) =>
      mutations.apply({ origin: "mcp", actorId, clientTxId: null }, list).pipe(
        Effect.mapError((e) => new ToolError({ message: e.message }))
      )

    /** A team as the team tools return it. */
    const teamResult = (teamId: string) =>
      Effect.gen(function*() {
        const team = yield* db.getTeam(teamId)
        if (!team) return yield* fail("The team disappeared.")
        const users = yield* db.users
        const people = (yield* db.membersOfTeam(teamId)).flatMap((m) => users.find((u) => u.id === m.userId)?.name ?? [])
        return { name: team.name, key: team.key, members: people }
      }).pipe(Effect.catchTag("SqlError", Effect.die))

    /** "me", or someone with an account, by name or GitHub login. */
    const resolveMember = (actorId: string, who: string) =>
      Effect.gen(function*() {
        const n = who.trim().replace(/^@/, "").toLowerCase()
        if (n === "me") return actorId
        const people = (yield* db.users).filter((u) => u.role !== null)
        const user = people.find((u) => u.name.toLowerCase() === n || u.githubLogin?.toLowerCase() === n)
        if (user) return user.id
        return yield* fail(
          `No one called "${who}" has an account. Valid: "me", ${names(people)}. To bring someone new in, use invite_person.`
        )
      }).pipe(Effect.catchTag("SqlError", Effect.die))

    /** How an agent reads a project's icon: "auto", "none", or the picked file. */
    const iconName = (p: Project) => (p.iconMode === "repo" ? p.icon?.path ?? "auto" : p.iconMode)

    const isOpen = (ws: Workspace, issue: Issue) => {
      const type = ws.states.find((s) => s.id === issue.stateId)?.type
      return type !== "completed" && type !== "canceled"
    }
    const rank = (ws: Workspace, issue: Issue) =>
      [issue.priority === 0 ? 5 : issue.priority, ws.states.findIndex((s) => s.id === issue.stateId) * -1] as const

    return GradientToolkit.of({
      describe_workspace: Effect.fn("mcp.describe_workspace")(function*(input) {
        const ws = yield* workspace(input.team)
        const issues = ws.issues
        const teams = yield* db.teams.pipe(Effect.orDie)
        const memberships = yield* db.teamMembers.pipe(Effect.orDie)
        const teamKeysOf = (userId: string) =>
          memberships.flatMap((m) => (m.userId === userId ? teams.find((t) => t.id === m.teamId)?.key ?? [] : []))
        const me = ws.users.find((u) => u.id === ws.viewerId)
        return {
          team: {
            key: ws.team.key,
            name: ws.team.name,
            members: memberships.filter((m) => m.teamId === ws.team.id).flatMap((m) => ws.users.find((u) => u.id === m.userId)?.name ?? [])
          },
          teams: teams.map((t) => ({
            key: t.key,
            name: t.name,
            members: memberships.filter((m) => m.teamId === t.id).length,
            you_are_member: memberships.some((m) => m.teamId === t.id && m.userId === ws.viewerId)
          })),
          you: me?.name ?? "me",
          your_role: me?.role ?? "member",
          states: ws.states.map((s) => ({ name: s.name, type: s.type })),
          labels: ws.labels.map((l) => l.name),
          people: ws.users.map((u) => ({ name: u.name, githubLogin: u.githubLogin, role: u.role, teams: teamKeysOf(u.id) })),
          projects: ws.projects.map((p) => ({
            name: p.name,
            key: p.key,
            githubRepo: repoName(ws, p.id),
            icon: iconName(p),
            openIssues: issues.filter((i) => i.projectId === p.id && i.archivedAt === null && isOpen(ws, i)).length
          })),
          openIssues: issues.filter((i) => i.archivedAt === null && isOpen(ws, i)).length
        }
      }),

      list_issues: Effect.fn("mcp.list_issues")(function*(input) {
        const ws = yield* workspace(yield* teamForProject(input.team, input.project))
        let issues = [...ws.issues]
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
        if (input.project !== undefined) {
          const projectId = yield* resolveProject(ws, input.project)
          issues = issues.filter((i) => i.projectId === projectId)
        }
        if (input.blocked !== undefined) issues = issues.filter((i) => isBlocked(ws, i) === input.blocked)
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
        const ws = yield* workspaceForIssue(id)
        return detail(ws, yield* findIssue(ws, id))
      }),

      create_issue: Effect.fn("mcp.create_issue")(function*(input) {
        const ws = yield* workspace(yield* teamForProject(input.team, input.project))
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
          projectId: input.project !== undefined ? yield* resolveProject(ws, input.project) : null,
          title: input.title.trim(),
          description: input.description ?? "",
          stateId: state.id,
          priority: PRIORITY_VALUES[input.priority ?? "none"]!,
          assigneeId: input.assignee !== undefined ? yield* resolvePerson(ws, input.assignee) : null,
          labelIds: input.labels ? yield* resolveLabels(ws, input.labels) : [],
          sortOrder: keyBetween(top ?? null, null)
        }])
        return yield* reload(id)
      }),

      update_issue: Effect.fn("mcp.update_issue")(function*(input) {
        const ws = yield* workspaceForIssue(input.id)
        const issue = yield* findIssue(ws, input.id)
        const patch: { -readonly [K in keyof Extract<Mutation, { _tag: "IssueUpdate" }>["patch"]]: any } = {}
        if (input.title !== undefined) patch.title = input.title
        if (input.description !== undefined) patch.description = input.description
        if (input.state !== undefined) patch.stateId = (yield* resolveState(ws, input.state)).id
        if (input.priority !== undefined) patch.priority = PRIORITY_VALUES[input.priority]
        if (input.assignee !== undefined) patch.assigneeId = yield* resolvePerson(ws, input.assignee)
        if (input.project !== undefined) patch.projectId = yield* resolveProject(ws, input.project)
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
        return yield* reload(issue.id)
      }),

      link_issues: Effect.fn("mcp.link_issues")(function*(input) {
        const ws = yield* workspaceForIssue(input.id)
        const issue = yield* findIssue(ws, input.id)
        const other = yield* findIssue(ws, input.other).pipe(
          Effect.mapError(() => new ToolError({ message: `No issue "${input.other}" in ${ws.team.name}: only issues of the same team can be related.` }))
        )
        if (issue.id === other.id) return yield* fail("An issue cannot relate to itself.")
        const [from, to] = input.relation === "blocked_by" ? [other, issue] : [issue, other]
        const type = input.relation === "related" ? "related" as const : "blocks" as const
        const existing = ws.relations.find((r) =>
          (r.issueId === issue.id && r.relatedIssueId === other.id) || (r.issueId === other.id && r.relatedIssueId === issue.id)
        )
        const same = existing && existing.type === type && (type === "related" || existing.issueId === from.id)
        if (!same) {
          yield* apply(ws, [
            ...(existing ? [{ _tag: "RelationDelete" as const, id: existing.id }] : []),
            { _tag: "RelationCreate", id: uuidv7(), teamId: ws.team.id, type, issueId: from.id, relatedIssueId: to.id }
          ])
        }
        return yield* reload(issue.id)
      }),

      unlink_issues: Effect.fn("mcp.unlink_issues")(function*(input) {
        const ws = yield* workspaceForIssue(input.id)
        const issue = yield* findIssue(ws, input.id)
        const other = yield* findIssue(ws, input.other)
        const existing = ws.relations.find((r) =>
          (r.issueId === issue.id && r.relatedIssueId === other.id) || (r.issueId === other.id && r.relatedIssueId === issue.id)
        )
        if (!existing) return yield* fail(`${keyOf(ws, issue)} and ${keyOf(ws, other)} are not related.`)
        yield* apply(ws, [{ _tag: "RelationDelete", id: existing.id }])
        return yield* reload(issue.id)
      }),

      github_status: Effect.fn("mcp.github_status")(function*() {
        yield* viewerId
        const status = yield* github.status
        const allRepos = yield* db.githubRepos.pipe(Effect.orDie)
        const allProjects = yield* db.projects.pipe(Effect.orDie)
        const via = status.tokenSource === "app"
          ? "Sign in with GitHub"
          : status.tokenSource === "env"
          ? "GITHUB_TOKEN"
          : status.tokenSource === "gh-cli"
          ? "GitHub CLI"
          : null
        const repos = allRepos.map((r) => ({
          repo: `${r.owner}/${r.name}`,
          project: allProjects.find((p) => p.id === r.projectId)?.name ?? "?"
        }))
        const hint = status.signIn.pending
          ? `Waiting for the user to enter ${status.signIn.pending.userCode} at ${status.signIn.pending.verificationUri}.`
          : !status.tokenSource
          ? status.notice ??
            (status.signIn.available
              ? "Not connected. Call github_sign_in, or ask the user to sign in under Settings → GitHub."
              : "Not connected. The user can set GITHUB_TOKEN or run `gh auth login`, then restart Gradient.")
          : repos.length === 0
          ? "Connected, but no repository is linked. Call create_project with github_repo, or the user links one from a project."
          : `Projects sync with ${repos.map((r) => `${r.repo} (${r.project})`).join(", ")}.`
        return {
          connected: status.tokenSource !== null,
          login: status.login,
          via,
          repos,
          sign_in_available: status.signIn.available,
          pending_code: status.signIn.pending?.userCode ?? null,
          hint
        }
      }),

      create_project: Effect.fn("mcp.create_project")(function*(input) {
        const ws = yield* workspace(input.team)
        const takenKeys = [...(yield* db.teams.pipe(Effect.orDie)).map((t) => t.key), ...(yield* db.projects.pipe(Effect.orDie)).map((p) => p.key)]
        if (input.github_repo) {
          const [owner, name] = input.github_repo.trim().replace(/^https?:\/\/github\.com\//, "").split("/")
          if (!owner || !name) return yield* fail(`Use "owner/name" for github_repo, not "${input.github_repo}".`)
          const result = yield* github.linkRepo({
            teamId: ws.team.id,
            projectId: null,
            projectName: input.name,
            projectKey: input.key,
            owner,
            name,
            pushExisting: false
          }).pipe(Effect.mapError((e) => new ToolError({ message: e.message })))
          const project = yield* db.getProject(result.projectId).pipe(Effect.orDie)
          return { name: project?.name ?? name, github_repo: `${owner}/${name}`, imported: result.imported }
        }
        if (!input.name?.trim()) return yield* fail("Give the project a name, or a github_repo to name it after.")
        yield* apply(ws, [{
          _tag: "ProjectCreate",
          id: uuidv7(),
          teamId: ws.team.id,
          key: input.key?.trim().toUpperCase() || projectKeyFor(input.name, takenKeys),
          name: input.name.trim(),
          color: PROJECT_COLORS[ws.projects.length % PROJECT_COLORS.length]!
        }])
        return { name: input.name.trim(), github_repo: null, imported: 0 }
      }),

      update_project: Effect.fn("mcp.update_project")(function*(input) {
        const ws = yield* workspace(yield* teamForProject(input.team, input.project))
        const projectId = yield* resolveProject(ws, input.project)
        const project = ws.projects.find((p) => p.id === projectId)
        if (!project) return yield* fail(`Name a project. Valid: ${names(ws.projects)}.`)
        const patch: { name?: string; key?: string; color?: string } = {}
        if (input.name !== undefined) patch.name = input.name.trim()
        if (input.key !== undefined) patch.key = input.key.trim().toUpperCase()
        if (input.color !== undefined) {
          if (!/^#[0-9a-fA-F]{6}$/.test(input.color.trim())) return yield* fail(`Use a hex color like "#0090ff", not "${input.color}".`)
          patch.color = input.color.trim()
        }
        if (Object.keys(patch).length > 0) yield* apply(ws, [{ _tag: "ProjectUpdate", id: project.id, patch }])
        if (input.icon !== undefined) {
          const wanted = input.icon.trim()
          const choice = wanted.toLowerCase() === "auto" || wanted.toLowerCase() === "none"
            ? { mode: wanted.toLowerCase() as "auto" | "none" }
            : { mode: "repo" as const, path: wanted }
          yield* github.setProjectIcon(project.id, choice, { origin: "mcp", actorId: ws.viewerId }).pipe(
            Effect.mapError((e) => new ToolError({ message: e.message }))
          )
        }
        const now = (yield* db.getProject(project.id).pipe(Effect.orDie))!
        return {
          name: now.name,
          key: now.key,
          color: now.color,
          github_repo: repoName(ws, now.id),
          icon: iconName(now),
          icon_file: now.icon?.path ?? null
        }
      }),

      create_team: Effect.fn("mcp.create_team")(function*(input) {
        const actor = yield* viewerId
        const name = input.name.trim()
        if (!name) return yield* fail("Give the team a name.")
        const taken = [...(yield* db.teams.pipe(Effect.orDie)).map((t) => t.key), ...(yield* db.projects.pipe(Effect.orDie)).map((p) => p.key)]
        const id = uuidv7()
        yield* applyAs(actor, [{ _tag: "TeamCreate", id, name, key: input.key?.trim().toUpperCase() || teamKeyFor(name, taken) }])
        return yield* teamResult(id)
      }),

      update_team: Effect.fn("mcp.update_team")(function*(input) {
        const actor = yield* viewerId
        const team = yield* resolveTeam(input.team, actor)
        const patch: { name?: string; key?: string } = {}
        if (input.name !== undefined) patch.name = input.name.trim()
        if (input.key !== undefined) patch.key = input.key.trim().toUpperCase()
        if (Object.keys(patch).length > 0) yield* applyAs(actor, [{ _tag: "TeamUpdate", id: team.id, patch }])
        return yield* teamResult(team.id)
      }),

      add_team_member: Effect.fn("mcp.add_team_member")(function*(input) {
        const actor = yield* viewerId
        const team = yield* resolveTeam(input.team, actor)
        const userId = yield* resolveMember(actor, input.person)
        if (!(yield* db.membership(team.id, userId).pipe(Effect.orDie))) {
          yield* applyAs(actor, [{ _tag: "TeamMemberAdd", id: uuidv7(), teamId: team.id, userId }])
        }
        return yield* teamResult(team.id)
      }),

      remove_team_member: Effect.fn("mcp.remove_team_member")(function*(input) {
        const actor = yield* viewerId
        const team = yield* resolveTeam(input.team, actor)
        const userId = yield* resolveMember(actor, input.person)
        const membership = yield* db.membership(team.id, userId).pipe(Effect.orDie)
        if (membership) yield* applyAs(actor, [{ _tag: "TeamMemberRemove", id: membership.id }])
        return yield* teamResult(team.id)
      }),

      invite_person: Effect.fn("mcp.invite_person")(function*(input) {
        const actor = yield* viewerId
        const teams = input.teams && input.teams.length > 0
          ? yield* Effect.forEach(input.teams, (t) => resolveTeam(t, actor))
          : [yield* resolveTeam(undefined, actor)]
        const { invite, token } = yield* members.createInvite(actor, {
          email: input.email ?? null,
          role: input.role ?? "member",
          teamIds: teams.map((t) => t.id)
        }).pipe(Effect.mapError((e) => new ToolError({ message: e.message })))
        return {
          url: `${appUrl}${invitePath(token)}`,
          email: invite.email,
          role: invite.role,
          teams: teams.map((t) => t.name),
          expires: iso(invite.expiresAt)
        }
      }),

      github_sign_in: Effect.fn("mcp.github_sign_in")(function*() {
        if ((yield* auth.source) === "app") {
          const viewer = yield* auth.viewer
          return yield* fail(`Already signed in as @${viewer?.login}. The user can sign out under Settings → GitHub.`)
        }
        const code = yield* auth.startSignIn.pipe(Effect.mapError((e) => new ToolError({ message: e.message })))
        return {
          user_code: code.userCode,
          url: code.verificationUri,
          expires_in_minutes: Math.round((code.expiresAt - Date.now()) / 60_000),
          instructions: `Ask the user to open ${code.verificationUri} and enter ${code.userCode}, then approve Gradient. ` +
            "Gradient picks up the sign-in by itself; call github_status to check."
        }
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

