import { Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"

/*
 * Tools are shaped for agents, not for the database: they take and return
 * human names ("In Progress", "me", "Bug", GRD-12) and never internal ids.
 * Call describe_workspace first to learn the valid names.
 */

const IssueRef = Schema.String.annotate({ description: "Issue identifier, e.g. \"GRD-12\"." })
const StateName = Schema.String.annotate({
  description: "Workflow state name (e.g. \"In Progress\") or type: backlog, unstarted, started, completed, canceled."
})
const PriorityName = Schema.Literals(["none", "urgent", "high", "medium", "low"]).annotate({
  description: "Priority."
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
  github: Schema.NullOr(Schema.String),
  updated: Schema.String
})
export type IssueSummary = typeof IssueSummary.Type

export const IssueDetail = Schema.Struct({
  ...IssueSummary.fields,
  description: Schema.String,
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
    "The team, its workflow states in order, labels, people and the linked GitHub repo. Call this first to learn valid names for other tools.",
  success: Schema.Struct({
    team: Schema.Struct({ key: Schema.String, name: Schema.String }),
    you: Schema.String,
    states: Schema.Array(Schema.Struct({ name: Schema.String, type: Schema.String })),
    labels: Schema.Array(Schema.String),
    people: Schema.Array(Schema.Struct({ name: Schema.String, githubLogin: Schema.NullOr(Schema.String) })),
    githubRepo: Schema.NullOr(Schema.String),
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
    query: Schema.optionalKey(Schema.String.annotate({ description: "Text to find in the title or description." })),
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
  description: "Everything about one issue, including its description and GitHub link.",
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
    "Create an issue. It appears live in the app and, when the team has a linked repo, on GitHub. Returns the new issue with its identifier.",
  parameters: Schema.Struct({
    title: Schema.String,
    description: Schema.optionalKey(Schema.String.annotate({ description: "Markdown." })),
    state: Schema.optionalKey(StateName),
    priority: Schema.optionalKey(PriorityName),
    assignee: Schema.optionalKey(Person),
    labels: Schema.optionalKey(Schema.Array(Schema.String).annotate({ description: "Existing label names." }))
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
    archived: Schema.optionalKey(Schema.Boolean.annotate({ description: "Archive (true) or restore (false)." }))
  }),
  success: IssueDetail,
  failure: ToolError,
  failureMode: "return"
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const GithubConnection = Tool.make("github_status", {
  description:
    "Whether Gradient is connected to GitHub, as whom, and which repo the team syncs with. Check this before relying on GitHub sync.",
  success: Schema.Struct({
    connected: Schema.Boolean,
    login: Schema.NullOr(Schema.String),
    via: Schema.NullOr(Schema.String),
    repo: Schema.NullOr(Schema.String),
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

export const GradientToolkit = Toolkit.make(
  DescribeWorkspace,
  ListIssues,
  GetIssue,
  CreateIssue,
  UpdateIssue,
  GithubConnection,
  GithubSignIn
)
