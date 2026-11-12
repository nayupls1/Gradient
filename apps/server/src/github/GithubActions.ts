import {
  type DraftReviewComment,
  type GithubAccount,
  GithubError,
  type MergeMethod,
  type PullRequestActivity,
  type PullRequestDetail,
  type ReviewEvent
} from "@gradient/domain"
import { Context, Effect, Layer } from "effect"
import { Db } from "../db/Db.ts"
import { type Acting, GithubAuth } from "./GithubAuth.ts"
import { GithubClient } from "./GithubClient.ts"
import { GithubSync } from "./GithubSync.ts"

/*
 * What a person does on GitHub from Gradient: comment on issues and pull
 * requests, review, merge. Each goes out as their own GitHub account
 * (GithubAuth.personal), so GitHub shows who did it and enforces its own
 * permissions and branch protection. The browser (RPC) and agents (MCP) call
 * the same functions.
 */

export interface PullRequestRef {
  readonly owner: string
  readonly repo: string
  readonly number: number
}

const NOT_CONNECTED =
  "Connect your GitHub account first (Profile → GitHub): comments, reviews and merges go out as you."

export class GithubActions extends Context.Service<GithubActions, {
  /** Who the user acts as on GitHub, their own account, and a sign-in waiting for them. */
  account(userId: string): Effect.Effect<GithubAccount>
  /** A pull request, read as the user when they are connected (so their private repositories show). */
  readPullRequest(userId: string, ref: PullRequestRef): Effect.Effect<PullRequestDetail, GithubError>
  commentOnPullRequest(userId: string, ref: PullRequestRef, body: string): Effect.Effect<PullRequestActivity, GithubError>
  review(userId: string, ref: PullRequestRef, review: {
    readonly event: ReviewEvent
    readonly body: string
    /** The commit the inline comments were written against; the head when omitted. */
    readonly commitSha?: string | undefined
    readonly comments: ReadonlyArray<DraftReviewComment>
  }): Effect.Effect<void, GithubError>
  /** Merge at `sha`, or at the current head when omitted. */
  merge(userId: string, ref: PullRequestRef, merge: {
    readonly method?: MergeMethod | undefined
    readonly sha?: string | undefined
  }): Effect.Effect<{ readonly sha: string; readonly method: MergeMethod }, GithubError>
  /** Comment on an issue's GitHub copy. The comment is stored at once, as sync would store it. */
  commentOnIssue(userId: string, issueId: string, body: string): Effect.Effect<void, GithubError>
}>()("gradient/GithubActions") {
  static readonly layer = Layer.effect(
    GithubActions,
    Effect.gen(function*() {
      const db = yield* Db
      const auth = yield* GithubAuth
      const client = yield* GithubClient
      const sync = yield* GithubSync

      const acting = (userId: string): Effect.Effect<Acting, GithubError> =>
        Effect.flatMap(auth.personal.actingAs(userId), (a) => (a ? Effect.succeed(a) : Effect.fail(new GithubError({ message: NOT_CONNECTED }))))

      const nonEmpty = (body: string, what: string) =>
        body.trim() === "" ? Effect.fail(new GithubError({ message: `Write ${what} first.` })) : Effect.void

      const readPullRequest = (userId: string, ref: PullRequestRef) =>
        Effect.flatMap(auth.personal.actingAs(userId), (a) => client.getPullRequest(ref.owner, ref.repo, ref.number, a?.token))

      return GithubActions.of({
        account: (userId) =>
          Effect.gen(function*() {
            const a = yield* auth.personal.actingAs(userId)
            return {
              actingAs: a ? { login: a.login, avatarUrl: a.avatarUrl, via: a.via } : null,
              personal: yield* auth.personal.account(userId),
              pending: yield* auth.personal.pending(userId),
              signInAvailable: auth.signInAvailable
            }
          }),

        readPullRequest,

        commentOnPullRequest: (userId, ref, body) =>
          Effect.gen(function*() {
            yield* nonEmpty(body, "a comment")
            const a = yield* acting(userId)
            const c = yield* client.createComment(a.token, ref.owner, ref.repo, ref.number, body)
            return {
              kind: "comment",
              author: c.user?.login ?? a.login,
              authorAvatarUrl: c.user?.avatar_url ?? a.avatarUrl,
              reviewState: null,
              body: c.body ?? body,
              url: c.html_url,
              createdAt: Date.parse(c.created_at)
            } satisfies PullRequestActivity
          }),

        review: (userId, ref, review) =>
          Effect.gen(function*() {
            if (review.event === "request_changes") yield* nonEmpty(review.body, "what should change")
            if (review.event === "comment" && review.body.trim() === "" && review.comments.length === 0) {
              return yield* new GithubError({ message: "A comment review needs a summary or an inline comment." })
            }
            const a = yield* acting(userId)
            const commitSha = review.commitSha ?? (yield* client.getPullRequest(ref.owner, ref.repo, ref.number, a.token)).headSha
            yield* client.submitReview(a.token, ref.owner, ref.repo, ref.number, { ...review, commitSha })
          }),

        merge: (userId, ref, merge) =>
          Effect.gen(function*() {
            const a = yield* acting(userId)
            const pr = yield* client.getPullRequest(ref.owner, ref.repo, ref.number, a.token)
            if (pr.state === "merged") return yield* new GithubError({ message: `${ref.owner}/${ref.repo}#${ref.number} is already merged.` })
            if (pr.state === "closed") return yield* new GithubError({ message: `${ref.owner}/${ref.repo}#${ref.number} is closed.` })
            const method = merge.method ?? pr.mergeMethods[0] ?? "merge"
            if (!pr.mergeMethods.includes(method)) {
              return yield* new GithubError({
                message: `${ref.owner}/${ref.repo} does not allow ${method} merges. Allowed: ${pr.mergeMethods.join(", ") || "none"}.`
              })
            }
            const done = yield* client.mergePullRequest(a.token, ref.owner, ref.repo, ref.number, { method, sha: merge.sha ?? pr.headSha })
            return { sha: done.sha, method }
          }),

        commentOnIssue: (userId, issueId, body) =>
          Effect.gen(function*() {
            yield* nonEmpty(body, "a comment")
            const issue = yield* db.getIssue(issueId).pipe(Effect.orDie)
            if (!issue) return yield* new GithubError({ message: "That issue does not exist." })
            if (!(yield* db.membership(issue.teamId, userId).pipe(Effect.orDie))) {
              return yield* new GithubError({ message: "Only people in the issue's team can comment on it." })
            }
            const gh = issue.github
            if (!gh) return yield* new GithubError({ message: "This issue is not on GitHub, so it has no comments." })
            const a = yield* acting(userId)
            const comment = yield* client.createComment(a.token, gh.owner, gh.repo, gh.number, body)
            // Store it now, the way the poller would, so it shows without waiting for the next poll.
            const repo = (yield* db.githubRepos.pipe(Effect.orDie)).find((r) =>
              r.owner.toLowerCase() === gh.owner.toLowerCase() && r.name.toLowerCase() === gh.repo.toLowerCase()
            )
            if (repo) yield* sync.ingestComment(repo, comment)
          })
      })
    })
  )
}
