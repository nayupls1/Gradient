import { Schema } from "effect"
import {
  Issue,
  IssueRelation,
  Label,
  Priority,
  Project,
  ProjectIconFile,
  ProjectIconMode,
  RelationType,
  Team,
  TeamMember
} from "./models.ts"

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
  /** A new team, with the default workflow states and labels. Whoever creates it joins it. */
  TeamCreate: { id: Schema.String, key: Schema.String, name: Schema.String },
  /** Rename a team or change its key (which renames the identifiers of its issues without a project). */
  TeamUpdate: {
    id: Schema.String,
    patch: Schema.Struct({ name: Schema.optionalKey(Schema.String), key: Schema.optionalKey(Schema.String) })
  },
  /** Admins only, and only for a team without issues or linked repositories. */
  TeamDelete: { id: Schema.String },
  /** Join a team, or add someone with an account to one. */
  TeamMemberAdd: { id: Schema.String, teamId: Schema.String, userId: Schema.String },
  /** Leave a team, or remove someone from it. */
  TeamMemberRemove: { id: Schema.String },
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
      color: Schema.optionalKey(Schema.String),
      /** Sent together by the server once it has looked the file up in the repository. */
      iconMode: Schema.optionalKey(ProjectIconMode),
      icon: Schema.optionalKey(Schema.NullOr(ProjectIconFile))
    })
  },
  /** Its issues stay, without a project. A project with a linked repository must be unlinked first. */
  ProjectDelete: { id: Schema.String },
  /** Relate two issues of one team. For `blocks`, `issueId` blocks `relatedIssueId`. */
  RelationCreate: {
    id: Schema.String,
    teamId: Schema.String,
    type: RelationType,
    issueId: Schema.String,
    relatedIssueId: Schema.String
  },
  RelationDelete: { id: Schema.String }
})
export type Mutation = typeof Mutation.Type

/** Ids of the issues a mutation touches, used to recompute optimistic state. */
export const touchedIssueId = (m: Mutation): string | undefined =>
  m._tag.startsWith("Issue") ? (m as { id: string }).id : undefined

/** Id of the project a mutation creates, changes or deletes. */
export const touchedProjectId = (m: Mutation): string | undefined =>
  m._tag === "ProjectCreate" || m._tag === "ProjectUpdate" || m._tag === "ProjectDelete" ? m.id : undefined

/** Id of the team a mutation creates, changes or deletes. */
export const touchedTeamId = (m: Mutation): string | undefined =>
  m._tag === "TeamCreate" || m._tag === "TeamUpdate" || m._tag === "TeamDelete" ? m.id : undefined

/** Id of the team membership a mutation adds or removes. */
export const touchedTeamMemberId = (m: Mutation): string | undefined =>
  m._tag === "TeamMemberAdd" || m._tag === "TeamMemberRemove" ? m.id : undefined

/** Id of the relation a mutation creates or deletes. */
export const touchedRelationId = (m: Mutation): string | undefined =>
  m._tag === "RelationCreate" || m._tag === "RelationDelete" ? m.id : undefined

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
      return {
        id: m.id,
        teamId: m.teamId,
        key: m.key,
        name: m.name,
        color: m.color,
        iconMode: "auto",
        icon: null,
        createdAt: ctx.now
      }
    case "ProjectUpdate": {
      if (!current) return current
      const next: Project = {
        ...current,
        ...(m.patch.name !== undefined ? { name: m.patch.name } : {}),
        ...(m.patch.key !== undefined ? { key: m.patch.key } : {}),
        ...(m.patch.color !== undefined ? { color: m.patch.color } : {}),
        ...(m.patch.iconMode !== undefined ? { iconMode: m.patch.iconMode } : {}),
        ...(m.patch.icon !== undefined ? { icon: m.patch.icon } : {})
      }
      // The cube shows no file, whatever the patch said.
      return next.iconMode === "none" ? { ...next, icon: null } : next
    }
    case "ProjectDelete":
      return null
    default:
      return current
  }
}

/** Applies a relation mutation, like applyIssueMutation. `null` means deleted. */
export const applyRelationMutation = (
  current: IssueRelation | undefined,
  m: Mutation,
  ctx: { readonly now: number }
): IssueRelation | null | undefined => {
  switch (m._tag) {
    case "RelationCreate":
      return {
        id: m.id,
        teamId: m.teamId,
        type: m.type,
        issueId: m.issueId,
        relatedIssueId: m.relatedIssueId,
        createdAt: ctx.now
      }
    case "RelationDelete":
      return null
    default:
      return current
  }
}

/** Applies a team mutation, like applyIssueMutation. `null` means deleted. */
export const applyTeamMutation = (current: Team | undefined, m: Mutation): Team | null | undefined => {
  switch (m._tag) {
    case "TeamCreate":
      return { id: m.id, key: m.key, name: m.name, issueCounter: 0 }
    case "TeamUpdate":
      return current && {
        ...current,
        ...(m.patch.name !== undefined ? { name: m.patch.name } : {}),
        ...(m.patch.key !== undefined ? { key: m.patch.key } : {})
      }
    case "TeamDelete":
      return null
    default:
      return current
  }
}

/** Applies a team membership mutation, like applyIssueMutation. `null` means removed. */
export const applyTeamMemberMutation = (
  current: TeamMember | undefined,
  m: Mutation,
  ctx: { readonly now: number }
): TeamMember | null | undefined => {
  switch (m._tag) {
    case "TeamMemberAdd":
      return { id: m.id, teamId: m.teamId, userId: m.userId, createdAt: ctx.now }
    case "TeamMemberRemove":
      return null
    default:
      return current
  }
}
