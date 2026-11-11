import { omit } from "solid-js"
import * as stylex from "@stylexjs/stylex"
import { Input as InputPrimitive } from "base-ui-solidjs/input"
import { colors, radius } from "../lib/tokens.stylex"
import { cx } from "../lib/utils"
import { mergeStyle } from "../lib/style"
import { buttonGroupItemStyles } from "./button-group"

// Port of shadcn/ui's base-vega `input` (see the Tailwind variant for the source classes).
// `aria-invalid` wins over `focus-visible` like in Tailwind, so the focus styles exclude it.
const shadowXs = "0 1px 2px 0 rgb(0 0 0 / 0.05)"
const focusRing = `0 0 0 3px color-mix(in oklch, ${colors.ring} 50%, transparent)`
const invalidRing = `0 0 0 3px light-dark(color-mix(in oklch, ${colors.destructive} 20%, transparent), color-mix(in oklch, ${colors.destructive} 40%, transparent))`
const invalidBorder = `light-dark(${colors.destructive}, color-mix(in oklch, ${colors.destructive} 50%, transparent))`

const styles = stylex.create({
  base: {
    height: "2.25rem",
    // A responsive Field's `@md/field-group:*:w-auto`.
    width: {
      default: "100%",
      "@container field-group (min-width: 28rem)": {
        default: "100%",
        ":is([data-slot=field][data-orientation=responsive] > *)": "auto",
      },
    },
    minWidth: 0,
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
    paddingBlock: "0.25rem",
    fontSize: { default: "1rem", "@media (min-width: 48rem)": "0.875rem" },
    lineHeight: { default: "1.5rem", "@media (min-width: 48rem)": "1.25rem" },
    color: "inherit",
    boxShadow: {
      default: shadowXs,
      ":focus-visible:not([aria-invalid=true])": `${focusRing}, ${shadowXs}`,
      ":is([aria-invalid=true])": `${invalidRing}, ${shadowXs}`,
    },
    transitionProperty: "color, box-shadow",
    transitionDuration: "150ms",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    outline: "none",
    pointerEvents: { default: null, ":disabled": "none" },
    cursor: { default: null, ":disabled": "not-allowed" },
    opacity: { default: null, ":disabled": 0.5 },
    "::placeholder": { color: colors.mutedForeground },
    "::file-selector-button": {
      display: "inline-flex",
      height: "1.75rem",
      borderWidth: 0,
      backgroundColor: "transparent",
      fontSize: "0.875rem",
      lineHeight: "1.25rem",
      fontWeight: 500,
      color: colors.foreground,
    },
  },
})

type InputProps = Omit<InputPrimitive.Props, "class"> & {
  class?: string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

function Input(props: InputProps) {
  const rest = omit(props, "class", "style", "type", "xstyle")
  // The button group's child rules (see button-group.tsx) apply when an input sits in a `ButtonGroup`.
  const attrs = () => stylex.attrs(styles.base, buttonGroupItemStyles.item, buttonGroupItemStyles.input, props.xstyle)
  return (
    <InputPrimitive
      type={props.type}
      data-slot="input"
      {...rest}
      class={cx(attrs().class, props.class)}
      style={mergeStyle(attrs().style, props.style)}
    />
  )
}

export { Input, type InputProps }
