import { describe, expect, test } from "bun:test"
import { buildTimeline, timelineItems } from "../src/github/timeline.ts"

const user = (login: string) => ({ login, avatar_url: `https://avatars/${login}` })
const at = "2026-01-02T03:04:05Z"

describe("pull request timeline", () => {
  test("commits, comments and reviews keep what the timeline shows", () => {
    expect(timelineItems({
      event: "committed",
      sha: "abc1234def",
      message: "Queue writes offline\n\nLonger explanation",
      author: { name: "Dev Person", date: at },
      html_url: "https://github.com/acme/web/commit/abc1234def"
    })).toMatchObject([{ kind: "commit", actor: "Dev Person", body: "Queue writes offline", sha: "abc1234def" }])
    expect(timelineItems({ event: "commented", user: user("octo"), body: "Nice", created_at: at, html_url: "u" }))
      .toMatchObject([{ kind: "comment", actor: "octo", actorAvatarUrl: "https://avatars/octo", body: "Nice", url: "u" }])
    expect(timelineItems({ event: "reviewed", user: user("lead"), state: "approved", body: "", submitted_at: at }))
      .toMatchObject([{ kind: "review", actor: "lead", reviewState: "approved", at: Date.parse(at) }])
    // A batch of inline comments is one row each, with where it is.
    expect(timelineItems({
      event: "line-commented",
      comments: [
        { user: user("lead"), body: "Why?", path: "src/a.ts", line: 3, created_at: at },
        { user: user("dev"), body: "Because", path: "src/a.ts", original_line: 3, created_at: at }
      ]
    }).map((i) => [i.kind, i.actor, i.subject])).toEqual([["inline", "lead", "src/a.ts:3"], ["inline", "dev", "src/a.ts:3"]])
  })

  test("what people did to it: labels, review requests, renames, references, merges", () => {
    const item = (raw: object) => timelineItems({ created_at: at, actor: user("octo"), ...raw })[0]
    expect(item({ event: "labeled", label: { name: "bug", color: "d73a4a" } })).toMatchObject({ kind: "labeled", label: { name: "bug", color: "d73a4a" } })
    expect(item({ event: "review_requested", requested_reviewer: user("lead") })).toMatchObject({ kind: "review_requested", subject: "lead" })
    expect(item({ event: "review_requested", requested_team: { name: "Core" } })).toMatchObject({ subject: "Core" })
    expect(item({ event: "renamed", rename: { from: "Old", to: "New" } })).toMatchObject({ kind: "renamed", subject: "New", detail: "Old" })
    expect(item({
      event: "cross-referenced",
      source: { issue: { number: 7, title: "Drafts vanish", html_url: "x", repository: { full_name: "acme/web" } } }
    })).toMatchObject({ kind: "referenced", subject: "Drafts vanish", detail: "acme/web#7" })
    expect(item({ event: "merged", commit_id: "m1" })).toMatchObject({ kind: "merged", actor: "octo", sha: "m1" })
    expect(item({ event: "head_ref_force_pushed" })).toMatchObject({ kind: "force_pushed" })
    expect(item({ event: "convert_to_draft" })).toMatchObject({ kind: "draft" })
  })

  test("events it does not show, and broken ones, are skipped", () => {
    expect(timelineItems({ event: "subscribed", created_at: at })).toEqual([])
    expect(timelineItems({ event: "commented", user: user("octo") })).toEqual([])
    expect(timelineItems(null)).toEqual([])
    expect(timelineItems("nope")).toEqual([])
  })

  test("the whole timeline starts with the opening and runs oldest first", () => {
    const timeline = buildTimeline({ author: "dev", authorAvatarUrl: null, at: Date.parse("2026-01-01T00:00:00Z") }, [
      { event: "merged", actor: user("octo"), created_at: "2026-01-03T00:00:00Z" },
      { event: "commented", user: user("octo"), body: "Hi", created_at: "2026-01-02T00:00:00Z" }
    ])
    expect(timeline.map((i) => [i.kind, i.actor])).toEqual([["opened", "dev"], ["comment", "octo"], ["merged", "octo"]])
  })
})
