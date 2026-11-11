import { Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { ServerConfig } from "../config.ts"
import { Db } from "../db/Db.ts"
import { GhComment, GhIssue } from "./GithubClient.ts"
import { GithubSync } from "./GithubSync.ts"

const Repository = Schema.Struct({ name: Schema.String, owner: Schema.Struct({ login: Schema.String }) })

const IssuesEvent = Schema.Struct({
  action: Schema.String,
  issue: GhIssue,
  repository: Repository
})

const PullRequestEvent = Schema.Struct({
  action: Schema.String,
  pull_request: Schema.Struct({
    id: Schema.optionalKey(Schema.Int),
    number: Schema.Int,
    html_url: Schema.String,
    title: Schema.String,
    body: Schema.NullOr(Schema.String),
    state: Schema.Literals(["open", "closed"]),
    draft: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
    merged_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
    user: Schema.NullOr(Schema.Struct({ login: Schema.String })),
    updated_at: Schema.String
  }),
  repository: Repository
})

/** A comment was created, edited or deleted, on an issue or a pull request. */
const IssueCommentEvent = Schema.Struct({
  action: Schema.String,
  comment: GhComment,
  repository: Repository
})

/** A "blocked by" edge changed. Only the blocked issue's URL matters: its list is read again. */
const DependencyEvent = Schema.Struct({
  action: Schema.String,
  blocked_issue: Schema.Struct({ html_url: Schema.String })
})

const encoder = new TextEncoder()

/** Constant-time check of GitHub's `X-Hub-Signature-256` header. */
export const verifySignature = async (secret: string, body: string, header: string | undefined) => {
  if (!header?.startsWith("sha256=")) return false
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign"
  ])
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)))
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")
  const given = header.slice("sha256=".length)
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}

/**
 * Receives GitHub webhooks. Locally, forward them with
 * `gh webhook forward --repo owner/name --events issues,issue_comment,pull_request,issue_dependencies --url http://localhost:4100/webhooks/github --secret $GITHUB_WEBHOOK_SECRET`.
 */
export const WebhookRoute = HttpRouter.add(
  "POST",
  "/webhooks/github",
  Effect.gen(function*() {
    const config = yield* ServerConfig
    const secret = Option.getOrNull(config.github.webhookSecret)
    if (!secret) return HttpServerResponse.text("Webhooks are not configured (set GITHUB_WEBHOOK_SECRET)", { status: 503 })
    const request = yield* HttpServerRequest.HttpServerRequest
    const body = yield* request.text
    const valid = yield* Effect.promise(() => verifySignature(secret, body, request.headers["x-hub-signature-256"]))
    if (!valid) return HttpServerResponse.text("Bad signature", { status: 401 })

    const db = yield* Db
    const delivery = request.headers["x-github-delivery"]
    if (delivery) {
      const inserted = yield* db.sql`INSERT OR IGNORE INTO github_delivery (delivery_id, received_at)
                                     VALUES (${delivery}, ${Date.now()}) RETURNING delivery_id`
      if (inserted.length === 0) return HttpServerResponse.text("Duplicate delivery", { status: 200 })
    }

    const event = request.headers["x-github-event"]
    const sync = yield* GithubSync
    const notLinked = HttpServerResponse.text("Repository not linked", { status: 202 })
    if (event === "issues") {
      const payload = yield* Schema.decodeUnknownEffect(IssuesEvent)(JSON.parse(body))
      const repo = yield* db.repoByName(payload.repository.owner.login, payload.repository.name)
      if (!repo) return notLinked
      const outcome = yield* sync.ingest(repo, payload.issue)
      return HttpServerResponse.text(outcome, { status: 202 })
    }
    if (event === "pull_request") {
      const { pull_request: pr, repository } = yield* Schema.decodeUnknownEffect(PullRequestEvent)(JSON.parse(body))
      const repo = yield* db.repoByName(repository.owner.login, repository.name)
      if (!repo) return notLinked
      const outcome = yield* sync.ingest(repo, {
        ...(pr.id !== undefined ? { id: pr.id } : {}),
        number: pr.number,
        html_url: pr.html_url,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        labels: [],
        user: pr.user,
        updated_at: pr.updated_at,
        draft: pr.draft ?? null,
        pull_request: { merged_at: pr.merged_at ?? null }
      })
      return HttpServerResponse.text(outcome, { status: 202 })
    }
    if (event === "issue_comment") {
      const { action, comment, repository } = yield* Schema.decodeUnknownEffect(IssueCommentEvent)(JSON.parse(body))
      const repo = yield* db.repoByName(repository.owner.login, repository.name)
      if (!repo) return notLinked
      if (action === "deleted") {
        yield* sync.removeComment(repo, comment.id)
        return HttpServerResponse.text("comment deleted", { status: 202 })
      }
      const outcome = yield* sync.ingestComment(repo, comment)
      return HttpServerResponse.text(outcome, { status: 202 })
    }
    if (event === "issue_dependencies") {
      const payload = yield* Schema.decodeUnknownEffect(DependencyEvent)(JSON.parse(body))
      const m = payload.blocked_issue.html_url.match(/\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/)
      const repo = m ? yield* db.repoByName(m[1]!, m[2]!) : undefined
      if (!m || !repo) return notLinked
      yield* sync.pullDependencies(repo, Number(m[3]))
      return HttpServerResponse.text("dependencies", { status: 202 })
    }
    return HttpServerResponse.text("Ignored", { status: 202 })
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Webhook failed", cause).pipe(
        Effect.as(HttpServerResponse.text("Webhook failed", { status: 400 }))
      )
    )
  )
)
