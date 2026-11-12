import { GithubError, type PullRequestCheckStatus, type PullRequestDetail, type PullRequestReviewState } from "@gradient/domain"
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

/** A comment on an issue or pull request (the issues endpoints treat both alike). */
export const GhComment = Schema.Struct({
  id: Schema.Int,
  html_url: Schema.String,
  /** API URL of the issue it is on; it ends in the issue's number. */
  issue_url: Schema.String,
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  user: Schema.NullOr(GhUser),
  created_at: Schema.String,
  updated_at: Schema.String
})
export type GhComment = typeof GhComment.Type

/** A pull request on an issue's "Development" list, as GraphQL reports it. */
export interface GhLinkedPullRequest {
  readonly owner: string
  readonly repo: string
  readonly number: number
  readonly title: string
  readonly url: string
  readonly state: "open" | "draft" | "merged" | "closed"
  readonly author: string | null
  readonly updatedAt: string
}

const GhGraphqlPullRequest = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: Schema.String,
  isDraft: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  updatedAt: Schema.String,
  author: Schema.optionalKey(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
  repository: Schema.Struct({ name: Schema.String, owner: Schema.Struct({ login: Schema.String }) })
})
const GhGraphqlIssue = Schema.NullOr(Schema.Struct({
  closedByPullRequestsReferences: Schema.NullOr(Schema.Struct({
    nodes: Schema.NullOr(Schema.Array(Schema.NullOr(GhGraphqlPullRequest)))
  }))
}))
const GhLinkedResponse = Schema.Struct({
  data: Schema.optionalKey(Schema.NullOr(Schema.Struct({
    repository: Schema.NullOr(Schema.Record(Schema.String, GhGraphqlIssue))
  }))),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String })))
})

const GhPull = Schema.Struct({
  number: Schema.Int,
  html_url: Schema.String,
  title: Schema.String,
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  state: Schema.Literals(["open", "closed"]),
  draft: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  merged: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  merged_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  closed_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
  updated_at: Schema.String,
  user: Schema.NullOr(GhUser),
  head: Schema.Struct({ ref: Schema.String, sha: Schema.String }),
  base: Schema.Struct({ ref: Schema.String }),
  mergeable: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  additions: Schema.optionalKey(Schema.Int),
  deletions: Schema.optionalKey(Schema.Int),
  changed_files: Schema.optionalKey(Schema.Int),
  commits: Schema.optionalKey(Schema.Int),
  labels: Schema.optionalKey(Schema.Array(GhLabel)),
  requested_reviewers: Schema.optionalKey(Schema.NullOr(Schema.Array(GhUser))),
  requested_teams: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Struct({ slug: Schema.String }))))
})
const GhPullFile = Schema.Struct({
  filename: Schema.String,
  previous_filename: Schema.optionalKey(Schema.NullOr(Schema.String)),
  status: Schema.Literals(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]),
  additions: Schema.Int,
  deletions: Schema.Int,
  patch: Schema.optionalKey(Schema.NullOr(Schema.String))
})
const GhReview = Schema.Struct({
  user: Schema.NullOr(GhUser),
  state: Schema.String,
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  html_url: Schema.String,
  submitted_at: Schema.optionalKey(Schema.NullOr(Schema.String))
})
const GhCheckRuns = Schema.Struct({
  check_runs: Schema.Array(Schema.Struct({
    name: Schema.String,
    status: Schema.String,
    conclusion: Schema.optionalKey(Schema.NullOr(Schema.String)),
    html_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
    details_url: Schema.optionalKey(Schema.NullOr(Schema.String))
  }))
})
const GhCombinedStatus = Schema.Struct({
  statuses: Schema.Array(Schema.Struct({
    context: Schema.String,
    state: Schema.String,
    target_url: Schema.optionalKey(Schema.NullOr(Schema.String))
  }))
})

/** A check run's status and conclusion, as one word. */
export const checkRunStatus = (status: string, conclusion: string | null): PullRequestCheckStatus => {
  if (status !== "completed") return "pending"
  switch (conclusion) {
    case "success":
      return "success"
    case "failure":
    case "timed_out":
    case "startup_failure":
      return "failure"
    case "action_required":
      return "pending"
    case "cancelled":
      return "cancelled"
    case "skipped":
      return "skipped"
    default:
      return "neutral"
  }
}

const commitStatus = (state: string): PullRequestCheckStatus =>
  state === "success" ? "success" : state === "pending" ? "pending" : "failure"

const reviewState = (state: string): PullRequestReviewState => {
  switch (state) {
    case "APPROVED":
      return "approved"
    case "CHANGES_REQUESTED":
      return "changes_requested"
    case "DISMISSED":
      return "dismissed"
    case "PENDING":
      return "pending"
    default:
      return "commented"
  }
}

/** How many pages of changed files a pull request page reads (100 each). */
const FILE_PAGES = 10

/** How many issues one GraphQL request asks about. */
export const LINKED_BATCH = 50

/**
 * The base URL `/graphql` hangs off: the REST base on github.com, its parent on
 * Enterprise Server (REST at /api/v3, GraphQL at /api/graphql).
 */
export const graphqlBaseFor = (apiUrl: string) => apiUrl.replace(/\/$/, "").replace(/(\/api)\/v3$/, "$1")

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

export type CommentsResult =
  | { readonly _tag: "NotModified" }
  | { readonly _tag: "Page"; readonly comments: ReadonlyArray<GhComment>; readonly etag: string | null; readonly hasNext: boolean }

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
  /** Comments on every issue and pull request of a repository, oldest update first. */
  listComments(owner: string, repo: string, options: {
    readonly since: string | null
    readonly etag: string | null
    readonly page: number
  }): Effect.Effect<CommentsResult, GithubError>
  createIssue(owner: string, repo: string, body: IssueWrite): Effect.Effect<GhIssue, GithubError>
  updateIssue(owner: string, repo: string, number: number, body: IssueWrite): Effect.Effect<GhIssue, GithubError>
  getIssue(owner: string, repo: string, number: number): Effect.Effect<GhIssue, GithubError>
  /** The issues blocking one issue (GitHub's issue dependencies). */
  listBlockedBy(owner: string, repo: string, number: number): Effect.Effect<ReadonlyArray<GhIssue>, GithubError>
  addBlockedBy(owner: string, repo: string, number: number, blockerId: number): Effect.Effect<void, GithubError>
  /** Succeeds when the dependency is already gone. */
  removeBlockedBy(owner: string, repo: string, number: number, blockerId: number): Effect.Effect<void, GithubError>
  /**
   * The pull requests on each issue's "Development" list (closing keywords or
   * linked by hand, in any repository the token can see), by issue number.
   * Issues GitHub does not know are left out of the map. Only REST covers the
   * rest of Gradient; this list exists in GraphQL alone.
   */
  linkedPullRequests(
    owner: string,
    repo: string,
    numbers: ReadonlyArray<number>
  ): Effect.Effect<ReadonlyMap<number, ReadonlyArray<GhLinkedPullRequest>>, GithubError>
  /**
   * One pull request with its changed files, checks, reviews and comments, in
   * any repository the token can see. Checks, reviews and comments are left
   * empty when the token may not read them; the pull request itself must load.
   */
  getPullRequest(owner: string, repo: string, number: number): Effect.Effect<PullRequestDetail, GithubError>
}>()("gradient/GithubClient") {
  static readonly layer = Layer.effect(
    GithubClient,
    Effect.gen(function*() {
      const config = (yield* ServerConfig).github
      const auth = yield* GithubAuth
      const authed = (base: HttpClient.HttpClient, prefix: string) =>
        base.pipe(
          HttpClient.mapRequest((req) => {
            // Read per request, so a sign-in or sign-out applies to the next call.
            const token = auth.tokenUnsafe()
            return req.pipe(
              HttpClientRequest.prependUrl(prefix),
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
      const base = yield* HttpClient.HttpClient
      const client = authed(base, config.apiUrl)
      const ok = HttpClient.filterStatusOk(client)
      // GraphQL lives beside the REST base, not under it (Enterprise Server: /api/graphql next to /api/v3).
      const graphql = HttpClient.filterStatusOk(authed(base, graphqlBaseFor(config.apiUrl)))
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
        params: Record<string, string> = {},
        maxPages = 20
      ) =>
        Effect.gen(function*() {
          const all: Array<A> = []
          for (let page = 1; page <= maxPages; page++) {
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

      const linkedBatch = (owner: string, repo: string, numbers: ReadonlyArray<number>) =>
        Effect.gen(function*() {
          const fields = numbers.map((n) =>
            `i${n}: issue(number: ${n}) { closedByPullRequestsReferences(first: 25, includeClosedPrs: true) { nodes {
              number title url state isDraft updatedAt author { login } repository { name owner { login } } } } }`
          )
          const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields.join("\n")} } }`
          const res = yield* HttpClientRequest.post("/graphql").pipe(
            HttpClientRequest.bodyJsonUnsafe({ query, variables: { owner, name: repo } }),
            graphql.execute
          )
          const body = yield* HttpClientResponse.schemaBodyJson(GhLinkedResponse)(res)
          const issues = body.data?.repository
          // Partial answers are normal (an issue number that is a pull request): keep what came back.
          if (!issues) throw new Error(body.errors?.map((e) => e.message).join("; ") ?? "no data")
          const out = new Map<number, ReadonlyArray<GhLinkedPullRequest>>()
          for (const n of numbers) {
            const issue = issues[`i${n}`]
            if (!issue) continue
            const nodes = issue.closedByPullRequestsReferences?.nodes ?? []
            out.set(n, nodes.flatMap((pr) => pr ? [{
              owner: pr.repository.owner.login,
              repo: pr.repository.name,
              number: pr.number,
              title: pr.title,
              url: pr.url,
              state: pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "open",
              author: pr.author?.login ?? null,
              updatedAt: pr.updatedAt
            } as const] : []))
          }
          return out
        })

      const millis = (iso: string) => Date.parse(iso)
      const optionalMillis = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null)

      const pullRequest = (owner: string, repo: string, number: number) =>
        Effect.gen(function*() {
          const base = `/repos/${owner}/${repo}`
          const res = yield* client.get(`${base}/pulls/${number}`)
          if (res.status === 404) {
            return yield* new GithubError({
              message: `${owner}/${repo}#${number} is not a pull request, or GitHub does not let Gradient see it.`
            })
          }
          if (res.status !== 200) {
            return yield* new GithubError({ message: `GitHub answered ${res.status} for ${owner}/${repo}#${number}.` })
          }
          const pr = yield* HttpClientResponse.schemaBodyJson(GhPull)(res)
          // Everything past the pull request itself is best effort: a token may lack checks or reviews.
          const optional = <A>(effect: Effect.Effect<ReadonlyArray<A>, unknown>) =>
            effect.pipe(Effect.orElseSucceed((): ReadonlyArray<A> => []))
          const [files, checkRuns, statuses, reviews, comments] = yield* Effect.all([
            pages(`${base}/pulls/${number}/files`, HttpClientResponse.schemaBodyJson(Schema.Array(GhPullFile)), {}, FILE_PAGES),
            optional(
              ok.get(`${base}/commits/${pr.head.sha}/check-runs`, { urlParams: { per_page: "100" } }).pipe(
                Effect.flatMap(HttpClientResponse.schemaBodyJson(GhCheckRuns)),
                Effect.map((b) => b.check_runs)
              )
            ),
            optional(
              ok.get(`${base}/commits/${pr.head.sha}/status`).pipe(
                Effect.flatMap(HttpClientResponse.schemaBodyJson(GhCombinedStatus)),
                Effect.map((b) => b.statuses)
              )
            ),
            optional(pages(`${base}/pulls/${number}/reviews`, HttpClientResponse.schemaBodyJson(Schema.Array(GhReview)))),
            optional(pages(`${base}/issues/${number}/comments`, HttpClientResponse.schemaBodyJson(Schema.Array(GhComment))))
          ], { concurrency: "unbounded" })
          const activity: Array<PullRequestDetail["activity"][number]> = [
            ...reviews
              // A bare "commented" review is the wrapper of inline comments: nothing to show on its own.
              .filter((r) => r.submitted_at && (r.state !== "COMMENTED" || (r.body ?? "").trim() !== ""))
              .map((r) => ({
                kind: "review" as const,
                author: r.user?.login ?? null,
                authorAvatarUrl: r.user?.avatar_url ?? null,
                reviewState: reviewState(r.state),
                body: r.body ?? "",
                url: r.html_url,
                createdAt: millis(r.submitted_at!)
              })),
            ...comments.map((c) => ({
              kind: "comment" as const,
              author: c.user?.login ?? null,
              authorAvatarUrl: c.user?.avatar_url ?? null,
              reviewState: null,
              body: c.body ?? "",
              url: c.html_url,
              createdAt: millis(c.created_at)
            }))
          ].sort((a, b) => a.createdAt - b.createdAt)
          const merged = pr.merged === true || (pr.merged_at ?? null) !== null
          return {
            owner,
            repo,
            number: pr.number,
            url: pr.html_url,
            title: pr.title,
            body: pr.body ?? "",
            state: merged ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open",
            author: pr.user?.login ?? null,
            authorAvatarUrl: pr.user?.avatar_url ?? null,
            baseBranch: pr.base.ref,
            headBranch: pr.head.ref,
            mergeable: pr.mergeable ?? null,
            additions: pr.additions ?? files.reduce((n, f) => n + f.additions, 0),
            deletions: pr.deletions ?? files.reduce((n, f) => n + f.deletions, 0),
            changedFiles: pr.changed_files ?? files.length,
            commits: pr.commits ?? 0,
            labels: (pr.labels ?? []).map((l) => ({ name: labelName(l), color: labelColor(l) })),
            requestedReviewers: [
              ...(pr.requested_reviewers ?? []).map((u) => u.login),
              ...(pr.requested_teams ?? []).map((t) => t.slug)
            ],
            createdAt: millis(pr.created_at),
            updatedAt: millis(pr.updated_at),
            mergedAt: optionalMillis(pr.merged_at),
            closedAt: optionalMillis(pr.closed_at),
            files: files.map((f) => ({
              path: f.filename,
              previousPath: f.previous_filename ?? null,
              status: f.status,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch ?? null
            })),
            checks: [
              ...checkRuns.map((c) => ({
                name: c.name,
                status: checkRunStatus(c.status, c.conclusion ?? null),
                url: c.html_url ?? c.details_url ?? null
              })),
              ...statuses.map((st) => ({ name: st.context, status: commitStatus(st.state), url: st.target_url ?? null }))
            ],
            activity
          } satisfies PullRequestDetail
        }).pipe(Effect.mapError((e) => (e instanceof GithubError ? e : toError(`Reading ${owner}/${repo}#${number} failed`)(e))))

      return GithubClient.of({
        ready,
        getPullRequest: (owner, repo, number) => guard(pullRequest(owner, repo, number)),
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
        listComments: (owner, repo, { since, etag, page }) =>
          guard(
            Effect.gen(function*() {
              const req = HttpClientRequest.get(`/repos/${owner}/${repo}/issues/comments`).pipe(
                HttpClientRequest.setUrlParams({
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
                return yield* new GithubError({ message: `Listing comments of ${owner}/${repo} failed (${res.status})` })
              }
              const comments = yield* HttpClientResponse.schemaBodyJson(Schema.Array(GhComment))(res)
              return {
                _tag: "Page",
                comments,
                etag: res.headers["etag"] ?? null,
                hasNext: /rel="next"/.test(res.headers["link"] ?? "")
              } as const
            }).pipe(Effect.mapError((e) => (e instanceof GithubError ? e : toError("Listing comments failed")(e))))
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
          ),
        linkedPullRequests: (owner, repo, numbers) =>
          guard(
            Effect.gen(function*() {
              const all = new Map<number, ReadonlyArray<GhLinkedPullRequest>>()
              for (let i = 0; i < numbers.length; i += LINKED_BATCH) {
                const batch = yield* linkedBatch(owner, repo, numbers.slice(i, i + LINKED_BATCH))
                for (const [n, prs] of batch) all.set(n, prs)
              }
              return all as ReadonlyMap<number, ReadonlyArray<GhLinkedPullRequest>>
            }).pipe(Effect.mapError(toError(`Reading the linked pull requests of ${owner}/${repo} failed`)))
          )
      })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
