import { GithubError } from "@gradient/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { ServerConfig } from "../config.ts"
import { GithubAuth } from "./GithubAuth.ts"
import type { RepoFile } from "./icons.ts"

const GhLabel = Schema.Union([
  Schema.String,
  Schema.Struct({ name: Schema.String, color: Schema.optionalKey(Schema.NullOr(Schema.String)) })
])

const GhUser = Schema.Struct({ login: Schema.String, avatar_url: Schema.optionalKey(Schema.NullOr(Schema.String)) })

const GhInstallations = Schema.Struct({ installations: Schema.Array(Schema.Struct({ id: Schema.Int })) })
const GhRepo = Schema.Struct({
  name: Schema.String,
  private: Schema.Boolean,
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  owner: Schema.Struct({ login: Schema.String })
})
const GhInstallationRepos = Schema.Struct({ repositories: Schema.Array(GhRepo) })
const GhTree = Schema.Struct({
  tree: Schema.Array(Schema.Struct({
    path: Schema.String,
    type: Schema.String,
    sha: Schema.String,
    size: Schema.optionalKey(Schema.Int)
  })),
  truncated: Schema.optionalKey(Schema.Boolean)
})
const GhBlob = Schema.Struct({ content: Schema.String, encoding: Schema.String, size: Schema.Int })

export interface AvailableRepo {
  readonly owner: string
  readonly name: string
  readonly private: boolean
  readonly description: string | null
}
const toAvailable = (r: typeof GhRepo.Type): AvailableRepo => ({
  owner: r.owner.login,
  name: r.name,
  private: r.private,
  description: r.description ?? null
})

export const GhIssue = Schema.Struct({
  /** Global id. Dependencies are written with it, not with the number. */
  id: Schema.optionalKey(Schema.Int),
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
  /** Present on pull requests, which the issues endpoint lists too. */
  pull_request: Schema.optionalKey(Schema.Struct({ merged_at: Schema.optionalKey(Schema.NullOr(Schema.String)) })),
  draft: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  issue_dependencies_summary: Schema.optionalKey(Schema.Struct({
    blocked_by: Schema.optionalKey(Schema.Int),
    total_blocked_by: Schema.optionalKey(Schema.Int)
  }))
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
  /** True while there is a token to call GitHub with (it can change at runtime). */
  ready(): boolean
  /**
   * Repositories the connected account can link. With an app sign-in, the ones
   * the app is installed on (alphabetical); with a token, every repository it
   * can see, most recently pushed first.
   */
  readonly availableRepos: Effect.Effect<ReadonlyArray<AvailableRepo>, GithubError>
  getRepo(owner: string, repo: string): Effect.Effect<void, GithubError>
  /** Every file on the default branch (GitHub stops at about 100,000 entries). */
  listFiles(owner: string, repo: string): Effect.Effect<ReadonlyArray<RepoFile>, GithubError>
  /** The bytes of one file, by blob sha. */
  getBlob(owner: string, repo: string, sha: string): Effect.Effect<Uint8Array, GithubError>
  listIssues(owner: string, repo: string, options: {
    readonly since: string | null
    readonly etag: string | null
    readonly page: number
  }): Effect.Effect<ListResult, GithubError>
  createIssue(owner: string, repo: string, body: IssueWrite): Effect.Effect<GhIssue, GithubError>
  updateIssue(owner: string, repo: string, number: number, body: IssueWrite): Effect.Effect<GhIssue, GithubError>
  getIssue(owner: string, repo: string, number: number): Effect.Effect<GhIssue, GithubError>
  /** The issues blocking one issue (GitHub's issue dependencies). */
  listBlockedBy(owner: string, repo: string, number: number): Effect.Effect<ReadonlyArray<GhIssue>, GithubError>
  addBlockedBy(owner: string, repo: string, number: number, blockerId: number): Effect.Effect<void, GithubError>
  /** Succeeds when the dependency is already gone. */
  removeBlockedBy(owner: string, repo: string, number: number, blockerId: number): Effect.Effect<void, GithubError>
}>()("gradient/GithubClient") {
  static readonly layer = Layer.effect(
    GithubClient,
    Effect.gen(function*() {
      const config = (yield* ServerConfig).github
      const auth = yield* GithubAuth
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest((req) => {
          // Read per request, so a sign-in or sign-out applies to the next call.
          const token = auth.tokenUnsafe()
          return req.pipe(
            HttpClientRequest.prependUrl(config.apiUrl),
            HttpClientRequest.setHeaders({
              accept: "application/vnd.github+json",
              "x-github-api-version": "2022-11-28",
              "user-agent": "gradient"
            }),
            token ? HttpClientRequest.bearerToken(token) : (r) => r
          )
        }),
        // An expired or revoked sign-in: drop it, so the UI asks to sign in again.
        HttpClient.tap((res) => {
          const sent = res.request.headers["authorization"]?.replace(/^Bearer /, "")
          return res.status === 401 && sent ? auth.rejected(sent) : Effect.void
        })
      )
      const ok = HttpClient.filterStatusOk(client)
      const disabled = Effect.fail(
        new GithubError({
          message: "GitHub is not connected. Sign in with GitHub in Settings, set GITHUB_TOKEN, or run `gh auth login`."
        })
      )
      const ready = () => config.enabled && auth.tokenUnsafe() !== null
      const guard = <A>(effect: Effect.Effect<A, GithubError>) => Effect.suspend(() => (ready() ? effect : disabled))

      /** Follow `Link: rel="next"` pages of one endpoint. */
      const pages = <A>(
        path: string,
        decode: (res: HttpClientResponse.HttpClientResponse) => Effect.Effect<ReadonlyArray<A>, unknown>,
        params: Record<string, string> = {}
      ) =>
        Effect.gen(function*() {
          const all: Array<A> = []
          for (let page = 1; page <= 20; page++) {
            const res = yield* ok.execute(
              HttpClientRequest.get(path).pipe(
                HttpClientRequest.setUrlParams({ ...params, per_page: "100", page: String(page) })
              )
            )
            all.push(...(yield* decode(res)))
            if (!/rel="next"/.test(res.headers["link"] ?? "")) break
          }
          return all
        })

      const decodeIssue = HttpClientResponse.schemaBodyJson(GhIssue)

      return GithubClient.of({
        ready,
        availableRepos: guard(
          Effect.gen(function*() {
            if ((yield* auth.source) !== "app") {
              const repos = yield* pages("/user/repos", HttpClientResponse.schemaBodyJson(Schema.Array(GhRepo)), {
                affiliation: "owner,collaborator,organization_member",
                sort: "pushed"
              })
              return repos.map(toAvailable)
            }
            // A user token from the app sees only what the app is installed on.
            const installations = yield* pages("/user/installations", (res) =>
              HttpClientResponse.schemaBodyJson(GhInstallations)(res).pipe(Effect.map((b) => b.installations)))
            const repos: Array<AvailableRepo> = []
            for (const installation of installations) {
              const list = yield* pages(`/user/installations/${installation.id}/repositories`, (res) =>
                HttpClientResponse.schemaBodyJson(GhInstallationRepos)(res).pipe(Effect.map((b) => b.repositories)))
              repos.push(...list.map(toAvailable))
            }
            return repos.sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`))
          }).pipe(Effect.mapError(toError("Listing your GitHub repositories failed")))
        ),
        getRepo: (owner, repo) =>
          guard(
            client.get(`/repos/${owner}/${repo}`).pipe(
              Effect.flatMap((res) =>
                res.status === 200
                  ? Effect.void
                  : Effect.fail(new GithubError({
                    message: res.status === 404
                      ? `Repository ${owner}/${repo} was not found, or Gradient cannot see it. If you signed in with GitHub, install the app on it.`
                      : `GitHub answered ${res.status} for ${owner}/${repo}.`
                  }))
              ),
              Effect.catchTag("HttpClientError", (e) => Effect.fail(toError("Reaching GitHub failed")(e)))
            )
          ),
        listFiles: (owner, repo) =>
          guard(
            HttpClientRequest.get(`/repos/${owner}/${repo}/git/trees/HEAD`).pipe(
              HttpClientRequest.setUrlParams({ recursive: "1" }),
              ok.execute,
              Effect.flatMap(HttpClientResponse.schemaBodyJson(GhTree)),
              Effect.map((tree) =>
                tree.tree
                  .filter((e) => e.type === "blob")
                  .map((e): RepoFile => ({ path: e.path, sha: e.sha, size: e.size ?? 0 }))
              ),
              Effect.mapError(toError(`Listing the files of ${owner}/${repo} failed`))
            )
          ),
        getBlob: (owner, repo, sha) =>
          guard(
            ok.get(`/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(sha)}`).pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(GhBlob)),
              Effect.flatMap((blob) =>
                blob.encoding === "base64"
                  ? Effect.succeed(Uint8Array.from(Buffer.from(blob.content, "base64")))
                  : Effect.fail(new Error(`unexpected encoding ${blob.encoding}`))
              ),
              Effect.mapError(toError(`Reading a file of ${owner}/${repo} failed`))
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
          ),
        getIssue: (owner, repo, number) =>
          guard(
            ok.get(`/repos/${owner}/${repo}/issues/${number}`).pipe(
              Effect.flatMap(decodeIssue),
              Effect.mapError(toError(`Reading ${owner}/${repo}#${number} failed`))
            )
          ),
        listBlockedBy: (owner, repo, number) =>
          guard(
            pages(`/repos/${owner}/${repo}/issues/${number}/dependencies/blocked_by`, HttpClientResponse.schemaBodyJson(Schema.Array(GhIssue))).pipe(
              Effect.mapError(toError(`Reading what blocks ${owner}/${repo}#${number} failed`))
            )
          ),
        addBlockedBy: (owner, repo, number, blockerId) =>
          guard(
            HttpClientRequest.post(`/repos/${owner}/${repo}/issues/${number}/dependencies/blocked_by`).pipe(
              HttpClientRequest.bodyJsonUnsafe({ issue_id: blockerId }),
              ok.execute,
              Effect.asVoid,
              Effect.mapError(toError(`Marking ${owner}/${repo}#${number} as blocked failed`))
            )
          ),
        removeBlockedBy: (owner, repo, number, blockerId) =>
          guard(
            client.del(`/repos/${owner}/${repo}/issues/${number}/dependencies/blocked_by/${blockerId}`).pipe(
              Effect.flatMap((res) =>
                res.status < 300 || res.status === 404
                  ? Effect.void
                  : Effect.fail(new Error(`GitHub answered ${res.status}`))
              ),
              Effect.mapError(toError(`Removing a blocker from ${owner}/${repo}#${number} failed`))
            )
          )
      })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
