import { describe, expect, test } from "bun:test"
import type {
  GithubRepo,
  Issue,
  IssueComment,
  IssueRelation,
  LinkedPullRequest,
  Project,
  PullRequest,
  Team,
  WorkflowState
} from "@gradient/domain"
import { blockerIndex, commentIndex, issueLookup, pullRequestIndex } from "../src/lib/indexes.ts"
import { commentsFor, findIssue, openBlockers, pullRequestsFor, resolveGithubRef } from "../src/lib/select.ts"
import type { SyncState } from "../src/sync/engine.ts"

/** A small random workspace with every way a pull request or a blocker can reach an issue. */
const workspace = (seed: number) => {
  let x = seed
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const pick = <T>(a: ReadonlyArray<T>) => a[Math.floor(rnd() * a.length)]!
  const teams: Array<Team> = [
    { id: "t1", key: "TES", name: "Test", issueCounter: 0 },
    { id: "t2", key: "OPS", name: "Ops", issueCounter: 0 }
  ]
  const projects: Array<Project> = [
    { id: "p1", teamId: "t1", key: "APP", name: "App", color: "#888", iconMode: "auto", icon: null, createdAt: 1 },
    { id: "p2", teamId: "t2", key: "INF", name: "Infra", color: "#888", iconMode: "auto", icon: null, createdAt: 1 }
  ] as Array<Project>
  const workflowStates: Array<WorkflowState> = [
    { id: "s1", teamId: "t1", name: "Todo", type: "unstarted", position: 0, color: "#888" },
    { id: "s2", teamId: "t1", name: "Done", type: "completed", position: 1, color: "#888" },
    { id: "s3", teamId: "t2", name: "Canceled", type: "canceled", position: 0, color: "#888" }
  ]
  const githubRepos: Array<GithubRepo> = [
    { id: "r1", teamId: "t1", projectId: "p1", owner: "acme", name: "web", lastSyncedAt: null, lastError: null, createdAt: 1 },
    { id: "r2", teamId: "t2", projectId: "p2", owner: "Acme", name: "Infra", lastSyncedAt: null, lastError: null, createdAt: 1 }
  ]
  const issues: Array<Issue> = Array.from({ length: 60 }, (_, i) => {
    const teamId = i % 3 === 0 ? "t2" : i % 17 === 0 ? "t-gone" : "t1"
    const gh = rnd() < 0.5 ? { owner: pick(["acme", "ACME", "Acme"]), repo: pick(["web", "infra"]), number: 1 + Math.floor(rnd() * 20) } : null
    return {
      id: `i${i}`,
      teamId,
      projectId: rnd() < 0.5 ? (teamId === "t2" ? "p2" : "p1") : null,
      number: i % 11 === 0 ? 0 : 1 + Math.floor(rnd() * 25),
      title: `Issue ${i}`,
      description: "",
      stateId: pick(workflowStates).id,
      priority: 0,
      assigneeId: null,
      creatorId: "u1",
      labelIds: [],
      sortOrder: "a0",
      github: gh && { ...gh, url: `https://github.com/${gh.owner}/${gh.repo}/issues/${gh.number}` },
      createdAt: 1,
      updatedAt: 1,
      archivedAt: rnd() < 0.1 ? 5 : null
    } as Issue
  })
  const pullRequests: Array<PullRequest> = Array.from({ length: 50 }, (_, i) => ({
    id: `pr${i}`,
    teamId: pick(["t1", "t2"]),
    repoId: pick(["r1", "r2", "r-gone"]),
    number: 100 + i,
    title: `PR ${i}`,
    url: `https://github.com/acme/web/pull/${100 + i}`,
    state: pick(["open", "draft", "merged", "closed"] as const),
    author: null,
    closes: Array.from({ length: Math.floor(rnd() * 3) }, () => ({ owner: pick(["acme", "Acme"]), repo: pick(["web", "Infra"]), number: 1 + Math.floor(rnd() * 20) })),
    mentions: Array.from({ length: Math.floor(rnd() * 3) }, () => `${pick(["TES", "tes", "APP", "OPS", "INF", "XYZ"])}-${1 + Math.floor(rnd() * 25)}`),
    updatedAt: Math.floor(rnd() * 5)
  }))
  const linkedPullRequests: Array<LinkedPullRequest> = Array.from({ length: 30 }, (_, i) => {
    const owner = pick(["acme", "Acme", "other"])
    const repo = pick(["web", "infra", "api"])
    const number = pick([100 + Math.floor(rnd() * 50), 900 + i])
    return {
      id: `l${i}`,
      teamId: "t1",
      issueId: pick(issues).id,
      repoId: "r1",
      owner,
      repo,
      number,
      title: `Linked ${i}`,
      url: `https://github.com/${owner}/${repo}/pull/${number}`,
      state: pick(["open", "merged"] as const),
      author: null,
      updatedAt: Math.floor(rnd() * 5)
    } as LinkedPullRequest
  })
  const issueRelations: Array<IssueRelation> = Array.from({ length: 40 }, (_, i) => ({
    id: `rel${i}`,
    teamId: "t1",
    type: rnd() < 0.7 ? "blocks" : "related",
    issueId: rnd() < 0.05 ? "i-gone" : pick(issues).id,
    relatedIssueId: pick(issues).id,
    createdAt: 1
  })) as Array<IssueRelation>

  const issueComments: Array<IssueComment> = Array.from({ length: 50 }, (_, i) => ({
    id: `c${i}`,
    teamId: "t1",
    issueId: pick(issues).id,
    author: null,
    authorAvatarUrl: null,
    body: "",
    url: "",
    createdAt: Math.floor(rnd() * 4),
    updatedAt: 1
  })) as Array<IssueComment>

  const rec = <T extends { id: string }>(rows: ReadonlyArray<T>) => Object.fromEntries(rows.map((r) => [r.id, r]))
  const map = <T extends { id: string }>(rows: ReadonlyArray<T>) => new Map(rows.map((r) => [r.id, r]))
  const state = {
    teams: rec(teams),
    projects: rec(projects),
    issues: rec(issues),
    githubRepos: rec(githubRepos),
    pullRequests: rec(pullRequests),
    linkedPullRequests: rec(linkedPullRequests),
    workflowStates: rec(workflowStates),
    issueRelations: rec(issueRelations),
    issueComments: rec(issueComments)
  } as unknown as SyncState
  const rows = {
    teams: map(teams),
    projects: map(projects),
    issues: map(issues),
    githubRepos: map(githubRepos),
    pullRequests: map(pullRequests),
    linkedPullRequests: map(linkedPullRequests),
    workflowStates: map(workflowStates),
    issueRelations: map(issueRelations),
    issueComments: map(issueComments)
  }
  return { state, rows, issues }
}

describe("indexes", () => {
  test("pullRequestIndex agrees with pullRequestsFor for every issue", () => {
    let found = 0
    for (let seed = 1; seed <= 40; seed++) {
      const { state, rows, issues } = workspace(seed)
      const index = pullRequestIndex(rows)
      for (const issue of issues) {
        const expected = pullRequestsFor(state, issue)
        found += expected.length
        expect(index.get(issue.id) ?? []).toEqual(expected)
      }
    }
    // The workspaces must actually link things, or the test proves nothing.
    expect(found).toBeGreaterThan(200)
  })

  test("blockerIndex agrees with openBlockers for every issue", () => {
    let found = 0
    for (let seed = 1; seed <= 40; seed++) {
      const { state, rows, issues } = workspace(seed)
      const index = blockerIndex(rows)
      for (const issue of issues) {
        const expected = openBlockers(state, issue.id)
        found += expected.length
        expect(index.get(issue.id) ?? []).toEqual(expected)
      }
    }
    expect(found).toBeGreaterThan(100)
  })

  test("issueLookup answers findIssue and resolveGithubRef like their scans", () => {
    const keys = ["TES", "APP", "OPS", "INF", "XYZ"]
    const owners = ["acme", "ACME", "Acme", "other"]
    const repos = ["web", "Infra", "infra", "api"]
    let found = 0
    for (let seed = 1; seed <= 20; seed++) {
      const { state, rows } = workspace(seed)
      const lookup = issueLookup(rows)
      for (const key of keys) {
        for (let n = 0; n <= 26; n++) {
          const expected = findIssue(state, `${key}-${n}`)
          if (expected) found++
          expect(findIssue(state, `${key.toLowerCase()}-${n}`, lookup)).toBe(findIssue(state, `${key.toLowerCase()}-${n}`)!)
          expect(findIssue(state, `${key}-${n}`, lookup)).toBe(expected!)
        }
      }
      expect(findIssue(state, "i3", lookup)).toBe(state.issues["i3"]!)
      for (const owner of owners) {
        for (const repo of repos) {
          for (const number of [1, 5, 9, 12, 20, 100, 120, 149, 905, 920]) {
            const ref = { owner, repo, number }
            const expected = resolveGithubRef(state, ref)
            if (expected) found++
            expect(resolveGithubRef(state, ref, lookup)).toEqual(expected)
          }
        }
      }
    }
    expect(found).toBeGreaterThan(300)
  })

  test("commentIndex agrees with commentsFor", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { state, rows, issues } = workspace(seed)
      const index = commentIndex(rows.issueComments)
      for (const issue of issues) expect(index.get(issue.id) ?? []).toEqual(commentsFor(state, issue.id))
    }
  })
})
