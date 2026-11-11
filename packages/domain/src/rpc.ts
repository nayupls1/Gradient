import { Context, Schema } from "effect"
import { Rpc, RpcGroup, RpcMiddleware } from "effect/rpc"
import { ProjectIconFile, Role } from "./models.ts"
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
