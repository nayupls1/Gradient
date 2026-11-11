import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

const hostname = (value: string) => {
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname
  } catch {
    return null
  }
}

/**
 * Requests from browsers must come from Gradient's own pages. Accounts guard
 * the data (see auth/), and this guard keeps other sites from even trying.
 *
 * - Browsers send `Origin` on cross-site requests and on every WebSocket
 *   upgrade. Anything but a loopback origin, or the origin of GRADIENT_URL, is
 *   refused, so a web page you visit cannot drive /rpc, /mcp or sign-in.
 * - When bound to loopback, the `Host` header must be loopback too, which
 *   blocks DNS rebinding.
 *
 * CLI clients (Claude Code, Codex, curl) and GitHub webhooks send no `Origin`.
 */
export const localOnly = (options: { loopbackBind: boolean; allowedOrigins?: ReadonlyArray<string> }) =>
<E, R>(app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
  Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    const origin = request.headers["origin"]
    const allowed = origin && (options.allowedOrigins ?? []).includes(origin)
    if (origin && origin !== "null" && !allowed && !LOOPBACK.has(hostname(origin) ?? "")) {
      return HttpServerResponse.text("Forbidden origin", { status: 403 })
    }
    const host = request.headers["host"]
    if (options.loopbackBind && host && !LOOPBACK.has(hostname(host) ?? "")) {
      return HttpServerResponse.text("Forbidden host", { status: 403 })
    }
    return yield* app
  })
