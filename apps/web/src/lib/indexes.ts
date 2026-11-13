import {
  type GithubRepo,
  isOpenBlocker,
  type Issue,
  type IssueComment,
  type IssueRelation,
  type LinkedPullRequest,
  parseIdentifier,
  type Project,
  type PullRequest,
  type Team,
  teamKeys,
  type WorkflowState
} from "@gradient/domain"
import { compareComments, comparePullRequests, type IssuePullRequest, pullRequestKey } from "./select.ts"

/**
 * Whole-table lookups, built in one pass from plain rows (the engine's `rows`).
 * The per-issue selectors in select.ts scan every row of a table; a list that
 * asks once per issue would scan it once per row. These answer the same
 * questions for every issue at once, and `test/indexes.test.ts` checks that
 * they agree with those selectors.
 */

/** What links pull requests and references to an issue. Other edits (title, status) leave these lookups alone. */
export type IssueKeys = Pick<Issue, "id" | "teamId" | "number" | "github">

export const issueKeysOf = (issue: Issue): IssueKeys => ({ id: issue.id, teamId: issue.teamId, number: issue.number, github: issue.github })

export const sameIssueKeys = (a: ReadonlyMap<string, IssueKeys>, b: ReadonlyMap<string, IssueKeys>) => {
  if (a.size !== b.size) return false
  for (const [id, x] of a) {
    const y = b.get(id)
    if (!y || x.teamId !== y.teamId || x.number !== y.number) return false
    if (x.github !== y.github && (!x.github || !y.github || x.github.owner !== y.github.owner || x.github.repo !== y.github.repo || x.github.number !== y.github.number)) return false
  }
  return true
}

const githubKey = (owner: string, repo: string, number: number) => `${owner}/${repo}#${number}`.toLowerCase()

export interface PullRequestIndexInput {
  readonly teams: ReadonlyMap<string, Team>
  readonly projects: ReadonlyMap<string, Project>
  readonly issues: ReadonlyMap<string, IssueKeys>
  readonly githubRepos: ReadonlyMap<string, GithubRepo>
  readonly pullRequests: ReadonlyMap<string, PullRequest>
  readonly linkedPullRequests: ReadonlyMap<string, LinkedPullRequest>
}

/** `pullRequestsFor` for every issue: issue id → its pull requests, live ones first, then newest. */
export const pullRequestIndex = (d: PullRequestIndexInput): ReadonlyMap<string, ReadonlyArray<IssuePullRequest>> => {
  const projectsByTeam = new Map<string, Array<Project>>()
  for (const p of d.projects.values()) {
    const list = projectsByTeam.get(p.teamId)
    if (list) list.push(p)
    else projectsByTeam.set(p.teamId, [p])
  }
  const keysByTeam = new Map<string, ReadonlySet<string>>()
  for (const t of d.teams.values()) keysByTeam.set(t.id, teamKeys(t, projectsByTeam.get(t.id) ?? []))

  // Issues a pull request can reach: by their GitHub copy, and by team and number.
  const byGithub = new Map<string, Array<IssueKeys>>()
  const byNumber = new Map<string, Array<IssueKeys>>()
  const push = (m: Map<string, Array<IssueKeys>>, k: string, issue: IssueKeys) => {
    const list = m.get(k)
    if (list) list.push(issue)
    else m.set(k, [issue])
  }
  for (const issue of d.issues.values()) {
    if (!keysByTeam.has(issue.teamId)) continue
    if (issue.github) push(byGithub, githubKey(issue.github.owner, issue.github.repo, issue.github.number), issue)
    if (issue.number > 0) push(byNumber, `${issue.teamId}#${issue.number}`, issue)
  }

  const out = new Map<string, Map<string, IssuePullRequest>>()
  const add = (issueId: string, entry: IssuePullRequest, keepExisting: boolean) => {
    let byKey = out.get(issueId)
    if (!byKey) out.set(issueId, (byKey = new Map()))
    const key = pullRequestKey(entry)
    if (keepExisting && byKey.has(key)) return
    byKey.set(key, entry)
  }

  for (const pr of d.pullRequests.values()) {
    const repo = d.githubRepos.get(pr.repoId)
    if (!repo) continue
    const targets = new Set<IssueKeys>()
    for (const c of pr.closes) for (const issue of byGithub.get(githubKey(c.owner, c.repo, c.number)) ?? []) targets.add(issue)
    const keys = keysByTeam.get(pr.teamId)
    if (keys) {
      for (const ref of pr.mentions) {
        const parsed = parseIdentifier(ref)
        if (!parsed || !keys.has(parsed.key)) continue
        for (const issue of byNumber.get(`${pr.teamId}#${parsed.number}`) ?? []) targets.add(issue)
      }
    }
    if (targets.size === 0) continue
    const entry: IssuePullRequest = { ...pr, owner: repo.owner, repo: repo.name }
    for (const issue of targets) add(issue.id, entry, false)
  }

  // GitHub's "Development" list. A linked repository's copy is kept current by its own sync: prefer it.
  const repoByName = new Map<string, GithubRepo>()
  for (const r of d.githubRepos.values()) {
    const k = `${r.owner}/${r.name}`.toLowerCase()
    if (!repoByName.has(k)) repoByName.set(k, r)
  }
  const prByRepoNumber = new Map<string, PullRequest>()
  for (const pr of d.pullRequests.values()) {
    const k = `${pr.repoId}#${pr.number}`
    if (!prByRepoNumber.has(k)) prByRepoNumber.set(k, pr)
  }
  for (const linked of d.linkedPullRequests.values()) {
    const issue = d.issues.get(linked.issueId)
    if (!issue || !keysByTeam.has(issue.teamId)) continue
    const repo = repoByName.get(`${linked.owner}/${linked.repo}`.toLowerCase())
    const known = repo && prByRepoNumber.get(`${repo.id}#${linked.number}`)
    add(issue.id, known ? { ...known, owner: linked.owner, repo: linked.repo } : linked, true)
  }

  const sorted = new Map<string, ReadonlyArray<IssuePullRequest>>()
  for (const [id, byKey] of out) sorted.set(id, [...byKey.values()].sort(comparePullRequests))
  return sorted
}

export interface BlockerIndexInput {
  readonly issues: ReadonlyMap<string, Issue>
  readonly workflowStates: ReadonlyMap<string, WorkflowState>
  readonly issueRelations: ReadonlyMap<string, IssueRelation>
}

/** `openBlockers` for every issue: issue id → the blockers that still hold it up. */
export const blockerIndex = (d: BlockerIndexInput): ReadonlyMap<string, ReadonlyArray<Issue>> => {
  const out = new Map<string, Array<Issue>>()
  for (const r of d.issueRelations.values()) {
    if (r.type !== "blocks") continue
    const blocker = d.issues.get(r.issueId)
    if (!blocker || !isOpenBlocker(blocker, d.workflowStates.get(blocker.stateId)?.type)) continue
    const list = out.get(r.relatedIssueId)
    if (list) list.push(blocker)
    else out.set(r.relatedIssueId, [blocker])
  }
  return out
}

export interface IssueLookupInput {
  readonly teams: ReadonlyMap<string, Team>
  readonly projects: ReadonlyMap<string, Project>
  readonly issues: ReadonlyMap<string, IssueKeys>
  readonly githubRepos: ReadonlyMap<string, GithubRepo>
  readonly pullRequests: ReadonlyMap<string, PullRequest>
  readonly linkedPullRequests: ReadonlyMap<string, LinkedPullRequest>
}

/**
 * Direct lookups for what `findIssue` and `resolveGithubRef` otherwise find by
 * scanning: an issue by identifier or GitHub copy, a pull request by repository
 * and number. Each answers like the first match of that scan.
 */
export interface IssueLookup {
  /** The id of the issue `KEY-12` names: the team with that key, else the team of the project with it. */
  readonly issueByIdentifier: (key: string, number: number) => string | undefined
  /** The id of the issue synced with owner/repo#number. */
  readonly issueByGithub: (owner: string, repo: string, number: number) => string | undefined
  /** A linked repository's copy of a pull request. */
  readonly pullRequest: (owner: string, repo: string, number: number) => PullRequest | undefined
  /** A pull request from an issue's "Development" list, in any repository. */
  readonly linkedPullRequest: (owner: string, repo: string, number: number) => LinkedPullRequest | undefined
}

const firstBy = <T>(rows: Iterable<T>, key: (row: T) => string | null) => {
  const out = new Map<string, T>()
  for (const row of rows) {
    const k = key(row)
    if (k !== null && !out.has(k)) out.set(k, row)
  }
  return out
}

export const issueLookup = (d: IssueLookupInput): IssueLookup => {
  const teamByKey = firstBy(d.teams.values(), (t) => t.key.toUpperCase())
  const projectByKey = firstBy(d.projects.values(), (p) => p.key)
  const byNumber = firstBy(d.issues.values(), (i) => `${i.teamId}#${i.number}`)
  const byGithub = firstBy(d.issues.values(), (i) => (i.github ? githubKey(i.github.owner, i.github.repo, i.github.number) : null))
  const repoByName = firstBy(d.githubRepos.values(), (r) => `${r.owner}/${r.name}`.toLowerCase())
  const prByRepoNumber = firstBy(d.pullRequests.values(), (pr) => `${pr.repoId}#${pr.number}`)
  const linkedByKey = firstBy(d.linkedPullRequests.values(), (l) => githubKey(l.owner, l.repo, l.number))
  return {
    issueByIdentifier: (key, number) => {
      const team = teamByKey.get(key) ?? d.teams.get(projectByKey.get(key)?.teamId ?? "")
      return team ? byNumber.get(`${team.id}#${number}`)?.id : undefined
    },
    issueByGithub: (owner, repo, number) => byGithub.get(githubKey(owner, repo, number))?.id,
    pullRequest: (owner, repo, number) => {
      const r = repoByName.get(`${owner}/${repo}`.toLowerCase())
      return r && prByRepoNumber.get(`${r.id}#${number}`)
    },
    linkedPullRequest: (owner, repo, number) => linkedByKey.get(githubKey(owner, repo, number))
  }
}

/** An issue's comments, oldest first, for every issue (`commentsFor` for each). */
export const commentIndex = (comments: ReadonlyMap<string, IssueComment>): ReadonlyMap<string, ReadonlyArray<IssueComment>> => {
  const out = new Map<string, Array<IssueComment>>()
  for (const c of comments.values()) {
    const list = out.get(c.issueId)
    if (list) list.push(c)
    else out.set(c.issueId, [c])
  }
  for (const list of out.values()) list.sort(compareComments)
  return out
}
