import { Effect } from "effect"
import { SqlClient } from "effect/sql"

/** Migrations run once each, in key order. Never edit one that has shipped; add a new one. */
export const migrations = {
  "0001_init": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
    yield* sql`CREATE TABLE team (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      issue_counter INTEGER NOT NULL DEFAULT 0
    )`
    yield* sql`CREATE TABLE user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      github_login TEXT UNIQUE COLLATE NOCASE,
      avatar_url TEXT
    )`
    yield* sql`CREATE TABLE workflow_state (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES team(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      position REAL NOT NULL,
      color TEXT NOT NULL
    )`
    yield* sql`CREATE TABLE label (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES team(id),
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      UNIQUE (team_id, name COLLATE NOCASE)
    )`
    yield* sql`CREATE TABLE issue (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES team(id),
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      state_id TEXT NOT NULL REFERENCES workflow_state(id),
      priority INTEGER NOT NULL,
      assignee_id TEXT REFERENCES user(id),
      creator_id TEXT NOT NULL REFERENCES user(id),
      label_ids TEXT NOT NULL,
      sort_order TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER,
      UNIQUE (team_id, number)
    )`
    yield* sql`CREATE TABLE github_repo (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES team(id),
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      last_synced_at INTEGER,
      last_error TEXT,
      poll_etag TEXT,
      poll_since TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (owner COLLATE NOCASE, name COLLATE NOCASE)
    )`
    yield* sql`CREATE TABLE github_issue_link (
      issue_id TEXT PRIMARY KEY REFERENCES issue(id) ON DELETE CASCADE,
      repo_id TEXT NOT NULL REFERENCES github_repo(id) ON DELETE CASCADE,
      gh_number INTEGER NOT NULL,
      gh_url TEXT NOT NULL,
      gh_updated_at TEXT NOT NULL,
      shadow TEXT NOT NULL,
      UNIQUE (repo_id, gh_number)
    )`
    yield* sql`CREATE TABLE github_outbox (
      issue_id TEXT PRIMARY KEY,
      enqueued_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL,
      last_error TEXT
    )`
    yield* sql`CREATE TABLE github_delivery (delivery_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL)`
    yield* sql`CREATE TABLE sync_log (
      sync_id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      model_id TEXT NOT NULL,
      op TEXT NOT NULL,
      data TEXT,
      client_tx_id TEXT,
      origin TEXT NOT NULL,
      actor_id TEXT,
      created_at INTEGER NOT NULL
    )`
    yield* sql`CREATE INDEX sync_log_client_tx ON sync_log (client_tx_id) WHERE client_tx_id IS NOT NULL`
  }),
  /** The token from "Sign in with GitHub". One row: Gradient is single-user for now. */
  "0002_github_auth": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE github_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      token TEXT NOT NULL,
      login TEXT NOT NULL,
      avatar_url TEXT,
      expires_at INTEGER,
      created_at INTEGER NOT NULL
    )`
  })
}
