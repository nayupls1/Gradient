import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun"
import type { Entity, GithubRepo, Issue, Label, ModelName, Team, User, WorkflowState } from "@gradient/domain"
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
  avatarUrl: strOrNull(r.avatar_url)
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
const toRepo = (r: Row): GithubRepo => ({
  id: str(r.id),
  teamId: str(r.team_id),
  owner: str(r.owner),
  name: str(r.name),
  lastSyncedAt: numOrNull(r.last_synced_at),
  lastError: strOrNull(r.last_error),
  createdAt: num(r.created_at)
})
const toIssue = (r: Row): Issue => ({
  id: str(r.id),
  teamId: str(r.team_id),
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
    nextIssueNumber: (teamId: string) =>
      one(
        sql`UPDATE team SET issue_counter = issue_counter + 1 WHERE id = ${teamId} RETURNING issue_counter`,
        (r) => num(r.issue_counter)
      ),

    users: all(sql`SELECT * FROM user ORDER BY name`, toUser),
    getUser: (id: string) => one(sql`SELECT * FROM user WHERE id = ${id}`, toUser),
    getUserByLogin: (login: string) => one(sql`SELECT * FROM user WHERE github_login = ${login}`, toUser),
    putUser: (u: User) =>
      sql`INSERT INTO user (id, name, github_login, avatar_url) VALUES (${u.id}, ${u.name}, ${u.githubLogin}, ${u.avatarUrl})
          ON CONFLICT (id) DO UPDATE SET name = excluded.name, github_login = excluded.github_login, avatar_url = excluded.avatar_url`,

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

    issues: all(sql.unsafe(`${ISSUE_SELECT} ORDER BY i.sort_order DESC`), toIssue),
    getIssue: (id: string) => one(sql.unsafe(`${ISSUE_SELECT} WHERE i.id = ?`, [id]), toIssue),
    issuesForTeam: (teamId: string) => all(sql.unsafe(`${ISSUE_SELECT} WHERE i.team_id = ?`, [teamId]), toIssue),
    putIssue: (i: Issue) =>
      sql`INSERT INTO issue (id, team_id, number, title, description, state_id, priority, assignee_id, creator_id,
                             label_ids, sort_order, created_at, updated_at, archived_at)
          VALUES (${i.id}, ${i.teamId}, ${i.number}, ${i.title}, ${i.description}, ${i.stateId}, ${i.priority},
                  ${i.assigneeId}, ${i.creatorId}, ${JSON.stringify(i.labelIds)}, ${i.sortOrder}, ${i.createdAt},
                  ${i.updatedAt}, ${i.archivedAt})
          ON CONFLICT (id) DO UPDATE SET
            title = excluded.title, description = excluded.description, state_id = excluded.state_id,
            priority = excluded.priority, assignee_id = excluded.assignee_id, label_ids = excluded.label_ids,
            sort_order = excluded.sort_order, updated_at = excluded.updated_at, archived_at = excluded.archived_at`,
    deleteIssue: (id: string) => sql`DELETE FROM issue WHERE id = ${id}`,
    topSortOrder: (teamId: string) =>
      one(sql`SELECT MAX(sort_order) AS s FROM issue WHERE team_id = ${teamId}`, (r) => strOrNull(r.s)),

    githubRepos: all(sql`SELECT * FROM github_repo ORDER BY created_at`, toRepo),
    getRepo: (id: string) => one(sql`SELECT * FROM github_repo WHERE id = ${id}`, toRepo),
    repoForTeam: (teamId: string) => one(sql`SELECT * FROM github_repo WHERE team_id = ${teamId} LIMIT 1`, toRepo),
    repoByName: (owner: string, name: string) =>
      one(sql`SELECT * FROM github_repo WHERE owner = ${owner} COLLATE NOCASE AND name = ${name} COLLATE NOCASE`, toRepo),

    /** Read an entity back from its table, in the shape clients receive. */
    loadEntity: (model: ModelName, id: string): Effect.Effect<Entity | undefined, SqlError.SqlError> => {
      switch (model) {
        case "team":
          return one(sql`SELECT * FROM team WHERE id = ${id}`, (r) => ({ model, value: toTeam(r) }))
        case "user":
          return one(sql`SELECT * FROM user WHERE id = ${id}`, (r) => ({ model, value: toUser(r) }))
        case "workflowState":
          return one(sql`SELECT * FROM workflow_state WHERE id = ${id}`, (r) => ({ model, value: toState(r) }))
        case "label":
          return one(sql`SELECT * FROM label WHERE id = ${id}`, (r) => ({ model, value: toLabel(r) }))
        case "issue":
          return one(sql.unsafe(`${ISSUE_SELECT} WHERE i.id = ?`, [id]), (r) => ({ model, value: toIssue(r) }))
        case "githubRepo":
          return one(sql`SELECT * FROM github_repo WHERE id = ${id}`, (r) => ({ model, value: toRepo(r) }))
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
