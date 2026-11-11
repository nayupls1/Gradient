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
    Effect.flatMap(Effect.service(GithubSync), (s) => s.linkRepo({ teamId: t.id, projectId: null, owner: "acme", name: "widgets", pushExisting }))
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
    expect(result).toMatchObject({ imported: 3, pushed: 0 })

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
    const { projectId } = await link()
    const t = await team()
    const done = (await states(t.id)).find((s) => s.type === "completed")!
    const id = Bun.randomUUIDv7()
    await mutate([{
      _tag: "IssueCreate",
      id,
      teamId: t.id,
      projectId,
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

describe("projects and repositories", () => {
  const linkTo = async (name: string, options: { projectId?: string | null; projectName?: string } = {}) => {
    const t = await team()
    return ctx.run(
      Effect.flatMap(Effect.service(GithubSync), (s) =>
        s.linkRepo({
          teamId: t.id,
          projectId: options.projectId ?? null,
          ...(options.projectName ? { projectName: options.projectName } : {}),
          owner: "acme",
          name,
          pushExisting: false
        }))
    )
  }
  const projects = () => ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.projects))
  const flush = () => ctx.run(Effect.flatMap(Effect.service(GithubSync), (s) => s.flushOutbox))
  const newIssue = async (title: string, projectId: string | null) => {
    const t = await team()
    const todo = (await states(t.id)).find((s) => s.type === "unstarted")!
    const id = Bun.randomUUIDv7()
    await mutate([{
      _tag: "IssueCreate",
      id,
      teamId: t.id,
      projectId,
      title,
      description: "",
      stateId: todo.id,
      priority: 0,
      assigneeId: null,
      labelIds: [],
      sortOrder: "a0"
    }])
    return id
  }
  const gadgets = { owner: "acme", name: "gadgets" }

  test("each project syncs with its own repository", async () => {
    ctx.fake.addRepo("acme", "gadgets")
    ctx.fake.seed({ title: "Widget bug" })
    ctx.fake.seed({ title: "Gadget idea" }, gadgets)

    const widgets = await linkTo("widgets")
    const gadgetsLink = await linkTo("gadgets", { projectName: "Gadgets" })
    expect((await projects()).map((p) => [p.name, p.key]).sort()).toEqual([["Gadgets", "GAD"], ["widgets", "WID"]])
    const all = await issues()
    expect(all.find((i) => i.title === "Widget bug")!.projectId).toBe(widgets.projectId)
    expect(all.find((i) => i.title === "Gadget idea")!.projectId).toBe(gadgetsLink.projectId)

    await newIssue("Made for gadgets", gadgetsLink.projectId)
    await newIssue("No project, stays local", null)
    await flush()
    expect(ctx.fake.issuesOf(gadgets).map((i) => i.title)).toEqual(["Gadget idea", "Made for gadgets"])
    expect(ctx.fake.issues.map((i) => i.title)).toEqual(["Widget bug"])

    await expect(linkTo("widgets")).rejects.toThrow(/already linked to the project "widgets"/)
  })

  test("linking reuses an unlinked project of the same name; a project takes one repository", async () => {
    ctx.fake.addRepo("acme", "gadgets")
    const t = await team()
    const id = Bun.randomUUIDv7()
    await mutate([{ _tag: "ProjectCreate", id, teamId: t.id, key: "WID", name: "Widgets", color: "#0090ff" }])
    const linked = await linkTo("widgets")
    expect(linked.projectId).toBe(id)
    await expect(linkTo("gadgets", { projectId: id })).rejects.toThrow(/already syncs/)
    await expect(mutate([{ _tag: "ProjectCreate", id: Bun.randomUUIDv7(), teamId: t.id, key: "WI2", name: "widgets", color: "#000" }]))
      .rejects.toThrow(/already exists/)
    // Keys are unique in the team, distinct from the team key, and well-formed.
    const create = (key: string) =>
      mutate([{ _tag: "ProjectCreate", id: Bun.randomUUIDv7(), teamId: t.id, key, name: `P ${key}`, color: "#000" }])
    await expect(create("WID")).rejects.toThrow(/taken by the project "Widgets"/)
    await expect(create("GRD")).rejects.toThrow(/team's own key/)
    await expect(create("w-1")).rejects.toThrow(/not a valid key/)
  })

  test("moving an issue into a linked project creates it on that repository", async () => {
    const { projectId } = await linkTo("widgets")
    const id = await newIssue("Was loose", null)
    await flush()
    expect(ctx.fake.issues).toHaveLength(0)
    await mutate([{ _tag: "IssueUpdate", id, patch: { projectId } }])
    await flush()
    expect(ctx.fake.issues.map((i) => i.title)).toEqual(["Was loose"])
  })

  test("a project with a repository must be unlinked before it is deleted; its issues stay", async () => {
    ctx.fake.seed({ title: "Imported" })
    const { projectId } = await linkTo("widgets")
    await expect(mutate([{ _tag: "ProjectDelete", id: projectId }])).rejects.toThrow(/Unlink acme\/widgets/)
    const repo = await repoId()
    await ctx.run(Effect.flatMap(Effect.service(GithubSync), (s) => s.unlinkRepo(repo)))
    await mutate([{ _tag: "ProjectDelete", id: projectId }])
    expect(await projects()).toHaveLength(0)
    const imported = (await issues()).find((i) => i.title === "Imported")!
    expect(imported.projectId).toBeNull()
    expect(imported.github).toBeNull()
  })
})

describe("relations and pull requests", () => {
  const relations = () => ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.relations))
  const pullRequests = () => ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.pullRequests))
  const flush = () => ctx.run(Effect.flatMap(Effect.service(GithubSync), (s) => s.flushOutbox))
  /** Models logged after `since`, in order. */
  const loggedSince = (since: number) =>
    ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.logSince(since, 100))).then((rows) => rows.map((r) => r.model))
  const blocks = async (blocker: string, blocked: string, id = Bun.randomUUIDv7()) => {
    const t = await team()
    await mutate([{ _tag: "RelationCreate", id, teamId: t.id, type: "blocks", issueId: blocker, relatedIssueId: blocked }])
    return id
  }
  const local = async (title: string, projectId: string | null = null) => {
    const t = await team()
    const todo = (await states(t.id)).find((s) => s.type === "unstarted")!
    const id = Bun.randomUUIDv7()
    await mutate([{
      _tag: "IssueCreate",
      id,
      teamId: t.id,
      projectId,
      title,
      description: "",
      stateId: todo.id,
      priority: 0,
      assigneeId: null,
      labelIds: [],
      sortOrder: "a0"
    }])
    return id
  }
  const signed = async (event: string, payload: object, delivery: string) => {
    const body = JSON.stringify(payload)
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))
    const signature = "sha256=" + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")
    const res = await fetch(`http://127.0.0.1:${ctx.port}/webhooks/github`, {
      method: "POST",
      body,
      headers: { "x-github-event": event, "x-github-delivery": delivery, "x-hub-signature-256": signature }
    })
    return { status: res.status, text: await res.text() }
  }

  test("relations refuse self links, duplicates in either direction and blocking loops; deleting an issue drops its links", async () => {
    const [a, b, c] = [await local("A"), await local("B"), await local("C")]
    await expect(blocks(a, a)).rejects.toThrow(/cannot relate to itself/)
    await blocks(a, b)
    await expect(blocks(b, a)).rejects.toThrow(/GRD-2 and GRD-1 are already related/)
    await blocks(b, c)
    await expect(blocks(c, a)).rejects.toThrow(/GRD-1 already blocks GRD-3/)
    expect(await relations()).toHaveLength(2)

    const before = await logSize()
    await mutate([{ _tag: "IssueDelete", id: b }])
    expect(await relations()).toEqual([])
    // The issue and both relations were logged as deletes, so clients drop them.
    expect((await loggedSince(before)).sort()).toEqual(["issue", "issueRelation", "issueRelation"])
  })

  test("blockers set on GitHub are imported, whatever order the issues arrive in, and removals flow in", async () => {
    ctx.fake.seed({ title: "Ship it" })
    ctx.fake.seed({ title: "Write tests" })
    ctx.fake.block(1, 2) // #1 is blocked by #2, which is imported after it
    await link()

    const ship = await issueByGh(1)
    const tests = await issueByGh(2)
    expect((await relations()).map((r) => [r.type, r.issueId, r.relatedIssueId])).toEqual([["blocks", tests.id, ship.id]])

    // GitHub does not bump updated_at for dependency changes; the next edit (or a webhook) brings it in.
    ctx.fake.unblock(1, 2)
    ctx.fake.edit(1, { body: "now unblocked" })
    await syncNow()
    expect(await relations()).toEqual([])
    expect(ctx.fake.writes()).toHaveLength(0)
  })

  test("a blocker added in Gradient is pushed once, its echo changes nothing, and removing it removes it on GitHub", async () => {
    ctx.fake.seed({ title: "Blocked" })
    ctx.fake.seed({ title: "Blocker" })
    await link()
    const blocked = await issueByGh(1)
    const blocker = await issueByGh(2)

    const id = await blocks(blocker.id, blocked.id)
    await flush()
    expect(ctx.fake.blockersOf(1)).toEqual([2])
    const posts = ctx.fake.writes().filter((w) => w.path.endsWith("/dependencies/blocked_by"))
    expect(posts).toHaveLength(1)
    expect(posts[0]!.body).toEqual({ issue_id: ctx.fake.issues[1]!.id })

    // Our own write comes back with the next update of the issue: nothing new is logged or sent.
    ctx.fake.edit(1, { body: "touched" })
    await syncNow()
    const before = await logSize()
    ctx.fake.edit(1, { body: "touched again" })
    await syncNow()
    expect(await loggedSince(before)).toEqual(["issue", "githubRepo"]) // the body edit and the repo's sync time
    expect(ctx.fake.writes().filter((w) => w.path.includes("/dependencies/"))).toHaveLength(1)
    expect(await relations()).toHaveLength(1)

    await mutate([{ _tag: "RelationDelete", id }])
    await flush()
    expect(ctx.fake.blockersOf(1)).toEqual([])
    expect(ctx.fake.writes().filter((w) => w.method === "DELETE")).toHaveLength(1)
  })

  test("a blocker made in Gradient is created on GitHub first, then linked as the blocker", async () => {
    ctx.fake.seed({ title: "Imported and blocked" })
    const { projectId } = await link()
    const imported = await issueByGh(1)
    const fresh = await local("New blocker", projectId)
    await blocks(fresh, imported.id)
    await flush()

    expect(ctx.fake.issues.map((i) => i.title)).toEqual(["Imported and blocked", "New blocker"])
    expect(ctx.fake.blockersOf(1)).toEqual([2])
  })

  test("an issue whose GitHub blockers were never read adopts them before pushing, instead of removing them", async () => {
    ctx.fake.seed({ title: "Blocked" })
    ctx.fake.seed({ title: "Blocker on GitHub" })
    ctx.fake.seed({ title: "Blocker in Gradient" })
    await link()
    // Like a link made before dependencies synced: GitHub has a blocker Gradient never read.
    ctx.fake.block(1, 2)
    await ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.sql`UPDATE github_issue_link SET blocked_by_shadow = NULL`))
    await blocks((await issueByGh(3)).id, (await issueByGh(1)).id)
    await flush()
    expect(ctx.fake.blockersOf(1).sort()).toEqual([2, 3])
    expect(await relations()).toHaveLength(2)
    expect(ctx.fake.writes().filter((w) => w.method === "DELETE")).toHaveLength(0)
  })

  test("adding a blocker GitHub already has (unseen, since dependencies keep updated_at) recovers on retry", async () => {
    ctx.fake.seed({ title: "Blocked" })
    ctx.fake.seed({ title: "Blocker" })
    await link()
    ctx.fake.block(1, 2)
    await blocks((await issueByGh(2)).id, (await issueByGh(1)).id)
    await flush()
    const queued = () => ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.sql`SELECT issue_id FROM github_outbox`))
    expect(await queued()).toHaveLength(1) // the POST got a 422

    await ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.sql`UPDATE github_outbox SET next_attempt_at = 0`))
    await flush()
    expect(await queued()).toEqual([])
    expect(ctx.fake.blockersOf(1)).toEqual([2])
    expect(ctx.fake.writes().filter((w) => w.path.endsWith("/dependencies/blocked_by"))).toHaveLength(1)
  })

  test("blockers of local-only issues stay in Gradient and do not disturb GitHub's own", async () => {
    ctx.fake.seed({ title: "Synced" })
    ctx.fake.seed({ title: "Other blocker on GitHub" })
    await link()
    // Blocked on GitHub by an issue Gradient does not hold (its link is dropped to simulate that).
    ctx.fake.block(1, 2)
    await ctx.run(Effect.flatMap(Effect.service(Db), (db) =>
      db.sql`DELETE FROM github_issue_link WHERE gh_number = 2`))
    const loose = await local("Local only")
    await blocks(loose, (await issueByGh(1)).id)
    await flush()
    expect(ctx.fake.blockersOf(1)).toEqual([2])
    expect(ctx.fake.writes().filter((w) => w.path.includes("/dependencies/"))).toHaveLength(0)
  })

  test("pull requests are stored with their state and the issues they close or mention", async () => {
    ctx.fake.seed({ title: "Crash on save" })
    ctx.fake.seed({ title: "Fix crash", body: "Fixes #1", pull_request: { url: "x", merged_at: "2026-01-02T00:00:00Z" } })
    ctx.fake.seed({ title: "WID-1: follow-up", draft: true, pull_request: { url: "y" } })
    const { imported } = await link()
    expect(imported).toBe(1)

    const prs = (await pullRequests()).sort((a, b) => a.number - b.number)
    expect(prs.map((p) => [p.number, p.state, p.author])).toEqual([[2, "merged", "someone"], [3, "draft", "someone"]])
    expect(prs[0]!.closes).toEqual([{ owner: "acme", repo: "widgets", number: 1 }])
    expect(prs[1]!.mentions).toEqual(["WID-1"])
    expect(prs[0]!.url).toBe("https://github.com/acme/widgets/pull/2")

    // An unchanged pull request logs nothing on the next poll.
    const before = await logSize()
    ctx.fake.edit(1, { body: "bump" })
    await syncNow()
    expect(await loggedSince(before)).toEqual(["issue", "githubRepo"])
  })

  test("webhooks: pull_request events update a pull request, issue_dependencies events re-read blockers", async () => {
    ctx.fake.seed({ title: "Target" })
    ctx.fake.seed({ title: "Blocker" })
    await link()

    const pr = await signed("pull_request", {
      action: "opened",
      pull_request: {
        number: 3,
        html_url: "https://github.com/acme/widgets/pull/3",
        title: "Resolve target",
        body: "closes #1",
        state: "open",
        draft: false,
        merged_at: null,
        user: { login: "dev" },
        updated_at: "2026-02-01T00:00:00Z"
      },
      repository: { name: "widgets", owner: { login: "acme" } }
    }, "pr-1")
    expect(pr).toEqual({ status: 202, text: "pull_request" })
    expect((await pullRequests()).map((p) => [p.number, p.state, p.author])).toEqual([[3, "open", "dev"]])

    ctx.fake.block(1, 2)
    const dep = await signed("issue_dependencies", {
      action: "blocked_by_added",
      blocked_issue: { html_url: "https://github.com/acme/widgets/issues/1" },
      blocking_issue: { html_url: "https://github.com/acme/widgets/issues/2" },
      repository: { name: "widgets", owner: { login: "acme" } }
    }, "dep-1")
    expect(dep).toEqual({ status: 202, text: "dependencies" })
    expect((await relations()).map((r) => [r.issueId, r.relatedIssueId])).toEqual([[(await issueByGh(2)).id, (await issueByGh(1)).id]])
  })

  test("unlinking a repository removes its pull requests", async () => {
    ctx.fake.seed({ title: "A PR", pull_request: { url: "x" } })
    await link()
    expect(await pullRequests()).toHaveLength(1)
    const id = await repoId()
    await ctx.run(Effect.flatMap(Effect.service(GithubSync), (s) => s.unlinkRepo(id)))
    expect(await pullRequests()).toEqual([])
  })
})

describe("project icons", () => {
  const project = async () => {
    const repos = await ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.githubRepos))
    return (await ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.getProject(repos[0]!.projectId))))!
  }
  const setIcon = async (choice: Parameters<GithubSync["Service"]["setProjectIcon"]>[1]) =>
    ctx.run(Effect.flatMap(Effect.service(GithubSync), (s) =>
      s.setProjectIcon((repoProjectId ?? ""), choice, { origin: "client", actorId: null })))
  let repoProjectId: string | undefined

  test("linking picks the repository's favicon", async () => {
    ctx.fake.putFile("README.md", "# widgets")
    ctx.fake.putFile("docs/logo.png", "png")
    const sha = ctx.fake.putFile("web/public/favicon.svg", "<svg/>")
    await link()
    expect(await project()).toMatchObject({ iconMode: "auto", icon: { path: "web/public/favicon.svg", sha } })
  })

  test("a repository without images keeps the cube, and linking still works", async () => {
    ctx.fake.seed({ title: "Bug" })
    expect(await link()).toMatchObject({ imported: 1 })
    expect(await project()).toMatchObject({ iconMode: "auto", icon: null })
  })

  test("auto follows the favicon when it changes; a picked file sticks", async () => {
    ctx.fake.putFile("favicon.ico", "v1")
    await link()
    repoProjectId = (await project()).id

    const v2 = ctx.fake.putFile("favicon.ico", "v2")
    await syncNow()
    expect((await project()).icon).toEqual({ path: "favicon.ico", sha: v2 })

    const logo = ctx.fake.putFile("assets/logo.svg", "<svg/>")
    await setIcon({ mode: "repo", path: "assets/logo.svg" })
    expect(await project()).toMatchObject({ iconMode: "repo", icon: { path: "assets/logo.svg", sha: logo } })

    // A new favicon does not replace the picked logo; a new version of the logo does.
    ctx.fake.putFile("public/favicon.svg", "<svg/>")
    const logo2 = ctx.fake.putFile("assets/logo.svg", "<svg>2</svg>")
    await syncNow()
    expect((await project()).icon).toEqual({ path: "assets/logo.svg", sha: logo2 })

    // Deleted on GitHub: the last version stays.
    ctx.fake.deleteFile("assets/logo.svg")
    await syncNow()
    expect((await project()).icon).toEqual({ path: "assets/logo.svg", sha: logo2 })

    await setIcon({ mode: "none" })
    expect(await project()).toMatchObject({ iconMode: "none", icon: null })
    await syncNow()
    expect((await project()).icon).toBe(null)

    await setIcon({ mode: "auto" })
    expect((await project()).icon?.path).toBe("public/favicon.svg")
  })

  test("picking a path that is not an image lists the images", async () => {
    ctx.fake.putFile("public/favicon.svg", "<svg/>")
    ctx.fake.putFile("src/index.ts", "")
    await link()
    repoProjectId = (await project()).id
    const error = await setIcon({ mode: "repo", path: "src/index.ts" }).catch((e) => e)
    expect(error.message).toContain(`No image "src/index.ts"`)
    expect(error.message).toContain(`"public/favicon.svg"`)
  })

  test("serves the icon through the server, cached by sha, with a sandbox for SVGs", async () => {
    const sha = ctx.fake.putFile("favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg"/>`)
    await link()
    const id = await repoId()
    const url = `http://127.0.0.1:${ctx.port}/repo-files/${id}/${sha}/favicon.svg`
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/svg+xml")
    expect(res.headers.get("content-security-policy")).toContain("sandbox")
    expect(await res.text()).toBe(`<svg xmlns="http://www.w3.org/2000/svg"/>`)

    const blobReads = () => ctx.fake.requests.filter((r) => r.path.includes("/git/blobs/")).length
    const before = blobReads()
    expect((await fetch(url)).status).toBe(200)
    expect(blobReads()).toBe(before)

    expect((await fetch(`http://127.0.0.1:${ctx.port}/repo-files/${id}/${sha}/notes.html`)).status).toBe(404)
    // Other files of the repository are not served, whatever name the URL gives them.
    const secret = ctx.fake.putFile(".env", "TOKEN=x")
    expect((await fetch(`http://127.0.0.1:${ctx.port}/repo-files/${id}/${secret}/env.png`)).status).toBe(404)
  })

  test("unlinking goes back to the cube, and a picked file back to auto", async () => {
    ctx.fake.putFile("logo.png", "png")
    await link()
    repoProjectId = (await project()).id
    await setIcon({ mode: "repo", path: "logo.png" })
    const id = await repoId()
    await ctx.run(Effect.flatMap(Effect.service(GithubSync), (s) => s.unlinkRepo(id)))
    const after = await ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.getProject(repoProjectId!)))
    expect(after).toMatchObject({ iconMode: "auto", icon: null })
  })

  test("an icon cannot be set on a project without a repository", async () => {
    const t = await team()
    const error = await mutate([{ _tag: "ProjectCreate", id: "p-local", teamId: t.id, key: "LOC", name: "Local", color: "#0090ff" }])
      .then(() => mutate([{ _tag: "ProjectUpdate", id: "p-local", patch: { iconMode: "repo", icon: { path: "a.png", sha: "a".repeat(40) } } }]))
      .catch((e) => e)
    expect(error.message).toContain("Link a GitHub repository first")
  })
})

describe("comments", () => {
  const comments = () => ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.comments))
  const loggedSince = (since: number) =>
    ctx.run(Effect.flatMap(Effect.service(Db), (db) => db.logSince(since, 100))).then((rows) => rows.map((r) => `${r.op}:${r.model}`))
  const signed = async (event: string, payload: object, delivery: string) => {
    const body = JSON.stringify(payload)
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))
    const signature = "sha256=" + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")
    const res = await fetch(`http://127.0.0.1:${ctx.port}/webhooks/github`, {
      method: "POST",
      body,
      headers: { "x-github-event": event, "x-github-delivery": delivery, "x-hub-signature-256": signature }
    })
    return { status: res.status, text: await res.text() }
  }
  const ghComment = (id: number, issue: number, body: string, updated = "2026-03-01T00:00:00Z") => ({
    id,
    html_url: `https://github.com/acme/widgets/issues/${issue}#issuecomment-${id}`,
    issue_url: `https://api.github.com/repos/acme/widgets/issues/${issue}`,
    body,
    user: { login: "dev", avatar_url: "https://avatars/dev" },
    created_at: "2026-03-01T00:00:00Z",
    updated_at: updated
  })

  test("linking imports comments on issues, not on pull requests", async () => {
    ctx.fake.seed({ title: "Crash on save" })
    ctx.fake.seed({ title: "Fix crash", pull_request: { url: "x" } })
    ctx.fake.comment(1, "Seen it too, see #2", { login: "dev" })
    ctx.fake.comment(2, "LGTM")
    ctx.fake.comment(1, "Still happens")
    await link()

    const issue = await issueByGh(1)
    const list = await comments()
    expect(list.map((c) => [c.body, c.author, c.issueId])).toEqual([
      ["Seen it too, see #2", "dev", issue.id],
      ["Still happens", "someone", issue.id]
    ])
    expect(list[0]!.url).toMatch(/\/issues\/1#issuecomment-\d+$/)
    expect(list[0]!.authorAvatarUrl).toBe("https://avatars/dev")
    expect(list[0]!.createdAt).toBeLessThan(list[1]!.createdAt)
  })

  test("polling picks up new and edited comments, and an unchanged poll logs no comment", async () => {
    ctx.fake.seed({ title: "Crash on save" })
    const first = ctx.fake.comment(1, "First")
    await link()

    let before = await logSize()
    ctx.fake.editComment(first.id, "First, edited")
    ctx.fake.comment(1, "Second")
    await syncNow()
    expect((await comments()).map((c) => c.body)).toEqual(["First, edited", "Second"])
    expect((await loggedSince(before)).filter((m) => m.endsWith(":issueComment"))).toEqual(["upsert:issueComment", "upsert:issueComment"])

    before = await logSize()
    await syncNow()
    expect((await loggedSince(before)).filter((m) => m.endsWith(":issueComment"))).toEqual([])
    // Comments are read-only: nothing went to GitHub.
    expect(ctx.fake.writes()).toHaveLength(0)
  })

  test("webhooks: issue_comment created, edited and deleted; stale edits are ignored", async () => {
    ctx.fake.seed({ title: "Target" })
    await link()
    const repository = { name: "widgets", owner: { login: "acme" } }

    const created = await signed("issue_comment", { action: "created", comment: ghComment(77, 1, "Hello"), repository }, "c-1")
    expect(created).toEqual({ status: 202, text: "comment" })
    expect((await comments()).map((c) => [c.body, c.issueId])).toEqual([["Hello", (await issueByGh(1)).id]])

    const edited = await signed("issue_comment", {
      action: "edited",
      comment: ghComment(77, 1, "Hello again", "2026-03-02T00:00:00Z"),
      repository
    }, "c-2")
    expect(edited).toEqual({ status: 202, text: "comment" })
    const stale = await signed("issue_comment", { action: "edited", comment: ghComment(77, 1, "Old"), repository }, "c-3")
    expect(stale).toEqual({ status: 202, text: "unchanged" })
    expect((await comments()).map((c) => c.body)).toEqual(["Hello again"])

    const onUnknown = await signed("issue_comment", { action: "created", comment: ghComment(78, 99, "Elsewhere"), repository }, "c-4")
    expect(onUnknown).toEqual({ status: 202, text: "skipped" })

    const before = await logSize()
    const deleted = await signed("issue_comment", { action: "deleted", comment: ghComment(77, 1, "Hello again"), repository }, "c-5")
    expect(deleted).toEqual({ status: 202, text: "comment deleted" })
    expect(await comments()).toEqual([])
    expect(await loggedSince(before)).toEqual(["delete:issueComment"])
  })

  test("deleting an issue or unlinking the repository removes its comments, and tells clients", async () => {
    ctx.fake.seed({ title: "One" })
    ctx.fake.seed({ title: "Two" })
    ctx.fake.comment(1, "On one")
    ctx.fake.comment(2, "On two")
    await link()
    expect(await comments()).toHaveLength(2)

    let before = await logSize()
    await mutate([{ _tag: "IssueDelete", id: (await issueByGh(1)).id }])
    expect((await comments()).map((c) => c.body)).toEqual(["On two"])
    expect((await loggedSince(before)).slice(0, 2)).toEqual(["delete:issueComment", "delete:issue"])

    before = await logSize()
    const id = await repoId()
    await ctx.run(Effect.flatMap(Effect.service(GithubSync), (s) => s.unlinkRepo(id)))
    expect(await comments()).toEqual([])
    expect(await loggedSince(before)).toContain("delete:issueComment")
  })
})
