import * as stylex from "@stylexjs/stylex"
import { cx } from "./utils"

type Marker = ReturnType<typeof stylex.defineMarker> | ReturnType<typeof stylex.defaultMarker>
type StyleXArg = stylex.StyleXStyles | Marker | boolean | null | undefined
type StyleValue = string | Record<string, string | number | undefined> | undefined

function styleToString(style: StyleValue): string | undefined {
  if (style == null) return undefined
  if (typeof style === "string") return style || undefined
  const out = Object.entries(style)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}:${v}`)
    .join(";")
  return out || undefined
}

function joinStyles(a: string | undefined, b: StyleValue) {
  const s = [a, styleToString(b)].filter(Boolean).join(";")
  return s || undefined
}

/**
 * `stylex.attrs()` merged with a consumer's `class` and `style`, for spreading after `{...rest}`
 * (where `class` and `style` were omitted from `rest`). StyleX's own inline style comes first, so
 * a consumer `style` wins. A function `style` (Base UI's `(state) => style`) stays a function.
 */
export function sxMerge(
  styles: StyleXArg[],
  className?: string,
  style?: unknown,
): { class: string | undefined; style: any } {
  const a = stylex.attrs(...(styles as any[]))
  const cls = cx(a.class, className) || undefined
  if (typeof style === "function") {
    return {
      class: cls,
      style: (state: unknown) => joinStyles(a.style, (style as (s: unknown) => StyleValue)(state)),
    }
  }
  return { class: cls, style: joinStyles(a.style, style as StyleValue) }
}
