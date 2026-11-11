import { describe, expect, test } from "bun:test"
import type { GithubRepo, Issue, IssueComment, PullRequest, WorkflowState } from "@gradient/domain"
import { collectReferences, parseMarkdown } from "../src/lib/markdown.ts"
import { commentsFor, issueReferences, resolveMentions } from "../src/lib/select.ts"
import type { SyncState } from "../src/sync/engine.ts"

const issue = (number: number, github: number | null, title = `Issue ${number}`): Issue => ({
  id: `i${number}`,
  teamId: "t1",
  projectId: "p1",
  number,
  title,
  description: "",
  stateId: "s1",
  priority: 0,
  assigneeId: null,
  creatorId: "u1",
  labelIds: [],
  sortOrder: "a0",
  github: github === null ? null : { owner: "acme", repo: "web", number: github, url: `https://github.com/acme/web/issues/${github}` },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null
})

const pr: PullRequest = {
  id: "pr9",
  teamId: "t1",
  repoId: "r1",
  number: 9,
  title: "Fix the crash",
  url: "https://github.com/acme/web/pull/9",
  state: "open",
  author: "dev",
  closes: [],
  mentions: [],
  updatedAt: 1
}
const repo: GithubRepo = { id: "r1", teamId: "t1", projectId: "p1", owner: "acme", name: "web", lastSyncedAt: null, lastError: null, createdAt: 1 }
const state: WorkflowState = { id: "s1", teamId: "t1", name: "Todo", type: "unstarted", position: 0, color: "#888" }
const comment = (id: string, issueId: string, body: string, createdAt: number): IssueComment => ({
  id,
  teamId: "t1",
  issueId,
  author: "dev",
  authorAvatarUrl: null,
  body,
  url: "https://github.com/acme/web/issues/1#issuecomment-1",
  createdAt,
  updatedAt: createdAt
})

const self = issue(1, 1)
const other = issue(2, 5, "Other")
const store = {
  teams: { t1: { id: "t1", key: "GRD", name: "Gradient", issueCounter: 2 } },
  projects: { p1: { id: "p1", teamId: "t1", key: "WEB", name: "Web", color: "#000", iconMode: "auto", icon: null, createdAt: 1 } },
  issues: { i1: self, i2: other },
  workflowStates: { s1: state },
  githubRepos: { r1: repo },
  pullRequests: { pr9: pr },
  issueComments: {
    c2: comment("c2", "i1", "Later: WEB-2 again, and #9", 20),
    c1: comment("c1", "i1", "Earlier: see acme/other#4", 10),
    c3: comment("c3", "i2", "Not this issue: #44", 5)
  }
} as unknown as SyncState

describe("collectReferences", () => {
  test("finds references anywhere in the tree, each once, not in code or link text", () => {
    const tree = parseMarkdown("- #1 and **TES-2**\n\n> #1 again, `#3`, [#4](https://example.com)\n\nhttps://github.com/acme/web/issues/1", {
      owner: "acme",
      repo: "web"
    })
    expect(collectReferences(tree).map((r) => r.text)).toEqual(["#1", "TES-2"])
  })
})

describe("mentions", () => {
  test("comments are the issue's own, oldest first", () => {
    expect(commentsFor(store, "i1").map((c) => c.id)).toEqual(["c1", "c2"])
  })

  test("description first, then comments; each target once; never the issue itself", () => {
    const refs = issueReferences("Blocked on #5 and WEB-1 (this one), GRD-2, and GRD-99", commentsFor(store, "i1"), { owner: "acme", repo: "web" })
    const mentions = resolveMentions(store, self, refs)
    expect(mentions.map((m) => (m.kind === "issue" ? `issue ${m.issue.number}` : `${m.kind} ${m.label}`))).toEqual([
      "issue 2", // #5 is its GitHub copy; GRD-2 and WEB-2 are the same issue
      "github acme/other#4",
      "pullRequest #9"
    ])
    const github = mentions.find((m) => m.kind === "github")
    expect(github?.kind === "github" && github.url).toBe("https://github.com/acme/other/issues/4")
  })
})
