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
  type Team,
  teamKeyFor,
  teamKeys,
  type WorkflowState
} from "@gradient/domain"
import type { SyncState } from "../sync/engine.ts"
import { collectReferences, type MdRef, parseMarkdown } from "./markdown.ts"

/** Every team, by name. Teams are visible to the whole workspace. */
export const allTeams = (state: SyncState): Array<Team> =>
  Object.values(state.teams).sort((a, b) => a.name.localeCompare(b.name))

export const teamMembers = (state: SyncState, teamId: string) =>
  Object.values(state.teamMembers).filter((m) => m.teamId === teamId)

export const membership = (state: SyncState, teamId: string, userId: string) =>
  Object.values(state.teamMembers).find((m) => m.teamId === teamId && m.userId === userId)

/** The teams the viewer is in, by name: the ones in the sidebar. */
export const myTeams = (state: SyncState): Array<Team> => {
  const mine = new Set(Object.values(state.teamMembers).filter((m) => m.userId === state.viewerId).map((m) => m.teamId))
  return allTeams(state).filter((t) => mine.has(t.id))
}

/** Where new things go when the page names no team: the viewer's first team, else the first team. */
export const defaultTeam = (state: SyncState): Team | undefined => myTeams(state)[0] ?? allTeams(state)[0]

/** A team by key (as in URLs, any case) or id. */
export const findTeam = (state: SyncState, ref: string): Team | undefined =>
  state.teams[ref] ?? Object.values(state.teams).find((t) => t.key.toLowerCase() === ref.toLowerCase())

export const teamHref = (team: Pick<Team, "key">) => `/team/${team.key}`
export const teamSettingsHref = (team: Pick<Team, "key">) => `/team/${team.key}/settings`

/** The team the current URL is about: /team/KEY, a project's or an issue's. */
export const teamFromPath = (state: SyncState, path: string): Team | undefined => {
  const key = path.match(/^\/team\/([^/]+)/)?.[1]
  if (key) return findTeam(state, decodeURIComponent(key))
  const projectId = projectIdFromPath(path)
  if (projectId) return state.teams[state.projects[projectId]?.teamId ?? ""]
  const ref = path.match(/^\/issue\/([^/]+)/)?.[1]
  const issue = ref ? findIssue(state, decodeURIComponent(ref)) : undefined
  return issue ? state.teams[issue.teamId] : undefined
}

/** The team of the current page, else the default one. */
export const currentTeam = (state: SyncState, path: string) => teamFromPath(state, path) ?? defaultTeam(state)

/** People with an account (members of the workspace), by name. */
export const workspaceMembers = (state: SyncState) => users(state).filter((u) => u.role !== null)

export const viewerIsAdmin = (state: SyncState) => state.users[state.viewerId]?.role === "admin"

/**
 * What already uses a key, for form hints: keys prefix identifiers, so no two
 * teams or projects in the workspace share one.
 */
export const keyOwner = (state: SyncState, key: string, except: { team?: string; project?: string } = {}) => {
  const k = key.toUpperCase()
  const team = Object.values(state.teams).find((t) => t.id !== except.team && t.key.toUpperCase() === k)
  if (team) return `the team ${team.name}`
  const project = Object.values(state.projects).find((p) => p.id !== except.project && p.key === k)
  return project ? `the project ${project.name}` : null
}

const takenKeys = (state: SyncState, except: { team?: string; project?: string }) => [
  ...Object.values(state.teams).filter((t) => t.id !== except.team).map((t) => t.key),
  ...Object.values(state.projects).filter((p) => p.id !== except.project).map((p) => p.key)
]

/** A free key for a new team, from its name. */
export const suggestTeamKey = (state: SyncState, name: string, exceptTeamId?: string) =>
  teamKeyFor(name, takenKeys(state, exceptTeamId ? { team: exceptTeamId } : {}))

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

/** A free key for a new project, from its name. Keys are unique across the workspace. */
export const suggestProjectKey = (state: SyncState, _teamId: string, name: string, exceptProjectId?: string) =>
  projectKeyFor(name, takenKeys(state, exceptProjectId ? { project: exceptProjectId } : {}))

export const issueHref = (state: SyncState, issue: Issue) =>
  `/issue/${issue.number > 0 ? issueKey(state, issue) : issue.id}`

const priorityRank = (p: number) => (p === 0 ? 5 : p)

export const compareIssues = (a: Pick<Issue, "priority" | "sortOrder">, b: Pick<Issue, "priority" | "sortOrder">) =>
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

/** A pull request shown on an issue: from a linked repository, or from GitHub's "Development" list (any repository). */
export interface IssuePullRequest {
  readonly owner: string
  readonly repo: string
  readonly number: number
  readonly title: string
  readonly url: string
  readonly state: PullRequest["state"]
  readonly author: string | null
  readonly updatedAt: number
}

/** The in-app page of a pull request (any repository; read from GitHub when it opens). */
export const pullRequestHref = (pr: { owner: string; repo: string; number: number }) =>
  `/pr/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/${pr.number}`

const PULL_URL = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:\/[\w-]*)?\/?(?:[?#].*)?$/i

/** The in-app page for a GitHub pull request URL (its files or commits tab too), or null for any other URL. */
export const pullRequestHrefFromUrl = (url: string): string | null => {
  const m = url.match(PULL_URL)
  return m ? pullRequestHref({ owner: m[1]!, repo: m[2]!, number: Number(m[3]) }) : null
}

/** "acme/web#12", lower case: one pull request however it was found. */
const pullRequestKey = (pr: { owner: string; repo: string; number: number }) => `${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase()

/**
 * Pull requests of the issue, each once: the ones that close its GitHub copy or
 * mention its identifier, and the ones GitHub links to it (its "Development"
 * list, in any repository). Live ones first, then newest.
 */
export const pullRequestsFor = (state: SyncState, issue: Issue): Array<IssuePullRequest> => {
  const team = state.teams[issue.teamId]
  if (!team) return []
  const keys = teamKeys(team, Object.values(state.projects).filter((p) => p.teamId === team.id))
  const byKey = new Map<string, IssuePullRequest>()
  for (const pr of Object.values(state.pullRequests)) {
    const repo = state.githubRepos[pr.repoId]
    if (!repo || !pullRequestRefersTo(pr, issue, keys)) continue
    const entry = { ...pr, owner: repo.owner, repo: repo.name }
    byKey.set(pullRequestKey(entry), entry)
  }
  for (const linked of Object.values(state.linkedPullRequests)) {
    if (linked.issueId !== issue.id) continue
    const key = pullRequestKey(linked)
    // A linked repository's copy is kept current by its own sync: prefer it.
    if (byKey.has(key)) continue
    const known = knownPullRequest(state, linked)
    byKey.set(key, known ? { ...known, owner: linked.owner, repo: linked.repo } : linked)
  }
  return [...byKey.values()].sort((a, b) =>
    pullRequestRank[a.state] - pullRequestRank[b.state] || b.updatedAt - a.updatedAt || b.number - a.number
  )
}

/** The copy of a pull request in a linked repository, if Gradient has one. */
const knownPullRequest = (state: SyncState, ref: { owner: string; repo: string; number: number }) => {
  const repo = Object.values(state.githubRepos).find((r) => sameRepo(ref, r.owner, r.name))
  return repo && Object.values(state.pullRequests).find((pr) => pr.repoId === repo.id && pr.number === ref.number)
}

/** How a pull request is labelled on an issue: `#12` in the issue's own repository, else `acme/api#12`. */
export const pullRequestLabelFor = (state: SyncState, issue: Issue, pr: { owner: string; repo: string; number: number }) => {
  const context = issueRepo(state, issue)
  return context && sameRepo(context, pr.owner, pr.repo) ? `#${pr.number}` : `${pr.owner}/${pr.repo}#${pr.number}`
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
 * with it, else a pull request Gradient knows (from a linked repository, or
 * from an issue's "Development" list in any repository), else nothing known.
 */
export const resolveGithubRef = (
  state: SyncState,
  ref: { owner: string; repo: string; number: number }
): { issue: Issue } | { pullRequest: IssuePullRequest } | null => {
  const issue = Object.values(state.issues).find((i) =>
    i.github !== null && i.github.number === ref.number && sameRepo(i.github, ref.owner, ref.repo)
  )
  if (issue) return { issue }
  const known = knownPullRequest(state, ref)
  if (known) return { pullRequest: { ...known, owner: ref.owner, repo: ref.repo } }
  const key = pullRequestKey(ref)
  const linked = Object.values(state.linkedPullRequests).find((l) => pullRequestKey(l) === key)
  return linked ? { pullRequest: linked } : null
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
  | { readonly kind: "pullRequest"; readonly pullRequest: IssuePullRequest; readonly label: string }
  | { readonly kind: "github"; readonly label: string; readonly url: string }

/**
 * What the references of an issue point at, each target once (`TES-3` and the
 * `#3` it syncs with are one; a pull request and its URL are one), never the
 * issue itself. References into any repository count, linked to Gradient or
 * not. Identifiers that match no issue are left out. Pass `exclude` to leave
 * out what the sidebar already shows above (relations, pull requests).
 */
export const resolveMentions = (
  state: SyncState,
  issue: Issue,
  refs: ReadonlyArray<MdRef>,
  exclude: { readonly issueIds?: Iterable<string>; readonly pullRequests?: Iterable<IssuePullRequest> } = {}
): Array<Mention> => {
  const out: Array<Mention> = []
  const seen = new Set<string>([`issue:${issue.id}`])
  for (const id of exclude.issueIds ?? []) seen.add(`issue:${id}`)
  for (const pr of exclude.pullRequests ?? []) seen.add(`gh:${pullRequestKey(pr)}`)
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
    const key = `gh:${pullRequestKey(ref)}`
    const label = pullRequestLabelFor(state, issue, ref)
    if (target && "issue" in target) add(`issue:${target.issue.id}`, { kind: "issue", issue: target.issue })
    else if (target) add(key, { kind: "pullRequest", pullRequest: target.pullRequest, label })
    else add(key, { kind: "github", label, url: `https://github.com/${ref.owner}/${ref.repo}/${ref.pull ? "pull" : "issues"}/${ref.number}` })
  }
  return out
}
