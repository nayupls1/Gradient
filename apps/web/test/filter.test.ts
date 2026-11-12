import { describe, expect, test } from "bun:test"
import type { Issue } from "@gradient/domain"
import {
  emptyFilter,
  entryMatcher,
  facetCount,
  filterOptions,
  indexIssues,
  isFiltering,
  matchesFilter,
  ME,
  toggle,
  UNASSIGNED,
  withPicked
} from "../src/lib/filter.ts"
import type { SyncState } from "../src/sync/engine.ts"

const issue = (id: string, number: number, extra: Partial<Issue> = {}): Issue => ({
  id, teamId: "t1", projectId: null, number, title: `Issue ${number}`, description: "", stateId: "todo", priority: 0,
  assigneeId: null, creatorId: "me", labelIds: [], sortOrder: "a0", github: null, createdAt: 1, updatedAt: 1, archivedAt: null,
  ...extra
})

const issues = {
  i1: issue("i1", 1, { title: "Login page crashes", assigneeId: "me", labelIds: ["bug"], priority: 1 }),
  i2: issue("i2", 2, { title: "Dark mode", description: "Follow the system setting", assigneeId: "grace", priority: 3 }),
  i3: issue("i3", 3, {
    title: "Sync is slow",
    labelIds: ["perf"],
    github: { owner: "acme", repo: "web", number: 42, url: "https://github.com/acme/web/issues/42" } as Issue["github"]
  }),
  i4: issue("i4", 4, { title: "Blocked thing", priority: 1 })
}

const state = {
  viewerId: "me",
  teams: { t1: { id: "t1", key: "GRD", name: "Gradient", issueCounter: 4 } },
  projects: {},
  users: {
    me: { id: "me", name: "Ada", githubLogin: "nayu", avatarUrl: null, role: "admin" },
    grace: { id: "grace", name: "Grace", githubLogin: null, avatarUrl: null, role: "member" }
  },
  labels: { bug: { id: "bug", teamId: "t1", name: "Bug", color: "#f00" }, perf: { id: "perf", teamId: "t1", name: "Performance", color: "#0f0" } },
  workflowStates: { todo: { id: "todo", teamId: "t1", name: "Todo", type: "unstarted", color: "#000", position: 1 } },
  issueRelations: { r1: { id: "r1", teamId: "t1", issueId: "i1", relatedIssueId: "i4", type: "blocks", createdAt: 1 } },
  issues
} as unknown as SyncState

const shown = (f: Partial<typeof emptyFilter>) =>
  Object.values(issues).filter((i) => matchesFilter(state, i, { ...emptyFilter, ...f })).map((i) => i.number)

describe("issue filters", () => {
  test("no filter shows everything", () => {
    expect(shown({})).toEqual([1, 2, 3, 4])
    expect(isFiltering(emptyFilter)).toBe(false)
  })

  test("search matches every word, in title, description, identifier, labels, assignee and GitHub ref", () => {
    expect(shown({ query: "crash login" })).toEqual([1])
    expect(shown({ query: "system" })).toEqual([2])
    expect(shown({ query: "grd-3" })).toEqual([3])
    expect(shown({ query: "performance" })).toEqual([3])
    expect(shown({ query: "grace" })).toEqual([2])
    expect(shown({ query: "@nayu" })).toEqual([1])
    expect(shown({ query: "#42" })).toEqual([3])
    expect(shown({ query: "acme/web" })).toEqual([3])
    expect(shown({ query: "   " })).toEqual([1, 2, 3, 4])
    expect(shown({ query: "nothing like this" })).toEqual([])
  })

  test("assignee: me follows the viewer, none is unassigned, values in a facet are ORed", () => {
    expect(shown({ assignees: [ME] })).toEqual([1])
    expect(shown({ assignees: [UNASSIGNED] })).toEqual([3, 4])
    expect(shown({ assignees: [ME, "grace"] })).toEqual([1, 2])
  })

  test("labels, priorities and blocked; facets are ANDed", () => {
    expect(shown({ labels: ["bug", "perf"] })).toEqual([1, 3])
    expect(shown({ priorities: [1] })).toEqual([1, 4])
    expect(shown({ blocked: true })).toEqual([4])
    expect(shown({ priorities: [1], assignees: [ME] })).toEqual([1])
    expect(shown({ priorities: [1], query: "blocked" })).toEqual([4])
    expect(facetCount({ ...emptyFilter, priorities: [1], blocked: true })).toBe(2)
  })

  test("toggle adds and removes a value", () => {
    expect(toggle(["a"], "b")).toEqual(["a", "b"])
    expect(toggle(["a", "b"], "a")).toEqual(["b"])
  })

  test("options come from the list's own issues: a project offers only its labels and people", () => {
    const project = indexIssues(state, [issues.i2, issues.i3])
    expect(filterOptions(state, project)).toEqual({ assignees: ["grace", UNASSIGNED], labels: ["perf"], priorities: [3, 0], blocked: false })
    const all = filterOptions(state, indexIssues(state, Object.values(issues)))
    expect(all.assignees).toEqual([ME, "grace", UNASSIGNED])
    expect(all.labels).toEqual(["bug", "perf"])
    expect(all.priorities).toEqual([1, 3, 0])
    expect(all.blocked).toBe(true)
  })

  test("values already picked stay offered, so they can be removed", () => {
    expect(withPicked(["perf"], ["bug", "perf"])).toEqual(["perf", "bug"])
  })

  test("the index matches like matchesFilter, and copes with thousands of issues per keystroke", () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      ({ ...issues.i2, id: `x${i}`, number: 100 + i, title: `Bulk ${i}`, description: "word ".repeat(300) }))
    const entries = indexIssues(state, many)
    const started = performance.now()
    for (const query of ["b", "bu", "bul", "bulk", "bulk 4", "bulk 49"]) entries.filter(entryMatcher({ ...emptyFilter, query }))
    expect(performance.now() - started).toBeLessThan(250)
    const f = { ...emptyFilter, query: "bulk 499" }
    const found = entries.filter(entryMatcher(f)).map((e) => e.issue.id)
    expect(found).toEqual(many.filter((i) => matchesFilter(state, i, f)).map((i) => i.id))
    expect(found.length).toBeGreaterThan(0)
  })
})
