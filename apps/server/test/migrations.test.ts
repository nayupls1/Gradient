import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun"
import { afterEach, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migrations } from "../src/db/migrations.ts"

const dirs: Array<string> = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Run `effect` against the database file after applying `upTo` migrations. */
const withDb = <A>(filename: string, upTo: ReadonlyArray<keyof typeof migrations>, effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) => {
  const subset = Object.fromEntries(upTo.map((k) => [k, migrations[k]]))
  const layer = SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(subset) }).pipe(
    Layer.provideMerge(SqliteClient.layer({ filename }))
  )
  return Effect.runPromise(effect.pipe(Effect.provide(layer)) as Effect.Effect<A>)
}

test("0003 moves a repository linked before projects into a project of its own, with its issues", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gradient-migrate-"))
  dirs.push(dir)
  const file = join(dir, "old.db")

  // A database from before projects: one team, a linked repo, one synced and one local issue.
  await withDb(file, ["0001_init", "0002_github_auth"], Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO team (id, key, name, issue_counter) VALUES ('t1', 'GRD', 'Gradient', 2)`
    yield* sql`INSERT INTO user (id, name) VALUES ('u1', 'Me')`
    yield* sql`INSERT INTO workflow_state (id, team_id, name, type, position, color) VALUES ('s1', 't1', 'Todo', 'unstarted', 0, '#fff')`
    for (const [id, n] of [["synced", 1], ["local", 2]] as const) {
      yield* sql`INSERT INTO issue (id, team_id, number, title, description, state_id, priority, creator_id, label_ids,
                                   sort_order, created_at, updated_at)
                 VALUES (${id}, 't1', ${n}, ${id}, '', 's1', 0, 'u1', '[]', 'a0', 1, 1)`
    }
    yield* sql`INSERT INTO github_repo (id, team_id, owner, name, created_at) VALUES ('r1', 't1', 'acme', 'widgets', 1)`
    yield* sql`INSERT INTO github_issue_link (issue_id, repo_id, gh_number, gh_url, gh_updated_at, shadow)
               VALUES ('synced', 'r1', 1, 'https://github.com/acme/widgets/issues/1', '2026-01-01T00:00:00Z', '{}')`
  }))

  const after = await withDb(file, Object.keys(migrations) as Array<keyof typeof migrations>, Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    return {
      projects: yield* sql`SELECT * FROM project`,
      repo: (yield* sql`SELECT project_id FROM github_repo WHERE id = 'r1'`)[0],
      issues: yield* sql`SELECT id, project_id FROM issue ORDER BY id`
    }
  }))

  expect(after.projects).toHaveLength(1)
  const project = after.projects[0]!
  expect(project).toMatchObject({ team_id: "t1", name: "widgets", key: "WID" })
  expect(after.repo!.project_id).toBe(project.id)
  expect(after.issues).toEqual([
    { id: "local", project_id: null },
    { id: "synced", project_id: project.id }
  ])
})

test("0004 gives existing projects unique keys from their names, never the team key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gradient-migrate-"))
  dirs.push(dir)
  const file = join(dir, "projects.db")
  await withDb(file, ["0001_init", "0002_github_auth", "0003_projects"], Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO team (id, key, name, issue_counter) VALUES ('t1', 'GRA', 'Grammar', 0)`
    let at = 1
    for (const name of ["Issue project", "issues", "Grand plan", "x"]) {
      yield* sql`INSERT INTO project (id, team_id, name, color, created_at) VALUES (${name}, 't1', ${name}, '#000', ${at++})`
    }
  }))
  const keys = await withDb(file, Object.keys(migrations) as Array<keyof typeof migrations>, Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql`SELECT name, key FROM project ORDER BY created_at`).map((r) => [r.name, r.key])
  }))
  expect(keys).toEqual([["Issue project", "ISS"], ["issues", "IS2"], ["Grand plan", "GR2"], ["x", "PRJ"]])
})

test("0005 adds relations and pull requests; existing links have no GitHub id or blocker shadow yet", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gradient-migrate-"))
  dirs.push(dir)
  const file = join(dir, "links.db")
  const before = ["0001_init", "0002_github_auth", "0003_projects", "0004_project_keys"] as const
  await withDb(file, [...before], Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO team (id, key, name, issue_counter) VALUES ('t1', 'GRD', 'Gradient', 1)`
    yield* sql`INSERT INTO user (id, name) VALUES ('u1', 'Me')`
    yield* sql`INSERT INTO workflow_state (id, team_id, name, type, position, color) VALUES ('s1', 't1', 'Todo', 'unstarted', 0, '#fff')`
    yield* sql`INSERT INTO issue (id, team_id, number, title, description, state_id, priority, creator_id, label_ids,
                                 sort_order, created_at, updated_at)
               VALUES ('i1', 't1', 1, 'Synced', '', 's1', 0, 'u1', '[]', 'a0', 1, 1)`
    yield* sql`INSERT INTO github_repo (id, team_id, owner, name, created_at) VALUES ('r1', 't1', 'acme', 'widgets', 1)`
    yield* sql`INSERT INTO github_issue_link (issue_id, repo_id, gh_number, gh_url, gh_updated_at, shadow)
               VALUES ('i1', 'r1', 1, 'https://github.com/acme/widgets/issues/1', '2026-01-01T00:00:00Z', '{}')`
  }))
  const after = await withDb(file, Object.keys(migrations) as Array<keyof typeof migrations>, Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    return {
      link: (yield* sql`SELECT gh_id, blocked_by_shadow FROM github_issue_link`)[0],
      relations: yield* sql`SELECT * FROM issue_relation`,
      pullRequests: yield* sql`SELECT * FROM pull_request`
    }
  }))
  expect(after.link).toEqual({ gh_id: null, blocked_by_shadow: null })
  expect(after.relations).toEqual([])
  expect(after.pullRequests).toEqual([])
})
