import { omit } from "solid-js"
import type { JSX } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { colors, radius } from "../lib/tokens.stylex"
import { cx } from "../lib/utils"
import { mergeStyle } from "../lib/style"

// Port of shadcn/ui's base-vega `textarea` (see the Tailwind variant for the source classes).
const shadowXs = "0 1px 2px 0 rgb(0 0 0 / 0.05)"
const focusRing = `0 0 0 3px color-mix(in oklch, ${colors.ring} 50%, transparent)`
const invalidRing = `0 0 0 3px light-dark(color-mix(in oklch, ${colors.destructive} 20%, transparent), color-mix(in oklch, ${colors.destructive} 40%, transparent))`
const invalidBorder = `light-dark(${colors.destructive}, color-mix(in oklch, ${colors.destructive} 50%, transparent))`

const styles = stylex.create({
  base: {
    display: "flex",
    fieldSizing: "content",
    minHeight: "4rem",
    // A responsive Field's `@md/field-group:*:w-auto`.
    width: {
      default: "100%",
      "@container field-group (min-width: 28rem)": {
        default: "100%",
        ":is([data-slot=field][data-orientation=responsive] > *)": "auto",
      },
    },
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: colors.input,
      ":focus-visible:not([aria-invalid=true])": colors.ring,
      ":is([aria-invalid=true])": invalidBorder,
    },
    backgroundColor: `light-dark(transparent, color-mix(in oklch, ${colors.input} 30%, transparent))`,
    paddingInline: "0.625rem",
    paddingBlock: "0.5rem",
    fontSize: { default: "1rem", "@media (min-width: 48rem)": "0.875rem" },
    lineHeight: { default: "1.5rem", "@media (min-width: 48rem)": "1.25rem" },
    color: "inherit",
    fontFamily: "inherit",
    boxShadow: {
      default: shadowXs,
      ":focus-visible:not([aria-invalid=true])": `${focusRing}, ${shadowXs}`,
      ":is([aria-invalid=true])": `${invalidRing}, ${shadowXs}`,
    },
    transitionProperty: "color, box-shadow",
    transitionDuration: "150ms",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    outline: "none",
    cursor: { default: null, ":disabled": "not-allowed" },
    opacity: { default: null, ":disabled": 0.5 },
    "::placeholder": { color: colors.mutedForeground },
  },
})

type TextareaProps = Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "class" | "style"> & {
  class?: string
  style?: JSX.CSSProperties | string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

function Textarea(props: TextareaProps) {
  const rest = omit(props, "class", "style", "xstyle")
  const attrs = () => stylex.attrs(styles.base, props.xstyle)
  return (
    <textarea
      data-slot="textarea"
      {...rest}
      class={cx(attrs().class, props.class)}
      style={mergeStyle(attrs().style, props.style)}
    />
  )
}

export { Textarea, type TextareaProps }
