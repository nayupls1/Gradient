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
    "The team, its workflow states in order, labels, people, and projects with the GitHub repo each syncs with. Call this first to learn valid names for other tools.",
  success: Schema.Struct({
    team: Schema.Struct({ key: Schema.String, name: Schema.String }),
    you: Schema.String,
    states: Schema.Array(Schema.Struct({ name: Schema.String, type: Schema.String })),
    labels: Schema.Array(Schema.String),
    people: Schema.Array(Schema.Struct({ name: Schema.String, githubLogin: Schema.NullOr(Schema.String) })),
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
  GithubConnection,
  GithubSignIn
)
