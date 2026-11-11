import { omit } from "solid-js"
import type { JSX } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { mergeProps } from "base-ui-solidjs/merge-props"
import { useRender } from "base-ui-solidjs/use-render"
import { colors, radius } from "../lib/tokens.stylex"
import { cx } from "../lib/utils"
import { Separator, type SeparatorProps } from "./separator"

// Port of shadcn/ui's base-vega `button-group` (see the Tailwind variant for the source classes).
//
// The Tailwind group styles its children (`*:data-slot:rounded-r-none`,
// `[&>[data-slot]~[data-slot]]:border-l-0`, ...). StyleX can't target children, so the children
// carry those rules themselves as conditions on their own element: `:is([data-slot=button-group] > *)`
// matches when the element is a direct child of a group, `:has(~ [data-slot])` when a part follows
// it, `:is([data-slot] ~ *)` when one precedes it. `buttonGroupItemStyles.item` holds them; the StyleX
// Button, Input and ButtonGroupText include it, and any other part placed in a group can spread it.
const styles = stylex.create({
  group: {
    display: "flex",
    width: "fit-content",
    alignItems: "stretch",
    gap: { default: null, ":has(> [data-slot=button-group])": "0.5rem" },
  },
  horizontal: {},
  vertical: { flexDirection: "column" },
  text: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.muted,
    paddingInline: "0.625rem",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    fontWeight: 500,
    boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  },
  separator: {
    position: "relative",
    alignSelf: "stretch",
    backgroundColor: colors.input,
  },
  separatorVertical: { marginBlock: "1px", height: "auto" },
  separatorHorizontal: { marginInline: "1px", width: "auto" },
})


/** Styles for parts placed inside a `ButtonGroup` (see the comment above). */
const buttonGroupItemStyles = stylex.create({
  item: {
    // `*:focus-visible:relative *:focus-visible:z-10`
    position: { default: null, ":is([data-slot=button-group] > *):focus-visible": "relative" },
    zIndex: { default: null, ":is([data-slot=button-group] > *):focus-visible": 10 },
    // Buttons' `in-data-[slot=button-group]:rounded-md`, then the group's corner rules.
    borderTopLeftRadius: {
      default: null,
      ":is([data-slot=button-group] *)": radius.md,
      ":is([data-slot=button-group]:not([data-orientation=vertical]) > [data-slot] ~ [data-slot])": 0,
      ":is([data-slot=button-group][data-orientation=vertical] > [data-slot] ~ [data-slot])": 0,
    },
    borderTopRightRadius: {
      default: null,
      ":is([data-slot=button-group] *)": radius.md,
      ":is([data-slot=button-group]:not([data-orientation=vertical]) > [data-slot]):has(~ [data-slot])": 0,
      ":is([data-slot=button-group][data-orientation=vertical] > [data-slot] ~ [data-slot])": 0,
    },
    borderBottomLeftRadius: {
      default: null,
      ":is([data-slot=button-group] *)": radius.md,
      ":is([data-slot=button-group]:not([data-orientation=vertical]) > [data-slot] ~ [data-slot])": 0,
      ":is([data-slot=button-group][data-orientation=vertical] > [data-slot]):has(~ [data-slot])": 0,
    },
    borderBottomRightRadius: {
      default: null,
      ":is([data-slot=button-group] *)": radius.md,
      ":is([data-slot=button-group]:not([data-orientation=vertical]) > [data-slot]):has(~ [data-slot])": 0,
      ":is([data-slot=button-group][data-orientation=vertical] > [data-slot]):has(~ [data-slot])": 0,
    },
    borderLeftWidth: {
      default: null,
      ":is([data-slot=button-group]:not([data-orientation=vertical]) > [data-slot] ~ [data-slot])": 0,
    },
    borderTopWidth: {
      default: null,
      ":is([data-slot=button-group][data-orientation=vertical] > [data-slot] ~ [data-slot])": 0,
    },
  },
  // `[&>input]:flex-1`
  input: {
    flex: { default: null, ":is([data-slot=button-group] > input)": "1 1 0%" },
  },
  // `[&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit`
  selectTrigger: {
    width: { default: null, ":is([data-slot=button-group] > *)": "fit-content" },
  },
})

type ButtonGroupOrientation = "horizontal" | "vertical"

/** The StyleX counterpart of Tailwind's `buttonGroupVariants`. */
function buttonGroupStyles(opts: { orientation?: ButtonGroupOrientation | null | undefined } = {}) {
  return [styles.group, opts.orientation === "vertical" ? styles.vertical : styles.horizontal]
}

type XStyle = {
  class?: string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

type ButtonGroupProps = Omit<JSX.IntrinsicElements["div"], "class"> &
  XStyle & { orientation?: ButtonGroupOrientation | null }

function ButtonGroup(props: ButtonGroupProps) {
  const rest = omit(props, "class", "orientation", "xstyle")
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={props.orientation ?? undefined}
      {...rest}
      class={cx(
        stylex.attrs(...buttonGroupStyles({ orientation: props.orientation }), buttonGroupItemStyles.item, props.xstyle)
          .class,
        props.class,
      )}
    />
  )
}

type ButtonGroupTextProps = Omit<useRender.ComponentProps<"div">, "class"> & XStyle

/** Tailwind's `[&_svg:not([class*='size-'])]:size-4` is `Icon`'s default size. */
function ButtonGroupText(props: ButtonGroupTextProps) {
  const rest = omit(props, "class", "render", "children", "xstyle")
  return useRender({
    defaultTagName: "div",
    get render() {
      return props.render
    },
    get props() {
      return mergeProps<Record<string, unknown>>(
        { class: cx(stylex.attrs(styles.text, buttonGroupItemStyles.item, props.xstyle).class, props.class) },
        rest,
      )
    },
    get children() {
      return props.children
    },
    state: { slot: "button-group-text" },
  })
}

type ButtonGroupSeparatorProps = SeparatorProps

function ButtonGroupSeparator(props: ButtonGroupSeparatorProps) {
  const rest = omit(props, "orientation", "xstyle")
  const isHorizontal = () => props.orientation === "horizontal"
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={props.orientation ?? "vertical"}
      {...rest}
      xstyle={[styles.separator, isHorizontal() ? styles.separatorHorizontal : styles.separatorVertical, props.xstyle]}
    />
  )
}

export {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  buttonGroupStyles,
  buttonGroupItemStyles,
  type ButtonGroupProps,
  type ButtonGroupTextProps,
  type ButtonGroupSeparatorProps,
  type ButtonGroupOrientation,
}
