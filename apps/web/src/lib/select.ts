import {
  identifier,
  type Issue,
  type IssueRelation,
  isOpenBlocker,
  parseIdentifier,
  projectKeyFor,
  type PullRequest,
  pullRequestRefersTo,
  teamKeys,
  type WorkflowState
} from "@gradient/domain"
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

export interface RelatedIssue {
  readonly relation: IssueRelation
  readonly issue: Issue
}

/** An issue's relations from its side: what blocks it, what it blocks, and loose relations. */
export const relationsOf = (state: SyncState, issueId: string) => {
  const blockedBy: Array<RelatedIssue> = []
  const blocks: Array<RelatedIssue> = []
  const related: Array<RelatedIssue> = []
  for (const relation of Object.values(state.issueRelations)) {
    const mine = relation.issueId === issueId
    if (!mine && relation.relatedIssueId !== issueId) continue
    const other = state.issues[mine ? relation.relatedIssueId : relation.issueId]
    if (!other) continue
    const entry = { relation, issue: other }
    if (relation.type === "related") related.push(entry)
    else if (mine) blocks.push(entry)
    else blockedBy.push(entry)
  }
  const byNumber = (a: RelatedIssue, b: RelatedIssue) => a.issue.number - b.issue.number
  return { blockedBy: blockedBy.sort(byNumber), blocks: blocks.sort(byNumber), related: related.sort(byNumber) }
}

/** Blockers that still hold the issue up: not completed, canceled or archived. */
export const openBlockers = (state: SyncState, issueId: string): Array<Issue> =>
  Object.values(state.issueRelations).flatMap((r) => {
    if (r.type !== "blocks" || r.relatedIssueId !== issueId) return []
    const blocker = state.issues[r.issueId]
    return blocker && isOpenBlocker(blocker, state.workflowStates[blocker.stateId]?.type) ? [blocker] : []
  })

const pullRequestRank: Record<PullRequest["state"], number> = { open: 0, draft: 1, merged: 2, closed: 3 }

/** Pull requests that close the issue on GitHub or mention its identifier: live ones first, then newest. */
export const pullRequestsFor = (state: SyncState, issue: Issue): Array<PullRequest> => {
  const team = state.teams[issue.teamId]
  if (!team) return []
  const keys = teamKeys(team, Object.values(state.projects).filter((p) => p.teamId === team.id))
  return Object.values(state.pullRequests)
    .filter((pr) => pullRequestRefersTo(pr, issue, keys))
    .sort((a, b) => pullRequestRank[a.state] - pullRequestRank[b.state] || b.updatedAt - a.updatedAt || b.number - a.number)
}
