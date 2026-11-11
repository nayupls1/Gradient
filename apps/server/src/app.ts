import { BunHttpServer } from "@effect/platform-bun"
import { GradientRpcs } from "@gradient/domain"
import { Effect, Layer, Option } from "effect"
import { HttpRouter, HttpServerResponse, HttpStaticServer } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { existsSync } from "node:fs"
import { Auth } from "./auth/Auth.ts"
import {
  AuthConfigRoute,
  AuthMiddlewareLive,
  AuthRoute,
  InviteAcceptRoute,
  InvitePreviewRoute,
  RequireApiKey,
  RequireSession
} from "./auth/http.ts"
import { Members } from "./auth/Members.ts"
import { ServerConfig } from "./config.ts"
import { DbLive } from "./db/Db.ts"
import { GithubAuth } from "./github/GithubAuth.ts"
import { GithubClient } from "./github/GithubClient.ts"
import { RepoFileRoute } from "./github/files.ts"
import { GithubSync } from "./github/GithubSync.ts"
import { WebhookRoute } from "./github/webhook.ts"
import { localOnly } from "./http/guard.ts"
import { McpRoute as McpRouteOpen } from "./mcp/server.ts"
import { seed } from "./seed.ts"
import { Hub } from "./sync/Hub.ts"
import { Mutations } from "./sync/Mutations.ts"
import { RpcHandlers } from "./sync/Rpc.ts"

/** The sync socket: only opens with a session cookie, and every call checks the session again. */
const RpcRoute = RpcServer.layerHttp({ group: GradientRpcs, path: "/rpc", protocol: "websocket" }).pipe(
  Layer.provide(RpcHandlers),
  Layer.provide(AuthMiddlewareLive),
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(RequireSession.layer)
)

/** Agents authenticate with an agent key from the profile page. */
const McpRoute = McpRouteOpen.pipe(Layer.provide(RequireApiKey.layer))

/** Images from (possibly private) linked repositories are for signed-in users only. */
const RepoFiles = RepoFileRoute.pipe(Layer.provide(RequireSession.layer))

const HealthRoute = HttpRouter.add("GET", "/health", HttpServerResponse.text("ok"))

/** Serves the built web app when it exists (`bun run build` in apps/web). */
const StaticRoute = Layer.unwrap(
  Effect.gen(function*() {
    const { webDist } = yield* ServerConfig
    return existsSync(`${webDist}/index.html`)
      ? HttpStaticServer.layer({ root: webDist, spa: true })
      : Layer.empty
  })
)

const Seed = Layer.effectDiscard(seed)

/** Everything except the HTTP listener, so tests can mount it on their own server. */
export const AppServices = Layer.mergeAll(Seed, Layer.empty).pipe(
  Layer.provideMerge(Members.layer),
  Layer.provideMerge(Auth.layer),
  Layer.provideMerge(GithubSync.layer),
  Layer.provideMerge(GithubClient.layer),
  Layer.provideMerge(GithubAuth.layer),
  Layer.provideMerge(Mutations.layer),
  Layer.provideMerge(Hub.layer),
  Layer.provideMerge(DbLive)
)

export const Routes = Layer.mergeAll(
  AuthRoute,
  AuthConfigRoute,
  InvitePreviewRoute,
  InviteAcceptRoute,
  RpcRoute,
  McpRoute,
  HealthRoute,
  WebhookRoute,
  RepoFiles,
  StaticRoute
)

export const HttpLive = Layer.unwrap(
  Effect.gen(function*() {
    const { host, port, auth } = yield* ServerConfig
    const loopbackBind = host === "127.0.0.1" || host === "localhost" || host === "::1"
    const allowedOrigins = Option.match(auth.url, { onNone: () => [], onSome: (url) => [new URL(url).origin] })
    return HttpRouter.serve(Routes, { middleware: localOnly({ loopbackBind, allowedOrigins }) }).pipe(
      Layer.provide(BunHttpServer.layer({ hostname: host, port, idleTimeout: 120 }))
    )
  })
)

export const MainLive = HttpLive.pipe(Layer.provide(AppServices), Layer.provideMerge(ServerConfig.layer))
