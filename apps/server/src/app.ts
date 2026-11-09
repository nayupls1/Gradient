import { BunHttpServer } from "@effect/platform-bun"
import { GradientRpcs } from "@gradient/domain"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse, HttpStaticServer } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { existsSync } from "node:fs"
import { ServerConfig } from "./config.ts"
import { DbLive } from "./db/Db.ts"
import { GithubClient } from "./github/GithubClient.ts"
import { GithubSync } from "./github/GithubSync.ts"
import { WebhookRoute } from "./github/webhook.ts"
import { localOnly } from "./http/guard.ts"
import { McpRoute } from "./mcp/server.ts"
import { seed } from "./seed.ts"
import { Hub } from "./sync/Hub.ts"
import { Mutations } from "./sync/Mutations.ts"
import { RpcHandlers } from "./sync/Rpc.ts"

const RpcRoute = RpcServer.layerHttp({ group: GradientRpcs, path: "/rpc", protocol: "websocket" }).pipe(
  Layer.provide(RpcHandlers),
  Layer.provide(RpcSerialization.layerJson)
)

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
  Layer.provideMerge(GithubSync.layer),
  Layer.provideMerge(GithubClient.layer),
  Layer.provideMerge(Mutations.layer),
  Layer.provideMerge(Hub.layer),
  Layer.provideMerge(DbLive)
)

export const Routes = Layer.mergeAll(RpcRoute, McpRoute, HealthRoute, WebhookRoute, StaticRoute)

export const HttpLive = Layer.unwrap(
  Effect.gen(function*() {
    const { host, port } = yield* ServerConfig
    const loopbackBind = host === "127.0.0.1" || host === "localhost" || host === "::1"
    return HttpRouter.serve(Routes, { middleware: localOnly({ loopbackBind }) }).pipe(
      Layer.provide(BunHttpServer.layer({ hostname: host, port, idleTimeout: 120 }))
    )
  })
)

export const MainLive = HttpLive.pipe(Layer.provide(AppServices), Layer.provideMerge(ServerConfig.layer))
