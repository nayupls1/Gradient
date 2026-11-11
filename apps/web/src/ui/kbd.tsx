import { omit } from "solid-js"
import type { JSX } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { colors, radius } from "../lib/tokens.stylex"
import { tooltipContentMarker } from "../lib/markers.stylex"
import { cx } from "../lib/utils"

// `in-data-[slot=tooltip-content]:` and the tooltip's `**:data-[slot=kbd]:relative isolate z-50`
// become ancestor conditions on `tooltipContentMarker` (set by TooltipContent).

const styles = stylex.create({
  kbd: {
    pointerEvents: "none",
    position: { default: null, [stylex.when.ancestor(":is([data-slot=tooltip-content])", tooltipContentMarker)]: "relative" },
    isolation: { default: null, [stylex.when.ancestor(":is([data-slot=tooltip-content])", tooltipContentMarker)]: "isolate" },
    zIndex: { default: null, [stylex.when.ancestor(":is([data-slot=tooltip-content])", tooltipContentMarker)]: 50 },
    display: "inline-flex",
    height: "1.25rem",
    width: "fit-content",
    minWidth: "1.25rem",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.25rem",
    borderRadius: radius.sm,
    backgroundColor: {
      default: colors.muted,
      [stylex.when.ancestor(":is([data-slot=tooltip-content])", tooltipContentMarker)]: `light-dark(color-mix(in oklch, ${colors.background} 20%, transparent), color-mix(in oklch, ${colors.background} 10%, transparent))`,
    },
    paddingInline: "0.25rem",
    fontFamily:
      'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
    fontSize: "0.75rem",
    lineHeight: "1rem",
    fontWeight: 500,
    color: { default: colors.mutedForeground, [stylex.when.ancestor(":is([data-slot=tooltip-content])", tooltipContentMarker)]: colors.background },
    userSelect: "none",
  },
  group: { display: "inline-flex", alignItems: "center", gap: "0.25rem" },
})

type KbdProps = Omit<JSX.IntrinsicElements["kbd"], "class"> & {
  class?: string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

/** `[&_svg]:size-3`: pass `size={12}` to icons inside. */
function Kbd(props: KbdProps) {
  const rest = omit(props, "class", "xstyle")
  return <kbd data-slot="kbd" {...rest} class={cx(stylex.attrs(styles.kbd, props.xstyle).class, props.class)} />
}

type KbdGroupProps = KbdProps

function KbdGroup(props: KbdGroupProps) {
  const rest = omit(props, "class", "xstyle")
  return <kbd data-slot="kbd-group" {...rest} class={cx(stylex.attrs(styles.group, props.xstyle).class, props.class)} />
}

export { Kbd, KbdGroup, type KbdProps, type KbdGroupProps }
