import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { Issue } from "@gradient/domain"
import { Effect, Layer, ManagedRuntime, Option } from "effect"
import { AppServices, HttpLive } from "../src/app.ts"
import { ServerConfig } from "../src/config.ts"
import { Db } from "../src/db/Db.ts"
import { GithubSync } from "../src/github/GithubSync.ts"
import { verifySignature } from "../src/github/webhook.ts"
import { Mutations } from "../src/sync/Mutations.ts"
import { makeFakeGithub } from "./fake-github.ts"

const SECRET = "test-secret"

const setup = () => {
  const fake = makeFakeGithub()
  const port = 20000 + Math.floor(Math.random() * 20000)
  const config = Layer.succeed(ServerConfig, {
    port,
    host: "127.0.0.1",
    dbPath: ":memory:",
    webDist: "/nonexistent",
    seedSampleData: false,
    github: {
      enabled: true,
      token: Option.some("test-token"),
      tokenSource: "env",
      apiUrl: fake.url,
      webUrl: fake.url,
      app: { clientId: "test-client", slug: "gradient-test" },
      webhookSecret: Option.some(SECRET),
      pollIntervalSeconds: 3600
    }
  })
  const layer = Layer.merge(AppServices, HttpLive.pipe(Layer.provide(AppServices))).pipe(Layer.provideMerge(config))
  const runtime = ManagedRuntime.make(layer)
  const run = <A, E>(effect: Effect.Effect<A, E, Db | GithubSync | Mutations>) => runtime.runPromise(effect)
  return { fake, runtime, run, port }
}

let ctx: ReturnType<typeof setup>

beforeEach(() => {
  ctx = setup()
})
afterEach(async () => {
  await ctx.runtime.dispose()
  ctx.fake.stop()
})

const team = () => ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.teams).pipe(Effect.map((t) => t[0]!)))
const issues = () => ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.issues))
const issueByGh = async (n: number) => (await issues()).find((i) => i.github?.number === n)!
const states = (teamId: string) => ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.statesForTeam(teamId)))
const link = async (pushExisting = false) => {
  const t = await team()
  return ctx.run(
    Effect.flatMap(Effect.service(GithubSync), (s) => s.linkRepo({ teamId: t.id, owner: "acme", name: "widgets", pushExisting }))
  )
}
const repoId = () => ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.githubRepos).pipe(Effect.map((r) => r[0]!.id)))
const syncNow = async () => {
  const id = await repoId()
  await ctx.run(Effect.flatMap(Effect.service(GithubSync), (s) => s.syncNow(id)))
}
const mutate = (m: Parameters<Mutations["Service"]["apply"]>[1]) =>
  ctx.run(Effect.flatMap(Effect.service(Mutations), (s) => s.apply({ origin: "client", actorId: null }, m)))
const logSize = () => ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.lastSyncId))

describe("GitHub sync", () => {
  test("linking imports issues, maps closed state and labels, and skips pull requests", async () => {
    ctx.fake.seed({ title: "Open bug", labels: [{ name: "bug", color: "d73a4a" }] })
    ctx.fake.seed({ title: "Shipped", state: "closed", state_reason: "completed" })
    ctx.fake.seed({ title: "Won't do", state: "closed", state_reason: "not_planned" })
    ctx.fake.seed({ title: "A pull request", pull_request: { url: "x" } })

    const result = await link()
    expect(result).toEqual({ imported: 3, pushed: 0 })

    const t = await team()
    const byName = new Map((await states(t.id)).map((s) => [s.id, s]))
    const all = await issues()
    expect(all.map((i) => i.title).sort()).toEqual(["Open bug", "Shipped", "Won't do"])
    const typeOf = (title: string) => byName.get(all.find((i) => i.title === title)!.stateId)!.type
    expect(typeOf("Open bug")).toBe("unstarted")
    expect(typeOf("Shipped")).toBe("completed")
    expect(typeOf("Won't do")).toBe("canceled")
    expect(all.find((i) => i.title === "Open bug")!.labelIds).toHaveLength(1)
    expect(ctx.fake.writes()).toHaveLength(0)
  })

  test("a local edit sends one PATCH with only the changed field, and its echo changes nothing", async () => {
    ctx.fake.seed({ title: "Original", body: "Body" })
    await link()
    const issue = await issueByGh(1)

    await mutate([{ _tag: "IssueUpdate", id: issue.id, patch: { title: "Renamed" } }])
    await syncNow()

    const patches = ctx.fake.writes()
    expect(patches).toHaveLength(1)
    expect(patches[0]!.body).toEqual({ title: "Renamed" })
    expect(ctx.fake.issues[0]!.title).toBe("Renamed")

    // The next poll sees our own change come back. It must not log anything new or push again.
    const before = await logSize()
    await syncNow()
    await syncNow()
    expect(await logSize()).toBe(before)
    expect(ctx.fake.writes()).toHaveLength(1)
  })

  test("an edit on GitHub flows in on poll and is not pushed back", async () => {
    ctx.fake.seed({ title: "From GitHub" })
    await link()
    ctx.fake.edit(1, { title: "Edited on GitHub", state: "closed", state_reason: "completed" })

    await syncNow()
    const issue = await issueByGh(1)
    const t = await team()
    const done = (await states(t.id)).find((s) => s.id === issue.stateId)!
    expect(issue.title).toBe("Edited on GitHub")
    expect(done.type).toBe("completed")
    expect(ctx.fake.writes()).toHaveLength(0)
  })

  test("concurrent edits to different fields both survive", async () => {
    ctx.fake.seed({ title: "Shared", body: "old body" })
    await link()
    const issue = await issueByGh(1)

    ctx.fake.edit(1, { body: "body from GitHub" })
    // Local title change made before we have seen GitHub's body change.
    await ctx.run(
      Effect.flatMap(Effect.service(Mutations), (m) =>
        m.apply({ origin: "client", actorId: null }, [{ _tag: "IssueUpdate", id: issue.id, patch: { title: "Local title" } }]))
    )
    await syncNow()

    const after = await issueByGh(1)
    expect(after.title).toBe("Local title")
    expect(after.description).toBe("body from GitHub")
    expect(ctx.fake.issues[0]!.title).toBe("Local title")
    expect(ctx.fake.issues[0]!.body).toBe("body from GitHub")
  })

  test("a new Gradient issue is created on GitHub, closed when its state is done", async () => {
    await link()
    const t = await team()
    const done = (await states(t.id)).find((s) => s.type === "completed")!
    const id = Bun.randomUUIDv7()
    await mutate([{
      _tag: "IssueCreate",
      id,
      teamId: t.id,
      title: "Made in Gradient",
      description: "hello",
      stateId: done.id,
      priority: 2,
      assigneeId: null,
      labelIds: [],
      sortOrder: "a0"
    }])
    await syncNow()

    expect(ctx.fake.issues).toHaveLength(1)
    expect(ctx.fake.issues[0]).toMatchObject({ title: "Made in Gradient", body: "hello", state: "closed" })
    const created = (await issues()).find((i) => i.id === id) as Issue
    expect(created.github).toMatchObject({ owner: "acme", repo: "widgets", number: 1 })

    // Linking it back produced no second create.
    await syncNow()
    expect(ctx.fake.writes().filter((w) => w.method === "POST")).toHaveLength(1)
  })

  test("webhooks: bad signatures are refused, valid ones apply once", async () => {
    ctx.fake.seed({ title: "Before webhook" })
    await link()
    const issue = ctx.fake.issues[0]!
    ctx.fake.edit(1, { title: "After webhook" })
    const payload = JSON.stringify({
      action: "edited",
      issue: { ...issue, html_url: "https://github.com/acme/widgets/issues/1" },
      repository: { name: "widgets", owner: { login: "acme" } }
    })
    const sign = async (body: string) => {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))
      return "sha256=" + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")
    }
    const post = (signature: string, delivery: string) =>
      fetch(`http://127.0.0.1:${ctx.port}/webhooks/github`, {
        method: "POST",
        body: payload,
        headers: { "x-github-event": "issues", "x-github-delivery": delivery, "x-hub-signature-256": signature }
      })

    expect((await post("sha256=deadbeef", "d1")).status).toBe(401)
    const ok = await post(await sign(payload), "d2")
    expect(ok.status).toBe(202)
    expect(await ok.text()).toBe("updated")
    expect((await issueByGh(1)).title).toBe("After webhook")
    expect(await (await post(await sign(payload), "d2")).text()).toBe("Duplicate delivery")
  })

  test("reopening on GitHub moves a done issue back to Todo, while staying open keeps the local state", async () => {
    ctx.fake.seed({ title: "Flaky", state: "closed", state_reason: "completed" })
    await link()
    const t = await team()
    const all = await states(t.id)
    const typeOf = async () => {
      const { stateId } = await issueByGh(1)
      return all.find((s) => s.id === stateId)!
    }

    ctx.fake.edit(1, { state: "open" })
    await syncNow()
    expect((await typeOf()).name).toBe("Todo")

    // In Review is still "open" on GitHub: no PATCH, and a later GitHub edit keeps it.
    const review = all.find((s) => s.name === "In Review")!
    await mutate([{ _tag: "IssueUpdate", id: (await issueByGh(1)).id, patch: { stateId: review.id } }])
    await syncNow()
    expect(ctx.fake.writes()).toHaveLength(0)
    ctx.fake.edit(1, { title: "Flaky test" })
    await syncNow()
    expect((await typeOf()).name).toBe("In Review")
  })

  test("a late event older than what we already have is ignored", async () => {
    ctx.fake.seed({ title: "Old title" })
    await link()
    const before = { ...ctx.fake.issues[0]!, html_url: "https://github.com/acme/widgets/issues/1" }
    ctx.fake.edit(1, { title: "New title" })
    await syncNow()

    // A delayed webhook for the earlier version arrives now.
    const repo = await ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.githubRepos).pipe(Effect.map((r) => r[0]!)))
    const outcome = await ctx.run(Effect.flatMap(Effect.service(GithubSync), (s) => s.ingest(repo, before)))
    expect(outcome).toBe("unchanged")
    expect((await issueByGh(1)).title).toBe("New title")
  })

  test("a push that fails stays queued and goes out on retry", async () => {
    ctx.fake.seed({ title: "Before" })
    await link()
    const issue = await issueByGh(1)
    ctx.fake.failNextWrites(1)
    await mutate([{ _tag: "IssueUpdate", id: issue.id, patch: { title: "After" } }])
    await syncNow()

    const queued = () =>
      ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.sql`SELECT attempts FROM github_outbox WHERE issue_id = ${issue.id}`))
    expect(ctx.fake.issues[0]!.title).toBe("Before")
    expect(await queued()).toEqual([{ attempts: 1 }])

    // Skip the backoff wait instead of sleeping in the test.
    await ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.sql`UPDATE github_outbox SET next_attempt_at = 0`))
    await syncNow()
    expect(ctx.fake.issues[0]!.title).toBe("After")
    expect(await queued()).toEqual([])
  })

  test("verifySignature matches GitHub's documented example", async () => {
    // https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
    const header = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17"
    expect(await verifySignature("It's a Secret to Everybody", "Hello, World!", header)).toBe(true)
    expect(await verifySignature("wrong", "Hello, World!", header)).toBe(false)
  })
})
