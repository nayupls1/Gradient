/**
 * Windowing for lists of fixed-height sections: each section is a header
 * followed by rows of one height. Only the rows near the viewport get
 * rendered; spacers stand in for the rest. Framework free, so it is unit
 * tested on its own (`test/window.test.ts`).
 */

export interface SectionSize {
  /** Rows in the section; 0 when it is collapsed. */
  readonly rows: number
}

export interface WindowMetrics {
  readonly headerHeight: number
  readonly rowHeight: number
}

/** Where a section's first row starts, from the top of the list, for each section. */
export const rowOffsets = (sections: ReadonlyArray<SectionSize>, m: WindowMetrics): ReadonlyArray<number> => {
  const offsets: Array<number> = []
  let top = 0
  for (const section of sections) {
    top += m.headerHeight
    offsets.push(top)
    top += section.rows * m.rowHeight
  }
  return offsets
}

export interface RowRange {
  /** First rendered row. */
  readonly start: number
  /** One past the last rendered row. */
  readonly end: number
}

export const sameRange = (a: RowRange, b: RowRange) => a.start === b.start && a.end === b.end

/**
 * The rows of a section, starting at `rowsTop`, that overlap the band from
 * `viewTop` to `viewBottom` (scroll position plus overscan). Empty when the
 * section lies outside it.
 */
export const visibleRows = (
  rowsTop: number,
  rows: number,
  rowHeight: number,
  viewTop: number,
  viewBottom: number
): RowRange => {
  const start = Math.min(rows, Math.max(0, Math.floor((viewTop - rowsTop) / rowHeight)))
  const end = Math.max(start, Math.min(rows, Math.ceil((viewBottom - rowsTop) / rowHeight)))
  return { start, end }
}

/**
 * The scroll position that brings an item fully into view, moving as little as
 * possible (like `scrollIntoView({ block: "nearest" })`), or null when it is
 * already visible. `stickyTop` is the height covered by a sticky header.
 */
export const scrollToReveal = (
  scrollTop: number,
  viewportHeight: number,
  itemTop: number,
  itemHeight: number,
  stickyTop = 0
): number | null => {
  if (itemTop - stickyTop < scrollTop) return Math.max(0, itemTop - stickyTop)
  if (itemTop + itemHeight > scrollTop + viewportHeight) return itemTop + itemHeight - viewportHeight
  return null
}

/** An item placed in a recycled element: `slot` keys the element, `value` is what it shows. */
export interface Slotted<T> {
  readonly key: string
  readonly value: T
  readonly slot: number
}

/**
 * Element slots for the items about to be rendered, so a keyed list reuses
 * elements while it scrolls: an item still on screen keeps its slot, and an
 * item that comes into view takes the slot of one that left. Keyed by slot,
 * the list then updates the few elements that changed hands instead of
 * building new ones. An item whose value is `same` as before keeps its exact
 * object, so nothing downstream sees a change. The result is in item order.
 */
export const assignSlots = <T>(
  previous: ReadonlyMap<string, Slotted<T>>,
  items: ReadonlyArray<{ readonly key: string; readonly value: T }>,
  same: (a: T, b: T) => boolean
): Map<string, Slotted<T>> => {
  const kept = new Map<string, Slotted<T>>()
  const taken = new Set<number>()
  for (const item of items) {
    const before = previous.get(item.key)
    if (before === undefined) continue
    kept.set(item.key, same(before.value, item.value) ? before : { key: item.key, value: item.value, slot: before.slot })
    taken.add(before.slot)
  }
  const freed: Array<number> = []
  for (const before of previous.values()) if (!taken.has(before.slot)) freed.push(before.slot)
  const next = new Map<string, Slotted<T>>()
  let fresh = 0
  for (const item of items) {
    let entry = kept.get(item.key)
    if (entry === undefined) {
      let slot = freed.pop()
      if (slot === undefined) {
        while (taken.has(fresh)) fresh++
        slot = fresh
      }
      taken.add(slot)
      entry = { key: item.key, value: item.value, slot }
    }
    next.set(item.key, entry)
  }
  return next
}
