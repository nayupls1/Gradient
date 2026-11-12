import { type Issue, isOpenBlocker, type Priority } from "@gradient/domain"
import type { SyncState } from "../sync/engine.ts"
import { issueKey } from "./select.ts"

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
 * An issue as the filter sees it: plain values copied out of the store, and
 * the text it is found by, lowercased. Built once per change to the issues,
 * so typing in the search only compares strings: no store reads, nothing
 * tracked, no text rebuilt per keystroke.
 */
export interface IssueEntry {
  readonly issue: Issue
  readonly stateId: string
  readonly priority: Priority
  readonly sortOrder: string
  /** The assignee as a filter value: "me", "none" or a user id. */
  readonly assignee: string
  readonly labelIds: ReadonlyArray<string>
  readonly blocked: boolean
  /** Identifier, title, description, labels, assignee (name and @login) and GitHub reference. */
  readonly text: string
}

/** Issues waiting on a blocker that is not finished, found in one pass over the relations. */
const blockedIssueIds = (state: SyncState) => {
  const blocked = new Set<string>()
  for (const r of Object.values(state.issueRelations)) {
    if (r.type !== "blocks") continue
    const blocker = state.issues[r.issueId]
    if (blocker && isOpenBlocker(blocker, state.workflowStates[blocker.stateId]?.type)) blocked.add(r.relatedIssueId)
  }
  return blocked
}

export const indexIssues = (state: SyncState, issues: ReadonlyArray<Issue>): Array<IssueEntry> => {
  const blocked = blockedIssueIds(state)
  return issues.map((issue) => {
    const user = issue.assigneeId ? state.users[issue.assigneeId] : undefined
    const gh = issue.github
    const labelIds = [...issue.labelIds]
    return {
      issue,
      stateId: issue.stateId,
      priority: issue.priority,
      sortOrder: issue.sortOrder,
      assignee: issue.assigneeId === null ? UNASSIGNED : issue.assigneeId === state.viewerId ? ME : issue.assigneeId,
      labelIds,
      blocked: blocked.has(issue.id),
      text: [
        issueKey(state, issue),
        issue.title,
        issue.description,
        ...labelIds.map((id) => state.labels[id]?.name ?? ""),
        user?.name ?? "",
        user?.githubLogin ? `@${user.githubLogin}` : "",
        gh ? `${gh.owner}/${gh.repo}#${gh.number} #${gh.number}` : ""
      ].join("\n").toLowerCase()
    }
  })
}

/** The words of a query, lowercased: every one must appear in an issue's text, in any order. */
export const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter((w) => w !== "")

/** A filter turned into one test, so a list of entries is checked without redoing the setup per issue. */
export const entryMatcher = (f: IssueFilter): ((e: IssueEntry) => boolean) => {
  const words = queryWords(f.query)
  return (e) =>
    (f.assignees.length === 0 || f.assignees.includes(e.assignee)) &&
    (f.labels.length === 0 || f.labels.some((id) => e.labelIds.includes(id))) &&
    (f.priorities.length === 0 || f.priorities.includes(e.priority)) &&
    (!f.blocked || e.blocked) &&
    words.every((w) => e.text.includes(w))
}

/** One issue against a filter (the list uses `indexIssues` and `entryMatcher` instead). */
export const matchesFilter = (state: SyncState, issue: Issue, f: IssueFilter) =>
  entryMatcher(f)(indexIssues(state, [issue])[0]!)

/** What the filter pickers offer: only values the list's issues use. */
export interface FilterOptions {
  readonly assignees: ReadonlyArray<string>
  readonly labels: ReadonlyArray<string>
  readonly priorities: ReadonlyArray<Priority>
  readonly blocked: boolean
}

const PRIORITY_ORDER: ReadonlyArray<Priority> = [1, 2, 3, 4, 0]

/**
 * The filter values that would match something in a list (a project's, or a
 * team's): its assignees (the viewer as "me", first; "none" last, when some
 * are unassigned), labels by name, priorities most urgent first, and whether
 * any issue is blocked.
 */
export const filterOptions = (state: SyncState, entries: ReadonlyArray<IssueEntry>): FilterOptions => {
  const people = new Set<string>()
  const labels = new Set<string>()
  const priorities = new Set<Priority>()
  let blocked = false
  for (const e of entries) {
    people.add(e.assignee)
    for (const id of e.labelIds) if (state.labels[id]) labels.add(id)
    priorities.add(e.priority)
    blocked ||= e.blocked
  }
  const name = (id: string) => state.users[id]?.name ?? ""
  const others = [...people].filter((p) => p !== ME && p !== UNASSIGNED && state.users[p]).sort((a, b) => name(a).localeCompare(name(b)))
  return {
    assignees: [...(people.has(ME) ? [ME] : []), ...others, ...(people.has(UNASSIGNED) ? [UNASSIGNED] : [])],
    labels: [...labels].sort((a, b) => state.labels[a]!.name.localeCompare(state.labels[b]!.name)),
    priorities: PRIORITY_ORDER.filter((p) => priorities.has(p)),
    blocked
  }
}

/** A picker's values: the offered ones, then any picked value the list no longer uses, so it can be removed. */
export const withPicked = <V>(offered: ReadonlyArray<V>, picked: ReadonlyArray<V>): ReadonlyArray<V> => [
  ...offered,
  ...picked.filter((v) => !offered.includes(v))
]
