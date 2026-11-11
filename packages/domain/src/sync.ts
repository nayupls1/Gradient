import { Schema } from "effect"
import {
  Entity,
  GithubRepo,
  Issue,
  IssueComment,
  IssueRelation,
  Label,
  ModelName,
  Project,
  PullRequest,
  Team,
  TeamMember,
  User,
  WorkflowState
} from "./models.ts"

/** One ordered change. `syncId` is a single counter across the whole database. */
export const Delta = Schema.TaggedUnion({
  Upsert: { syncId: Schema.Int, clientTxId: Schema.NullOr(Schema.String), entity: Entity },
  Delete: { syncId: Schema.Int, clientTxId: Schema.NullOr(Schema.String), model: ModelName, id: Schema.String }
})
export type Delta = typeof Delta.Type

export const SyncEvent = Schema.TaggedUnion({
  /** Changes in syncId order. Sent on catch-up and for every live commit. */
  Deltas: { deltas: Schema.Array(Delta) },
  /** The client is too far behind to catch up from the log: bootstrap again. */
  ResetRequired: {}
})
export type SyncEvent = typeof SyncEvent.Type

export const Snapshot = Schema.Struct({
  lastSyncId: Schema.Int,
  viewerId: Schema.String,
  teams: Schema.Array(Team),
  teamMembers: Schema.Array(TeamMember),
  users: Schema.Array(User),
  workflowStates: Schema.Array(WorkflowState),
  labels: Schema.Array(Label),
  projects: Schema.Array(Project),
  issues: Schema.Array(Issue),
  githubRepos: Schema.Array(GithubRepo),
  issueRelations: Schema.Array(IssueRelation),
  pullRequests: Schema.Array(PullRequest),
  issueComments: Schema.Array(IssueComment)
})
export type Snapshot = typeof Snapshot.Type
