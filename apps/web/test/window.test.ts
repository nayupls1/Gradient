import { describe, expect, test } from "bun:test"
import { assignSlots, rowOffsets, scrollToReveal, type Slotted, visibleRows } from "../src/lib/window.ts"

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

describe("assignSlots", () => {
  const items = (keys: string, value = 0) => [...keys].map((key) => ({ key, value }))
  const same = (a: number, b: number) => a === b
  const slots = (m: Map<string, Slotted<number>>) => Object.fromEntries([...m].map(([k, v]) => [k, v.slot]))

  test("first render numbers the slots in order", () => {
    expect(slots(assignSlots(new Map(), items("abc"), same))).toEqual({ a: 0, b: 1, c: 2 })
  })
  test("an item that comes into view takes the slot of one that left", () => {
    const first = assignSlots(new Map(), items("abc"), same)
    const next = assignSlots(first, items("bcd"), same)
    expect(slots(next)).toEqual({ b: 1, c: 2, d: 0 })
    expect([...next.keys()]).toEqual(["b", "c", "d"])
  })
  test("unchanged items keep their exact object; changed values get a new one in the same slot", () => {
    const first = assignSlots(new Map(), items("ab"), same)
    const next = assignSlots(first, [{ key: "a", value: 0 }, { key: "b", value: 5 }], same)
    expect(next.get("a")).toBe(first.get("a")!)
    expect(next.get("b")).not.toBe(first.get("b")!)
    expect(next.get("b")!.slot).toBe(first.get("b")!.slot)
  })
  test("more items than before get fresh slots that do not collide", () => {
    const first = assignSlots(new Map(), items("ab"), same)
    const next = assignSlots(first, items("xbyz"), same)
    const used = Object.values(slots(next))
    expect(new Set(used).size).toBe(4)
    expect(next.get("b")!.slot).toBe(1)
  })
})
