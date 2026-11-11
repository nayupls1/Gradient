import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, ManagedRuntime, Option } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AppServices } from "../src/app.ts"
import { ServerConfig } from "../src/config.ts"
import { Db } from "../src/db/Db.ts"
import { GithubAuth } from "../src/github/GithubAuth.ts"
import { GithubSync } from "../src/github/GithubSync.ts"
import { makeFakeGithub } from "./fake-github.ts"

type Fake = ReturnType<typeof makeFakeGithub>
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const start = (options: {
  fake: Fake
  dbPath?: string
  envToken?: string
  clientId?: string | null
}) => {
  const config = Layer.succeed(ServerConfig, {
    port: 0,
    host: "127.0.0.1",
    dbPath: options.dbPath ?? ":memory:",
    webDist: "/nonexistent",
    seedSampleData: false,
    auth: { secret: Option.some("test-secret-0123456789abcdef0123456789"), url: Option.none(), allowSignUp: false },
    github: {
      enabled: true,
      token: options.envToken ? Option.some(options.envToken) : Option.none(),
      tokenSource: options.envToken ? "env" : null,
      apiUrl: options.fake.url,
      webUrl: options.fake.url,
      app: { clientId: options.clientId === undefined ? "test-client" : options.clientId, slug: "gradient-test" },
      webhookSecret: Option.none(),
      pollIntervalSeconds: 3600
    }
  })
  const runtime = ManagedRuntime.make(AppServices.pipe(Layer.provideMerge(config)))
  cleanups.push(() => runtime.dispose())
  const run = <A, E>(effect: Effect.Effect<A, E, Db | GithubSync | GithubAuth>) => runtime.runPromise(effect)
  const auth = <A, E>(f: (a: GithubAuth["Service"]) => Effect.Effect<A, E>) => run(Effect.flatMap(Effect.service(GithubAuth), f))
  const github = <A, E>(f: (s: GithubSync["Service"]) => Effect.Effect<A, E>) => run(Effect.flatMap(Effect.service(GithubSync), f))
  const status = () => github((s) => s.status)
  /** Start a sign-in, approve it on "github.com", and wait for it. */
  const signIn = async () => {
    const code = await auth((a) => a.startSignIn)
    options.fake.approveDevice()
    await auth((a) => a.awaitSignIn)
    return code
  }
  return { run, auth, github, status, signIn }
}

const fakeGithub = (options?: Parameters<typeof makeFakeGithub>[2]) => {
  const fake = makeFakeGithub(undefined, 0, options)
  cleanups.push(() => fake.stop())
  return fake
}

const viewerUser = (app: ReturnType<typeof start>) =>
  app.run(
    Effect.gen(function*() {
      const db = yield* Db
      return yield* db.getUser((yield* db.getMeta("viewer_id"))!)
    })
  )

describe("Sign in with GitHub", () => {
  test("device flow signs in, links the local user, and sync uses the new token", async () => {
    const fake = fakeGithub()
    const app = start({ fake })

    const before = await app.status()
    expect(before.tokenSource).toBeNull()
    expect(before.signIn.available).toBe(true)
    expect(before.signIn.installUrl).toBe(`${fake.url}/apps/gradient-test/installations/new`)

    const code = await app.auth((a) => a.startSignIn)
    expect(code.userCode).toBe("WDJB-MJHT")
    expect(code.verificationUri).toBe(`${fake.url}/login/device`)
    expect((await app.status()).signIn.pending?.userCode).toBe("WDJB-MJHT")

    fake.approveDevice()
    // Read the status right as the wait ends, like the GithubSignInWait RPC does.
    const [viewer, atWake] = await app.run(
      Effect.gen(function*() {
        const viewer = yield* (yield* GithubAuth).awaitSignIn
        return [viewer, yield* (yield* GithubSync).status] as const
      })
    )
    expect(viewer.login).toBe("octo")
    expect(atWake.signIn.pending).toBeNull()
    expect(atWake.tokenSource).toBe("app")

    const after = await app.status()
    expect(after.tokenSource).toBe("app")
    expect(after.login).toBe("octo")
    expect(after.signIn.pending).toBeNull()
    expect((await viewerUser(app))?.githubLogin).toBe("octo")

    // Linking a repo now talks to GitHub with the app token.
    fake.seed({ title: "From GitHub" })
    const teamId = await app.run(Effect.flatMap(Effect.service(Db), (db) => db.teams).pipe(Effect.map((t) => t[0]!.id)))
    const result = await app.github((s) => s.linkRepo({ teamId, projectId: null, owner: "acme", name: "widgets", pushExisting: false }))
    expect(result.imported).toBe(1)
    const [token] = fake.appTokens()
    expect(token).toStartWith("ghu_")
    expect(await app.auth((a) => Effect.sync(() => a.tokenUnsafe()))).toBe(token!)
  })

  test("the sign-in survives a restart", async () => {
    const fake = fakeGithub()
    const dir = mkdtempSync(join(tmpdir(), "gradient-auth-"))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const dbPath = join(dir, "gradient.db")

    const first = start({ fake, dbPath })
    await first.signIn()
    await cleanups.pop()!() // dispose the first server

    const second = start({ fake, dbPath })
    const status = await second.status()
    expect(status.tokenSource).toBe("app")
    expect(status.login).toBe("octo")
  })

  test("a declined sign-in fails with a clear message", async () => {
    const fake = fakeGithub()
    const app = start({ fake })
    await app.auth((a) => a.startSignIn)
    fake.denyDevice()
    const exit = await app.run(Effect.exit(Effect.flatMap(Effect.service(GithubAuth), (a) => a.awaitSignIn)))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(JSON.stringify(exit)).toContain("declined")
    expect((await app.status()).tokenSource).toBeNull()
  })

  test("starting again or cancelling ends the waiting sign-in", async () => {
    const fake = fakeGithub()
    const app = start({ fake })
    await app.auth((a) => a.startSignIn)
    const waiting = app.run(Effect.exit(Effect.flatMap(Effect.service(GithubAuth), (a) => a.awaitSignIn)))
    await app.auth((a) => a.cancelSignIn)
    const exit = await waiting
    expect(JSON.stringify(exit)).toContain("cancelled")
    expect((await app.status()).signIn.pending).toBeNull()
  })

  test("without a client id, sign-in explains what is missing", async () => {
    const fake = fakeGithub()
    const app = start({ fake, clientId: null })
    expect((await app.status()).signIn.available).toBe(false)
    const exit = await app.run(Effect.exit(Effect.flatMap(Effect.service(GithubAuth), (a) => a.startSignIn)))
    expect(JSON.stringify(exit)).toContain("GITHUB_APP_CLIENT_ID")
  })

  test("a token lists every repo it can see; an app sign-in only the installed ones", async () => {
    const fake = fakeGithub()
    fake.addRepo("acme", "a-private", { private: true })
    const app = start({ fake, envToken: "test-token" })
    expect((await app.github((s) => s.availableRepos)).map((r) => `${r.owner}/${r.name}`)).toEqual([
      "acme/widgets",
      "acme/a-private"
    ])

    await app.signIn()
    expect(await app.github((s) => s.availableRepos)).toEqual([])
    fake.install([{ owner: "acme", name: "widgets" }, { owner: "acme", name: "a-private", private: true }])
    expect(await app.github((s) => s.availableRepos)).toEqual([
      { owner: "acme", name: "a-private", private: true, description: null },
      { owner: "acme", name: "widgets", private: false, description: null }
    ])
  })

  test("the app sign-in wins over GITHUB_TOKEN, and signing out falls back to it", async () => {
    const fake = fakeGithub()
    const app = start({ fake, envToken: "test-token" })
    expect((await app.status()).tokenSource).toBe("env")
    await app.signIn()
    expect((await app.status()).tokenSource).toBe("app")
    await app.auth((a) => a.signOut)
    const status = await app.status()
    expect(status.tokenSource).toBe("env")
    expect(status.login).toBe("octo")
    expect(await app.auth((a) => Effect.sync(() => a.tokenUnsafe()))).toBe("test-token")
  })

  test("a revoked token is dropped on GitHub's 401, with a notice", async () => {
    const fake = fakeGithub()
    const app = start({ fake })
    await app.signIn()
    fake.revoke(fake.appTokens()[0]!)
    await app.run(Effect.exit(Effect.flatMap(Effect.service(GithubSync), (s) => s.availableRepos)))
    const status = await app.status()
    expect(status.tokenSource).toBeNull()
    expect(status.notice).toContain("Sign in again")
  })

  test("an expired token is not sent", async () => {
    const fake = fakeGithub({ tokenExpiresIn: 0.05 })
    const app = start({ fake })
    await app.signIn()
    expect((await app.status()).tokenSource).toBe("app")
    await Bun.sleep(80)
    const status = await app.status()
    expect(status.tokenSource).toBeNull()
    expect(status.notice).toContain("Sign in again")
    expect(await app.auth((a) => Effect.sync(() => a.tokenUnsafe()))).toBeNull()
  })
})
