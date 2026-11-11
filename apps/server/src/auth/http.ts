import { AuthMiddleware, CurrentViewer, Unauthorized } from "@gradient/domain"
import { Effect, Layer, Option, Schedule } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Auth, AUTH_BASE_PATH, CLIENT_IP_HEADER, type Viewer } from "./Auth.ts"

/**
 * Better Auth's endpoints. The client's address is passed on in a header the
 * server owns (any copy the client sent is replaced), for the sign-in rate limits.
 */
export const AuthRoute = HttpRouter.add(
  "*",
  `${AUTH_BASE_PATH}/*`,
  Effect.gen(function*() {
    const auth = yield* Auth
    const request = yield* HttpServerRequest.HttpServerRequest
    const source = request.source as Request
    const headers = new Headers(source.headers)
    headers.delete(CLIENT_IP_HEADER)
    const ip = Option.getOrUndefined(request.remoteAddress)
    if (ip) headers.set(CLIENT_IP_HEADER, ip)
    const response = yield* Effect.promise(() => auth.handler(new Request(source, { headers })))
    return HttpServerResponse.fromWeb(response)
  })
)

/** What the sign-in screen needs before anyone is signed in. */
export const AuthConfigRoute = HttpRouter.add(
  "GET",
  "/api/auth-config",
  Effect.gen(function*() {
    const auth = yield* Auth
    return HttpServerResponse.jsonUnsafe({ signUpOpen: yield* auth.signUpOpen })
  })
)

const unauthorized = (message: string, scheme?: string) =>
  HttpServerResponse.text(message, {
    status: 401,
    headers: scheme ? { "www-authenticate": scheme } : {}
  })

/**
 * Routes for the signed-in app (the sync socket, repository images) refuse
 * requests without a valid session cookie, so an unauthenticated socket never
 * opens. Each RPC call checks the session again (`AuthMiddlewareLive`).
 */
export const RequireSession = HttpRouter.middleware(
  Effect.gen(function*() {
    const auth = yield* Auth
    return (app) =>
      Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest
        const viewer = yield* auth.viewerFromHeaders(request.headers)
        return viewer ? yield* app : unauthorized("Sign in to Gradient first.")
      })
  })
)

/** `Authorization: Bearer grd_…` (what MCP clients send), or `x-api-key`. */
export const apiKeyFrom = (headers: Record<string, string | undefined>) => {
  const authorization = headers["authorization"]
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  return bearer || headers["x-api-key"]?.trim() || null
}

const noKey =
  "Gradient needs an agent key. Create one on your profile page and send it as `Authorization: Bearer <key>`."

/**
 * MCP needs an agent key (an API key from the profile page). The viewer it
 * resolves to is provided as `CurrentViewer`, which the MCP tools read.
 */
export const RequireApiKey = HttpRouter.middleware<{ provides: CurrentViewer }>()(
  Effect.gen(function*() {
    const auth = yield* Auth
    return (app) =>
      Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest
        const key = apiKeyFrom(request.headers)
        const viewer = key ? yield* auth.viewerFromApiKey(key, request.headers) : null
        if (!viewer) return unauthorized(key ? "That agent key is not valid." : noKey, `Bearer realm="gradient"`)
        return yield* Effect.provideService(app, CurrentViewer, viewer)
      })
  })
)

/** How often a live subscription checks that its session still exists. */
const SESSION_RECHECK = "30 seconds"

/**
 * Resolves the session of every RPC call from the cookie the socket was
 * opened with. A subscription also rechecks it while it runs, so signing out
 * elsewhere (or revoking the session from the profile page) ends it.
 */
export const AuthMiddlewareLive = Layer.effect(
  AuthMiddleware,
  Effect.gen(function*() {
    const auth = yield* Auth
    const resolve = (headers: Record<string, string | undefined>) =>
      Effect.flatMap(auth.viewerFromHeaders(headers), (viewer) =>
        viewer ? Effect.succeed(viewer) : Effect.fail(new Unauthorized({ message: "Your session has ended. Sign in again." })))
    return AuthMiddleware.of((effect, { headers, rpc }) =>
      Effect.gen(function*() {
        const viewer: Viewer = yield* resolve(headers)
        const run = Effect.provideService(effect, CurrentViewer, viewer)
        if (rpc._tag !== "Subscribe") return yield* run
        const watch = resolve(headers).pipe(
          Effect.delay(SESSION_RECHECK),
          Effect.repeat(Schedule.forever),
          Effect.andThen(Effect.never)
        )
        return yield* Effect.raceFirst(run, watch)
      })
    )
  })
)
