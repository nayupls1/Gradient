import { describe, expect, test } from "bun:test"
import { referenceKey, textReferences } from "../src/index.ts"

const repo = { owner: "acme", repo: "web" }
const refs = (text: string, context: typeof repo | null = repo) => textReferences(text, context).map((r) => r.text)

describe("textReferences", () => {
  test("finds #12, owner/repo#12, identifiers and bare GitHub URLs, in order", () => {
    expect(refs("See #12 and acme/api#3, then TES-4.\nAlso https://github.com/acme/web/pull/7 and https://github.com/o/r/issues/1")).toEqual([
      "#12",
      "acme/api#3",
      "TES-4",
      "#7",
      "o/r#1"
    ])
  })

  test("skips code, and lists each target once", () => {
    expect(refs("`#1` and\n```\n#2 TES-9\n```\n#3, #3 again, https://github.com/acme/web/issues/3")).toEqual(["#3"])
  })

  test("#12 needs a repository to point into", () => {
    expect(refs("#12 and TES-1", null)).toEqual(["TES-1"])
  })

  test("referenceKey treats spelling and case alike", () => {
    expect(referenceKey({ kind: "github", owner: "Acme", repo: "Web", number: 3 }))
      .toBe(referenceKey({ kind: "github", owner: "acme", repo: "web", number: 3 }))
  })
})
