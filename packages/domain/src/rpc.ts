import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Mutation } from "./mutations.ts"
import { Snapshot, SyncEvent } from "./sync.ts"

export class MutationRejected extends Schema.TaggedError<MutationRejected>()("MutationRejected", {
  message: Schema.String
}) {}

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

export const ServerInfo = Schema.Struct({
  version: Schema.String,
  /** Where agents connect over MCP (Streamable HTTP). */
  mcpUrl: Schema.String
})
export type ServerInfo = typeof ServerInfo.Type

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
  Rpc.make("GithubRepos", { success: Schema.Array(GithubAvailableRepo), error: GithubError })
) {}
