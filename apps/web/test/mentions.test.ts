import { describe, expect, test } from "bun:test"
import type { GithubRepo, Issue, IssueComment, LinkedPullRequest, PullRequest, WorkflowState } from "@gradient/domain"
import { collectReferences, parseMarkdown } from "../src/lib/markdown.ts"
import {
  commentsFor,
  issueReferences,
  pullRequestHref,
  pullRequestHrefFromUrl,
  pullRequestLabelFor,
  pullRequestsFor,
  resolveMentions
} from "../src/lib/select.ts"
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
  },
  linkedPullRequests: {}
} as unknown as SyncState

const linked = (id: string, issueId: string, owner: string, repo: string, number: number, state: LinkedPullRequest["state"] = "open"): LinkedPullRequest => ({
  id,
  teamId: "t1",
  issueId,
  owner,
  repo,
  number,
  title: `PR ${owner}/${repo}#${number}`,
  url: `https://github.com/${owner}/${repo}/pull/${number}`,
  state,
  author: "dev",
  updatedAt: number
})

describe("collectReferences", () => {
  test("links to a GitHub issue or pull request count, whatever their text", () => {
    const tree = parseMarkdown(
      "[acme/api#7](https://github.com/acme/api/pull/7), [the fix](https://github.com/acme/api/pull/8#issuecomment-1), " +
        "[files](https://github.com/acme/api/pull/7/files), [#9](https://example.com/9)",
      { owner: "acme", repo: "web" }
    )
    expect(collectReferences(tree).map((r) => r.ref.kind === "github" && `${r.ref.repo}#${r.ref.number}`)).toEqual(["api#7", "api#8"])
    // Written as its own reference, it shows as one (with its written text); other text stays a link.
    const paragraph = tree[0] as { children: Array<unknown> }
    expect(paragraph.children[0]).toEqual({ ref: { kind: "github", owner: "acme", repo: "api", number: 7, pull: true }, text: "acme/api#7" })
    expect(paragraph.children[2]).toMatchObject({ tag: "a", attrs: { href: "https://github.com/acme/api/pull/8#issuecomment-1" } })
  })

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

  test("references into repositories Gradient does not link are listed, and a known pull request shows as one", () => {
    const withLinked = { ...store, linkedPullRequests: { l1: linked("l1", "i2", "acme", "api", 7, "merged") } } as unknown as SyncState
    const refs = issueReferences("Needs acme/api#7, acme/api#8 and acme/api#7 again", [], { owner: "acme", repo: "web" })
    expect(resolveMentions(withLinked, self, refs).map((m) => (m.kind === "pullRequest" ? `pr ${m.label} ${m.pullRequest.state}` : `${m.kind} ${m.kind === "github" ? m.label : ""}`))).toEqual([
      "pr acme/api#7 merged", // known from another issue's Development list
      "github acme/api#8"
    ])
  })

  test("leaves out what the sidebar already lists above: relations and pull requests", () => {
    const refs = issueReferences("See #9, WEB-2 and acme/api#3", [], { owner: "acme", repo: "web" })
    const mentions = resolveMentions(store, self, refs, {
      issueIds: ["i2"],
      pullRequests: [{ ...pr, owner: "acme", repo: "web" }]
    })
    expect(mentions.map((m) => m.kind === "github" && m.label)).toEqual(["acme/api#3"])
  })
})

describe("pull requests of an issue", () => {
  test("its Development list joins the ones that refer to it, each once, from any repository", () => {
    const closing = { ...pr, closes: [{ owner: "acme", repo: "web", number: 1 }] }
    const state = {
      ...store,
      pullRequests: { pr9: closing },
      linkedPullRequests: {
        l1: linked("l1", "i1", "acme", "web", 9, "closed"), // the same pull request as pr9: the repository's copy wins
        l2: linked("l2", "i1", "acme", "api", 738),
        l3: linked("l3", "i2", "acme", "api", 5) // another issue's
      }
    } as unknown as SyncState
    const prs = pullRequestsFor(state, self)
    expect(prs.map((p) => `${pullRequestLabelFor(state, self, p)} ${p.state}`)).toEqual(["acme/api#738 open", "#9 open"])
  })
})

describe("pull request pages", () => {
  test("a pull request, or a link to one (its tabs and comments too), opens its page in the app", () => {
    expect(pullRequestHref({ owner: "acme", repo: "web.js", number: 12 })).toBe("/pr/acme/web.js/12")
    expect(pullRequestHrefFromUrl("https://github.com/acme/web/pull/12")).toBe("/pr/acme/web/12")
    expect(pullRequestHrefFromUrl("https://github.com/acme/web/pull/12/files")).toBe("/pr/acme/web/12")
    expect(pullRequestHrefFromUrl("https://github.com/acme/web/pull/12#issuecomment-3")).toBe("/pr/acme/web/12")
    // Issues and everything else still open on GitHub.
    expect(pullRequestHrefFromUrl("https://github.com/acme/web/issues/12")).toBeNull()
    expect(pullRequestHrefFromUrl("https://example.com/acme/web/pull/12")).toBeNull()
  })
})
