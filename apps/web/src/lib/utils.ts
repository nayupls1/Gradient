import * as stylex from "@stylexjs/stylex"

type StyleXArg = Parameters<typeof stylex.attrs>[number]

/** Joins class names, skipping falsy values. */
export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ")
}

/**
 * `stylex.attrs()` plus an optional consumer class. Returns `{ class, style }`
 * for spreading onto a Solid element (StyleX's `props()` targets React's `className`).
 */
export function sx(styles: StyleXArg | StyleXArg[], extraClass?: string) {
  const a = stylex.attrs(styles as StyleXArg)
  return { class: cx(a.class, extraClass) || undefined, style: a.style }
}
