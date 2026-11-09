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

export const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  githubLogin: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String)
})
export type User = typeof User.Type

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
  owner: Schema.String,
  name: Schema.String,
  /** When the last successful sync from GitHub finished. */
  lastSyncedAt: Schema.NullOr(Millis),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Millis
})
export type GithubRepo = typeof GithubRepo.Type

export const ModelName = Schema.Literals(["team", "user", "workflowState", "label", "issue", "githubRepo"])
export type ModelName = typeof ModelName.Type

/** One synced record, tagged by model, so clients can route it to the right table. */
export const Entity = Schema.Union([
  Schema.Struct({ model: Schema.Literal("team"), value: Team }),
  Schema.Struct({ model: Schema.Literal("user"), value: User }),
  Schema.Struct({ model: Schema.Literal("workflowState"), value: WorkflowState }),
  Schema.Struct({ model: Schema.Literal("label"), value: Label }),
  Schema.Struct({ model: Schema.Literal("issue"), value: Issue }),
  Schema.Struct({ model: Schema.Literal("githubRepo"), value: GithubRepo })
])
export type Entity = typeof Entity.Type

export const identifier = (team: Pick<Team, "key">, issue: Pick<Issue, "number">) =>
  issue.number > 0 ? `${team.key}-${issue.number}` : `${team.key}-…`
