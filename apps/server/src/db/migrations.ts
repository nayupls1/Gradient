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
  }),
  /**
   * Projects group issues inside a team, and each linked repository belongs to
   * one. A repository linked before projects existed gets a project named
   * after it, holding the issues synced with it.
   */
  "0003_projects": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE project (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES team(id),
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (team_id, name COLLATE NOCASE)
    )`
    yield* sql`ALTER TABLE issue ADD COLUMN project_id TEXT REFERENCES project(id) ON DELETE SET NULL`
    yield* sql`CREATE INDEX issue_project ON issue (project_id)`
    yield* sql`ALTER TABLE github_repo ADD COLUMN project_id TEXT REFERENCES project(id)`
    const repos = yield* sql`SELECT id, team_id, name, created_at FROM github_repo`
    for (const repo of repos) {
      const projectId = crypto.randomUUID()
      yield* sql`INSERT INTO project (id, team_id, name, color, created_at)
                 VALUES (${projectId}, ${repo.team_id as string}, ${repo.name as string}, '#0090ff', ${repo.created_at as number})`
      yield* sql`UPDATE github_repo SET project_id = ${projectId} WHERE id = ${repo.id as string}`
      yield* sql`UPDATE issue SET project_id = ${projectId}
                 WHERE id IN (SELECT issue_id FROM github_issue_link WHERE repo_id = ${repo.id as string})`
    }
    yield* sql`CREATE UNIQUE INDEX github_repo_project ON github_repo (project_id)`
  }),
  /**
   * Projects get a key that prefixes their issues' identifiers (TES-12). Keys
   * are the first three letters of the name, made unique within the team.
   * (The derivation is inlined so this migration never changes.)
   */
  "0004_project_keys": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE project ADD COLUMN key TEXT`
    const teams = yield* sql`SELECT id, key FROM team`
    for (const team of teams) {
      const used = new Set<string>([String(team.key).toUpperCase()])
      const projects = yield* sql`SELECT id, name FROM project WHERE team_id = ${team.id as string} ORDER BY created_at`
      for (const project of projects) {
        const cleaned = String(project.name).normalize("NFKD").replace(/[^A-Za-z0-9]/g, "").toUpperCase().replace(/^[0-9]+/, "")
        const base = cleaned.length >= 2 ? cleaned.slice(0, 3) : "PRJ"
        let key = base
        for (let n = 2; used.has(key); n++) key = `${base.slice(0, n < 10 ? 2 : 1)}${n}`
        used.add(key)
        yield* sql`UPDATE project SET key = ${key} WHERE id = ${project.id as string}`
      }
    }
    yield* sql`CREATE UNIQUE INDEX project_key ON project (team_id, key)`
  }),
  /**
   * Relations between issues ("blocks", "related"), pull requests read from
   * linked repositories, and what Gradient knows of each linked issue's
   * dependencies on GitHub: its global id (dependencies are written by id) and
   * the shadow of its "blocked by" list (NULL until first read).
   */
  "0005_relations": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE issue_relation (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES team(id),
      type TEXT NOT NULL,
      issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
      related_issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      UNIQUE (issue_id, related_issue_id)
    )`
    yield* sql`CREATE INDEX issue_relation_related ON issue_relation (related_issue_id)`
    yield* sql`CREATE TABLE pull_request (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES team(id),
      repo_id TEXT NOT NULL REFERENCES github_repo(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      state TEXT NOT NULL,
      author TEXT,
      closes TEXT NOT NULL,
      mentions TEXT NOT NULL,
      gh_updated_at TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (repo_id, number)
    )`
    yield* sql`ALTER TABLE github_issue_link ADD COLUMN gh_id INTEGER`
    yield* sql`ALTER TABLE github_issue_link ADD COLUMN blocked_by_shadow TEXT`
  }),
  /**
   * Project icons: how the icon is chosen ("auto" finds a favicon or logo in the
   * linked repository) and the repository file shown, as path and blob sha.
   * `github_blob` caches the bytes of those files, so private repositories
   * work and GitHub is asked once per version.
   */
  "0006_project_icons": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE project ADD COLUMN icon_mode TEXT NOT NULL DEFAULT 'auto'`
    yield* sql`ALTER TABLE project ADD COLUMN icon_path TEXT`
    yield* sql`ALTER TABLE project ADD COLUMN icon_sha TEXT`
    yield* sql`CREATE TABLE github_blob (
      repo_id TEXT NOT NULL REFERENCES github_repo(id) ON DELETE CASCADE,
      sha TEXT NOT NULL,
      content BLOB NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (repo_id, sha)
    )`
  }),
  /**
   * Comments on issues, read from GitHub (Gradient does not write them), and
   * the cursor of the repository-wide comment poll: the newest `updated_at`
   * seen and the ETag of that request.
   */
  "0007_issue_comments": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE issue_comment (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES team(id),
      issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
      repo_id TEXT NOT NULL REFERENCES github_repo(id) ON DELETE CASCADE,
      gh_id INTEGER NOT NULL,
      author TEXT,
      author_avatar_url TEXT,
      body TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      gh_updated_at TEXT NOT NULL,
      UNIQUE (repo_id, gh_id)
    )`
    yield* sql`CREATE INDEX issue_comment_issue ON issue_comment (issue_id, created_at)`
    yield* sql`ALTER TABLE github_repo ADD COLUMN comments_since TEXT`
    yield* sql`ALTER TABLE github_repo ADD COLUMN comments_etag TEXT`
  }),
  /**
   * Accounts (Better Auth, email and password). Better Auth's models live in
   * `auth_*` tables; the adapter maps its camelCase fields to these columns.
   * Dates are ISO strings, booleans 0/1. A Gradient user acts for at most one
   * account (`user.account_id`); users without one are people known from
   * GitHub (assignees, authors).
   */
  "0008_auth": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE auth_user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
    yield* sql`CREATE TABLE auth_session (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
    yield* sql`CREATE INDEX auth_session_user ON auth_session (user_id)`
    yield* sql`CREATE TABLE auth_account (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      id_token TEXT,
      access_token_expires_at TEXT,
      refresh_token_expires_at TEXT,
      scope TEXT,
      password TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
    yield* sql`CREATE INDEX auth_account_user ON auth_account (user_id)`
    yield* sql`CREATE TABLE auth_verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
    yield* sql`CREATE INDEX auth_verification_identifier ON auth_verification (identifier)`
    yield* sql`CREATE TABLE auth_api_key (
      id TEXT PRIMARY KEY,
      config_id TEXT NOT NULL DEFAULT 'default',
      name TEXT,
      start TEXT,
      reference_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
      prefix TEXT,
      key TEXT NOT NULL,
      refill_interval INTEGER,
      refill_amount INTEGER,
      last_refill_at TEXT,
      enabled INTEGER,
      rate_limit_enabled INTEGER,
      rate_limit_time_window INTEGER,
      rate_limit_max INTEGER,
      request_count INTEGER,
      remaining INTEGER,
      last_request TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      permissions TEXT,
      metadata TEXT
    )`
    yield* sql`CREATE INDEX auth_api_key_key ON auth_api_key (key)`
    yield* sql`CREATE INDEX auth_api_key_reference ON auth_api_key (reference_id)`
    yield* sql`ALTER TABLE user ADD COLUMN account_id TEXT REFERENCES auth_user(id) ON DELETE SET NULL`
    yield* sql`CREATE UNIQUE INDEX user_account ON user (account_id)`
  }),
  /**
   * Teams for real: memberships (`team_member`), workspace roles on users
   * (`admin`, `member`; NULL for people known only from GitHub) and invites.
   * The workspace's original user is the admin; other users with an account
   * are members. Everyone who could see the teams before (every account, and
   * the original user) joins every existing team, so nothing disappears from
   * anyone's sidebar. An invite keeps only the SHA-256 of its token.
   */
  "0009_teams": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE team_member (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      UNIQUE (team_id, user_id)
    )`
    yield* sql`CREATE INDEX team_member_user ON team_member (user_id)`
    yield* sql`ALTER TABLE user ADD COLUMN role TEXT`
    const owner = (yield* sql`SELECT value FROM meta WHERE key = 'viewer_id'`)[0]?.value as string | undefined
    yield* sql`UPDATE user SET role = 'member' WHERE account_id IS NOT NULL`
    if (owner) yield* sql`UPDATE user SET role = 'admin' WHERE id = ${owner} AND account_id IS NOT NULL`
    const now = Date.now()
    const people = yield* sql`SELECT id FROM user WHERE account_id IS NOT NULL OR id = ${owner ?? ""}`
    const teams = yield* sql`SELECT id FROM team`
    for (const team of teams) {
      for (const person of people) {
        yield* sql`INSERT INTO team_member (id, team_id, user_id, created_at)
                   VALUES (${crypto.randomUUID()}, ${team.id as string}, ${person.id as string}, ${now})`
      }
    }
    yield* sql`CREATE TABLE invite (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      email TEXT COLLATE NOCASE,
      role TEXT NOT NULL,
      team_ids TEXT NOT NULL,
      invited_by TEXT REFERENCES user(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      accepted_at INTEGER,
      accepted_by TEXT REFERENCES user(id) ON DELETE SET NULL
    )`
  }),
  /**
   * The pull requests GitHub links to each issue (its "Development" list), in
   * any repository. `development_synced_at` stays NULL until a repository's
   * issues have all been read once, so repositories linked earlier catch up.
   */
  "0010_linked_pull_requests": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE linked_pull_request (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES team(id),
      issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
      repo_id TEXT NOT NULL REFERENCES github_repo(id) ON DELETE CASCADE,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      state TEXT NOT NULL,
      author TEXT,
      updated_at INTEGER NOT NULL,
      UNIQUE (issue_id, url)
    )`
    yield* sql`ALTER TABLE github_repo ADD COLUMN development_synced_at INTEGER`
  }),
  /**
   * Each person's own GitHub account: comments, reviews and merges made in
   * Gradient go out as them. The workspace connection (github_auth) still
   * syncs issues. Tokens are secrets: never synced.
   */
  "0011_github_user_auth": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE github_user_auth (
      user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      login TEXT NOT NULL,
      avatar_url TEXT,
      expires_at INTEGER,
      created_at INTEGER NOT NULL
    )`
  })
}
