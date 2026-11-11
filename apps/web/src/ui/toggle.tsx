import { omit } from "solid-js"
import * as stylex from "@stylexjs/stylex"
import { Toggle as TogglePrimitive } from "base-ui-solidjs/toggle"
import { colors, radius } from "../lib/tokens.stylex"
import { toggleMarker } from "../lib/markers.stylex"
import { cx } from "../lib/utils"
import { mergeStyle } from "../lib/style"

// Port of shadcn/ui's base-vega `toggle` (see the Tailwind variant for the source classes).
// `group/toggle` is `toggleMarker`: style children with
// `stylex.when.ancestor(":is([aria-pressed=true])", toggleMarker)`.
// Tailwind's `[&_svg]` icon sizing can't be expressed in StyleX; `Icon` defaults to 16px instead.
const shadowXs = "0 1px 2px 0 rgb(0 0 0 / 0.05)"
const focusRing = `0 0 0 3px color-mix(in oklch, ${colors.ring} 50%, transparent)`
const invalidFocusRing = `0 0 0 3px light-dark(color-mix(in oklch, ${colors.destructive} 20%, transparent), color-mix(in oklch, ${colors.destructive} 40%, transparent))`

const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.25rem",
    borderRadius: radius.md,
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    fontWeight: 500,
    whiteSpace: "nowrap",
    transitionProperty: "color, box-shadow",
    transitionDuration: "150ms",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    outline: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": colors.muted,
      ":is([aria-pressed=true])": colors.muted,
    },
    color: { default: "inherit", ":hover": colors.foreground },
    borderColor: {
      default: null,
      ":focus-visible:not([aria-invalid=true])": colors.ring,
      ":is([aria-invalid=true])": colors.destructive,
    },
    boxShadow: {
      default: null,
      ":focus-visible:not([aria-invalid=true])": focusRing,
      ":focus-visible:is([aria-invalid=true])": invalidFocusRing,
    },
    pointerEvents: { default: null, ":disabled": "none" },
    opacity: { default: null, ":disabled": 0.5 },
  },
  outline: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: colors.input,
      ":focus-visible:not([aria-invalid=true])": colors.ring,
      ":is([aria-invalid=true])": colors.destructive,
    },
    boxShadow: {
      default: shadowXs,
      ":focus-visible:not([aria-invalid=true])": `${focusRing}, ${shadowXs}`,
      ":focus-visible:is([aria-invalid=true])": `${invalidFocusRing}, ${shadowXs}`,
    },
  },
  sizeDefault: {
    height: "2.25rem",
    minWidth: "2.25rem",
    paddingLeft: { default: "0.625rem", ":has([data-icon=inline-start])": "0.5rem" },
    paddingRight: { default: "0.625rem", ":has([data-icon=inline-end])": "0.5rem" },
  },
  sizeSm: {
    height: "2rem",
    minWidth: "2rem",
    paddingLeft: { default: "0.625rem", ":has([data-icon=inline-start])": "0.375rem" },
    paddingRight: { default: "0.625rem", ":has([data-icon=inline-end])": "0.375rem" },
  },
  sizeLg: {
    height: "2.5rem",
    minWidth: "2.5rem",
    paddingLeft: { default: "0.625rem", ":has([data-icon=inline-start])": "0.5rem" },
    paddingRight: { default: "0.625rem", ":has([data-icon=inline-end])": "0.5rem" },
  },
})

const variantStyles = { default: null, outline: styles.outline }
const sizeStyles = { default: styles.sizeDefault, sm: styles.sizeSm, lg: styles.sizeLg }

type ToggleVariant = keyof typeof variantStyles
type ToggleSize = keyof typeof sizeStyles

/** The toggle's styles, also used by `ToggleGroupItem`. */
function toggleStyles(opts: { variant?: ToggleVariant | null | undefined; size?: ToggleSize | null | undefined }) {
  return [toggleMarker, styles.base, variantStyles[opts.variant ?? "default"], sizeStyles[opts.size ?? "default"]]
}

type ToggleProps = Omit<TogglePrimitive.Props, "class"> & {
  variant?: ToggleVariant | null
  size?: ToggleSize | null
  class?: string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

function Toggle(props: ToggleProps) {
  const rest = omit(props, "class", "style", "variant", "size", "xstyle")
  const attrs = () => stylex.attrs(...toggleStyles({ variant: props.variant, size: props.size }), props.xstyle)
  return (
    <TogglePrimitive
      data-slot="toggle"
      {...rest}
      class={cx(attrs().class, props.class)}
      style={mergeStyle(attrs().style, props.style)}
    />
  )
}

export { Toggle, toggleStyles, type ToggleProps, type ToggleVariant, type ToggleSize }
