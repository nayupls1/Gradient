import { type GithubDeviceCode, GithubError, type GithubTokenSource } from "@gradient/domain"
import { Context, Deferred, Duration, Effect, FiberHandle, Layer, Option, PubSub, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { ServerConfig } from "../config.ts"
import { Db } from "../db/Db.ts"

/*
 * Who Gradient talks to GitHub as.
 *
 * "Sign in with GitHub" uses the device flow of the Gradient GitHub App: the
 * server asks github.com for a short code, the user enters it on github.com,
 * and the server polls until GitHub hands over a user token. The flow needs
 * only the app's public client id, so a local install carries no secret. The
 * token acts as the user, limited to the repositories the app is installed on.
 *
 * The token is read on every request, so signing in or out applies at once.
 * Precedence: app sign-in, then GITHUB_TOKEN, then the gh CLI.
 */

export interface Viewer {
  readonly login: string
  readonly avatarUrl: string | null
}

interface Stored {
  readonly token: string
  readonly login: string
  readonly avatarUrl: string | null
  readonly expiresAt: number | null
}

const DeviceCodeResponse = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  expires_in: Schema.Number,
  interval: Schema.Number
})

/** GitHub answers 200 for both outcomes: a token, or an `error` such as authorization_pending. */
const TokenResponse = Schema.Struct({
  access_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
  error: Schema.optionalKey(Schema.String),
  error_description: Schema.optionalKey(Schema.String),
  interval: Schema.optionalKey(Schema.Number)
})

const GhUser = Schema.Struct({ login: Schema.String, avatar_url: Schema.optionalKey(Schema.NullOr(Schema.String)) })

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"

const fail = (message: string) => Effect.fail(new GithubError({ message }))

export class GithubAuth extends Context.Service<GithubAuth, {
  /** The token to send right now, or null. Cheap and synchronous: called per request. */
  tokenUnsafe(): string | null
  readonly source: Effect.Effect<GithubTokenSource | null>
  readonly viewer: Effect.Effect<Viewer | null>
  readonly signInAvailable: boolean
  readonly installUrl: string | null
  readonly pending: Effect.Effect<GithubDeviceCode | null>
  readonly notice: Effect.Effect<string | null>
  /** Publishes after every sign-in and sign-out. */
  readonly changes: PubSub.PubSub<void>
  /** Ask GitHub for a code and start polling for the user's approval. */
  readonly startSignIn: Effect.Effect<GithubDeviceCode, GithubError>
  /** Wait for the pending sign-in to finish. */
  readonly awaitSignIn: Effect.Effect<Viewer, GithubError>
  readonly cancelSignIn: Effect.Effect<void>
  readonly signOut: Effect.Effect<void>
  /** GitHub answered 401 for this token. Drops it when it is the app sign-in (expired or revoked). */
  rejected(token: string): Effect.Effect<void>
}>()("gradient/GithubAuth") {
  static readonly layer = Layer.effect(
    GithubAuth,
    Effect.gen(function*() {
      const config = (yield* ServerConfig).github
      const sql = (yield* Db).sql
      const http = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.setHeaders({ accept: "application/json", "user-agent": "gradient" }))
      )
      const changes = yield* PubSub.unbounded<void>()
      const flows = yield* FiberHandle.make<void, never>()

      const clientId = config.enabled ? config.app.clientId : null
      const fallback = config.enabled ? Option.getOrNull(config.token) : null

      const loadStored = sql`SELECT * FROM github_auth WHERE id = 1`.pipe(
        Effect.map((rows): Stored | null => {
          const r = rows[0]
          return r
            ? {
              token: r.token as string,
              login: r.login as string,
              avatarUrl: (r.avatar_url as string | null) ?? null,
              expiresAt: r.expires_at === null ? null : Number(r.expires_at)
            }
            : null
        }),
        Effect.orDie
      )

      let stored: Stored | null = config.enabled ? yield* loadStored : null
      let fallbackViewer: Viewer | null = null
      let notice: string | null = null
      let pending: { code: GithubDeviceCode; result: Deferred.Deferred<Viewer, GithubError> } | null = null

      const forget = (message: string | null) =>
        Effect.gen(function*() {
          yield* sql`DELETE FROM github_auth WHERE id = 1`.pipe(Effect.orDie)
          stored = null
          notice = message
          yield* PubSub.publish(changes, undefined)
        })

      const EXPIRED = "Your GitHub sign-in expired or was revoked. Sign in again."
      /** An expired app token is dropped before it is ever sent. */
      const liveStored = () => {
        if (stored && stored.expiresAt !== null && stored.expiresAt <= Date.now()) {
          notice = EXPIRED
          return null
        }
        return stored
      }
      if (stored && !liveStored()) yield* forget(EXPIRED)

      const tokenUnsafe = () => liveStored()?.token ?? fallback

      const userFor = (token: string) =>
        Effect.gen(function*() {
          const res = yield* http.execute(
            HttpClientRequest.get(`${config.apiUrl}/user`).pipe(HttpClientRequest.bearerToken(token))
          )
          if (res.status !== 200) return yield* fail(`GitHub did not accept the token (${res.status}).`)
          const u = yield* HttpClientResponse.schemaBodyJson(GhUser)(res)
          return { login: u.login, avatarUrl: u.avatar_url ?? null } satisfies Viewer
        }).pipe(
          Effect.mapError((e) =>
            e._tag === "GithubError" ? e : new GithubError({ message: `Reading your GitHub account failed: ${e.message}` })
          )
        )

      // Learn who the environment / gh CLI token belongs to, so assignees map both ways.
      if (fallback) {
        const viewer = yield* Effect.option(userFor(fallback))
        if (Option.isSome(viewer)) fallbackViewer = viewer.value
        else yield* Effect.logWarning("GitHub token found but /user failed; assignees will not map to you")
      }

      const form = (path: string, params: Record<string, string>) =>
        HttpClientRequest.post(`${config.webUrl}${path}`).pipe(HttpClientRequest.bodyUrlParams(params), http.execute)

      /** Poll until the user approves, declines, or the code expires. */
      const poll = (deviceCode: string, startInterval: number, expiresAt: number) =>
        Effect.gen(function*() {
          let interval = startInterval
          while (true) {
            yield* Effect.sleep(Duration.seconds(interval))
            if (Date.now() >= expiresAt) return yield* fail("The sign-in code expired. Start again.")
            const answer = yield* form("/login/oauth/access_token", {
              client_id: clientId!,
              device_code: deviceCode,
              grant_type: DEVICE_GRANT
            }).pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenResponse)),
              // A network blip is not a decline: try again at the next interval.
              Effect.catch((e) =>
                Effect.as(
                  Effect.logWarning("Polling GitHub for the sign-in failed", e.message),
                  { error: "authorization_pending" } as typeof TokenResponse.Type
                )
              )
            )
            if (answer.access_token) {
              return { token: answer.access_token, expiresIn: answer.expires_in ?? null }
            }
            switch (answer.error) {
              case "authorization_pending":
                continue
              case "slow_down":
                interval = answer.interval ?? interval + 5
                continue
              case "expired_token":
                return yield* fail("The sign-in code expired. Start again.")
              case "access_denied":
                return yield* fail("Sign-in was declined on GitHub.")
              default:
                return yield* fail(`GitHub sign-in failed: ${answer.error_description ?? answer.error ?? "no token"}`)
            }
          }
        })

      const startSignIn = Effect.gen(function*() {
        if (!config.enabled) return yield* fail("GitHub is disabled (GRADIENT_GITHUB_DISABLED).")
        if (!clientId) {
          return yield* fail("Sign-in with GitHub needs the Gradient GitHub App. Set GITHUB_APP_CLIENT_ID and restart.")
        }
        const res = yield* form("/login/device/code", { client_id: clientId }).pipe(
          Effect.mapError((e) => new GithubError({ message: `Reaching GitHub failed: ${e.message}` }))
        )
        if (res.status !== 200) {
          return yield* fail(`GitHub refused to start a sign-in (${res.status}). Is Device Flow enabled on the app?`)
        }
        const body = yield* HttpClientResponse.schemaBodyJson(Schema.Union([
          DeviceCodeResponse,
          Schema.Struct({ error: Schema.String, error_description: Schema.optionalKey(Schema.String) })
        ]))(res).pipe(Effect.mapError((e) => new GithubError({ message: `GitHub sent an unexpected answer: ${e.message}` })))
        if ("error" in body) {
          return yield* fail(
            body.error === "device_flow_disabled"
              ? "Device Flow is turned off for the Gradient GitHub App. Enable it in the app's settings."
              : `GitHub refused to start a sign-in: ${body.error_description ?? body.error}`
          )
        }

        const code: GithubDeviceCode = {
          userCode: body.user_code,
          verificationUri: body.verification_uri,
          expiresAt: Date.now() + body.expires_in * 1000
        }
        const result = yield* Deferred.make<Viewer, GithubError>()
        const flow = { code, result }
        const clearPending = Effect.sync(() => {
          if (pending === flow) pending = null
        })
        // Replacing an older flow interrupts its poller, which fails its waiters.
        yield* FiberHandle.run(
          flows,
          poll(body.device_code, body.interval, code.expiresAt).pipe(
            Effect.flatMap(({ token, expiresIn }) =>
              Effect.gen(function*() {
                const viewer = yield* userFor(token)
                const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null
                yield* sql`INSERT INTO github_auth (id, token, login, avatar_url, expires_at, created_at)
                           VALUES (1, ${token}, ${viewer.login}, ${viewer.avatarUrl}, ${expiresAt}, ${Date.now()})
                           ON CONFLICT (id) DO UPDATE SET token = excluded.token, login = excluded.login,
                             avatar_url = excluded.avatar_url, expires_at = excluded.expires_at,
                             created_at = excluded.created_at`.pipe(Effect.orDie)
                stored = { token, login: viewer.login, avatarUrl: viewer.avatarUrl, expiresAt }
                notice = null
                yield* PubSub.publish(changes, undefined)
                return viewer
              })
            ),
            Effect.exit,
            // Clear `pending` before waking waiters, so the status they read is final.
            Effect.flatMap((exit) => Effect.andThen(clearPending, Deferred.done(result, exit))),
            Effect.onInterrupt(() =>
              Effect.andThen(clearPending, Deferred.fail(result, new GithubError({ message: "Sign-in was cancelled." })))
            ),
            Effect.asVoid
          )
        )
        pending = flow
        return code
      })

      const awaitSignIn = Effect.suspend(() =>
        pending ? Deferred.await(pending.result) : fail("No sign-in is in progress.")
      )

      return GithubAuth.of({
        tokenUnsafe,
        source: Effect.sync(() => (liveStored() ? "app" : fallback ? config.tokenSource : null)),
        viewer: Effect.sync(() => {
          const s = liveStored()
          return s ? { login: s.login, avatarUrl: s.avatarUrl } : fallback ? fallbackViewer : null
        }),
        signInAvailable: clientId !== null,
        installUrl: clientId && config.app.slug ? `${config.webUrl}/apps/${config.app.slug}/installations/new` : null,
        pending: Effect.sync(() => (pending && pending.code.expiresAt > Date.now() ? pending.code : null)),
        notice: Effect.sync(() => notice),
        changes,
        startSignIn,
        awaitSignIn,
        cancelSignIn: FiberHandle.clear(flows),
        signOut: Effect.gen(function*() {
          yield* FiberHandle.clear(flows)
          if (stored) yield* forget(null)
        }),
        rejected: (token) => (stored && stored.token === token ? forget(EXPIRED) : Effect.void)
      })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
