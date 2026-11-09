import { Schema } from "effect"
import { Issue, Label, Priority } from "./models.ts"

export const IssuePatch = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  stateId: Schema.optionalKey(Schema.String),
  priority: Schema.optionalKey(Priority),
  assigneeId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  labelIds: Schema.optionalKey(Schema.Array(Schema.String)),
  sortOrder: Schema.optionalKey(Schema.String)
})
export type IssuePatch = typeof IssuePatch.Type

/**
 * Every write in Gradient is one of these. The browser, the GitHub sync and the
 * seed script all go through the same union, so there is one write path.
 */
export const Mutation = Schema.TaggedUnion({
  IssueCreate: {
    id: Schema.String,
    teamId: Schema.String,
    title: Schema.String,
    description: Schema.String,
    stateId: Schema.String,
    priority: Priority,
    assigneeId: Schema.NullOr(Schema.String),
    labelIds: Schema.Array(Schema.String),
    sortOrder: Schema.String
  },
  IssueUpdate: { id: Schema.String, patch: IssuePatch },
  IssueArchive: { id: Schema.String },
  IssueUnarchive: { id: Schema.String },
  IssueDelete: { id: Schema.String },
  LabelCreate: { id: Schema.String, teamId: Schema.String, name: Schema.String, color: Schema.String }
})
export type Mutation = typeof Mutation.Type

/** Ids of the issues a mutation touches, used to recompute optimistic state. */
export const touchedIssueId = (m: Mutation): string | undefined =>
  m._tag === "LabelCreate" ? undefined : m.id

const pickPatch = (patch: IssuePatch): Partial<Issue> => {
  const out: { -readonly [K in keyof Issue]?: Issue[K] } = {}
  if (patch.title !== undefined) out.title = patch.title
  if (patch.description !== undefined) out.description = patch.description
  if (patch.stateId !== undefined) out.stateId = patch.stateId
  if (patch.priority !== undefined) out.priority = patch.priority
  if (patch.assigneeId !== undefined) out.assigneeId = patch.assigneeId
  if (patch.labelIds !== undefined) out.labelIds = patch.labelIds
  if (patch.sortOrder !== undefined) out.sortOrder = patch.sortOrder
  return out
}

/**
 * Applies an issue mutation to the current value of that issue. Shared by the
 * server (the real write) and the client (the optimistic preview), so both
 * agree on the result. Returns `null` when the issue no longer exists.
 */
export const applyIssueMutation = (
  current: Issue | undefined,
  m: Mutation,
  ctx: { readonly now: number; readonly actorId: string; readonly number?: number }
): Issue | null | undefined => {
  switch (m._tag) {
    case "IssueCreate":
      return {
        id: m.id,
        teamId: m.teamId,
        number: ctx.number ?? 0,
        title: m.title,
        description: m.description,
        stateId: m.stateId,
        priority: m.priority,
        assigneeId: m.assigneeId,
        creatorId: ctx.actorId,
        labelIds: m.labelIds,
        sortOrder: m.sortOrder,
        github: null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        archivedAt: null
      }
    case "IssueUpdate":
      return current && { ...current, ...pickPatch(m.patch), updatedAt: ctx.now }
    case "IssueArchive":
      return current && { ...current, archivedAt: ctx.now, updatedAt: ctx.now }
    case "IssueUnarchive":
      return current && { ...current, archivedAt: null, updatedAt: ctx.now }
    case "IssueDelete":
      return null
    case "LabelCreate":
      return current
  }
}

export const applyLabelMutation = (m: Mutation): Label | undefined =>
  m._tag === "LabelCreate" ? { id: m.id, teamId: m.teamId, name: m.name, color: m.color } : undefined
