import { createContext, omit, useContext } from "solid-js"
import * as stylex from "@stylexjs/stylex"
import { Toggle as TogglePrimitive } from "base-ui-solidjs/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "base-ui-solidjs/toggle-group"
import { radius } from "../lib/tokens.stylex"
import { toggleGroupMarker } from "../lib/markers.stylex"
import { cx } from "../lib/utils"
import { mergeStyle } from "../lib/style"
import { toggleStyles, type ToggleSize, type ToggleVariant } from "./toggle"

// Port of shadcn/ui's base-vega `toggle-group` (see the Tailwind variant for the source classes).
// The items' `group-data-[spacing=0]/toggle-group` and orientation styles read the group's
// props from context instead of ancestor selectors.
const shadowXs = "0 1px 2px 0 rgb(0 0 0 / 0.05)"

const styles = stylex.create({
  group: {
    display: "flex",
    width: "fit-content",
    flexDirection: "row",
    alignItems: "center",
    gap: "calc(0.25rem * var(--gap))",
    borderRadius: radius.md,
  },
  groupVertical: { flexDirection: "column", alignItems: "stretch" },
  groupAttachedOutline: { boxShadow: shadowXs },
  item: {
    flexShrink: 0,
    zIndex: { default: null, ":focus": 10, ":focus-visible": 10 },
  },
  itemAttached: {
    borderRadius: 0,
    boxShadow: "none",
    paddingLeft: { default: "0.5rem", ":has([data-icon=inline-start])": "0.375rem" },
    paddingRight: { default: "0.5rem", ":has([data-icon=inline-end])": "0.375rem" },
  },
  itemAttachedHorizontal: {
    borderTopLeftRadius: { default: null, ":first-child": radius.md },
    borderBottomLeftRadius: { default: null, ":first-child": radius.md },
    borderTopRightRadius: { default: null, ":last-child": radius.md },
    borderBottomRightRadius: { default: null, ":last-child": radius.md },
  },
  itemAttachedVertical: {
    borderTopLeftRadius: { default: null, ":first-child": radius.md },
    borderTopRightRadius: { default: null, ":first-child": radius.md },
    borderBottomLeftRadius: { default: null, ":last-child": radius.md },
    borderBottomRightRadius: { default: null, ":last-child": radius.md },
  },
  itemAttachedOutlineHorizontal: { borderLeftWidth: { default: 0, ":first-child": "1px" } },
  itemAttachedOutlineVertical: { borderTopWidth: { default: 0, ":first-child": "1px" } },
})

type ToggleGroupContextValue = {
  variant?: ToggleVariant | null | undefined
  size?: ToggleSize | null | undefined
  spacing?: number
  orientation?: "horizontal" | "vertical"
}

const ToggleGroupContext = createContext<ToggleGroupContextValue>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
})

type ToggleGroupProps = Omit<ToggleGroupPrimitive.Props, "class"> & {
  variant?: ToggleVariant | null
  size?: ToggleSize | null
  spacing?: number
  orientation?: "horizontal" | "vertical"
  class?: string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

function ToggleGroup(props: ToggleGroupProps) {
  const rest = omit(props, "class", "style", "variant", "size", "spacing", "orientation", "children", "xstyle")
  const spacing = () => props.spacing ?? 2
  const orientation = () => props.orientation ?? "horizontal"
  const vertical = () => orientation() === "vertical"
  const attachedOutline = () => spacing() === 0 && props.variant === "outline"
  const context: ToggleGroupContextValue = {
    get variant() {
      return props.variant
    },
    get size() {
      return props.size
    },
    get spacing() {
      return spacing()
    },
    get orientation() {
      return orientation()
    },
  }
  const attrs = () =>
    stylex.attrs(
      toggleGroupMarker,
      styles.group,
      vertical() && styles.groupVertical,
      attachedOutline() && styles.groupAttachedOutline,
      props.xstyle,
    )
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={props.variant}
      data-size={props.size}
      data-spacing={spacing()}
      data-orientation={orientation()}
      orientation={orientation()}
      {...rest}
      class={cx(attrs().class, props.class)}
      style={mergeStyle(attrs().style ? `${attrs().style};--gap:${spacing()}` : `--gap:${spacing()}`, props.style)}
    >
      <ToggleGroupContext value={context}>{props.children}</ToggleGroupContext>
    </ToggleGroupPrimitive>
  )
}

type ToggleGroupItemProps = Omit<TogglePrimitive.Props, "class"> & {
  variant?: ToggleVariant | null
  size?: ToggleSize | null
  class?: string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

function ToggleGroupItem(props: ToggleGroupItemProps) {
  const rest = omit(props, "class", "style", "variant", "size", "children", "xstyle")
  const context = useContext(ToggleGroupContext)
  const variant = () => context.variant || props.variant || "default"
  const size = () => context.size || props.size || "default"
  const attached = () => context.spacing === 0
  const vertical = () => context.orientation === "vertical"
  const attachedOutline = () => attached() && variant() === "outline"
  // Helpers: the StyleX compiler only accepts `fn() && styles.x` conditions inside `stylex.attrs`.
  const attachedStyles = () => {
    if (!attached()) return []
    const outline = attachedOutline()
    if (vertical()) return [styles.itemAttached, styles.itemAttachedVertical, outline && styles.itemAttachedOutlineVertical]
    return [styles.itemAttached, styles.itemAttachedHorizontal, outline && styles.itemAttachedOutlineHorizontal]
  }
  const attrs = () =>
    stylex.attrs(...toggleStyles({ variant: variant(), size: size() }), styles.item, ...attachedStyles(), props.xstyle)
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={variant()}
      data-size={size()}
      data-spacing={context.spacing}
      {...rest}
      class={cx(attrs().class, props.class)}
      style={mergeStyle(attrs().style, props.style)}
    >
      {props.children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem, type ToggleGroupProps, type ToggleGroupItemProps }
