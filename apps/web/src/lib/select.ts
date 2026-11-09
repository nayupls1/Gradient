import { identifier, type Issue, parseIdentifier, projectKeyFor, type WorkflowState } from "@gradient/domain"
import type { SyncState } from "../sync/engine.ts"

export const firstTeam = (state: SyncState) => Object.values(state.teams)[0]

export const teamStates = (state: SyncState, teamId: string): Array<WorkflowState> =>
  Object.values(state.workflowStates)
    .filter((s) => s.teamId === teamId)
    .sort((a, b) => a.position - b.position)

export const teamLabels = (state: SyncState, teamId: string) =>
  Object.values(state.labels)
    .filter((l) => l.teamId === teamId)
    .sort((a, b) => a.name.localeCompare(b.name))

export const teamProjects = (state: SyncState, teamId: string) =>
  Object.values(state.projects)
    .filter((p) => p.teamId === teamId)
    .sort((a, b) => a.name.localeCompare(b.name))

/** The GitHub repository a project syncs with, if any. */
export const projectRepo = (state: SyncState, projectId: string | null | undefined) =>
  projectId ? Object.values(state.githubRepos).find((r) => r.projectId === projectId) : undefined

export const projectHref = (projectId: string) => `/project/${projectId}`

/** The project shown by the current URL, if any. */
export const projectIdFromPath = (path: string) => path.match(/^\/project\/([^/]+)/)?.[1]

export const users = (state: SyncState) => Object.values(state.users).sort((a, b) => a.name.localeCompare(b.name))

/** TES-12 for an issue in the project TES, GRD-12 for one without a project. */
export const issueKey = (state: SyncState, issue: Issue) => {
  const team = state.teams[issue.teamId]
  const project = issue.projectId ? state.projects[issue.projectId] : undefined
  return team ? identifier(team, issue, project) : "…"
}

/**
 * Resolve a URL ref: an identifier, or a raw id for issues still being created.
 * Any key of the team or its projects works with the team-wide number, so old
 * links survive moving an issue to another project or renaming a key.
 */
export const findIssue = (state: SyncState, ref: string): Issue | undefined => {
  const parsed = parseIdentifier(ref)
  if (parsed) {
    const team =
      Object.values(state.teams).find((t) => t.key.toUpperCase() === parsed.key) ??
      state.teams[Object.values(state.projects).find((p) => p.key === parsed.key)?.teamId ?? ""]
    if (team) {
      const found = Object.values(state.issues).find((i) => i.teamId === team.id && i.number === parsed.number)
      if (found) return found
    }
  }
  return state.issues[ref]
}

/** A free key for a new project in this team, from its name. */
export const suggestProjectKey = (state: SyncState, teamId: string, name: string, exceptProjectId?: string) =>
  projectKeyFor(name, [
    state.teams[teamId]?.key ?? "",
    ...Object.values(state.projects).filter((p) => p.teamId === teamId && p.id !== exceptProjectId).map((p) => p.key)
  ])

export const issueHref = (state: SyncState, issue: Issue) =>
  `/issue/${issue.number > 0 ? issueKey(state, issue) : issue.id}`

const priorityRank = (p: number) => (p === 0 ? 5 : p)

export const compareIssues = (a: Issue, b: Issue) =>
  priorityRank(a.priority) - priorityRank(b.priority) || (a.sortOrder < b.sortOrder ? 1 : a.sortOrder > b.sortOrder ? -1 : 0)

export const formatDate = (ms: number) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(ms)

export const formatRelative = (ms: number) => {
  const diff = Date.now() - ms
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return formatDate(ms)
}
