import { Schema } from "effect"

/** Timestamps are epoch milliseconds everywhere: cheap to store, compare and send. */
export const Millis = Schema.Number

export const StateType = Schema.Literals(["backlog", "unstarted", "started", "completed", "canceled"])
export type StateType = typeof StateType.Type

/** 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low (same scale as Linear). */
export const Priority = Schema.Literals([0, 1, 2, 3, 4])
export type Priority = typeof Priority.Type

export const Team = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  name: Schema.String,
  issueCounter: Schema.Int
})
export type Team = typeof Team.Type

/**
 * What a person with an account may do in the workspace. Admins invite and
 * remove people and change roles; members do everything else.
 */
export const Role = Schema.Literals(["admin", "member"])
export type Role = typeof Role.Type

export const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  githubLogin: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  /** The workspace role of a person with an account; null for people known only from GitHub. */
  role: Schema.NullOr(Role)
})
export type User = typeof User.Type

/**
 * A person's membership of a team. Every team is visible to the whole
 * workspace; membership decides whose sidebar it is in, and who manages it.
 */
export const TeamMember = Schema.Struct({
  id: Schema.String,
  teamId: Schema.String,
  userId: Schema.String,
  createdAt: Millis
})
export type TeamMember = typeof TeamMember.Type

export const WorkflowState = Schema.Struct({
  id: Schema.String,
  teamId: Schema.String,
  name: Schema.String,
  type: StateType,
  position: Schema.Number,
  color: Schema.String
})
export type WorkflowState = typeof WorkflowState.Type

export const Label = Schema.Struct({
  id: Schema.String,
  teamId: Schema.String,
  name: Schema.String,
  color: Schema.String
})
export type Label = typeof Label.Type

/**
 * How a project picks its icon. `auto`: Gradient finds one in the linked
 * repository (a favicon, else a logo) and follows it when it changes. `repo`:
 * a file the user picked in the repository. `none`: the plain cube.
 */
export const ProjectIconMode = Schema.Literals(["auto", "repo", "none"])
export type ProjectIconMode = typeof ProjectIconMode.Type

/** An image file in the project's linked repository, as of the last check. */
export const ProjectIconFile = Schema.Struct({
  /** Path in the repository, e.g. "public/favicon.svg". */
  path: Schema.String,
  /** Git blob id of the file. It changes with the content, so it also versions the image URL. */
  sha: Schema.String
})
export type ProjectIconFile = typeof ProjectIconFile.Type

/** File types a project icon can be. */
export const PROJECT_ICON_EXTENSIONS = ["svg", "png", "ico", "webp", "jpg", "jpeg", "gif", "avif"] as const

export const isProjectIconPath = (path: string) => {
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return ext !== undefined && (PROJECT_ICON_EXTENSIONS as ReadonlyArray<string>).includes(ext)
}

/**
 * A group of issues inside a team, such as one product or repository. An issue
 * belongs to at most one project. A project can link one GitHub repository;
 * its issues sync there.
 */
export const Project = Schema.Struct({
  id: Schema.String,
  teamId: Schema.String,
  /** Prefix of its issues' identifiers ("TES" → TES-12). Unique in the team, distinct from the team key. */
  key: Schema.String,
  name: Schema.String,
  color: Schema.String,
  iconMode: ProjectIconMode,
  /** The image shown for the project, or null for the cube in its color. Set by the server from the repository. */
  icon: Schema.NullOr(ProjectIconFile),
  createdAt: Millis
})
export type Project = typeof Project.Type

/** Colors handed to new projects in turn. Readable on light and dark surfaces. */
export const PROJECT_COLORS = ["#0090ff", "#46a758", "#8e4ec6", "#f76b15", "#d6409f", "#12a594", "#e5484d", "#ffc53d"]

export const IssueGithubRef = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  number: Schema.Int,
  url: Schema.String
})
export type IssueGithubRef = typeof IssueGithubRef.Type

export const Issue = Schema.Struct({
  id: Schema.String,
  teamId: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  /** Assigned by the server. 0 while an optimistic create is in flight. */
  number: Schema.Int,
  title: Schema.String,
  description: Schema.String,
  stateId: Schema.String,
  priority: Priority,
  assigneeId: Schema.NullOr(Schema.String),
  creatorId: Schema.String,
  labelIds: Schema.Array(Schema.String),
  /** Fractional index for manual ordering. */
  sortOrder: Schema.String,
  github: Schema.NullOr(IssueGithubRef),
  createdAt: Millis,
  updatedAt: Millis,
  archivedAt: Schema.NullOr(Millis)
})
export type Issue = typeof Issue.Type

export const GithubRepo = Schema.Struct({
  id: Schema.String,
  teamId: Schema.String,
  /** The project whose issues sync with this repository. */
  projectId: Schema.String,
  owner: Schema.String,
  name: Schema.String,
  /** When the last successful sync from GitHub finished. */
  lastSyncedAt: Schema.NullOr(Millis),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Millis
})
export type GithubRepo = typeof GithubRepo.Type

/**
 * How two issues relate. `blocks`: `issueId` blocks `relatedIssueId` (so the
 * second is "blocked by" the first); it syncs with GitHub's issue dependencies.
 * `related` has no direction and stays in Gradient.
 */
export const RelationType = Schema.Literals(["blocks", "related"])
export type RelationType = typeof RelationType.Type

export const IssueRelation = Schema.Struct({
  id: Schema.String,
  teamId: Schema.String,
  type: RelationType,
  issueId: Schema.String,
  relatedIssueId: Schema.String,
  createdAt: Millis
})
export type IssueRelation = typeof IssueRelation.Type

export const PullRequestState = Schema.Literals(["open", "draft", "merged", "closed"])
export type PullRequestState = typeof PullRequestState.Type

export const GithubIssueCoords = Schema.Struct({ owner: Schema.String, repo: Schema.String, number: Schema.Int })
export type GithubIssueCoords = typeof GithubIssueCoords.Type

/**
 * A pull request in a linked repository, read from GitHub. Gradient does not
 * edit pull requests; it shows them on the issues they refer to.
 */
export const PullRequest = Schema.Struct({
  id: Schema.String,
  teamId: Schema.String,
  repoId: Schema.String,
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: PullRequestState,
  author: Schema.NullOr(Schema.String),
  /** GitHub issues it closes when merged ("Fixes #12", "closes acme/web#3", or an issue URL). */
  closes: Schema.Array(GithubIssueCoords),
  /** Gradient identifiers in its title or body ("TES-12"), upper case. */
  mentions: Schema.Array(Schema.String),
  updatedAt: Millis
})
export type PullRequest = typeof PullRequest.Type

/**
 * A comment on an issue, read from its GitHub copy. Gradient shows comments
 * but does not write them; they are edited on GitHub.
 */
export const IssueComment = Schema.Struct({
  id: Schema.String,
  teamId: Schema.String,
  issueId: Schema.String,
  /** GitHub login of the author, or null for a deleted account. */
  author: Schema.NullOr(Schema.String),
  authorAvatarUrl: Schema.NullOr(Schema.String),
  body: Schema.String,
  url: Schema.String,
  createdAt: Millis,
  updatedAt: Millis
})
export type IssueComment = typeof IssueComment.Type

/**
 * A pull request GitHub links to an issue's GitHub copy: the issue's
 * "Development" list (closing keywords, or linked by hand), in any
 * repository, linked to Gradient or not. Read from GitHub, one row per issue
 * and pull request.
 */
export const LinkedPullRequest = Schema.Struct({
  id: Schema.String,
  teamId: Schema.String,
  issueId: Schema.String,
  owner: Schema.String,
  repo: Schema.String,
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: PullRequestState,
  author: Schema.NullOr(Schema.String),
  updatedAt: Millis
})
export type LinkedPullRequest = typeof LinkedPullRequest.Type

export const ModelName = Schema.Literals([
  "team",
  "teamMember",
  "user",
  "workflowState",
  "label",
  "project",
  "issue",
  "githubRepo",
  "issueRelation",
  "pullRequest",
  "issueComment",
  "linkedPullRequest"
])
export type ModelName = typeof ModelName.Type

/** One synced record, tagged by model, so clients can route it to the right table. */
export const Entity = Schema.Union([
  Schema.Struct({ model: Schema.Literal("team"), value: Team }),
  Schema.Struct({ model: Schema.Literal("teamMember"), value: TeamMember }),
  Schema.Struct({ model: Schema.Literal("user"), value: User }),
  Schema.Struct({ model: Schema.Literal("workflowState"), value: WorkflowState }),
  Schema.Struct({ model: Schema.Literal("label"), value: Label }),
  Schema.Struct({ model: Schema.Literal("project"), value: Project }),
  Schema.Struct({ model: Schema.Literal("issue"), value: Issue }),
  Schema.Struct({ model: Schema.Literal("githubRepo"), value: GithubRepo }),
  Schema.Struct({ model: Schema.Literal("issueRelation"), value: IssueRelation }),
  Schema.Struct({ model: Schema.Literal("pullRequest"), value: PullRequest }),
  Schema.Struct({ model: Schema.Literal("issueComment"), value: IssueComment }),
  Schema.Struct({ model: Schema.Literal("linkedPullRequest"), value: LinkedPullRequest })
])
export type Entity = typeof Entity.Type

/**
 * An issue's human identifier: its project's key, or the team's when it has no
 * project, then its number. Numbers are unique per team, so moving an issue to
 * another project changes only the prefix, and any known prefix still finds it.
 */
export const identifier = (
  team: Pick<Team, "key">,
  issue: Pick<Issue, "number">,
  project?: Pick<Project, "key"> | null
) => {
  const key = project?.key ?? team.key
  return issue.number > 0 ? `${key}-${issue.number}` : `${key}-…`
}

/** "TES-12" → { key: "TES", number: 12 }. */
export const parseIdentifier = (ref: string): { key: string; number: number } | null => {
  const match = ref.trim().match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/)
  return match ? { key: match[1]!.toUpperCase(), number: Number(match[2]) } : null
}

export const isValidProjectKey = (key: string) => /^[A-Z][A-Z0-9]{1,4}$/.test(key)

/** Team keys follow the same rule as project keys. Every key, of a team or a project, is unique in the workspace. */
export const isValidTeamKey = isValidProjectKey

/**
 * A key for a new team, from its name: like `projectKeyFor`, but a name too
 * short to read falls back to "TM" instead of "PRJ".
 */
export const teamKeyFor = (name: string, taken: Iterable<string>): string => {
  const cleaned = name.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "")
  return projectKeyFor(cleaned.length >= 2 ? name : "Team", taken)
}

/**
 * A key for a new project: the first three letters of its name, uppercased
 * ("test" → "TES", "Issue project" → "ISS"). When taken, the third character
 * becomes a digit ("IS2").
 */
export const projectKeyFor = (name: string, taken: Iterable<string>): string => {
  const used = new Set([...taken].map((k) => k.toUpperCase()))
  const cleaned = name.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "").toUpperCase().replace(/^[0-9]+/, "")
  const base = cleaned.length >= 2 ? cleaned.slice(0, 3) : "PRJ"
  if (!used.has(base)) return base
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, n < 10 ? 2 : 1)}${n}`
    if (!used.has(candidate)) return candidate
  }
  return `${base.slice(0, 1)}${Date.now() % 10000}`
}
