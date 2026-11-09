import { identifier, type Issue, type StateType, type WorkflowState } from "@gradient/domain"
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

export const users = (state: SyncState) => Object.values(state.users).sort((a, b) => a.name.localeCompare(b.name))

export const issueKey = (state: SyncState, issue: Issue) => {
  const team = state.teams[issue.teamId]
  return team ? identifier(team, issue) : "…"
}

/** Resolve a URL ref: an identifier like GRD-12, or a raw id for issues still being created. */
export const findIssue = (state: SyncState, ref: string): Issue | undefined => {
  const match = ref.match(/^([A-Za-z]+)-(\d+)$/)
  if (match) {
    const team = Object.values(state.teams).find((t) => t.key.toLowerCase() === match[1]!.toLowerCase())
    if (team) {
      const n = Number(match[2])
      const found = Object.values(state.issues).find((i) => i.teamId === team.id && i.number === n)
      if (found) return found
    }
  }
  return state.issues[ref]
}

export const issueHref = (state: SyncState, issue: Issue) =>
  `/issue/${issue.number > 0 ? issueKey(state, issue) : issue.id}`

const priorityRank = (p: number) => (p === 0 ? 5 : p)

export const compareIssues = (a: Issue, b: Issue) =>
  priorityRank(a.priority) - priorityRank(b.priority) || (a.sortOrder < b.sortOrder ? 1 : a.sortOrder > b.sortOrder ? -1 : 0)

export type View = "all" | "active" | "backlog" | "mine"

export const viewTypes: Record<View, ReadonlyArray<StateType> | null> = {
  all: null,
  active: ["unstarted", "started"],
  backlog: ["backlog"],
  mine: ["backlog", "unstarted", "started"]
}

export const formatDate = (ms: number) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(ms)

export const formatRelative = (ms: number) => {
  const diff = Date.now() - ms
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return formatDate(ms)
}
