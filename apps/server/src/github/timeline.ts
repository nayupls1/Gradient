import type { PullRequestReviewState, PullRequestTimelineItem } from "@gradient/domain"

/*
 * GitHub's issue timeline (`GET /repos/{owner}/{repo}/issues/{n}/timeline`)
 * as the pull request page's Timeline shows it. GitHub's events come in many
 * shapes; this reads the ones worth showing and skips the rest (subscribed,
 * mentioned, deployments…). Pure, so it is unit tested on raw payloads.
 */

type Raw = Record<string, unknown>

const obj = (v: unknown): Raw | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null)
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number | null => (typeof v === "number" ? v : null)
const time = (v: unknown): number | null => {
  const s = str(v)
  const t = s ? Date.parse(s) : NaN
  return Number.isNaN(t) ? null : t
}

const reviewState = (state: string | null): PullRequestReviewState => {
  switch (state?.toLowerCase()) {
    case "approved":
      return "approved"
    case "changes_requested":
      return "changes_requested"
    case "dismissed":
      return "dismissed"
    case "pending":
      return "pending"
    default:
      return "commented"
  }
}

const base = (kind: PullRequestTimelineItem["kind"], at: number): PullRequestTimelineItem => ({
  kind,
  actor: null,
  actorAvatarUrl: null,
  at,
  body: null,
  url: null,
  sha: null,
  reviewState: null,
  label: null,
  subject: null,
  detail: null
})

/** `actor`, `user` or `author` as login and avatar. */
const who = (e: Raw, key: "actor" | "user" = "actor") => {
  const u = obj(e[key]) ?? obj(e.user) ?? obj(e.actor)
  return { actor: str(u?.login), actorAvatarUrl: str(u?.avatar_url) }
}

const SIMPLE: Record<string, PullRequestTimelineItem["kind"]> = {
  merged: "merged",
  closed: "closed",
  reopened: "reopened",
  ready_for_review: "ready",
  convert_to_draft: "draft",
  head_ref_force_pushed: "force_pushed",
  head_ref_deleted: "branch_deleted"
}

/** One raw timeline event as zero or more items (a batch of inline comments is several). */
export const timelineItems = (raw: unknown): Array<PullRequestTimelineItem> => {
  const e = obj(raw)
  const event = str(e?.event)
  if (!e || !event) return []
  const at = time(e.created_at) ?? time(e.submitted_at)
  switch (event) {
    case "committed": {
      const author = obj(e.author)
      const when = time(author?.date) ?? time(obj(e.committer)?.date)
      if (when === null) return []
      return [{
        ...base("commit", when),
        actor: str(author?.name),
        body: str(e.message)?.split("\n")[0] ?? null,
        url: str(e.html_url),
        sha: str(e.sha)
      }]
    }
    case "commented":
      if (at === null) return []
      return [{ ...base("comment", at), ...who(e, "user"), body: str(e.body) ?? "", url: str(e.html_url) }]
    case "reviewed":
      if (at === null) return []
      return [{
        ...base("review", at),
        ...who(e, "user"),
        body: str(e.body) ?? "",
        url: str(e.html_url),
        reviewState: reviewState(str(e.state))
      }]
    case "line-commented": {
      const comments = Array.isArray(e.comments) ? e.comments : []
      return comments.flatMap((c) => {
        const comment = obj(c)
        const when = time(comment?.created_at)
        if (!comment || when === null) return []
        const line = num(comment.line) ?? num(comment.original_line)
        return [{
          ...base("inline", when),
          ...who(comment, "user"),
          body: str(comment.body) ?? "",
          url: str(comment.html_url),
          subject: `${str(comment.path) ?? "a file"}${line !== null ? `:${line}` : ""}`
        }]
      })
    }
    case "labeled":
    case "unlabeled": {
      const label = obj(e.label)
      if (at === null || !str(label?.name)) return []
      return [{
        ...base(event, at),
        ...who(e),
        label: { name: str(label!.name)!, color: str(label!.color) }
      }]
    }
    case "review_requested":
    case "review_request_removed": {
      if (at === null) return []
      const subject = str(obj(e.requested_reviewer)?.login) ?? str(obj(e.requested_team)?.name)
      return [{ ...base(event, at), ...who(e), subject }]
    }
    case "assigned":
    case "unassigned":
      if (at === null) return []
      return [{ ...base(event, at), ...who(e), subject: str(obj(e.assignee)?.login) }]
    case "renamed": {
      const rename = obj(e.rename)
      if (at === null) return []
      return [{ ...base("renamed", at), ...who(e), subject: str(rename?.to), detail: str(rename?.from) }]
    }
    case "cross-referenced": {
      const issue = obj(obj(e.source)?.issue)
      if (at === null || !issue) return []
      const repo = str(obj(issue.repository)?.full_name)
      const number = num(issue.number)
      return [{
        ...base("referenced", at),
        ...who(e),
        subject: str(issue.title),
        detail: repo && number !== null ? `${repo}#${number}` : null,
        url: str(issue.html_url)
      }]
    }
    default: {
      const kind = SIMPLE[event]
      if (!kind || at === null) return []
      return [{ ...base(kind, at), ...who(e), sha: str(e.commit_id) }]
    }
  }
}

/**
 * The whole timeline, oldest first, starting with the pull request being
 * opened (which GitHub's timeline leaves out).
 */
export const buildTimeline = (
  opened: { readonly author: string | null; readonly authorAvatarUrl: string | null; readonly at: number },
  raw: ReadonlyArray<unknown>
): Array<PullRequestTimelineItem> =>
  [
    { ...base("opened", opened.at), actor: opened.author, actorAvatarUrl: opened.authorAvatarUrl },
    ...raw.flatMap(timelineItems)
  ].sort((a, b) => a.at - b.at)
