import { Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"

/*
 * Tools are shaped for agents, not for the database: they take and return
 * human names ("In Progress", "me", "Bug", GRD-12) and never internal ids.
 * Call describe_workspace first to learn the valid names.
 */

const IssueRef = Schema.String.annotate({
  description: "Issue identifier: project key (or team key) and number, e.g. \"TES-12\" or \"GRD-12\"."
})
const StateName = Schema.String.annotate({
  description: "Workflow state name (e.g. \"In Progress\") or type: backlog, unstarted, started, completed, canceled."
})
const PriorityName = Schema.Literals(["none", "urgent", "high", "medium", "low"]).annotate({
  description: "Priority."
})
const ProjectName = Schema.String.annotate({
  description: "Project name from describe_workspace. Use \"none\" for no project."
})
const TeamName = Schema.String.annotate({
  description: "Team name or key from describe_workspace. Defaults to your first team."
})
const Person = Schema.String.annotate({
  description: "\"me\", a person's name, or a GitHub login. Use \"none\" to unassign."
})

export const IssueSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  state: Schema.String,
  priority: Schema.String,
  assignee: Schema.NullOr(Schema.String),
  labels: Schema.Array(Schema.String),
  project: Schema.NullOr(Schema.String),
  github: Schema.NullOr(Schema.String),
  /** Held up by an issue that is not done yet. */
  blocked: Schema.Boolean,
  updated: Schema.String
})
export type IssueSummary = typeof IssueSummary.Type

const RelatedIssue = Schema.Struct({ id: Schema.String, title: Schema.String, state: Schema.String })

export const IssueDetail = Schema.Struct({
  ...IssueSummary.fields,
  blocked_by: Schema.Array(RelatedIssue),
  blocks: Schema.Array(RelatedIssue),
  related: Schema.Array(RelatedIssue),
  /** Pull requests that close or mention the issue, and its GitHub "Development" list (any repository). */
  pull_requests: Schema.Array(Schema.Struct({
    repo: Schema.String,
    number: Schema.Int,
    title: Schema.String,
    state: Schema.String,
    url: Schema.String
  })),
  description: Schema.String,
  /** Comments from the issue's GitHub copy, oldest first. */
  comments: Schema.Array(Schema.Struct({
    author: Schema.NullOr(Schema.String),
    body: Schema.String,
    created: Schema.String,
    url: Schema.String
  })),
  /** Issues and pull requests the description and comments refer to, in reading order. */
  mentions: Schema.Array(Schema.Struct({
    kind: Schema.Literals(["issue", "pull_request", "github"]),
    /** "TES-12" for a Gradient issue, "acme/web#3" for anything on GitHub. */
    ref: Schema.String,
    title: Schema.NullOr(Schema.String),
    state: Schema.NullOr(Schema.String),
    url: Schema.NullOr(Schema.String)
  })),
  creator: Schema.String,
  created: Schema.String,
  archived: Schema.Boolean,
  url: Schema.String
})
export type IssueDetail = typeof IssueDetail.Type

export class ToolError extends Schema.TaggedError<ToolError>()("ToolError", {
  message: Schema.String
}) {}

export const DescribeWorkspace = Tool.make("describe_workspace", {
  description:
    "A team (yours by default): its workflow states in order, labels, members and projects with the GitHub repo each syncs with; " +
    "plus every team in the workspace and the people in it. Call this first to learn valid names for other tools.",
  parameters: Schema.Struct({ team: Schema.optionalKey(TeamName) }),
  success: Schema.Struct({
    team: Schema.Struct({ key: Schema.String, name: Schema.String, members: Schema.Array(Schema.String) }),
    teams: Schema.Array(Schema.Struct({
      key: Schema.String,
      name: Schema.String,
      members: Schema.Int,
      you_are_member: Schema.Boolean
    })),
    you: Schema.String,
    your_role: Schema.String,
    states: Schema.Array(Schema.Struct({ name: Schema.String, type: Schema.String })),
    labels: Schema.Array(Schema.String),
    people: Schema.Array(Schema.Struct({
      name: Schema.String,
      githubLogin: Schema.NullOr(Schema.String),
      /** "admin" or "member" for people with an account; null for people known only from GitHub. */
      role: Schema.NullOr(Schema.String),
      /** Keys of their teams. */
      teams: Schema.Array(Schema.String)
    })),
    projects: Schema.Array(Schema.Struct({
      name: Schema.String,
      key: Schema.String,
      githubRepo: Schema.NullOr(Schema.String),
      /** "auto", "none" (the cube), or the repository file shown. */
      icon: Schema.String,
      openIssues: Schema.Int
    })),
    openIssues: Schema.Int
  }),
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

export const ListIssues = Tool.make("list_issues", {
  description:
    "List issues, most important first. By default returns open issues (not completed or canceled). Filters combine with AND.",
  parameters: Schema.Struct({
    team: Schema.optionalKey(TeamName),
    state: Schema.optionalKey(Schema.String.annotate({
      description: "\"open\" (default), \"all\", a state name, or a state type."
    })),
    assignee: Schema.optionalKey(Person),
    label: Schema.optionalKey(Schema.String.annotate({ description: "Label name." })),
    project: Schema.optionalKey(ProjectName),
    query: Schema.optionalKey(Schema.String.annotate({ description: "Text to find in the title or description." })),
    blocked: Schema.optionalKey(Schema.Boolean.annotate({
      description: "true: only issues waiting on an unfinished blocker. false: only issues free to start."
    })),
    include_archived: Schema.optionalKey(Schema.Boolean),
    limit: Schema.optionalKey(Schema.Int.annotate({ description: "Default 50, max 200." }))
  }),
  success: Schema.Struct({ total: Schema.Int, issues: Schema.Array(IssueSummary) }),
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

export const GetIssue = Tool.make("get_issue", {
  description:
    "Everything about one issue: its description, GitHub link, what blocks it, what it blocks, related issues, the pull requests that refer to it, its comments (read from GitHub) and the issues and pull requests it mentions.",
  parameters: Schema.Struct({ id: IssueRef }),
  success: IssueDetail,
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

export const CreateIssue = Tool.make("create_issue", {
  description:
    "Create an issue. It appears live in the app and, when its project has a linked repo, on GitHub. Returns the new issue with its identifier.",
  parameters: Schema.Struct({
    team: Schema.optionalKey(TeamName),
    title: Schema.String,
    description: Schema.optionalKey(Schema.String.annotate({ description: "Markdown." })),
    state: Schema.optionalKey(StateName),
    priority: Schema.optionalKey(PriorityName),
    assignee: Schema.optionalKey(Person),
    labels: Schema.optionalKey(Schema.Array(Schema.String).annotate({ description: "Existing label names." })),
    project: Schema.optionalKey(ProjectName)
  }),
  success: IssueDetail,
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

export const UpdateIssue = Tool.make("update_issue", {
  description:
    "Change an issue. Only the fields you pass change. Use add_labels/remove_labels to edit labels without replacing them.",
  parameters: Schema.Struct({
    id: IssueRef,
    title: Schema.optionalKey(Schema.String),
    description: Schema.optionalKey(Schema.String.annotate({ description: "Markdown. Replaces the whole description." })),
    state: Schema.optionalKey(StateName),
    priority: Schema.optionalKey(PriorityName),
    assignee: Schema.optionalKey(Person),
    labels: Schema.optionalKey(Schema.Array(Schema.String).annotate({ description: "Replace all labels." })),
    add_labels: Schema.optionalKey(Schema.Array(Schema.String)),
    remove_labels: Schema.optionalKey(Schema.Array(Schema.String)),
    project: Schema.optionalKey(ProjectName),
    archived: Schema.optionalKey(Schema.Boolean.annotate({ description: "Archive (true) or restore (false)." }))
  }),
  success: IssueDetail,
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const LinkIssues = Tool.make("link_issues", {
  description:
    "Relate two issues. \"blocked_by\": `id` cannot finish before `other`. \"blocks\": the reverse. \"related\": loosely connected. " +
    "Two issues have at most one relation; linking again replaces it. Blocking syncs with GitHub's issue dependencies when both issues are on GitHub.",
  parameters: Schema.Struct({
    id: IssueRef,
    relation: Schema.Literals(["blocked_by", "blocks", "related"]),
    other: IssueRef
  }),
  success: IssueDetail,
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const UnlinkIssues = Tool.make("unlink_issues", {
  description: "Remove the relation between two issues, whichever kind it is.",
  parameters: Schema.Struct({ id: IssueRef, other: IssueRef }),
  success: IssueDetail,
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const GetPullRequest = Tool.make("get_pull_request", {
  description:
    "Read a pull request from GitHub (any repository the connection can see): its description, branches, state, " +
    "changed files, checks, reviews and comments. Use it on the pull requests get_issue lists. Pass diff: true for each file's patch.",
  parameters: Schema.Struct({
    pull_request: Schema.String.annotate({
      description: "\"owner/repo#12\" or a GitHub pull request URL."
    }),
    diff: Schema.optionalKey(Schema.Boolean.annotate({ description: "Include each file's unified diff. Default false." }))
  }),
  success: Schema.Struct({
    ref: Schema.String,
    title: Schema.String,
    state: Schema.String,
    url: Schema.String,
    author: Schema.NullOr(Schema.String),
    base: Schema.String,
    head: Schema.String,
    /** False when it has merge conflicts; null while GitHub is still checking. */
    mergeable: Schema.NullOr(Schema.Boolean),
    additions: Schema.Int,
    deletions: Schema.Int,
    changed_files: Schema.Int,
    commits: Schema.Int,
    labels: Schema.Array(Schema.String),
    requested_reviewers: Schema.Array(Schema.String),
    description: Schema.String,
    files: Schema.Array(Schema.Struct({
      path: Schema.String,
      status: Schema.String,
      additions: Schema.Int,
      deletions: Schema.Int,
      patch: Schema.optionalKey(Schema.NullOr(Schema.String))
    })),
    checks: Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String, url: Schema.NullOr(Schema.String) })),
    /** GitHub's mergeable_state: clean, unstable, blocked, behind, dirty, draft or unknown. */
    merge_state: Schema.String,
    merge_methods: Schema.Array(Schema.String),
    /** Inline comments on the diff, oldest first. */
    review_comments: Schema.Array(Schema.Struct({
      path: Schema.String,
      line: Schema.NullOr(Schema.Int),
      author: Schema.NullOr(Schema.String),
      body: Schema.String,
      url: Schema.String
    })),
    /** Reviews and comments, oldest first. */
    activity: Schema.Array(Schema.Struct({
      kind: Schema.String,
      author: Schema.NullOr(Schema.String),
      review: Schema.NullOr(Schema.String),
      body: Schema.String,
      created: Schema.String,
      url: Schema.String
    })),
    created: Schema.String,
    updated: Schema.String
  }),
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true)

const PullRequestRefParam = Schema.String.annotate({ description: "\"owner/repo#12\" or a GitHub pull request URL." })
const ActsAs = " It goes out as your GitHub account (the agent key owner's): connect it under Profile → GitHub in the app."

export const CommentOnIssue = Tool.make("comment_on_issue", {
  description: "Comment on an issue's GitHub copy (the issue must be synced with GitHub)." + ActsAs,
  parameters: Schema.Struct({ id: IssueRef, body: Schema.String.annotate({ description: "Markdown." }) }),
  success: Schema.Struct({ ok: Schema.Boolean }),
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true)

export const CommentOnPullRequest = Tool.make("comment_on_pull_request", {
  description: "Comment on a pull request's conversation." + ActsAs,
  parameters: Schema.Struct({ pull_request: PullRequestRefParam, body: Schema.String.annotate({ description: "Markdown." }) }),
  success: Schema.Struct({ url: Schema.String }),
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true)

export const ReviewPullRequest = Tool.make("review_pull_request", {
  description:
    "Review a pull request: approve, request changes, or comment, with an optional summary and inline comments on lines of its diff " +
    "(read them with get_pull_request and diff: true). Request changes needs a summary." + ActsAs,
  parameters: Schema.Struct({
    pull_request: PullRequestRefParam,
    event: Schema.Literals(["approve", "request_changes", "comment"]),
    body: Schema.optionalKey(Schema.String.annotate({ description: "The review summary, markdown." })),
    comments: Schema.optionalKey(Schema.Array(Schema.Struct({
      path: Schema.String,
      line: Schema.Int.annotate({ description: "Line in the new file (side RIGHT) or the old one (LEFT)." }),
      side: Schema.optionalKey(Schema.Literals(["LEFT", "RIGHT"]).annotate({ description: "Default RIGHT." })),
      start_line: Schema.optionalKey(Schema.Int.annotate({ description: "First line of a multi-line comment." })),
      body: Schema.String
    })))
  }),
  success: Schema.Struct({ ok: Schema.Boolean }),
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true)

export const MergePullRequest = Tool.make("merge_pull_request", {
  description:
    "Merge a pull request at its current head (or at `sha`). Only when the user asked for it: pass confirm: true. " +
    "GitHub refuses when it conflicts or branch protection blocks it, and the error says why." + ActsAs,
  parameters: Schema.Struct({
    pull_request: PullRequestRefParam,
    method: Schema.optionalKey(Schema.Literals(["merge", "squash", "rebase"]).annotate({
      description: "Defaults to the first method the repository allows."
    })),
    sha: Schema.optionalKey(Schema.String.annotate({ description: "Refuse if the head is no longer this commit." })),
    confirm: Schema.Literal(true).annotate({ description: "Must be true: the user asked for this merge." })
  }),
  success: Schema.Struct({ merged: Schema.Boolean, sha: Schema.String, method: Schema.String }),
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true)

export const GithubConnection = Tool.make("github_status", {
  description:
    "Whether Gradient is connected to GitHub, as whom, and which repo each project syncs with. Check this before relying on GitHub sync.",
  success: Schema.Struct({
    connected: Schema.Boolean,
    login: Schema.NullOr(Schema.String),
    via: Schema.NullOr(Schema.String),
    repos: Schema.Array(Schema.Struct({ repo: Schema.String, project: Schema.String })),
    sign_in_available: Schema.Boolean,
    pending_code: Schema.NullOr(Schema.String),
    hint: Schema.String
  }),
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

export const GithubSignIn = Tool.make("github_sign_in", {
  description:
    "Start \"Sign in with GitHub\". Returns a short code and a URL: show both to the user and ask them to enter the code there. " +
    "Gradient finishes the sign-in on its own once they approve; call github_status to confirm.",
  success: Schema.Struct({
    user_code: Schema.String,
    url: Schema.String,
    expires_in_minutes: Schema.Int,
    instructions: Schema.String
  }),
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true)

export const CreateProject = Tool.make("create_project", {
  description:
    "Create a project to group issues. Pass github_repo (\"owner/name\") to link a repository: its issues are imported into the project and sync both ways.",
  parameters: Schema.Struct({
    team: Schema.optionalKey(TeamName),
    name: Schema.optionalKey(Schema.String.annotate({ description: "Defaults to the repository name." })),
    key: Schema.optionalKey(Schema.String.annotate({
      description: "Identifier prefix, 2–5 capitals (\"WEB\" → WEB-12). Defaults to the first three letters of the name."
    })),
    github_repo: Schema.optionalKey(Schema.String.annotate({ description: "\"owner/name\" of a GitHub repository." }))
  }),
  success: Schema.Struct({ name: Schema.String, github_repo: Schema.NullOr(Schema.String), imported: Schema.Int }),
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true)

const ProjectIconChoice = Schema.String.annotate({
  description:
    "\"auto\": the repository's favicon (else its logo), kept up to date. \"none\": the plain cube. " +
    "Or a path of an image in the linked repository, e.g. \"public/logo.svg\"; an unknown path lists the images."
})

export const UpdateProject = Tool.make("update_project", {
  description:
    "Change a project: rename it, change its identifier key or color, or set its icon from its GitHub repository. Only the fields you pass change.",
  parameters: Schema.Struct({
    team: Schema.optionalKey(TeamName),
    project: Schema.String.annotate({ description: "Project name from describe_workspace." }),
    name: Schema.optionalKey(Schema.String),
    key: Schema.optionalKey(Schema.String.annotate({ description: "2–5 capitals. Renames every issue identifier of the project." })),
    color: Schema.optionalKey(Schema.String.annotate({ description: "Hex color, e.g. \"#0090ff\"." })),
    icon: Schema.optionalKey(ProjectIconChoice)
  }),
  success: Schema.Struct({
    name: Schema.String,
    key: Schema.String,
    color: Schema.String,
    github_repo: Schema.NullOr(Schema.String),
    icon: Schema.String,
    icon_file: Schema.NullOr(Schema.String)
  }),
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)

const TeamResult = Schema.Struct({ name: Schema.String, key: Schema.String, members: Schema.Array(Schema.String) })

export const CreateTeam = Tool.make("create_team", {
  description:
    "Create a team, with the default workflow states and labels. You join it. Its key prefixes issues without a project (\"WEB\" → WEB-12).",
  parameters: Schema.Struct({
    name: Schema.String,
    key: Schema.optionalKey(Schema.String.annotate({
      description: "2–5 capitals, unique in the workspace. Defaults to the first three letters of the name."
    }))
  }),
  success: TeamResult,
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

export const UpdateTeam = Tool.make("update_team", {
  description: "Rename a team or change its key. Only members of the team and admins can.",
  parameters: Schema.Struct({
    team: Schema.String.annotate({ description: "Team name or key." }),
    name: Schema.optionalKey(Schema.String),
    key: Schema.optionalKey(Schema.String.annotate({ description: "2–5 capitals. Renames the identifiers of its issues without a project." }))
  }),
  success: TeamResult,
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

const MembershipParams = Schema.Struct({
  team: Schema.String.annotate({ description: "Team name or key." }),
  person: Schema.String.annotate({ description: "\"me\", or the name of someone with an account (see people in describe_workspace)." })
})

export const AddTeamMember = Tool.make("add_team_member", {
  description:
    "Add someone with an account to a team (\"me\" to join it). Adding others needs you to be in the team or an admin. To bring in someone new, use invite_person.",
  parameters: MembershipParams,
  success: TeamResult,
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const RemoveTeamMember = Tool.make("remove_team_member", {
  description: "Take someone out of a team (\"me\" to leave it). Their issues stay as they are.",
  parameters: MembershipParams,
  success: TeamResult,
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const InvitePerson = Tool.make("invite_person", {
  description:
    "Admins only: make an invite link for someone new. It works once, for 7 days; give it to the user to send on. " +
    "Opening it lets the person create an account (even while sign-up is closed) and puts them in the teams named.",
  parameters: Schema.Struct({
    email: Schema.optionalKey(Schema.String.annotate({ description: "Only this address may accept the invite. Omit for a link anyone can use once." })),
    role: Schema.optionalKey(Schema.Literals(["member", "admin"]).annotate({ description: "Default \"member\"." })),
    teams: Schema.optionalKey(Schema.Array(Schema.String).annotate({ description: "Team names or keys to join. Defaults to your first team." }))
  }),
  success: Schema.Struct({
    url: Schema.String,
    email: Schema.NullOr(Schema.String),
    role: Schema.String,
    teams: Schema.Array(Schema.String),
    expires: Schema.String
  }),
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

export const GradientToolkit = Toolkit.make(
  DescribeWorkspace,
  ListIssues,
  GetIssue,
  CreateIssue,
  UpdateIssue,
  LinkIssues,
  UnlinkIssues,
  CreateProject,
  UpdateProject,
  CreateTeam,
  UpdateTeam,
  AddTeamMember,
  RemoveTeamMember,
  InvitePerson,
  GetPullRequest,
  CommentOnIssue,
  CommentOnPullRequest,
  ReviewPullRequest,
  MergePullRequest,
  GithubConnection,
  GithubSignIn
)
