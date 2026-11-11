import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun"
import type {
  Entity,
  GithubRepo,
  Issue,
  IssueComment,
  IssueRelation,
  Label,
  ModelName,
  Project,
  PullRequest,
  Role,
  Team,
  TeamMember,
  User,
  WorkflowState
} from "@gradient/domain"
import { Context, Effect, Layer } from "effect"
import { SqlClient, type SqlError } from "effect/sql"
import { ServerConfig } from "../config.ts"
import { migrations } from "./migrations.ts"

type Row = Record<string, unknown>
const str = (v: unknown) => v as string
const strOrNull = (v: unknown) => (v ?? null) as string | null
const num = (v: unknown) => Number(v)
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v))

const toTeam = (r: Row): Team => ({ id: str(r.id), key: str(r.key), name: str(r.name), issueCounter: num(r.issue_counter) })
const toUser = (r: Row): User => ({
  id: str(r.id),
  name: str(r.name),
  githubLogin: strOrNull(r.github_login),
  avatarUrl: strOrNull(r.avatar_url),
  role: r.role === "admin" || r.role === "member" ? r.role : null
})
const toTeamMember = (r: Row): TeamMember => ({
  id: str(r.id),
  teamId: str(r.team_id),
  userId: str(r.user_id),
  createdAt: num(r.created_at)
})

/** An invite row. The token itself is never stored, only its hash. */
export interface InviteRow {
  readonly id: string
  readonly email: string | null
  readonly role: Role
  readonly teamIds: ReadonlyArray<string>
  readonly invitedBy: string | null
  readonly createdAt: number
  readonly expiresAt: number
  readonly acceptedAt: number | null
  readonly acceptedBy: string | null
}
const toInvite = (r: Row): InviteRow => ({
  id: str(r.id),
  email: strOrNull(r.email),
  role: r.role === "admin" ? "admin" : "member",
  teamIds: JSON.parse(str(r.team_ids)) as Array<string>,
  invitedBy: strOrNull(r.invited_by),
  createdAt: num(r.created_at),
  expiresAt: num(r.expires_at),
  acceptedAt: numOrNull(r.accepted_at),
  acceptedBy: strOrNull(r.accepted_by)
})
const toState = (r: Row): WorkflowState => ({
  id: str(r.id),
  teamId: str(r.team_id),
  name: str(r.name),
  type: r.type as WorkflowState["type"],
  position: num(r.position),
  color: str(r.color)
})
const toLabel = (r: Row): Label => ({ id: str(r.id), teamId: str(r.team_id), name: str(r.name), color: str(r.color) })
const toProject = (r: Row): Project => ({
  id: str(r.id),
  teamId: str(r.team_id),
  key: str(r.key),
  name: str(r.name),
  color: str(r.color),
  iconMode: (r.icon_mode ?? "auto") as Project["iconMode"],
  icon: r.icon_path && r.icon_sha ? { path: str(r.icon_path), sha: str(r.icon_sha) } : null,
  createdAt: num(r.created_at)
})
const toRepo = (r: Row): GithubRepo => ({
  id: str(r.id),
  teamId: str(r.team_id),
  projectId: str(r.project_id),
  owner: str(r.owner),
  name: str(r.name),
  lastSyncedAt: numOrNull(r.last_synced_at),
  lastError: strOrNull(r.last_error),
  createdAt: num(r.created_at)
})
const toIssue = (r: Row): Issue => ({
  id: str(r.id),
  teamId: str(r.team_id),
  projectId: strOrNull(r.project_id),
  number: num(r.number),
  title: str(r.title),
  description: str(r.description),
  stateId: str(r.state_id),
  priority: num(r.priority) as Issue["priority"],
  assigneeId: strOrNull(r.assignee_id),
  creatorId: str(r.creator_id),
  labelIds: JSON.parse(str(r.label_ids)) as Array<string>,
  sortOrder: str(r.sort_order),
  github: r.gh_number == null
    ? null
    : {
      owner: str(r.gh_owner),
      repo: str(r.gh_repo),
      number: num(r.gh_number),
      url: str(r.gh_url)
    },
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
  archivedAt: numOrNull(r.archived_at)
})

const toRelation = (r: Row): IssueRelation => ({
  id: str(r.id),
  teamId: str(r.team_id),
  type: r.type as IssueRelation["type"],
  issueId: str(r.issue_id),
  relatedIssueId: str(r.related_issue_id),
  createdAt: num(r.created_at)
})
const toPullRequest = (r: Row): PullRequest => ({
  id: str(r.id),
  teamId: str(r.team_id),
  repoId: str(r.repo_id),
  number: num(r.number),
  title: str(r.title),
  url: str(r.url),
  state: r.state as PullRequest["state"],
  author: strOrNull(r.author),
  closes: JSON.parse(str(r.closes)) as PullRequest["closes"],
  mentions: JSON.parse(str(r.mentions)) as Array<string>,
  updatedAt: num(r.updated_at)
})

const toComment = (r: Row): IssueComment => ({
  id: str(r.id),
  teamId: str(r.team_id),
  issueId: str(r.issue_id),
  author: strOrNull(r.author),
  authorAvatarUrl: strOrNull(r.author_avatar_url),
  body: str(r.body),
  url: str(r.url),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at)
})

export interface LogRow {
  readonly syncId: number
  readonly model: ModelName
  readonly modelId: string
  readonly op: "upsert" | "delete"
  readonly data: Entity | null
  readonly clientTxId: string | null
}

/**
 * Typed queries over the SQLite database. Writes here do not log or publish;
 * go through `Mutations` for any change clients should see.
 */
export class Db extends Context.Service<Db, Effect.Success<typeof makeDb>>()("gradient/Db") {
  static readonly layer = Layer.effect(Db, Effect.suspend(() => makeDb))
}

const ISSUE_SELECT = `
  SELECT i.*, l.gh_number, l.gh_url, r.owner AS gh_owner, r.name AS gh_repo
  FROM issue i
  LEFT JOIN github_issue_link l ON l.issue_id = i.id
  LEFT JOIN github_repo r ON r.id = l.repo_id`

const makeDb = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const all = <A>(query: Effect.Effect<ReadonlyArray<Row>, SqlError.SqlError>, f: (r: Row) => A) =>
    Effect.map(query, (rows) => rows.map(f))
  const one = <A>(query: Effect.Effect<ReadonlyArray<Row>, SqlError.SqlError>, f: (r: Row) => A) =>
    Effect.map(query, (rows) => (rows[0] ? f(rows[0]) : undefined))

  return {
    sql,
    getMeta: (key: string) => one(sql`SELECT value FROM meta WHERE key = ${key}`, (r) => str(r.value)),
    setMeta: (key: string, value: string) =>
      sql`INSERT INTO meta (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,

    teams: all(sql`SELECT * FROM team ORDER BY name`, toTeam),
    getTeam: (id: string) => one(sql`SELECT * FROM team WHERE id = ${id}`, toTeam),
    putTeam: (t: Team) =>
      sql`INSERT INTO team (id, key, name, issue_counter) VALUES (${t.id}, ${t.key}, ${t.name}, ${t.issueCounter})
          ON CONFLICT (id) DO UPDATE SET key = excluded.key, name = excluded.name, issue_counter = excluded.issue_counter`,
    getTeamByKey: (key: string) => one(sql`SELECT * FROM team WHERE key = ${key} COLLATE NOCASE`, toTeam),
    deleteTeam: (id: string) => sql`DELETE FROM team WHERE id = ${id}`,
    nextIssueNumber: (teamId: string) =>
      one(
        sql`UPDATE team SET issue_counter = issue_counter + 1 WHERE id = ${teamId} RETURNING issue_counter`,
        (r) => num(r.issue_counter)
      ),

    users: all(sql`SELECT * FROM user ORDER BY name`, toUser),
    getUser: (id: string) => one(sql`SELECT * FROM user WHERE id = ${id}`, toUser),
    /** The Gradient user a signed-in account acts as. */
    userForAccount: (accountId: string) => one(sql`SELECT * FROM user WHERE account_id = ${accountId}`, toUser),
    linkAccount: (userId: string, accountId: string) =>
      sql`UPDATE user SET account_id = ${accountId} WHERE id = ${userId}`,
    accountCount: one(sql`SELECT COUNT(*) AS n FROM auth_user`, (r) => num(r.n)).pipe(Effect.map((n) => n ?? 0)),
    getUserByLogin: (login: string) => one(sql`SELECT * FROM user WHERE github_login = ${login}`, toUser),
    /** Insert or update a user. An existing user's role only changes through `setRole`. */
    putUser: (u: User) =>
      sql`INSERT INTO user (id, name, github_login, avatar_url, role) VALUES (${u.id}, ${u.name}, ${u.githubLogin}, ${u.avatarUrl}, ${u.role})
          ON CONFLICT (id) DO UPDATE SET name = excluded.name, github_login = excluded.github_login, avatar_url = excluded.avatar_url`,
    setRole: (userId: string, role: Role | null) => sql`UPDATE user SET role = ${role} WHERE id = ${userId}`,
    adminCount: one(sql`SELECT COUNT(*) AS n FROM user WHERE role = 'admin'`, (r) => num(r.n)).pipe(Effect.map((n) => n ?? 0)),
    /** The account behind a user, if any. */
    accountOfUser: (userId: string) =>
      one(sql`SELECT account_id FROM user WHERE id = ${userId}`, (r) => strOrNull(r.account_id)).pipe(
        Effect.map((id) => id ?? null)
      ),
    /** Emails of the people with an account, by user id. */
    memberEmails: all(
      sql`SELECT u.id, a.email FROM user u JOIN auth_user a ON a.id = u.account_id`,
      (r) => [str(r.id), str(r.email)] as const
    ),

    teamMembers: all(sql`SELECT * FROM team_member ORDER BY created_at`, toTeamMember),
    getTeamMember: (id: string) => one(sql`SELECT * FROM team_member WHERE id = ${id}`, toTeamMember),
    membersOfTeam: (teamId: string) =>
      all(sql`SELECT * FROM team_member WHERE team_id = ${teamId} ORDER BY created_at`, toTeamMember),
    teamsOfUser: (userId: string) =>
      all(sql`SELECT * FROM team_member WHERE user_id = ${userId} ORDER BY created_at`, toTeamMember),
    membership: (teamId: string, userId: string) =>
      one(sql`SELECT * FROM team_member WHERE team_id = ${teamId} AND user_id = ${userId}`, toTeamMember),
    putTeamMember: (m: TeamMember) =>
      sql`INSERT INTO team_member (id, team_id, user_id, created_at) VALUES (${m.id}, ${m.teamId}, ${m.userId}, ${m.createdAt})`,
    deleteTeamMember: (id: string) => sql`DELETE FROM team_member WHERE id = ${id}`,

    invites: all(
      sql`SELECT * FROM invite WHERE accepted_at IS NULL ORDER BY created_at DESC`,
      toInvite
    ),
    getInvite: (id: string) => one(sql`SELECT * FROM invite WHERE id = ${id}`, toInvite),
    inviteByTokenHash: (hash: string) => one(sql`SELECT * FROM invite WHERE token_hash = ${hash}`, toInvite),
    putInvite: (i: InviteRow, tokenHash: string) =>
      sql`INSERT INTO invite (id, token_hash, email, role, team_ids, invited_by, created_at, expires_at)
          VALUES (${i.id}, ${tokenHash}, ${i.email}, ${i.role}, ${JSON.stringify(i.teamIds)}, ${i.invitedBy},
                  ${i.createdAt}, ${i.expiresAt})`,
    /** Mark an open, unexpired invite as used. False when someone else got there first, or it expired. */
    claimInvite: (id: string, now: number) =>
      Effect.map(
        sql`UPDATE invite SET accepted_at = ${now} WHERE id = ${id} AND accepted_at IS NULL AND expires_at > ${now}
            RETURNING id`,
        (rows) => rows.length > 0
      ),
    /** Give an invite back, when the sign-up it was claimed for failed. */
    unclaimInvite: (id: string) => sql`UPDATE invite SET accepted_at = NULL WHERE id = ${id} AND accepted_by IS NULL`,
    inviteAcceptedBy: (id: string, userId: string) => sql`UPDATE invite SET accepted_by = ${userId} WHERE id = ${id}`,
    deleteInvite: (id: string) => sql`DELETE FROM invite WHERE id = ${id}`,

    workflowStates: all(sql`SELECT * FROM workflow_state ORDER BY team_id, position`, toState),
    getState: (id: string) => one(sql`SELECT * FROM workflow_state WHERE id = ${id}`, toState),
    statesForTeam: (teamId: string) =>
      all(sql`SELECT * FROM workflow_state WHERE team_id = ${teamId} ORDER BY position`, toState),
    putState: (s: WorkflowState) =>
      sql`INSERT INTO workflow_state (id, team_id, name, type, position, color)
          VALUES (${s.id}, ${s.teamId}, ${s.name}, ${s.type}, ${s.position}, ${s.color})
          ON CONFLICT (id) DO UPDATE SET name = excluded.name, type = excluded.type, position = excluded.position, color = excluded.color`,

    labels: all(sql`SELECT * FROM label ORDER BY name`, toLabel),
    getLabel: (id: string) => one(sql`SELECT * FROM label WHERE id = ${id}`, toLabel),
    labelsForTeam: (teamId: string) => all(sql`SELECT * FROM label WHERE team_id = ${teamId}`, toLabel),
    putLabel: (l: Label) =>
      sql`INSERT INTO label (id, team_id, name, color) VALUES (${l.id}, ${l.teamId}, ${l.name}, ${l.color})
          ON CONFLICT (id) DO UPDATE SET name = excluded.name, color = excluded.color`,

    projects: all(sql`SELECT * FROM project ORDER BY name COLLATE NOCASE`, toProject),
    getProject: (id: string) => one(sql`SELECT * FROM project WHERE id = ${id}`, toProject),
    projectsForTeam: (teamId: string) =>
      all(sql`SELECT * FROM project WHERE team_id = ${teamId} ORDER BY name COLLATE NOCASE`, toProject),
    putProject: (p: Project) =>
      sql`INSERT INTO project (id, team_id, key, name, color, icon_mode, icon_path, icon_sha, created_at)
          VALUES (${p.id}, ${p.teamId}, ${p.key}, ${p.name}, ${p.color}, ${p.iconMode}, ${p.icon?.path ?? null},
                  ${p.icon?.sha ?? null}, ${p.createdAt})
          ON CONFLICT (id) DO UPDATE SET key = excluded.key, name = excluded.name, color = excluded.color,
            icon_mode = excluded.icon_mode, icon_path = excluded.icon_path, icon_sha = excluded.icon_sha`,
    deleteProject: (id: string) => sql`DELETE FROM project WHERE id = ${id}`,

    issues: all(sql.unsafe(`${ISSUE_SELECT} ORDER BY i.sort_order DESC`), toIssue),
    getIssue: (id: string) => one(sql.unsafe(`${ISSUE_SELECT} WHERE i.id = ?`, [id]), toIssue),
    issuesForTeam: (teamId: string) => all(sql.unsafe(`${ISSUE_SELECT} WHERE i.team_id = ?`, [teamId]), toIssue),
    putIssue: (i: Issue) =>
      sql`INSERT INTO issue (id, team_id, project_id, number, title, description, state_id, priority, assignee_id,
                             creator_id, label_ids, sort_order, created_at, updated_at, archived_at)
          VALUES (${i.id}, ${i.teamId}, ${i.projectId}, ${i.number}, ${i.title}, ${i.description}, ${i.stateId},
                  ${i.priority}, ${i.assigneeId}, ${i.creatorId}, ${JSON.stringify(i.labelIds)}, ${i.sortOrder},
                  ${i.createdAt}, ${i.updatedAt}, ${i.archivedAt})
          ON CONFLICT (id) DO UPDATE SET
            project_id = excluded.project_id,
            title = excluded.title, description = excluded.description, state_id = excluded.state_id,
            priority = excluded.priority, assignee_id = excluded.assignee_id, label_ids = excluded.label_ids,
            sort_order = excluded.sort_order, updated_at = excluded.updated_at, archived_at = excluded.archived_at`,
    deleteIssue: (id: string) => sql`DELETE FROM issue WHERE id = ${id}`,
    topSortOrder: (teamId: string) =>
      one(sql`SELECT MAX(sort_order) AS s FROM issue WHERE team_id = ${teamId}`, (r) => strOrNull(r.s)),

    githubRepos: all(sql`SELECT * FROM github_repo ORDER BY created_at`, toRepo),
    getRepo: (id: string) => one(sql`SELECT * FROM github_repo WHERE id = ${id}`, toRepo),
    repoForProject: (projectId: string) =>
      one(sql`SELECT * FROM github_repo WHERE project_id = ${projectId} LIMIT 1`, toRepo),
    /** Where an issue syncs: the repo it is already linked to, else its project's repo. */
    repoForIssue: (issue: Pick<Issue, "id" | "projectId">) =>
      one(
        sql`SELECT r.* FROM github_repo r
            WHERE r.id = (SELECT repo_id FROM github_issue_link WHERE issue_id = ${issue.id})
               OR (r.project_id = ${issue.projectId} AND NOT EXISTS
                    (SELECT 1 FROM github_issue_link WHERE issue_id = ${issue.id}))
            LIMIT 1`,
        toRepo
      ),
    repoByName: (owner: string, name: string) =>
      one(sql`SELECT * FROM github_repo WHERE owner = ${owner} COLLATE NOCASE AND name = ${name} COLLATE NOCASE`, toRepo),

    relations: all(sql`SELECT * FROM issue_relation ORDER BY created_at`, toRelation),
    getRelation: (id: string) => one(sql`SELECT * FROM issue_relation WHERE id = ${id}`, toRelation),
    relationsForTeam: (teamId: string) =>
      all(sql`SELECT * FROM issue_relation WHERE team_id = ${teamId} ORDER BY created_at`, toRelation),
    /** Relations on either side of an issue. */
    relationsOf: (issueId: string) =>
      all(
        sql`SELECT * FROM issue_relation WHERE issue_id = ${issueId} OR related_issue_id = ${issueId} ORDER BY created_at`,
        toRelation
      ),
    /** The relation between two issues, in either direction. There is at most one. */
    relationBetween: (a: string, b: string) =>
      one(
        sql`SELECT * FROM issue_relation
            WHERE (issue_id = ${a} AND related_issue_id = ${b}) OR (issue_id = ${b} AND related_issue_id = ${a})`,
        toRelation
      ),
    putRelation: (r: IssueRelation) =>
      sql`INSERT INTO issue_relation (id, team_id, type, issue_id, related_issue_id, created_at)
          VALUES (${r.id}, ${r.teamId}, ${r.type}, ${r.issueId}, ${r.relatedIssueId}, ${r.createdAt})`,
    deleteRelation: (id: string) => sql`DELETE FROM issue_relation WHERE id = ${id}`,

    /** Cached bytes of a repository file, by blob sha. */
    getBlob: (repoId: string, sha: string) =>
      one(sql`SELECT content FROM github_blob WHERE repo_id = ${repoId} AND sha = ${sha}`, (r) => r.content as Uint8Array),
    putBlob: (repoId: string, sha: string, content: Uint8Array, now: number) =>
      sql`INSERT INTO github_blob (repo_id, sha, content, fetched_at) VALUES (${repoId}, ${sha}, ${content}, ${now})
          ON CONFLICT (repo_id, sha) DO NOTHING`,
    /** Drop cached files of a repository other than `keep` that are older than `before`. */
    pruneBlobs: (repoId: string, keep: string | null, before: number) =>
      sql`DELETE FROM github_blob WHERE repo_id = ${repoId} AND sha IS NOT ${keep} AND fetched_at < ${before}`,

    pullRequests: all(sql`SELECT * FROM pull_request ORDER BY updated_at DESC`, toPullRequest),
    pullRequestsForTeam: (teamId: string) =>
      all(sql`SELECT * FROM pull_request WHERE team_id = ${teamId} ORDER BY updated_at DESC`, toPullRequest),

    comments: all(sql`SELECT * FROM issue_comment ORDER BY created_at`, toComment),
    commentsForTeam: (teamId: string) =>
      all(sql`SELECT * FROM issue_comment WHERE team_id = ${teamId} ORDER BY created_at`, toComment),

    /** Read an entity back from its table, in the shape clients receive. */
    loadEntity: (model: ModelName, id: string): Effect.Effect<Entity | undefined, SqlError.SqlError> => {
      switch (model) {
        case "team":
          return one(sql`SELECT * FROM team WHERE id = ${id}`, (r) => ({ model, value: toTeam(r) }))
        case "teamMember":
          return one(sql`SELECT * FROM team_member WHERE id = ${id}`, (r) => ({ model, value: toTeamMember(r) }))
        case "user":
          return one(sql`SELECT * FROM user WHERE id = ${id}`, (r) => ({ model, value: toUser(r) }))
        case "workflowState":
          return one(sql`SELECT * FROM workflow_state WHERE id = ${id}`, (r) => ({ model, value: toState(r) }))
        case "label":
          return one(sql`SELECT * FROM label WHERE id = ${id}`, (r) => ({ model, value: toLabel(r) }))
        case "project":
          return one(sql`SELECT * FROM project WHERE id = ${id}`, (r) => ({ model, value: toProject(r) }))
        case "issue":
          return one(sql.unsafe(`${ISSUE_SELECT} WHERE i.id = ?`, [id]), (r) => ({ model, value: toIssue(r) }))
        case "githubRepo":
          return one(sql`SELECT * FROM github_repo WHERE id = ${id}`, (r) => ({ model, value: toRepo(r) }))
        case "issueRelation":
          return one(sql`SELECT * FROM issue_relation WHERE id = ${id}`, (r) => ({ model, value: toRelation(r) }))
        case "pullRequest":
          return one(sql`SELECT * FROM pull_request WHERE id = ${id}`, (r) => ({ model, value: toPullRequest(r) }))
        case "issueComment":
          return one(sql`SELECT * FROM issue_comment WHERE id = ${id}`, (r) => ({ model, value: toComment(r) }))
      }
    },

    appendLog: (entry: {
      model: ModelName
      modelId: string
      op: "upsert" | "delete"
      data: Entity | null
      clientTxId: string | null
      origin: string
      actorId: string | null
      now: number
    }) =>
      one(
        sql`INSERT INTO sync_log (model, model_id, op, data, client_tx_id, origin, actor_id, created_at)
            VALUES (${entry.model}, ${entry.modelId}, ${entry.op}, ${entry.data ? JSON.stringify(entry.data) : null},
                    ${entry.clientTxId}, ${entry.origin}, ${entry.actorId}, ${entry.now})
            RETURNING sync_id`,
        (r) => num(r.sync_id)
      ).pipe(Effect.map((id) => id!)),
    lastSyncId: one(sql`SELECT COALESCE(MAX(sync_id), 0) AS id FROM sync_log`, (r) => num(r.id)).pipe(
      Effect.map((id) => id ?? 0)
    ),
    syncIdForClientTx: (clientTxId: string) =>
      one(sql`SELECT MAX(sync_id) AS id FROM sync_log WHERE client_tx_id = ${clientTxId}`, (r) => numOrNull(r.id)).pipe(
        Effect.map((id) => id ?? null)
      ),
    logSince: (since: number, limit: number) =>
      all(
        sql`SELECT * FROM sync_log WHERE sync_id > ${since} ORDER BY sync_id LIMIT ${limit}`,
        (r): LogRow => ({
          syncId: num(r.sync_id),
          model: r.model as ModelName,
          modelId: str(r.model_id),
          op: r.op as "upsert" | "delete",
          data: r.data ? (JSON.parse(str(r.data)) as Entity) : null,
          clientTxId: strOrNull(r.client_tx_id)
        })
      )
  }
})

/** SQLite client plus migrations. Everything built on this sees a migrated database. */
export const SqlLive = Layer.unwrap(
  Effect.gen(function*() {
    const config = yield* ServerConfig
    const client = SqliteClient.layer({ filename: config.dbPath })
    const migrator = SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) })
    const pragmas = Layer.effectDiscard(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient
        yield* sql`PRAGMA foreign_keys = ON`
      })
    )
    return Layer.mergeAll(migrator, pragmas).pipe(Layer.provideMerge(client))
  })
)

export const DbLive = Db.layer.pipe(Layer.provideMerge(SqlLive))
