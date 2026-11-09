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

export const GithubStatus = Schema.Struct({
  /** Where the token came from, or null when sync is disabled. */
  tokenSource: Schema.NullOr(Schema.Literals(["env", "gh-cli"])),
  login: Schema.NullOr(Schema.String),
  webhookSecretSet: Schema.Boolean,
  pollIntervalSeconds: Schema.Number
})
export type GithubStatus = typeof GithubStatus.Type

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
  Rpc.make("GithubLinkRepo", {
    payload: { teamId: Schema.String, owner: Schema.String, name: Schema.String, pushExisting: Schema.Boolean },
    success: Schema.Struct({ imported: Schema.Int, pushed: Schema.Int }),
    error: GithubError
  }),
  Rpc.make("GithubUnlinkRepo", {
    payload: { repoId: Schema.String },
    error: GithubError
  }),
  Rpc.make("GithubSyncNow", { payload: { repoId: Schema.String }, error: GithubError })
) {}
