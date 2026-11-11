import {
  identifier,
  type Issue,
  type IssueComment,
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
import { collectReferences, type MdRef, parseMarkdown } from "./markdown.ts"

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

const sameRepo = (a: { owner: string; repo: string }, owner: string, name: string) =>
  a.owner.toLowerCase() === owner.toLowerCase() && a.repo.toLowerCase() === name.toLowerCase()

/** The repository `#12` in an issue's description points into: the one it syncs with, else its project's. */
export const issueRepo = (state: SyncState, issue: Issue): { owner: string; repo: string } | null => {
  if (issue.github) return { owner: issue.github.owner, repo: issue.github.repo }
  const repo = projectRepo(state, issue.projectId)
  return repo ? { owner: repo.owner, repo: repo.name } : null
}

/**
 * What a GitHub reference (owner/repo#12) points at: the Gradient issue synced
 * with it, else a pull request of a linked repository, else nothing known.
 */
export const resolveGithubRef = (
  state: SyncState,
  ref: { owner: string; repo: string; number: number }
): { issue: Issue } | { pullRequest: PullRequest } | null => {
  const issue = Object.values(state.issues).find((i) =>
    i.github !== null && i.github.number === ref.number && sameRepo(i.github, ref.owner, ref.repo)
  )
  if (issue) return { issue }
  const repo = Object.values(state.githubRepos).find((r) => sameRepo(ref, r.owner, r.name))
  const pullRequest = repo && Object.values(state.pullRequests).find((pr) => pr.repoId === repo.id && pr.number === ref.number)
  return pullRequest ? { pullRequest } : null
}

/** An issue's comments, oldest first. */
export const commentsFor = (state: SyncState, issueId: string): Array<IssueComment> =>
  Object.values(state.issueComments)
    .filter((c) => c.issueId === issueId)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))

/** Every reference in an issue's description and comments, in reading order, each once. */
export const issueReferences = (
  description: string,
  comments: ReadonlyArray<Pick<IssueComment, "body">>,
  context: { owner: string; repo: string } | null
): Array<MdRef> => {
  const refs: Array<MdRef> = []
  const seen = new Set<string>()
  for (const text of [description, ...comments.map((c) => c.body)]) {
    if (text.trim() !== "") collectReferences(parseMarkdown(text, context), refs, seen)
  }
  return refs
}

/** Something an issue mentions: a Gradient issue, a pull request, or anything else on GitHub. */
export type Mention =
  | { readonly kind: "issue"; readonly issue: Issue }
  | { readonly kind: "pullRequest"; readonly pullRequest: PullRequest; readonly label: string }
  | { readonly kind: "github"; readonly label: string; readonly url: string }

/**
 * What the references of an issue point at, each target once (`TES-3` and the
 * `#3` it syncs with are one), never the issue itself. Identifiers that match
 * no issue are left out.
 */
export const resolveMentions = (state: SyncState, issue: Issue, refs: ReadonlyArray<MdRef>): Array<Mention> => {
  const context = issueRepo(state, issue)
  const label = (ref: { owner: string; repo: string; number: number }) =>
    context && sameRepo(context, ref.owner, ref.repo) ? `#${ref.number}` : `${ref.owner}/${ref.repo}#${ref.number}`
  const out: Array<Mention> = []
  const seen = new Set<string>([`issue:${issue.id}`])
  const add = (key: string, mention: Mention) => {
    if (seen.has(key)) return
    seen.add(key)
    out.push(mention)
  }
  for (const { ref } of refs) {
    if (ref.kind === "identifier") {
      const found = findIssue(state, `${ref.key}-${ref.number}`)
      if (found) add(`issue:${found.id}`, { kind: "issue", issue: found })
      continue
    }
    const target = resolveGithubRef(state, ref)
    if (target && "issue" in target) add(`issue:${target.issue.id}`, { kind: "issue", issue: target.issue })
    else if (target) add(`pr:${target.pullRequest.id}`, { kind: "pullRequest", pullRequest: target.pullRequest, label: label(ref) })
    else {
      const url = `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.number}`
      add(url.toLowerCase(), { kind: "github", label: label(ref), url })
    }
  }
  return out
}
