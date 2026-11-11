import { describe, expect, test } from "bun:test"
import { rowOffsets, scrollToReveal, visibleRows } from "../src/lib/window.ts"

const m = { headerHeight: 36, rowHeight: 40 }

describe("rowOffsets", () => {
  test("each section's rows start below its header and every section before it", () => {
    expect(rowOffsets([{ rows: 3 }, { rows: 0 }, { rows: 2 }], m)).toEqual([36, 36 + 120 + 36, 36 + 120 + 36 + 36])
  })
  test("no sections", () => {
    expect(rowOffsets([], m)).toEqual([])
  })
})

describe("visibleRows", () => {
  test("rows overlapping the band, partial rows included", () => {
    // Rows start at 36: row 0 is 36–76, row 1 76–116, row 2 116–156.
    expect(visibleRows(36, 100, 40, 80, 120)).toEqual({ start: 1, end: 3 })
  })
  test("a band above the section renders nothing", () => {
    expect(visibleRows(1000, 10, 40, 0, 500)).toEqual({ start: 0, end: 0 })
  })
  test("a band below the section renders nothing", () => {
    expect(visibleRows(0, 10, 40, 1000, 1500)).toEqual({ start: 10, end: 10 })
  })
  test("a band larger than the section renders every row", () => {
    expect(visibleRows(100, 5, 40, -200, 5000)).toEqual({ start: 0, end: 5 })
  })
  test("a collapsed section renders nothing", () => {
    expect(visibleRows(36, 0, 40, 0, 1000)).toEqual({ start: 0, end: 0 })
  })
  test("5,000 rows scrolled to the middle render only the window", () => {
    const r = visibleRows(36, 5000, 40, 100_000, 100_800)
    expect(r.end - r.start).toBeLessThanOrEqual(21)
    expect(r.start).toBe(Math.floor((100_000 - 36) / 40))
  })
})

describe("scrollToReveal", () => {
  test("a visible item needs no scroll", () => {
    expect(scrollToReveal(0, 400, 100, 40)).toBeNull()
  })
  test("an item below the viewport scrolls so its bottom edge shows", () => {
    expect(scrollToReveal(0, 400, 400, 40)).toBe(40)
  })
  test("an item above the viewport scrolls so its top edge shows", () => {
    expect(scrollToReveal(1000, 400, 500, 40)).toBe(500)
  })
  test("an item under the sticky header counts as hidden", () => {
    expect(scrollToReveal(100, 400, 110, 40, 36)).toBe(74)
  })
  test("never scrolls above the top", () => {
    expect(scrollToReveal(10, 400, 20, 40, 36)).toBe(0)
  })
})
