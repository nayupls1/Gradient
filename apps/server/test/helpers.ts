import { GradientRpcs } from "@gradient/domain"
import { Effect, Layer, ManagedRuntime, Option } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import { AppServices, HttpLive } from "../src/app.ts"
import { ServerConfig, type ServerConfigShape } from "../src/config.ts"

/** Config for a test server: in-memory database, no GitHub. */
export const testConfig = (port: number, overrides: Partial<ServerConfigShape> = {}): ServerConfigShape => ({
  port,
  host: "127.0.0.1",
  dbPath: ":memory:",
  webDist: "/nonexistent",
  seedSampleData: true,
  auth: { secret: Option.some("test-secret-0123456789abcdef0123456789"), url: Option.none(), allowSignUp: false },
  github: {
    enabled: false,
    token: Option.none(),
    tokenSource: null,
    apiUrl: "http://127.0.0.1:1",
    webUrl: "http://127.0.0.1:1",
    app: { clientId: null, slug: null },
    webhookSecret: Option.none(),
    pollIntervalSeconds: 3600
  },
  ...overrides
})

/** A real server on a random port. Call `start()` before use and `dispose()` after. */
export const startServer = (overrides: Partial<ServerConfigShape> = {}) => {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const runtime = ManagedRuntime.make(
    Layer.merge(AppServices, HttpLive.pipe(Layer.provide(AppServices))).pipe(
      Layer.provideMerge(Layer.succeed(ServerConfig, testConfig(port, overrides)))
    )
  )
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    runtime,
    start: () => runtime.runPromise(Effect.void),
    dispose: () => runtime.dispose()
  }
}

export interface Account {
  readonly name: string
  readonly email: string
  readonly password: string
}

export const OWNER: Account = { name: "Ada Lovelace", email: "ada@example.com", password: "correct horse battery" }

/** `name=value` pairs of the cookies a response sets, ready for a `cookie` header. */
export const cookiesOf = (res: Response) =>
  res.headers.getSetCookie().map((c) => c.split(";")[0]!).filter((c) => !c.endsWith("=")).join("; ")

/** POST to a Better Auth endpoint the way the browser does (same origin, JSON). */
export const authPost = (base: string, path: string, body: object, cookie?: string) =>
  fetch(`${base}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  })

export const authGet = (base: string, path: string, cookie?: string) =>
  fetch(`${base}/api/auth${path}`, { headers: { origin: base, ...(cookie ? { cookie } : {}) } })

/** Create an account and return its session cookie. */
export const signUp = async (base: string, account: Account = OWNER) => {
  const res = await authPost(base, "/sign-up/email", account)
  if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`)
  return cookiesOf(res)
}

export const signIn = async (base: string, account: Account = OWNER) => {
  const res = await authPost(base, "/sign-in/email", { email: account.email, password: account.password })
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`)
  return cookiesOf(res)
}

/** An agent key for MCP, created the way the profile page does. */
export const createApiKey = async (base: string, cookie: string, name = "test agent") => {
  const res = await authPost(base, "/api-key/create", { name }, cookie)
  if (!res.ok) throw new Error(`api key failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as { id: string; key: string }
}

/** The sync RPC client over a WebSocket opened with `cookie` (or none). */
export const rpcClientLayer = (port: number, cookie?: string) =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(`ws://127.0.0.1:${port}/rpc`)),
    Layer.provide(
      Layer.succeed(Socket.WebSocketConstructor)((url) =>
        new globalThis.WebSocket(url, { headers: cookie ? { cookie } : {} } as any) as any
      )
    ),
    Layer.provide(RpcSerialization.layerJson)
  )

export const runRpc = <A, E>(
  port: number,
  cookie: string | undefined,
  f: (c: RpcClient.FromGroup<typeof GradientRpcs>) => Effect.Effect<A, E>
) =>
  Effect.runPromise(
    Effect.gen(function*() {
      return yield* f((yield* RpcClient.make(GradientRpcs)) as any)
    }).pipe(Effect.scoped, Effect.provide(rpcClientLayer(port, cookie)))
  )
