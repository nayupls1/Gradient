import { GithubError } from "@gradient/domain"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { ServerConfig } from "../config.ts"

const GhLabel = Schema.Union([
  Schema.String,
  Schema.Struct({ name: Schema.String, color: Schema.optionalKey(Schema.NullOr(Schema.String)) })
])

const GhUser = Schema.Struct({ login: Schema.String, avatar_url: Schema.optionalKey(Schema.NullOr(Schema.String)) })

export const GhIssue = Schema.Struct({
  number: Schema.Int,
  html_url: Schema.String,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  state: Schema.Literals(["open", "closed"]),
  state_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
  labels: Schema.Array(GhLabel),
  assignees: Schema.optionalKey(Schema.NullOr(Schema.Array(GhUser))),
  user: Schema.NullOr(GhUser),
  updated_at: Schema.String,
  pull_request: Schema.optionalKey(Schema.Unknown)
})
export type GhIssue = typeof GhIssue.Type

export const labelName = (l: typeof GhLabel.Type) => (typeof l === "string" ? l : l.name)
export const labelColor = (l: typeof GhLabel.Type) => (typeof l === "string" ? null : l.color ?? null)

export interface IssueWrite {
  readonly title?: string
  readonly body?: string
  readonly state?: "open" | "closed"
  readonly state_reason?: "completed" | "not_planned" | "reopened" | null
  readonly labels?: ReadonlyArray<string>
  readonly assignees?: ReadonlyArray<string>
}

export type ListResult =
  | { readonly _tag: "NotModified" }
  | { readonly _tag: "Page"; readonly issues: ReadonlyArray<GhIssue>; readonly etag: string | null; readonly hasNext: boolean }

const toError = (context: string) => (cause: unknown) =>
  new GithubError({ message: `${context}: ${cause instanceof Error ? cause.message : String(cause)}` })

/** A small hand-written GitHub REST client: only the calls Gradient needs. */
export class GithubClient extends Context.Service<GithubClient, {
  readonly enabled: boolean
  readonly viewer: Effect.Effect<{ login: string; avatarUrl: string | null }, GithubError>
  getRepo(owner: string, repo: string): Effect.Effect<void, GithubError>
  listIssues(owner: string, repo: string, options: {
    readonly since: string | null
    readonly etag: string | null
    readonly page: number
  }): Effect.Effect<ListResult, GithubError>
  createIssue(owner: string, repo: string, body: IssueWrite): Effect.Effect<GhIssue, GithubError>
  updateIssue(owner: string, repo: string, number: number, body: IssueWrite): Effect.Effect<GhIssue, GithubError>
}>()("gradient/GithubClient") {
  static readonly layer = Layer.effect(
    GithubClient,
    Effect.gen(function*() {
      const config = (yield* ServerConfig).github
      const token = Option.getOrNull(config.token)
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest((req) =>
          req.pipe(
            HttpClientRequest.prependUrl(config.apiUrl),
            HttpClientRequest.setHeaders({
              accept: "application/vnd.github+json",
              "x-github-api-version": "2022-11-28",
              "user-agent": "gradient"
            }),
            token ? HttpClientRequest.bearerToken(token) : (r) => r
          )
        )
      )
      const ok = HttpClient.filterStatusOk(client)
      const disabled = Effect.fail(
        new GithubError({ message: "GitHub is not configured. Set GITHUB_TOKEN or run `gh auth login`." })
      )
      const guard = <A>(effect: Effect.Effect<A, GithubError>) => (config.enabled ? effect : disabled)

      const decodeIssue = HttpClientResponse.schemaBodyJson(GhIssue)

      return GithubClient.of({
        enabled: config.enabled,
        viewer: guard(
          ok.get("/user").pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(GhUser)),
            Effect.map((u) => ({ login: u.login, avatarUrl: u.avatar_url ?? null })),
            Effect.mapError(toError("Reading the GitHub user failed"))
          )
        ),
        getRepo: (owner, repo) =>
          guard(
            client.get(`/repos/${owner}/${repo}`).pipe(
              Effect.flatMap((res) =>
                res.status === 200
                  ? Effect.void
                  : Effect.fail(new GithubError({
                    message: res.status === 404
                      ? `Repository ${owner}/${repo} was not found, or the token cannot see it.`
                      : `GitHub answered ${res.status} for ${owner}/${repo}.`
                  }))
              ),
              Effect.catchTag("HttpClientError", (e) => Effect.fail(toError("Reaching GitHub failed")(e)))
            )
          ),
        listIssues: (owner, repo, { since, etag, page }) =>
          guard(
            Effect.gen(function*() {
              const req = HttpClientRequest.get(`/repos/${owner}/${repo}/issues`).pipe(
                HttpClientRequest.setUrlParams({
                  state: "all",
                  sort: "updated",
                  direction: "asc",
                  per_page: "100",
                  page: String(page),
                  ...(since ? { since } : {})
                }),
                etag ? HttpClientRequest.setHeader("if-none-match", etag) : (r) => r
              )
              const res = yield* client.execute(req)
              if (res.status === 304) return { _tag: "NotModified" } as const
              if (res.status !== 200) {
                return yield* new GithubError({ message: `Listing issues of ${owner}/${repo} failed (${res.status})` })
              }
              const issues = yield* HttpClientResponse.schemaBodyJson(Schema.Array(GhIssue))(res)
              return {
                _tag: "Page",
                issues,
                etag: res.headers["etag"] ?? null,
                hasNext: /rel="next"/.test(res.headers["link"] ?? "")
              } as const
            }).pipe(Effect.mapError((e) => (e instanceof GithubError ? e : toError("Listing issues failed")(e))))
          ),
        createIssue: (owner, repo, body) =>
          guard(
            HttpClientRequest.post(`/repos/${owner}/${repo}/issues`).pipe(
              HttpClientRequest.bodyJsonUnsafe(body),
              ok.execute,
              Effect.flatMap(decodeIssue),
              Effect.mapError(toError(`Creating an issue in ${owner}/${repo} failed`))
            )
          ),
        updateIssue: (owner, repo, number, body) =>
          guard(
            HttpClientRequest.patch(`/repos/${owner}/${repo}/issues/${number}`).pipe(
              HttpClientRequest.bodyJsonUnsafe(body),
              ok.execute,
              Effect.flatMap(decodeIssue),
              Effect.mapError(toError(`Updating ${owner}/${repo}#${number} failed`))
            )
          )
      })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
