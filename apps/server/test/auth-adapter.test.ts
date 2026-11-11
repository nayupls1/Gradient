import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { SqlClient } from "effect/sql"
import { sqliteAdapter } from "../src/auth/adapter.ts"
import { migrations } from "../src/db/migrations.ts"

const runtime = ManagedRuntime.make(
  SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) }).pipe(
    Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" }))
  )
)
let adapter: ReturnType<ReturnType<typeof sqliteAdapter>>

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute))

beforeAll(async () => {
  const context = await runtime.runPromise(Effect.context<SqlClient.SqlClient>())
  adapter = sqliteAdapter(context)({ verification: { modelName: "auth_verification" } })
  for (const [i, identifier] of ["Alpha", "beta", "gamma", "alphabet"].entries()) {
    await adapter.create({
      model: "verification",
      data: { identifier, value: `v${i}`, expiresAt: at(i), createdAt: at(i), updatedAt: at(i) }
    })
  }
})
afterAll(() => runtime.dispose())

const ids = (rows: ReadonlyArray<any>) => rows.map((r) => r.identifier).sort()

test("dates come back as dates and compare in time order", async () => {
  const row = await adapter.findOne<any>({ model: "verification", where: [{ field: "identifier", value: "beta" }] })
  expect(row.expiresAt).toBeInstanceOf(Date)
  expect(row.expiresAt.getTime()).toBe(at(1).getTime())
  const later = await adapter.findMany<any>({
    model: "verification",
    where: [{ field: "expiresAt", operator: "gte", value: at(2) }]
  })
  expect(ids(later)).toEqual(["alphabet", "gamma"])
})

test("text operators are case-sensitive unless asked otherwise", async () => {
  const find = (where: Array<any>) => adapter.findMany<any>({ model: "verification", where }).then(ids)
  expect(await find([{ field: "identifier", operator: "starts_with", value: "alpha" }])).toEqual(["alphabet"])
  expect(await find([{ field: "identifier", operator: "starts_with", value: "alpha", mode: "insensitive" }]))
    .toEqual(["Alpha", "alphabet"])
  expect(await find([{ field: "identifier", operator: "contains", value: "mm" }])).toEqual(["gamma"])
  expect(await find([{ field: "identifier", operator: "ends_with", value: "bet" }])).toEqual(["alphabet"])
  expect(await find([{ field: "identifier", operator: "in", value: ["beta", "gamma"] }])).toEqual(["beta", "gamma"])
  expect(await find([{ field: "identifier", operator: "not_in", value: ["beta", "gamma"] }])).toEqual(["Alpha", "alphabet"])
  expect(await find([{ field: "identifier", operator: "in", value: [] }])).toEqual([])
  expect(await find([{ field: "identifier", operator: "ne", value: "beta" }])).toEqual(["Alpha", "alphabet", "gamma"])
})

test("AND conditions all hold and one OR condition does", async () => {
  const rows = await adapter.findMany<any>({
    model: "verification",
    where: [
      { field: "expiresAt", operator: "gt", value: at(0) },
      { field: "identifier", value: "beta", connector: "OR" },
      { field: "identifier", value: "Alpha", connector: "OR" }
    ]
  })
  expect(ids(rows)).toEqual(["beta"])
})

test("sorting, paging and counting", async () => {
  const page = await adapter.findMany<any>({
    model: "verification",
    sortBy: { field: "createdAt", direction: "desc" },
    limit: 2,
    offset: 1
  })
  expect(page.map((r) => r.identifier)).toEqual(["gamma", "beta"])
  expect(await adapter.count({ model: "verification" })).toBe(4)
})

test("updates and deletes report what they touched; a failed transaction leaves nothing", async () => {
  const updated = await adapter.update<any>({
    model: "verification",
    where: [{ field: "identifier", value: "beta" }],
    update: { value: "changed" }
  })
  expect(updated.value).toBe("changed")
  expect(await adapter.updateMany({
    model: "verification",
    where: [{ field: "identifier", operator: "starts_with", value: "zzz" }],
    update: { value: "x" }
  })).toBe(0)

  await expect(adapter.transaction(async (tx) => {
    await tx.create({
      model: "verification",
      data: { identifier: "doomed", value: "v", expiresAt: at(9), createdAt: at(9), updatedAt: at(9) }
    })
    throw new Error("roll back")
  })).rejects.toThrow()
  expect(await adapter.count({ model: "verification", where: [{ field: "identifier", value: "doomed" }] })).toBe(0)

  expect(await adapter.deleteMany({
    model: "verification",
    where: [{ field: "identifier", operator: "starts_with", value: "alpha", mode: "insensitive" }]
  })).toBe(2)
  expect(await adapter.count({ model: "verification" })).toBe(2)
})
