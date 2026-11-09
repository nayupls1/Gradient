import { Schema } from "effect"
import { Issue, Label, Priority, Project } from "./models.ts"

export const IssuePatch = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  stateId: Schema.optionalKey(Schema.String),
  priority: Schema.optionalKey(Priority),
  assigneeId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  labelIds: Schema.optionalKey(Schema.Array(Schema.String)),
  projectId: Schema.optionalKey(Schema.NullOr(Schema.String)),
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
    projectId: Schema.NullOr(Schema.String),
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
  LabelCreate: { id: Schema.String, teamId: Schema.String, name: Schema.String, color: Schema.String },
  ProjectCreate: { id: Schema.String, teamId: Schema.String, key: Schema.String, name: Schema.String, color: Schema.String },
  ProjectUpdate: {
    id: Schema.String,
    patch: Schema.Struct({
      name: Schema.optionalKey(Schema.String),
      key: Schema.optionalKey(Schema.String),
      color: Schema.optionalKey(Schema.String)
    })
  },
  /** Its issues stay, without a project. A project with a linked repository must be unlinked first. */
  ProjectDelete: { id: Schema.String }
})
export type Mutation = typeof Mutation.Type

/** Ids of the issues a mutation touches, used to recompute optimistic state. */
export const touchedIssueId = (m: Mutation): string | undefined =>
  m._tag.startsWith("Issue") ? (m as { id: string }).id : undefined

/** Id of the project a mutation creates, changes or deletes. */
export const touchedProjectId = (m: Mutation): string | undefined =>
  m._tag === "ProjectCreate" || m._tag === "ProjectUpdate" || m._tag === "ProjectDelete" ? m.id : undefined

const pickPatch = (patch: IssuePatch): Partial<Issue> => {
  const out: { -readonly [K in keyof Issue]?: Issue[K] } = {}
  if (patch.title !== undefined) out.title = patch.title
  if (patch.description !== undefined) out.description = patch.description
  if (patch.stateId !== undefined) out.stateId = patch.stateId
  if (patch.priority !== undefined) out.priority = patch.priority
  if (patch.assigneeId !== undefined) out.assigneeId = patch.assigneeId
  if (patch.labelIds !== undefined) out.labelIds = patch.labelIds
  if (patch.projectId !== undefined) out.projectId = patch.projectId
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
        projectId: m.projectId,
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
    default:
      return current
  }
}

export const applyLabelMutation = (m: Mutation): Label | undefined =>
  m._tag === "LabelCreate" ? { id: m.id, teamId: m.teamId, name: m.name, color: m.color } : undefined

/** Applies a project mutation, like applyIssueMutation. `null` means deleted. */
export const applyProjectMutation = (
  current: Project | undefined,
  m: Mutation,
  ctx: { readonly now: number }
): Project | null | undefined => {
  switch (m._tag) {
    case "ProjectCreate":
      return { id: m.id, teamId: m.teamId, key: m.key, name: m.name, color: m.color, createdAt: ctx.now }
    case "ProjectUpdate":
      return current && {
        ...current,
        ...(m.patch.name !== undefined ? { name: m.patch.name } : {}),
        ...(m.patch.key !== undefined ? { key: m.patch.key } : {}),
        ...(m.patch.color !== undefined ? { color: m.patch.color } : {})
      }
    case "ProjectDelete":
      return null
    default:
      return current
  }
}
