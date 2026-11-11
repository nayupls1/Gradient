import { apiKey } from "@better-auth/api-key"
import { uuidv7 } from "@gradient/domain"
import { betterAuth } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { Context, Effect, Layer, Option } from "effect"
import { SqlClient } from "effect/sql"
import { ServerConfig } from "../config.ts"
import { Db } from "../db/Db.ts"
import { Mutations } from "../sync/Mutations.ts"
import { sqliteAdapter } from "./adapter.ts"

/** Where Better Auth's endpoints live (sign-up, sign-in, sessions, API keys…). */
export const AUTH_BASE_PATH = "/api/auth"

/**
 * The header Better Auth reads the client's address from, for its rate
 * limits. The server sets it from the socket and drops any copy a client sends.
 */
export const CLIENT_IP_HEADER = "x-gradient-client-ip"

/** Agent keys (for MCP) start with this, so they are easy to spot in a config file. */
export const API_KEY_PREFIX = "grd_"

const LOOPBACK_HOSTS = ["localhost:*", "127.0.0.1:*", "[::1]:*", "localhost", "127.0.0.1", "[::1]"]

/** The signed-in account and the Gradient user it acts as. */
export interface Viewer {
  readonly userId: string
  readonly accountId: string
}

export interface AccountRef {
  readonly id: string
  readonly name: string
}

const makeAuth = Effect.gen(function*() {
  const config = yield* ServerConfig
  const db = yield* Db
  const mutations = yield* Mutations
  const sqlContext = yield* Effect.context<SqlClient.SqlClient>()

  const secret = Option.isSome(config.auth.secret) ? config.auth.secret.value : yield* storedSecret(db)

  /**
   * The Gradient user an account acts as, created on first use. The first
   * account takes over the workspace's original user (the seeded "Me", who
   * owns the existing issues and the GitHub connection); later accounts get a
   * user of their own. Runs in `Mutations.transact`, so clients see the user.
   */
  const ensureMember = (account: AccountRef) =>
    mutations.transact({ origin: "system", actorId: null }, (tx) =>
      Effect.gen(function*() {
        const linked = yield* db.userForAccount(account.id)
        if (linked) return linked.id
        const ownerId = yield* db.getMeta("viewer_id")
        const owner = ownerId ? yield* db.getUser(ownerId) : undefined
        const ownerFree = owner
          ? (yield* db.sql`SELECT account_id FROM user WHERE id = ${owner.id}`)[0]?.account_id == null
          : false
        const user = owner && ownerFree
          ? { ...owner, name: account.name }
          : { id: uuidv7(), name: account.name, githubLogin: null, avatarUrl: null }
        yield* db.putUser(user)
        yield* db.linkAccount(user.id, account.id)
        tx.touch("user", user.id)
        return user.id
      })).pipe(Effect.map(({ value }) => value), Effect.orDie)

  /** Keep the Gradient user's name in step with the account's (the profile page edits the account). */
  const syncName = (account: AccountRef) =>
    mutations.transact({ origin: "system", actorId: null }, (tx) =>
      Effect.gen(function*() {
        const user = yield* db.userForAccount(account.id)
        if (!user || user.name === account.name) return
        yield* db.putUser({ ...user, name: account.name })
        tx.touch("user", user.id)
      })).pipe(Effect.asVoid, Effect.orDie)

  /** Sign-up is open until the first account exists, then only with GRADIENT_ALLOW_SIGNUP. */
  const signUpOpen = Effect.map(db.accountCount, (n) => n === 0 || config.auth.allowSignUp).pipe(Effect.orDie)

  const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

  const auth = betterAuth({
    appName: "Gradient",
    secret,
    basePath: AUTH_BASE_PATH,
    // A configured public URL is the one origin; otherwise answer whichever
    // loopback host and port the browser used (Vite on 4200, the server on 4100).
    baseURL: Option.isSome(config.auth.url)
      ? config.auth.url.value
      : { allowedHosts: LOOPBACK_HOSTS, protocol: "http" },
    trustedOrigins: Option.isSome(config.auth.url) ? [new URL(config.auth.url.value).origin] : [],
    database: sqliteAdapter(sqlContext),
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true
    },
    user: { modelName: "auth_user" },
    session: { modelName: "auth_session" },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    advanced: {
      cookiePrefix: "gradient",
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] }
    },
    rateLimit: {
      enabled: true,
      customStorage: rateLimitStore(),
      window: 60,
      max: 300,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/change-password": { window: 60, max: 5 }
      }
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email" && !(await run(signUpOpen))) {
          throw new APIError("FORBIDDEN", {
            message: "Sign-up is closed. Ask the owner to start Gradient with GRADIENT_ALLOW_SIGNUP=true."
          })
        }
      })
    },
    databaseHooks: {
      user: {
        // Both run after Better Auth's transaction commits.
        create: { after: async (user) => void (await run(ensureMember(user))) },
        update: { after: async (user) => run(syncName(user)) }
      }
    },
    plugins: [
      apiKey({
        defaultPrefix: API_KEY_PREFIX,
        requireName: true,
        maximumNameLength: 64,
        // Agents make many calls; Better Auth's default is 10 a day.
        rateLimit: { enabled: false },
        schema: { apikey: { modelName: "auth_api_key" } }
      })
    ]
  })

  const accountOf = (user: AccountRef) =>
    Effect.gen(function*() {
      // Linked already in all but the very first request of an account: skip the write lock.
      const linked = yield* db.userForAccount(user.id).pipe(Effect.orDie)
      const userId = linked ? linked.id : yield* ensureMember(user)
      return { userId, accountId: user.id } satisfies Viewer
    })

  /** The viewer of a request's session cookie, or null when it has no valid session. */
  const viewerFromHeaders = (headers: Record<string, string | undefined>) =>
    Effect.gen(function*() {
      if (!headers["cookie"]) return null
      const session = yield* Effect.tryPromise(() => auth.api.getSession({ headers: toWebHeaders(headers) })).pipe(
        Effect.tapError((e) => Effect.logDebug("Session lookup failed", e)),
        Effect.orElseSucceed(() => null)
      )
      return session ? yield* accountOf(session.user) : null
    })

  /** The viewer an agent key belongs to, or null when the key is unknown, disabled or expired. */
  const viewerFromApiKey = (key: string, headers: Record<string, string | undefined>) =>
    Effect.gen(function*() {
      const result = yield* Effect.tryPromise(() =>
        auth.api.verifyApiKey({ body: { key }, headers: toWebHeaders(headers) })
      ).pipe(
        Effect.tapError((e) => Effect.logDebug("Agent key check failed", e)),
        Effect.orElseSucceed(() => null)
      )
      if (!result?.valid || !result.key) return null
      const rows = yield* db.sql`SELECT id, name FROM auth_user WHERE id = ${result.key.referenceId}`.pipe(Effect.orDie)
      const user = rows[0]
      return user ? yield* accountOf({ id: String(user.id), name: String(user.name) }) : null
    })

  /** For the sign-in screen: whether it may offer sign-up, and whether this would be the first account. */
  const publicConfig = Effect.map(db.accountCount, (n) => ({
    signUpOpen: n === 0 || config.auth.allowSignUp,
    firstAccount: n === 0
  })).pipe(Effect.orDie)

  return {
    auth,
    handler: (request: Request) => auth.handler(request),
    signUpOpen,
    publicConfig,
    viewerFromHeaders,
    viewerFromApiKey
  }
})

/**
 * Fixed-window counters for Better Auth's rate limits, kept per server
 * (Better Auth's "memory" store is shared by every instance in the process).
 * Expired windows are dropped as new ones open, so it stays small.
 */
const rateLimitStore = () => {
  const windows = new Map<string, { start: number; count: number; until: number }>()
  return {
    consume: async (key: string, rule: { window: number; max: number }) => {
      const now = Date.now()
      if (windows.size > 10_000) for (const [k, w] of windows) if (w.until <= now) windows.delete(k)
      const current = windows.get(key)
      if (!current || current.until <= now) {
        windows.set(key, { start: now, count: 1, until: now + rule.window * 1000 })
        return { allowed: true, retryAfter: null }
      }
      if (current.count >= rule.max) return { allowed: false, retryAfter: Math.ceil((current.until - now) / 1000) }
      current.count++
      return { allowed: true, retryAfter: null }
    }
  }
}

/**
 * A request's headers for a direct `auth.api` call. All of them: with a
 * dynamic base URL, Better Auth reads the host as well as the cookie.
 */
const toWebHeaders = (headers: Record<string, string | undefined>) => {
  const out = new Headers()
  for (const [name, value] of Object.entries(headers)) if (value !== undefined) out.set(name, value)
  return out
}

/** A random secret, made once and kept in `meta`, for installs that set none. */
const storedSecret = (db: Db["Service"]) =>
  Effect.gen(function*() {
    const existing = yield* db.getMeta("auth_secret")
    if (existing) return existing
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const secret = Buffer.from(bytes).toString("base64url")
    yield* db.setMeta("auth_secret", secret)
    return secret
  }).pipe(Effect.orDie)

export class Auth extends Context.Service<Auth, Effect.Success<typeof makeAuth>>()("gradient/Auth") {
  static readonly layer = Layer.effect(Auth, makeAuth)
}
