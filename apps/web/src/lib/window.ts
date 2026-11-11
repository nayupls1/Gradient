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
