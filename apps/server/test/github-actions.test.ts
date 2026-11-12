import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime, Option } from "effect"
import { AppServices } from "../src/app.ts"
import { ServerConfig } from "../src/config.ts"
import { Db } from "../src/db/Db.ts"
import { GithubActions } from "../src/github/GithubActions.ts"
import { GithubAuth } from "../src/github/GithubAuth.ts"
import { GithubSync } from "../src/github/GithubSync.ts"
import { makeFakeGithub } from "./fake-github.ts"

/*
 * Comments, reviews and merges made in Gradient go out as the person's own
 * GitHub account: one they connected, or the workspace connection when it is
 * theirs. GITHUB_TOKEN here belongs to "octo", and the workspace's original
 * user is linked to it.
 */

const setup = () => {
  const fake = makeFakeGithub()
  const config = Layer.succeed(ServerConfig, {
    port: 0,
    host: "127.0.0.1",
    dbPath: ":memory:",
    webDist: "/nonexistent",
    seedSampleData: false,
    auth: { secret: Option.some("test-secret-0123456789abcdef0123456789"), url: Option.none(), allowSignUp: false },
    github: {
      enabled: true,
      token: Option.some("test-token"),
      tokenSource: "env",
      apiUrl: fake.url,
      webUrl: fake.url,
      app: { clientId: "test-client", slug: "gradient-test" },
      webhookSecret: Option.none(),
      pollIntervalSeconds: 3600
    }
  })
  const runtime = ManagedRuntime.make(AppServices.pipe(Layer.provideMerge(config)))
  const run = <A, E>(effect: Effect.Effect<A, E, Db | GithubSync | GithubAuth | GithubActions>) => runtime.runPromise(effect)
  const fail = <A, E>(effect: Effect.Effect<A, E, Db | GithubSync | GithubAuth | GithubActions>) =>
    runtime.runPromise(Effect.flip(effect))
  return { fake, runtime, run, fail }
}

let ctx: ReturnType<typeof setup>
beforeEach(() => {
  ctx = setup()
})
afterEach(async () => {
  await ctx.runtime.dispose()
  ctx.fake.stop()
})

const actions = Effect.service(GithubActions)
const db = Effect.service(Db)

/** The workspace's original user (linked to octo) and a second person in the same team, with no GitHub yet. */
const people = () =>
  ctx.run(Effect.gen(function*() {
    const d = yield* db
    const owner = (yield* d.getMeta("viewer_id"))!
    const team = (yield* d.teams)[0]!
    const sam = crypto.randomUUID()
    yield* d.putUser({ id: sam, name: "Sam", githubLogin: null, avatarUrl: null, role: "member" })
    yield* d.sql`INSERT INTO team_member (id, team_id, user_id, created_at) VALUES (${crypto.randomUUID()}, ${team.id}, ${sam}, 1)`
    return { owner, sam, teamId: team.id }
  }))

const link = (teamId: string) =>
  ctx.run(Effect.flatMap(Effect.service(GithubSync), (s) => s.linkRepo({ teamId, projectId: null, owner: "acme", name: "widgets", pushExisting: false })))

/** Sam connects their own GitHub account through the device flow. */
const connect = async (userId: string, login: string) => {
  await ctx.run(Effect.flatMap(Effect.service(GithubAuth), (a) => a.personal.start(userId)))
  ctx.fake.approveDevice(login)
  return ctx.run(Effect.flatMap(Effect.service(GithubAuth), (a) => a.personal.wait(userId)))
}

const ref = (number: number) => ({ owner: "acme", repo: "widgets", number })

describe("acting as yourself on GitHub", () => {
  test("the workspace connection stands in only for its owner; others connect their own account", async () => {
    const { owner, sam } = await people()
    expect((await ctx.run(Effect.flatMap(actions, (a) => a.account(owner)))).actingAs).toMatchObject({ login: "octo", via: "workspace" })
    expect((await ctx.run(Effect.flatMap(actions, (a) => a.account(sam)))).actingAs).toBeNull()

    const viewer = await connect(sam, "sam-gh")
    expect(viewer.login).toBe("sam-gh")
    const account = await ctx.run(Effect.flatMap(actions, (a) => a.account(sam)))
    expect(account.actingAs).toMatchObject({ login: "sam-gh", via: "personal" })
    expect(account.personal).toMatchObject({ login: "sam-gh" })
    // Connecting links the person to that login, so assignees map to them.
    expect((await ctx.run(Effect.flatMap(db, (d) => d.getUser(sam))))?.githubLogin).toBe("sam-gh")

    await ctx.run(Effect.flatMap(Effect.service(GithubAuth), (a) => a.personal.signOut(sam)))
    expect((await ctx.run(Effect.flatMap(actions, (a) => a.account(sam)))).actingAs).toBeNull()
  })

  test("one GitHub account per person: a login someone else uses is refused", async () => {
    const { sam } = await people()
    const other = await ctx.run(Effect.gen(function*() {
      const d = yield* db
      const id = crypto.randomUUID()
      yield* d.putUser({ id, name: "Kim", githubLogin: "sam-gh", avatarUrl: null, role: "member" })
      return id
    }))
    expect(other).toBeTruthy()
    const error = await connect(sam, "sam-gh").then(() => null, (e) => e as Error)
    expect(error?.message).toContain("already connected to Kim")
  })

  test("without a GitHub account, writes say how to connect one", async () => {
    const { sam } = await people()
    ctx.fake.seed({ title: "A pull request", pull_request: { url: "x", merged_at: null } })
    const error = await ctx.fail(Effect.flatMap(actions, (a) => a.commentOnPullRequest(sam, ref(1), "Hi")))
    expect(error.message).toContain("Connect your GitHub account")
  })
})

describe("comments", () => {
  test("commenting on an issue posts as you and shows at once, without waiting for a poll", async () => {
    const { owner, sam, teamId } = await people()
    ctx.fake.seed({ title: "Crash on save" })
    await link(teamId)
    const issue = (await ctx.run(Effect.flatMap(db, (d) => d.issues))).find((i) => i.title === "Crash on save")!

    await ctx.run(Effect.flatMap(actions, (a) => a.commentOnIssue(owner, issue.id, "On it")))
    await connect(sam, "sam-gh")
    await ctx.run(Effect.flatMap(actions, (a) => a.commentOnIssue(sam, issue.id, "Same here")))

    const comments = await ctx.run(Effect.flatMap(db, (d) => d.comments))
    expect(comments.map((c) => [c.author, c.body])).toEqual([["octo", "On it"], ["sam-gh", "Same here"]])
    expect(ctx.fake.writes().filter((w) => w.path.endsWith("/comments")).map((w) => w.body.body)).toEqual(["On it", "Same here"])
  })

  test("an issue that is not on GitHub, or a person outside its team, cannot comment", async () => {
    const { owner } = await people()
    const local = await ctx.run(Effect.gen(function*() {
      const d = yield* db
      return (yield* d.issues)[0]
    }))
    if (local) {
      const error = await ctx.fail(Effect.flatMap(actions, (a) => a.commentOnIssue(owner, local.id, "Hi")))
      expect(error.message).toContain("not on GitHub")
    }
    const stranger = crypto.randomUUID()
    await ctx.run(Effect.flatMap(db, (d) => d.putUser({ id: stranger, name: "Lee", githubLogin: "octo", avatarUrl: null, role: "member" })))
    ctx.fake.seed({ title: "Crash on save" })
    const { teamId } = await ctx.run(Effect.map(Effect.flatMap(db, (d) => d.teams), (t) => ({ teamId: t[0]!.id })))
    await link(teamId)
    const issue = (await ctx.run(Effect.flatMap(db, (d) => d.issues))).find((i) => i.title === "Crash on save")!
    const error = await ctx.fail(Effect.flatMap(actions, (a) => a.commentOnIssue(stranger, issue.id, "Hi")))
    expect(error.message).toContain("Only people in the issue's team")
  })

  test("commenting on a pull request returns the new comment", async () => {
    const { owner } = await people()
    ctx.fake.seed({ title: "A pull request", pull_request: { url: "x", merged_at: null } })
    const comment = await ctx.run(Effect.flatMap(actions, (a) => a.commentOnPullRequest(owner, ref(1), "Looks good")))
    expect(comment).toMatchObject({ kind: "comment", author: "octo", body: "Looks good" })
    const pr = await ctx.run(Effect.flatMap(actions, (a) => a.readPullRequest(owner, ref(1))))
    expect(pr.activity.map((a) => a.body)).toEqual(["Looks good"])
  })
})

describe("reviews", () => {
  test("a review with inline comments goes out as you; GitHub's refusal comes back as it said it", async () => {
    const { owner, sam } = await people()
    ctx.fake.seed({ title: "Mine", user: { login: "octo", avatar_url: "" }, pull_request: { url: "x", merged_at: null } })

    const own = await ctx.fail(Effect.flatMap(actions, (a) => a.review(owner, ref(1), { event: "approve", body: "", comments: [] })))
    expect(own.message).toContain("Can not approve your own pull request")
    const empty = await ctx.fail(Effect.flatMap(actions, (a) => a.review(owner, ref(1), { event: "request_changes", body: " ", comments: [] })))
    expect(empty.message).toContain("Write what should change")

    await connect(sam, "sam-gh")
    await ctx.run(Effect.flatMap(actions, (a) =>
      a.review(sam, ref(1), {
        event: "approve",
        body: "Ship it",
        comments: [{ path: "src/a.ts", line: 3, side: "RIGHT", startLine: 1, body: "Nice" }]
      })
    ))
    const sent = ctx.fake.writes().find((w) => w.path.endsWith("/reviews") && w.body.event === "APPROVE" && w.body.body === "Ship it")
    expect(sent?.body).toMatchObject({
      commit_id: "sha1",
      comments: [{ path: "src/a.ts", line: 3, side: "RIGHT", start_line: 1, start_side: "RIGHT", body: "Nice" }]
    })
    const pr = await ctx.run(Effect.flatMap(actions, (a) => a.readPullRequest(sam, ref(1))))
    expect(pr.reviewComments.map((c) => [c.path, c.line, c.author, c.body])).toEqual([["src/a.ts", 3, "sam-gh", "Nice"]])
    expect(pr.activity.map((a) => [a.author, a.reviewState])).toEqual([["sam-gh", "approved"]])
  })
})

describe("merging", () => {
  test("merges at the head you saw: a moved head, a conflict or a closed pull request is refused", async () => {
    const { owner } = await people()
    ctx.fake.seed({ title: "Ready", pull_request: { url: "x", merged_at: null } })
    ctx.fake.seed({ title: "Conflicted", pull_request: { url: "x", merged_at: null }, pr: { mergeable: false } })

    const moved = await ctx.fail(Effect.flatMap(actions, (a) => a.merge(owner, ref(1), { method: "squash", sha: "old" })))
    expect(moved.message).toContain("Head branch was modified")
    const conflicted = await ctx.fail(Effect.flatMap(actions, (a) => a.merge(owner, ref(2), {})))
    expect(conflicted.message).toContain("not mergeable")

    const before = await ctx.run(Effect.flatMap(actions, (a) => a.readPullRequest(owner, ref(1))))
    expect(before).toMatchObject({ mergeableState: "clean", headSha: "sha1", mergeMethods: ["merge", "squash", "rebase"] })
    const merged = await ctx.run(Effect.flatMap(actions, (a) => a.merge(owner, ref(1), { method: "squash", sha: before.headSha })))
    expect(merged).toEqual({ sha: "merged1", method: "squash" })
    expect((await ctx.run(Effect.flatMap(actions, (a) => a.readPullRequest(owner, ref(1))))).state).toBe("merged")
    const again = await ctx.fail(Effect.flatMap(actions, (a) => a.merge(owner, ref(1), {})))
    expect(again.message).toContain("already merged")
  })
})
