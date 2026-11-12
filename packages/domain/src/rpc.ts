import { Context, Schema } from "effect"
import { Rpc, RpcGroup, RpcMiddleware } from "effect/rpc"
import { ProjectIconFile, PullRequestState, Role } from "./models.ts"
import { Mutation } from "./mutations.ts"
import { Snapshot, SyncEvent } from "./sync.ts"

export class MutationRejected extends Schema.TaggedError<MutationRejected>()("MutationRejected", {
  message: Schema.String
}) {}

/** The connection has no valid session: signed out, expired, or revoked. Sign in again. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  message: Schema.String
}) {}

/** Who is calling: the signed-in account and the Gradient user it acts as. */
export class CurrentViewer extends Context.Service<CurrentViewer, {
  /** The Gradient user (issues, assignees, the sync log's actor). */
  readonly userId: string
  /** The Better Auth account behind the session. */
  readonly accountId: string
}>()("gradient/CurrentViewer") {}

/**
 * Every RPC needs a signed-in session. The server resolves it from the
 * session cookie on each call and provides `CurrentViewer`; a missing or
 * revoked session fails with `Unauthorized`.
 */
export class AuthMiddleware extends RpcMiddleware.Service<AuthMiddleware, { provides: CurrentViewer }>()(
  "gradient/AuthMiddleware",
  { error: Unauthorized }
) {}

export class GithubError extends Schema.TaggedError<GithubError>()("GithubError", {
  message: Schema.String
}) {}

/** A GitHub device-flow code the user enters at `verificationUri` to sign in. */
export const GithubDeviceCode = Schema.Struct({
  userCode: Schema.String,
  verificationUri: Schema.String,
  /** Epoch milliseconds. */
  expiresAt: Schema.Int
})
export type GithubDeviceCode = typeof GithubDeviceCode.Type

export const GithubTokenSource = Schema.Literals(["app", "env", "gh-cli"])
export type GithubTokenSource = typeof GithubTokenSource.Type

export const GithubStatus = Schema.Struct({
  /**
   * Where the token in use came from, or null when GitHub is not connected.
   * "app" is a sign-in through the Gradient GitHub App; it wins over the others.
   */
  tokenSource: Schema.NullOr(GithubTokenSource),
  login: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  signIn: Schema.Struct({
    /** False when no GitHub App client id is configured. */
    available: Schema.Boolean,
    /** Where to install the app on more repositories, when the app's slug is known. */
    installUrl: Schema.NullOr(Schema.String),
    /** The code of a sign-in that is waiting for the user. */
    pending: Schema.NullOr(GithubDeviceCode)
  }),
  /** Something the user should know, such as an expired sign-in. */
  notice: Schema.NullOr(Schema.String),
  webhookSecretSet: Schema.Boolean,
  pollIntervalSeconds: Schema.Number
})
export type GithubStatus = typeof GithubStatus.Type

/**
 * A repository the connected GitHub account can link: with an app sign-in, the
 * ones the app is installed on; with a token, every repository it can see.
 */
export const GithubAvailableRepo = Schema.Struct({
  owner: Schema.String,
  name: Schema.String,
  private: Schema.Boolean,
  description: Schema.NullOr(Schema.String)
})
export type GithubAvailableRepo = typeof GithubAvailableRepo.Type

/** An image in a project's repository that can be its icon. */
export const GithubRepoImage = Schema.Struct({ path: Schema.String, sha: Schema.String, size: Schema.Int })
export type GithubRepoImage = typeof GithubRepoImage.Type

export const ProjectIconChoices = Schema.Struct({
  /** The file "auto" picks (a favicon, else a logo), or null when there is none. */
  auto: Schema.NullOr(ProjectIconFile),
  /** Every image that can be picked, best guesses first. */
  images: Schema.Array(GithubRepoImage)
})
export type ProjectIconChoices = typeof ProjectIconChoices.Type

/** A check on a pull request's head commit: a check run (Actions and apps) or a commit status. */
export const PullRequestCheckStatus = Schema.Literals(["pending", "success", "failure", "cancelled", "skipped", "neutral"])
export type PullRequestCheckStatus = typeof PullRequestCheckStatus.Type

export const PullRequestCheck = Schema.Struct({
  name: Schema.String,
  status: PullRequestCheckStatus,
  url: Schema.NullOr(Schema.String)
})
export type PullRequestCheck = typeof PullRequestCheck.Type

/** One changed file. `patch` is GitHub's unified diff, null for binary or very large files. */
export const PullRequestFile = Schema.Struct({
  path: Schema.String,
  /** The old path of a renamed file. */
  previousPath: Schema.NullOr(Schema.String),
  status: Schema.Literals(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]),
  additions: Schema.Int,
  deletions: Schema.Int,
  patch: Schema.NullOr(Schema.String)
})
export type PullRequestFile = typeof PullRequestFile.Type

export const PullRequestReviewState = Schema.Literals(["approved", "changes_requested", "commented", "dismissed", "pending"])
export type PullRequestReviewState = typeof PullRequestReviewState.Type

/** A review or a conversation comment on a pull request. */
export const PullRequestActivity = Schema.Struct({
  kind: Schema.Literals(["comment", "review"]),
  author: Schema.NullOr(Schema.String),
  authorAvatarUrl: Schema.NullOr(Schema.String),
  /** Reviews only. */
  reviewState: Schema.NullOr(PullRequestReviewState),
  body: Schema.String,
  url: Schema.String,
  createdAt: Schema.Number
})
export type PullRequestActivity = typeof PullRequestActivity.Type

/** An inline comment on a pull request's diff (a review comment). */
export const PullRequestReviewComment = Schema.Struct({
  id: Schema.Int,
  path: Schema.String,
  /** The line it is on, or null when the code moved on (outdated). */
  line: Schema.NullOr(Schema.Int),
  /** The first line of a multi-line comment. */
  startLine: Schema.NullOr(Schema.Int),
  /** LEFT is the old file (a deleted or context line), RIGHT the new one. */
  side: Schema.Literals(["LEFT", "RIGHT"]),
  /** The comment it answers; replies share their thread's position. */
  inReplyTo: Schema.NullOr(Schema.Int),
  author: Schema.NullOr(Schema.String),
  authorAvatarUrl: Schema.NullOr(Schema.String),
  body: Schema.String,
  url: Schema.String,
  createdAt: Schema.Number
})
export type PullRequestReviewComment = typeof PullRequestReviewComment.Type

export const PullRequestTimelineKind = Schema.Literals([
  "opened",
  "commit",
  "comment",
  "review",
  "inline",
  "merged",
  "closed",
  "reopened",
  "ready",
  "draft",
  "labeled",
  "unlabeled",
  "review_requested",
  "review_request_removed",
  "assigned",
  "unassigned",
  "force_pushed",
  "branch_deleted",
  "renamed",
  "referenced"
])
export type PullRequestTimelineKind = typeof PullRequestTimelineKind.Type

/**
 * One thing that happened on a pull request, as GitHub's timeline lists it:
 * its commits, comments, reviews and what people did to it. Fields beyond
 * kind, who and when are set only for the kinds that have them.
 */
export const PullRequestTimelineItem = Schema.Struct({
  kind: PullRequestTimelineKind,
  /** GitHub login, or a commit's author name when it has no account. */
  actor: Schema.NullOr(Schema.String),
  actorAvatarUrl: Schema.NullOr(Schema.String),
  at: Schema.Number,
  /** A comment's or review's markdown, or a commit's message. */
  body: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  /** A commit's sha. */
  sha: Schema.NullOr(Schema.String),
  reviewState: Schema.NullOr(PullRequestReviewState),
  label: Schema.NullOr(Schema.Struct({ name: Schema.String, color: Schema.NullOr(Schema.String) })),
  /**
   * What it was about: the person or team asked to review, the assignee, the
   * new title, the file and line of an inline comment, or the referencing
   * issue's title.
   */
  subject: Schema.NullOr(Schema.String),
  /** More about it: the old title, or the referencing issue as "owner/repo#12". */
  detail: Schema.NullOr(Schema.String)
})
export type PullRequestTimelineItem = typeof PullRequestTimelineItem.Type

export const MergeMethod = Schema.Literals(["merge", "squash", "rebase"])
export type MergeMethod = typeof MergeMethod.Type

/**
 * A pull request as its page shows it, read from GitHub when the page opens
 * (not synced): any pull request the connected account can see.
 */
export const PullRequestDetail = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  number: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  body: Schema.String,
  state: PullRequestState,
  author: Schema.NullOr(Schema.String),
  authorAvatarUrl: Schema.NullOr(Schema.String),
  baseBranch: Schema.String,
  headBranch: Schema.String,
  /** False when GitHub found merge conflicts with the base branch; null while it is still computing. */
  mergeable: Schema.NullOr(Schema.Boolean),
  /**
   * GitHub's `mergeable_state`: clean, unstable (checks failing but allowed),
   * blocked (protection: reviews or checks required), behind, dirty
   * (conflicts), draft, has_hooks, or unknown while it computes.
   */
  mergeableState: Schema.String,
  /** The head commit; a merge is pinned to it, so new pushes are never merged unseen. */
  headSha: Schema.String,
  /** The merge methods the repository allows, in GitHub's order. */
  mergeMethods: Schema.Array(MergeMethod),
  additions: Schema.Int,
  deletions: Schema.Int,
  changedFiles: Schema.Int,
  commits: Schema.Int,
  labels: Schema.Array(Schema.Struct({ name: Schema.String, color: Schema.NullOr(Schema.String) })),
  /** Logins (or team slugs) asked to review who have not yet. */
  requestedReviewers: Schema.Array(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  mergedAt: Schema.NullOr(Schema.Number),
  closedAt: Schema.NullOr(Schema.Number),
  /** At most the first 1,000 files; `changedFiles` counts them all. */
  files: Schema.Array(PullRequestFile),
  checks: Schema.Array(PullRequestCheck),
  /** Reviews and comments, oldest first. */
  activity: Schema.Array(PullRequestActivity),
  /** Inline comments on the diff, oldest first. */
  reviewComments: Schema.Array(PullRequestReviewComment),
  /** Everything that happened on it, oldest first (at most the first 1,000 events). */
  timeline: Schema.Array(PullRequestTimelineItem)
})
export type PullRequestDetail = typeof PullRequestDetail.Type

/** A GitHub account and how Gradient reaches it. */
export const GithubActing = Schema.Struct({
  login: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
  /** The person's own connected account, or the workspace connection (which is theirs). */
  via: Schema.Literals(["personal", "workspace"])
})
export type GithubActing = typeof GithubActing.Type

/**
 * The signed-in person's GitHub: who their comments, reviews and merges go
 * out as. Each person connects their own account; the workspace connection
 * stands in only for the person it belongs to.
 */
export const GithubAccount = Schema.Struct({
  /** Who you act as on GitHub, or null: connect your account to comment, review and merge. */
  actingAs: Schema.NullOr(GithubActing),
  /** Your own connected account. */
  personal: Schema.NullOr(Schema.Struct({ login: Schema.String, avatarUrl: Schema.NullOr(Schema.String) })),
  /** The code of your sign-in that is waiting for you. */
  pending: Schema.NullOr(GithubDeviceCode),
  /** False when no GitHub App client id is configured. */
  signInAvailable: Schema.Boolean
})
export type GithubAccount = typeof GithubAccount.Type

export const ReviewEvent = Schema.Literals(["approve", "request_changes", "comment"])
export type ReviewEvent = typeof ReviewEvent.Type

/** An inline comment written in Gradient, sent with a review. */
export const DraftReviewComment = Schema.Struct({
  path: Schema.String,
  line: Schema.Int,
  side: Schema.Literals(["LEFT", "RIGHT"]),
  /** The first line of a multi-line comment, on the same side. */
  startLine: Schema.NullOr(Schema.Int),
  body: Schema.String
})
export type DraftReviewComment = typeof DraftReviewComment.Type

const PullRequestRef = { owner: Schema.String, repo: Schema.String, number: Schema.Int }

export const ServerInfo = Schema.Struct({
  version: Schema.String,
  /** Where agents connect over MCP (Streamable HTTP). */
  mcpUrl: Schema.String
})
export type ServerInfo = typeof ServerInfo.Type

/** Something only an admin may do, or an invite that cannot be used. */
export class MemberError extends Schema.TaggedError<MemberError>()("MemberError", {
  message: Schema.String
}) {}

/** How long an invite link works. */
export const INVITE_TTL_DAYS = 7

/** An invite waiting to be accepted, as admins see it. The token is never stored, only its hash. */
export const Invite = Schema.Struct({
  id: Schema.String,
  /** Only this address may accept it, when set. */
  email: Schema.NullOr(Schema.String),
  role: Role,
  /** The teams the new person joins. */
  teamIds: Schema.Array(Schema.String),
  /** The Gradient user who made it. */
  invitedBy: Schema.NullOr(Schema.String),
  createdAt: Schema.Int,
  expiresAt: Schema.Int
})
export type Invite = typeof Invite.Type

/** What the invite page shows before anyone signs in (`GET /api/invites/<token>`). */
export const InvitePreview = Schema.Struct({
  email: Schema.NullOr(Schema.String),
  role: Role,
  teams: Schema.Array(Schema.Struct({ id: Schema.String, key: Schema.String, name: Schema.String })),
  invitedBy: Schema.NullOr(Schema.String),
  expiresAt: Schema.Int
})
export type InvitePreview = typeof InvitePreview.Type

/** The link of an invite is `<origin>/invite/<token>`. */
export const invitePath = (token: string) => `/invite/${token}`

export class GradientRpcs extends RpcGroup.make(
  Rpc.make("Bootstrap", { success: Snapshot }),
  Rpc.make("ServerInfo", { success: ServerInfo }),
  Rpc.make("Subscribe", {
    payload: { since: Schema.Int },
    success: SyncEvent,
    stream: true
  }),
  Rpc.make("Mutate", {
    payload: { clientTxId: Schema.String, mutations: Schema.Array(Mutation) },
    success: Schema.Struct({ syncId: Schema.Int }),
    error: MutationRejected
  }),
  /** Admins: invite someone. The token is returned once; its link is `invitePath(token)`. */
  Rpc.make("InviteCreate", {
    payload: { email: Schema.NullOr(Schema.String), role: Role, teamIds: Schema.Array(Schema.String) },
    success: Schema.Struct({ invite: Invite, token: Schema.String }),
    error: MemberError
  }),
  /** Admins: invites not accepted yet, newest first (expired ones too, until revoked). */
  Rpc.make("InviteList", { success: Schema.Array(Invite), error: MemberError }),
  Rpc.make("InviteRevoke", { payload: { id: Schema.String }, error: MemberError }),
  /** Accept an invite as the signed-in account: join its teams (and become admin, if it says so). */
  Rpc.make("InviteAccept", {
    payload: { token: Schema.String },
    success: Schema.Struct({ teamIds: Schema.Array(Schema.String) }),
    error: MemberError
  }),
  /** Admins: change someone's role. The last admin cannot step down. */
  Rpc.make("MemberSetRole", { payload: { userId: Schema.String, role: Role }, error: MemberError }),
  /**
   * Admins: remove someone from the workspace. Their account, sessions and
   * agent keys are deleted; they stay on the issues they touched, without a role.
   */
  Rpc.make("MemberRemove", { payload: { userId: Schema.String }, error: MemberError }),
  /** Admins: the email addresses of the people with an account, by user id. */
  Rpc.make("MemberEmails", { success: Schema.Record(Schema.String, Schema.String), error: MemberError }),
  Rpc.make("GithubStatus", { success: GithubStatus }),
  /**
   * Link a repository to a project and import its issues. Without a projectId,
   * a new project is created (named `projectName`, or after the repository).
   */
  Rpc.make("GithubLinkRepo", {
    payload: {
      teamId: Schema.String,
      projectId: Schema.NullOr(Schema.String),
      projectName: Schema.optionalKey(Schema.String),
      /** Key of the new project; derived from its name when omitted. */
      projectKey: Schema.optionalKey(Schema.String),
      owner: Schema.String,
      name: Schema.String,
      pushExisting: Schema.Boolean
    },
    success: Schema.Struct({ projectId: Schema.String, imported: Schema.Int, pushed: Schema.Int }),
    error: GithubError
  }),
  Rpc.make("GithubUnlinkRepo", {
    payload: { repoId: Schema.String },
    error: GithubError
  }),
  Rpc.make("GithubSyncNow", { payload: { repoId: Schema.String }, error: GithubError }),
  /** A pull request with its files, checks, reviews and comments, read from GitHub. */
  Rpc.make("GithubPullRequest", {
    payload: PullRequestRef,
    success: PullRequestDetail,
    error: GithubError
  }),
  /** Comment on a pull request's conversation, as your GitHub account. */
  Rpc.make("GithubPullRequestComment", {
    payload: { ...PullRequestRef, body: Schema.String },
    success: PullRequestActivity,
    error: GithubError
  }),
  /** Submit a review (approve, request changes or comment) with inline comments, as your GitHub account. */
  Rpc.make("GithubPullRequestReview", {
    payload: {
      ...PullRequestRef,
      event: ReviewEvent,
      body: Schema.String,
      /** The commit the inline comments were written against. */
      commitSha: Schema.String,
      comments: Schema.Array(DraftReviewComment)
    },
    error: GithubError
  }),
  /** Merge a pull request at `sha` (refused if the head moved), as your GitHub account. */
  Rpc.make("GithubPullRequestMerge", {
    payload: { ...PullRequestRef, method: MergeMethod, sha: Schema.String },
    success: Schema.Struct({ sha: Schema.String }),
    error: GithubError
  }),
  /** Comment on an issue's GitHub copy, as your GitHub account. The comment arrives through sync. */
  Rpc.make("GithubIssueComment", {
    payload: { issueId: Schema.String, body: Schema.String },
    error: GithubError
  }),
  /** Your GitHub account: who your comments, reviews and merges go out as. */
  Rpc.make("GithubAccountStatus", { success: GithubAccount }),
  /** Connect your own GitHub account (device flow). Replaces your sign-in that is already waiting. */
  Rpc.make("GithubAccountSignInStart", { success: GithubDeviceCode, error: GithubError }),
  Rpc.make("GithubAccountSignInWait", { success: GithubAccount, error: GithubError }),
  Rpc.make("GithubAccountSignInCancel", {}),
  Rpc.make("GithubAccountSignOut", { success: GithubAccount }),
  /** Start a device-flow sign-in. Replaces one that is already waiting. */
  Rpc.make("GithubSignInStart", { success: GithubDeviceCode, error: GithubError }),
  /** Wait until the pending sign-in finishes. */
  Rpc.make("GithubSignInWait", { success: GithubStatus, error: GithubError }),
  Rpc.make("GithubSignInCancel", {}),
  /** Forget the app sign-in. GITHUB_TOKEN or the gh CLI take over when present. */
  Rpc.make("GithubSignOut", { success: GithubStatus }),
  Rpc.make("GithubRepos", { success: Schema.Array(GithubAvailableRepo), error: GithubError }),
  /** The images in a project's repository, for the icon picker. */
  Rpc.make("GithubProjectIcons", {
    payload: { projectId: Schema.String },
    success: ProjectIconChoices,
    error: GithubError
  }),
  /**
   * Choose a project's icon: "auto" (favicon or logo, kept up to date), a file
   * of its repository ("repo" with `path`), or the cube ("none").
   */
  Rpc.make("GithubSetProjectIcon", {
    payload: {
      projectId: Schema.String,
      mode: Schema.Literals(["auto", "repo", "none"]),
      path: Schema.optionalKey(Schema.String)
    },
    error: GithubError
  })
).middleware(AuthMiddleware) {}
