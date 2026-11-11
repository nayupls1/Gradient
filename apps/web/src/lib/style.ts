import type { JSX } from "@solidjs/web"

type StyleValue = JSX.CSSProperties | string | undefined | null

function toCss(style: JSX.CSSProperties | string) {
  if (typeof style === "string") return style
  return Object.entries(style)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")
}

/**
 * Merges the inline `style` that `stylex.attrs()` returns (dynamic styles) with a consumer's
 * `style`, which may be an object, a string or Base UI's `(state) => style` function.
 */
export function mergeStyle<S>(sx: string | undefined, user: S): S | string | undefined {
  if (!sx) return user
  if (user == null) return sx
  if (typeof user === "function") {
    return ((state: unknown) => mergeStyle(sx, (user as (s: unknown) => StyleValue)(state))) as S
  }
  return `${sx};${toCss(user as JSX.CSSProperties | string)}`
}
