import { type CleanedWhere, createAdapterFactory } from "better-auth/adapters"
import type { BetterAuthOptions } from "better-auth"
import { Context, Effect } from "effect"
import { SqlClient } from "effect/sql"

/**
 * Better Auth's database adapter, on Gradient's own SQLite connection (Effect
 * SQL). Auth tables then share the migrations, the file and the transaction
 * lock with everything else, and an in-memory database works in tests.
 *
 * Better Auth speaks camelCase fields; the tables use snake_case columns.
 * SQLite has no dates or booleans, so the factory turns them into ISO strings
 * and 0/1 (`supportsDates`/`supportsBooleans: false`), which also keeps date
 * comparisons correct: ISO strings in UTC sort in time order.
 */

type Row = Record<string, unknown>
type Run = <A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) => Promise<A>

const column = (field: string) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const field = (col: string) => col.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
/** Table and column names come from Better Auth's schema, never from users; quote them anyway. */
const ident = (name: string) => `"${name.replaceAll(`"`, `""`)}"`

const fromRow = (row: Row): Row => {
  const out: Row = {}
  for (const [key, value] of Object.entries(row)) out[field(key)] = typeof value === "bigint" ? Number(value) : value
  return out
}

/** One condition. Text matching is case-sensitive unless `mode` is "insensitive" (SQLite's LIKE never is). */
const condition = (w: CleanedWhere, params: Array<unknown>): string => {
  const insensitive = w.mode === "insensitive"
  const col = insensitive ? `LOWER(${ident(column(w.field))})` : ident(column(w.field))
  const val = (v: unknown) => {
    params.push(insensitive && typeof v === "string" ? v.toLowerCase() : v)
    return "?"
  }
  switch (w.operator) {
    case "in":
    case "not_in": {
      const list = Array.isArray(w.value) ? (w.value as ReadonlyArray<unknown>) : [w.value]
      if (list.length === 0) return w.operator === "in" ? "0" : "1"
      return `${col} ${w.operator === "in" ? "IN" : "NOT IN"} (${list.map(val).join(", ")})`
    }
    case "contains":
      return `instr(${col}, ${val(w.value)}) > 0`
    case "starts_with":
      return `substr(${col}, 1, length(${val(w.value)})) = ${val(w.value)}`
    case "ends_with":
      return `substr(${col}, -length(${val(w.value)})) = ${val(w.value)}`
    case "ne":
      return w.value === null ? `${col} IS NOT NULL` : `${col} IS NOT ${val(w.value)}`
    case "lt":
      return `${col} < ${val(w.value)}`
    case "lte":
      return `${col} <= ${val(w.value)}`
    case "gt":
      return `${col} > ${val(w.value)}`
    case "gte":
      return `${col} >= ${val(w.value)}`
    default:
      return w.value === null ? `${col} IS NULL` : `${col} = ${val(w.value)}`
  }
}

/** `AND` conditions all hold, and at least one `OR` condition does (like Better Auth's Kysely adapter). */
const whereClause = (where: ReadonlyArray<CleanedWhere> | undefined, params: Array<unknown>) => {
  if (!where || where.length === 0) return ""
  const and = where.filter((w) => w.connector !== "OR").map((w) => condition(w, params))
  const or = where.filter((w) => w.connector === "OR").map((w) => condition(w, params))
  const parts = [...(and.length ? [and.join(" AND ")] : []), ...(or.length ? [`(${or.join(" OR ")})`] : [])]
  return ` WHERE ${parts.map((p) => `(${p})`).join(" AND ")}`
}

const selectList = (select: ReadonlyArray<string> | undefined) =>
  select && select.length ? select.map((f) => ident(column(f))).join(", ") : "*"

const query = (text: string, params: ReadonlyArray<unknown>) =>
  Effect.flatMap(Effect.service(SqlClient.SqlClient), (sql) => sql.unsafe<Row>(text, params as Array<any>))

const makeAdapter = (run: Run, getOptions: () => BetterAuthOptions): ReturnType<typeof createAdapterFactory> =>
  createAdapterFactory({
    config: {
      adapterId: "gradient-sqlite",
      adapterName: "Gradient SQLite",
      supportsDates: false,
      supportsBooleans: false,
      supportsJSON: false,
      supportsArrays: false,
      supportsNumericIds: true,
      // Runs the callback inside one SQL transaction: every query the adapter it
      // receives makes borrows the transaction's connection.
      transaction: (callback) =>
        run(
          Effect.flatMap(Effect.service(SqlClient.SqlClient), (sql) =>
            sql.withTransaction(
              Effect.flatMap(Effect.context<SqlClient.SqlClient>(), (context) =>
                Effect.tryPromise(() => callback(makeAdapter((e) => Effect.runPromise(Effect.provide(e, context)), getOptions)(getOptions()))))
            ))
        )
    },
    adapter: () => {
      const all = (text: string, params: ReadonlyArray<unknown>) =>
        run(query(text, params)).then((rows) => rows.map(fromRow))
      return {
        create: async ({ model, data, select }) => {
          const entries = Object.entries(data as Row)
          const rows = await all(
            `INSERT INTO ${ident(model)} (${entries.map(([k]) => ident(column(k))).join(", ")})
             VALUES (${entries.map(() => "?").join(", ")}) RETURNING ${selectList(select)}`,
            entries.map(([, v]) => v)
          )
          return rows[0] as any
        },
        findOne: async ({ model, where, select }) => {
          const params: Array<unknown> = []
          const rows = await all(`SELECT ${selectList(select)} FROM ${ident(model)}${whereClause(where, params)} LIMIT 1`, params)
          return (rows[0] ?? null) as any
        },
        findMany: async ({ model, where, limit, offset, sortBy, select }) => {
          const params: Array<unknown> = []
          let text = `SELECT ${selectList(select)} FROM ${ident(model)}${whereClause(where, params)}`
          if (sortBy) text += ` ORDER BY ${ident(column(sortBy.field))} ${sortBy.direction === "desc" ? "DESC" : "ASC"}`
          if (limit !== undefined || offset !== undefined) {
            text += " LIMIT ? OFFSET ?"
            params.push(limit ?? -1, offset ?? 0)
          }
          return (await all(text, params)) as any
        },
        count: async ({ model, where }) => {
          const params: Array<unknown> = []
          const rows = await all(`SELECT COUNT(*) AS n FROM ${ident(model)}${whereClause(where, params)}`, params)
          return Number(rows[0]?.n ?? 0)
        },
        update: async ({ model, where, update }) => {
          const entries = Object.entries(update as Row)
          if (entries.length === 0 || where.length === 0) return null
          const params: Array<unknown> = entries.map(([, v]) => v)
          // One row, like the other adapters: the first match by rowid.
          const rows = await all(
            `UPDATE ${ident(model)} SET ${entries.map(([k]) => `${ident(column(k))} = ?`).join(", ")}
             WHERE rowid = (SELECT rowid FROM ${ident(model)}${whereClause(where, params)} LIMIT 1) RETURNING *`,
            params
          )
          return (rows[0] ?? null) as any
        },
        updateMany: async ({ model, where, update }) => {
          const entries = Object.entries(update)
          if (entries.length === 0) return 0
          const params: Array<unknown> = entries.map(([, v]) => v)
          const rows = await all(
            `UPDATE ${ident(model)} SET ${entries.map(([k]) => `${ident(column(k))} = ?`).join(", ")}${whereClause(where, params)} RETURNING 1 AS x`,
            params
          )
          return rows.length
        },
        delete: async ({ model, where }) => {
          if (where.length === 0) return
          const params: Array<unknown> = []
          await all(`DELETE FROM ${ident(model)}${whereClause(where, params)}`, params)
        },
        deleteMany: async ({ model, where }) => {
          const params: Array<unknown> = []
          const rows = await all(`DELETE FROM ${ident(model)}${whereClause(where, params)} RETURNING 1 AS x`, params)
          return rows.length
        },
        consumeOne: async ({ model, where }) => {
          const params: Array<unknown> = []
          const rows = await all(
            `DELETE FROM ${ident(model)} WHERE rowid = (SELECT rowid FROM ${ident(model)}${whereClause(where, params)} LIMIT 1) RETURNING *`,
            params
          )
          return (rows[0] ?? null) as any
        },
        incrementOne: async ({ model, where, increment, set }) => {
          const params: Array<unknown> = []
          const sets = Object.entries(increment).map(([k, delta]) => {
            params.push(delta)
            return `${ident(column(k))} = COALESCE(${ident(column(k))}, 0) + ?`
          })
          for (const [k, v] of Object.entries(set ?? {})) {
            params.push(v)
            sets.push(`${ident(column(k))} = ?`)
          }
          const rows = await all(
            `UPDATE ${ident(model)} SET ${sets.join(", ")}
             WHERE rowid = (SELECT rowid FROM ${ident(model)}${whereClause(where, params)} LIMIT 1) RETURNING *`,
            params
          )
          return (rows[0] ?? null) as any
        }
      }
    }
  })

/** The adapter for `betterAuth({ database })`, running queries with the given SQL client. */
export const sqliteAdapter = (context: Context.Context<SqlClient.SqlClient>) => {
  let options: BetterAuthOptions | undefined
  const factory = makeAdapter((effect) => Effect.runPromise(Effect.provide(effect, context)), () => options!)
  return (opts: BetterAuthOptions) => {
    options = opts
    return factory(opts)
  }
}
