import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Option } from "effect"
import { Db } from "../src/db/Db.ts"
import {
  type Account,
  authGet,
  authPost,
  cookiesOf,
  createApiKey,
  OWNER,
  runRpc,
  signIn,
  signUp,
  startServer
} from "./helpers.ts"

const SECOND: Account = { name: "Grace Hopper", email: "grace@example.com", password: "compilers all the way" }

const servers: Array<ReturnType<typeof startServer>> = []
afterEach(async () => {
  for (const s of servers.splice(0)) await s.dispose()
})
const start = async (overrides: Parameters<typeof startServer>[0] = {}) => {
  const server = startServer(overrides)
  servers.push(server)
  await server.start()
  return server
}

const db = <A>(server: ReturnType<typeof startServer>, f: (db: Db["Service"]) => Effect.Effect<A, unknown>) =>
  server.runtime.runPromise(Effect.flatMap(Effect.service(Db), f) as Effect.Effect<A>)

const upgrade = (base: string, cookie?: string) =>
  fetch(`${base}/rpc`, {
    headers: {
      upgrade: "websocket",
      connection: "upgrade",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
      ...(cookie ? { cookie } : {})
    }
  })

const mcp = (base: string, key: string | null, body: object, session?: string) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(session ? { "mcp-session-id": session } : {})
    },
    body: JSON.stringify(body)
  })

describe("accounts", () => {
  test("the first account takes over the workspace user; then sign-up closes", async () => {
    const server = await start()
    const config = async () =>
      (await (await fetch(`${server.base}/api/auth-config`)).json()) as { signUpOpen: boolean; firstAccount: boolean }
    expect(await config()).toEqual({ signUpOpen: true, firstAccount: true })

    const owner = await db(server, (d) => d.getMeta("viewer_id"))
    const cookie = await signUp(server.base)
    const snap = await runRpc(server.port, cookie, (c) => c.Bootstrap())
    // The seeded user, who owns the sample issues, now carries the account's name.
    expect(snap.viewerId).toBe(owner!)
    expect(snap.users.find((u) => u.id === owner)?.name).toBe(OWNER.name)
    expect(snap.issues.some((i) => i.assigneeId === owner)).toBe(true)

    expect(await config()).toEqual({ signUpOpen: false, firstAccount: false })
    const refused = await authPost(server.base, "/sign-up/email", SECOND)
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { message: string }).message).toContain("GRADIENT_ALLOW_SIGNUP")
  })

  test("with GRADIENT_ALLOW_SIGNUP, later accounts get a user of their own and act as it", async () => {
    const server = await start({
      auth: { secret: Option.some("test-secret-0123456789abcdef0123456789"), url: Option.none(), allowSignUp: true }
    })
    const ownerCookie = await signUp(server.base)
    const cookie = await signUp(server.base, SECOND)
    const ownerSnap = await runRpc(server.port, ownerCookie, (c) => c.Bootstrap())
    const snap = await runRpc(server.port, cookie, (c) => c.Bootstrap())
    expect(snap.viewerId).not.toBe(ownerSnap.viewerId)
    expect(snap.users.find((u) => u.id === snap.viewerId)?.name).toBe(SECOND.name)

    const issue = snap.issues[0]!
    await runRpc(server.port, cookie, (c) =>
      c.Mutate({ clientTxId: "by-grace", mutations: [{ _tag: "IssueUpdate", id: issue.id, patch: { title: "Grace was here" } }] }))
    const actor = await db(server, (d) => d.sql`SELECT actor_id FROM sync_log WHERE client_tx_id = 'by-grace'`)
    expect(actor[0]?.actor_id).toBe(snap.viewerId)
  })

  test("sign-in checks the password, and renaming the account renames the user", async () => {
    const server = await start()
    await signUp(server.base)
    expect((await authPost(server.base, "/sign-in/email", { email: OWNER.email, password: "wrong password" })).status)
      .toBe(401)
    const cookie = await signIn(server.base)

    const renamed = await authPost(server.base, "/update-user", { name: "Ada King" }, cookie)
    expect(renamed.status).toBe(200)
    const snap = await runRpc(server.port, cookie, (c) => c.Bootstrap())
    expect(snap.users.find((u) => u.id === snap.viewerId)?.name).toBe("Ada King")
  })

  test("password changes need the current password", async () => {
    const server = await start()
    const cookie = await signUp(server.base)
    const bad = await authPost(server.base, "/change-password", { currentPassword: "nope nope", newPassword: "a new password" }, cookie)
    expect(bad.status).toBe(400)
    const ok = await authPost(
      server.base,
      "/change-password",
      { currentPassword: OWNER.password, newPassword: "a new password", revokeOtherSessions: true },
      cookie
    )
    expect(ok.status).toBe(200)
    await signIn(server.base, { ...OWNER, password: "a new password" })
  })

  test("repeated failed sign-ins from one address are rate limited", async () => {
    const server = await start()
    await signUp(server.base)
    const statuses: Array<number> = []
    for (let i = 0; i < 12; i++) {
      statuses.push((await authPost(server.base, "/sign-in/email", { email: OWNER.email, password: "guess " + i })).status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(statuses.at(-1)).toBe(429)
  })
})

describe("the sync socket", () => {
  test("refuses to open without a valid session", async () => {
    const server = await start()
    const cookie = await signUp(server.base)
    expect((await upgrade(server.base)).status).toBe(401)
    expect((await upgrade(server.base, "gradient.session_token=forged.value")).status).toBe(401)
    expect((await upgrade(server.base, cookie)).status).not.toBe(401)
  })

  test("calls fail with Unauthorized once the session is signed out", async () => {
    const server = await start()
    const cookie = await signUp(server.base)
    const result = await runRpc(server.port, cookie, (c) =>
      Effect.gen(function*() {
        const snap = yield* c.Bootstrap()
        yield* Effect.promise(() => authPost(server.base, "/sign-out", {}, cookie))
        return yield* c.Mutate({
          clientTxId: "after-sign-out",
          mutations: [{ _tag: "IssueUpdate", id: snap.issues[0]!.id, patch: { title: "Nope" } }]
        }).pipe(Effect.flip)
      }))
    expect(result._tag).toBe("Unauthorized")
  })

  test("revoking a session from another one signs it out", async () => {
    const server = await start()
    const first = await signUp(server.base)
    const second = await signIn(server.base)
    const sessions = (await (await authGet(server.base, "/list-sessions", second)).json()) as Array<{ token: string }>
    expect(sessions.length).toBe(2)
    const firstToken = decodeURIComponent(first.split("=")[1]!).split(".")[0]
    const revoked = await authPost(server.base, "/revoke-session", { token: firstToken }, second)
    expect(revoked.status).toBe(200)
    expect((await upgrade(server.base, first)).status).toBe(401)
  })

  test("repository images need a session", async () => {
    const server = await start()
    const res = await fetch(`${server.base}/repo-files/r/${"a".repeat(40)}/icon.png`)
    expect(res.status).toBe(401)
  })
})

describe("agent keys (MCP)", () => {
  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }
  }

  test("MCP needs a valid key and acts as its owner", async () => {
    const server = await start()
    const cookie = await signUp(server.base)

    const missing = await mcp(server.base, null, initialize)
    expect(missing.status).toBe(401)
    expect(missing.headers.get("www-authenticate")).toContain("Bearer")
    expect((await mcp(server.base, "grd_not-a-real-key", initialize)).status).toBe(401)

    const { key, id } = await createApiKey(server.base, cookie, "Claude Code")
    expect(key.startsWith("grd_")).toBe(true)
    const init = await mcp(server.base, key, initialize)
    expect(init.status).toBe(200)
    const session = init.headers.get("mcp-session-id") ?? undefined
    await mcp(server.base, key, { jsonrpc: "2.0", method: "notifications/initialized" }, session)

    const call = await mcp(server.base, key, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "describe_workspace", arguments: {} }
    }, session)
    const text = await call.text()
    const json = JSON.parse(text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))!.slice(5))
    expect(json.result.structuredContent.you).toBe(OWNER.name)

    // The key is stored hashed, and deleting it locks the agent out.
    const stored = await db(server, (d) => d.sql`SELECT key FROM auth_api_key`)
    expect(stored[0]?.key).not.toBe(key)
    expect((await authPost(server.base, "/api-key/delete", { keyId: id }, cookie)).status).toBe(200)
    expect((await mcp(server.base, key, initialize)).status).toBe(401)
  })

  test("keys need a session to create", async () => {
    const server = await start()
    await signUp(server.base)
    expect((await authPost(server.base, "/api-key/create", { name: "sneaky" })).status).toBe(401)
  })
})

describe("cookies", () => {
  test("the session cookie is HttpOnly and SameSite=Lax", async () => {
    const server = await start()
    const res = await authPost(server.base, "/sign-up/email", OWNER)
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("gradient.session_token="))!
    expect(cookie).toContain("HttpOnly")
    expect(cookie.toLowerCase()).toContain("samesite=lax")
    expect(cookiesOf(res)).toContain("gradient.session_token=")
  })
})
