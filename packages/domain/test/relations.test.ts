import { describe, expect, test } from "bun:test"
import { parsePullRequestRefs, pullRequestRefersTo, teamKeys, wouldCycle } from "../src/index.ts"

const repo = { owner: "acme", name: "widgets" }

describe("parsePullRequestRefs", () => {
  test("reads GitHub's closing keywords in all their forms", () => {
    const { closes } = parsePullRequestRefs(
      repo,
      "Fix the crash",
      "Fixes #12\ncloses: acme/gadgets#3, resolved https://github.com/acme/web/issues/7\nFIXED #12 again"
    )
    expect(closes).toEqual([
      { owner: "acme", repo: "widgets", number: 12 },
      { owner: "acme", repo: "gadgets", number: 3 },
      { owner: "acme", repo: "web", number: 7 }
    ])
  })

  test("ignores plain mentions and lookalike words", () => {
    expect(parsePullRequestRefs(repo, "See #4", "prefix #5, unfixed #6, closesthing #7").closes).toEqual([])
  })

  test("collects Gradient identifiers from the title and body, once each", () => {
    const { mentions } = parsePullRequestRefs(repo, "WID-3: faster sync", "Also GRD-12 and WID-3, not wid-4 or X-1")
    expect(mentions).toEqual(["WID-3", "GRD-12"])
  })
})

describe("pullRequestRefersTo", () => {
  const keys = teamKeys({ key: "GRD" }, [{ key: "WID" }])
  const issue = { teamId: "t1", number: 3, github: { owner: "Acme", repo: "Widgets", number: 9, url: "" } }
  const pr = (closes: Array<{ owner: string; repo: string; number: number }>, mentions: Array<string>) => ({
    teamId: "t1",
    closes,
    mentions
  })

  test("matches the issue's GitHub copy, ignoring case", () => {
    expect(pullRequestRefersTo(pr([{ owner: "acme", repo: "widgets", number: 9 }], []), issue, keys)).toBe(true)
    expect(pullRequestRefersTo(pr([{ owner: "acme", repo: "gadgets", number: 9 }], []), issue, keys)).toBe(false)
  })

  test("matches any key of the team with the issue's number", () => {
    expect(pullRequestRefersTo(pr([], ["WID-3"]), issue, keys)).toBe(true)
    expect(pullRequestRefersTo(pr([], ["GRD-3"]), issue, keys)).toBe(true)
    expect(pullRequestRefersTo(pr([], ["UTF-3"]), issue, keys)).toBe(false)
    expect(pullRequestRefersTo({ ...pr([], ["WID-3"]), teamId: "t2" }, issue, keys)).toBe(false)
  })
})

describe("wouldCycle", () => {
  const blocks = (a: string, b: string) => ({ type: "blocks" as const, issueId: a, relatedIssueId: b })

  test("finds direct and indirect loops, and ignores related links", () => {
    const relations = [blocks("a", "b"), blocks("b", "c"), { type: "related" as const, issueId: "c", relatedIssueId: "d" }]
    expect(wouldCycle(relations, "b", "a")).toBe(true)
    expect(wouldCycle(relations, "c", "a")).toBe(true)
    expect(wouldCycle(relations, "a", "a")).toBe(true)
    expect(wouldCycle(relations, "a", "c")).toBe(false)
    expect(wouldCycle(relations, "d", "a")).toBe(false)
  })
})
