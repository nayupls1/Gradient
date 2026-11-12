import type { Issue, Priority } from "@gradient/domain"
import type { SyncState } from "../sync/engine.ts"
import { issueKey, openBlockers } from "./select.ts"

/**
 * What the issue list shows. Facets combine with AND; the values inside one
 * facet with OR. Assignees are user ids, plus "me" (whoever is viewing, so a
 * saved filter follows the viewer) and "none" (unassigned).
 */
export interface IssueFilter {
  readonly query: string
  readonly assignees: ReadonlyArray<string>
  readonly labels: ReadonlyArray<string>
  readonly priorities: ReadonlyArray<Priority>
  readonly blocked: boolean
}

export const ME = "me"
export const UNASSIGNED = "none"

export const emptyFilter: IssueFilter = { query: "", assignees: [], labels: [], priorities: [], blocked: false }

/** How many facets are set (the search text is not one). */
export const facetCount = (f: IssueFilter) =>
  (f.assignees.length > 0 ? 1 : 0) + (f.labels.length > 0 ? 1 : 0) + (f.priorities.length > 0 ? 1 : 0) + (f.blocked ? 1 : 0)

export const isFiltering = (f: IssueFilter) => f.query.trim() !== "" || facetCount(f) > 0

/** Adds a value to a facet, or removes it when it is there. */
export const toggle = <V>(values: ReadonlyArray<V>, value: V): ReadonlyArray<V> =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value]

/**
 * The text an issue is found by: its identifier, title, description, labels,
 * assignee (name and GitHub login) and GitHub reference.
 */
export const searchText = (state: SyncState, issue: Issue) => {
  const assignee = issue.assigneeId ? state.users[issue.assigneeId] : undefined
  const gh = issue.github
  return [
    issueKey(state, issue),
    issue.title,
    issue.description,
    ...issue.labelIds.map((id) => state.labels[id]?.name ?? ""),
    assignee?.name ?? "",
    assignee?.githubLogin ? `@${assignee.githubLogin}` : "",
    gh ? `${gh.owner}/${gh.repo}#${gh.number} #${gh.number}` : ""
  ].join("\n").toLowerCase()
}

/** Every word of the query must appear somewhere in the issue's search text, in any order. */
export const matchesQuery = (state: SyncState, issue: Issue, query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "")
  if (words.length === 0) return true
  const text = searchText(state, issue)
  return words.every((w) => text.includes(w))
}

export const matchesFilter = (state: SyncState, issue: Issue, f: IssueFilter) => {
  if (f.assignees.length > 0) {
    const ok = f.assignees.some((a) =>
      a === UNASSIGNED ? issue.assigneeId === null : issue.assigneeId === (a === ME ? state.viewerId : a)
    )
    if (!ok) return false
  }
  if (f.labels.length > 0 && !f.labels.some((id) => issue.labelIds.includes(id))) return false
  if (f.priorities.length > 0 && !f.priorities.includes(issue.priority)) return false
  if (f.blocked && openBlockers(state, issue.id).length === 0) return false
  return matchesQuery(state, issue, f.query)
}

/** What the filter menu offers: only values the list's issues use, plus any already picked. */
export interface FilterOptions {
  readonly assignees: ReadonlyArray<string>
  readonly labels: ReadonlyArray<string>
  readonly priorities: ReadonlyArray<Priority>
  readonly blocked: boolean
}

const PRIORITY_ORDER: ReadonlyArray<Priority> = [1, 2, 3, 4, 0]

/**
 * The filter values that would match something in `issues` (a project's, or
 * a team's): its assignees (the viewer as "me", first; "none" when some are
 * unassigned), labels by name, priorities most urgent first, and whether any
 * issue is blocked. Values already in the filter stay, so they can be removed.
 */
export const filterOptions = (state: SyncState, issues: ReadonlyArray<Issue>, current: IssueFilter = emptyFilter): FilterOptions => {
  const people = new Set<string>(current.assignees)
  const labels = new Set<string>(current.labels)
  const priorities = new Set<Priority>(current.priorities)
  let blocked = current.blocked
  for (const issue of issues) {
    people.add(issue.assigneeId === null ? UNASSIGNED : issue.assigneeId === state.viewerId ? ME : issue.assigneeId)
    for (const id of issue.labelIds) if (state.labels[id]) labels.add(id)
    priorities.add(issue.priority)
    if (!blocked && openBlockers(state, issue.id).length > 0) blocked = true
  }
  const name = (id: string) => state.users[id]?.name ?? ""
  const others = [...people].filter((p) => p !== ME && p !== UNASSIGNED && state.users[p]).sort((a, b) => name(a).localeCompare(name(b)))
  return {
    assignees: [...(people.has(ME) ? [ME] : []), ...others, ...(people.has(UNASSIGNED) ? [UNASSIGNED] : [])],
    labels: [...labels].filter((id) => state.labels[id]).sort((a, b) => state.labels[a]!.name.localeCompare(state.labels[b]!.name)),
    priorities: PRIORITY_ORDER.filter((p) => priorities.has(p)),
    blocked
  }
}
