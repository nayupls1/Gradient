import { omit } from "solid-js"
import type { JSX } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { colors, radius } from "../lib/tokens.stylex"
import { inputGroupMarker } from "../lib/markers.stylex"
import { cx } from "../lib/utils"
import { mergeStyle } from "../lib/style"
import { Button, type ButtonProps } from "./button"
import { Input, type InputProps } from "./input"
import { Textarea, type TextareaProps } from "./textarea"

// Port of shadcn/ui's base-vega `input-group` (see the Tailwind variant for the source classes).
// The group's `[&>input]` padding rules move to InputGroupInput as
// `:is([data-slot=input-group]:has(> …) > *)` conditions; combobox's
// `*:data-[slot=input-group]:` overrides live here as `:is([data-slot=combobox-content] > *)`.
// Tailwind's `[&>svg]` / `[&>kbd]` child styles can't be expressed in StyleX; `Icon` defaults to 16px.
const shadowXs = "0 1px 2px 0 rgb(0 0 0 / 0.05)"
const focusRing = `0 0 0 3px color-mix(in oklch, ${colors.ring} 50%, transparent)`
const invalidRing = `0 0 0 3px light-dark(color-mix(in oklch, ${colors.destructive} 20%, transparent), color-mix(in oklch, ${colors.destructive} 40%, transparent))`

const styles = stylex.create({
  group: {
    position: "relative",
    display: "flex",
    height: {
      default: "2.25rem",
      ":has(> [data-align=block-end])": "auto",
      ":has(> [data-align=block-start])": "auto",
      ":has(> textarea)": "auto",
      ":is([data-slot=combobox-content] > *)": "2rem",
    },
    flexDirection: {
      default: null,
      ":has(> [data-align=block-end])": "column",
      ":has(> [data-align=block-start])": "column",
    },
    width: {
      default: "100%",
      "@container field-group (min-width: 28rem)": {
        default: "100%",
        ":is([data-slot=field][data-orientation=responsive] > *)": "auto",
      },
    },
    minWidth: 0,
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: colors.input,
      ":is([data-slot=combobox-content] > *)": `color-mix(in oklch, ${colors.input} 30%, transparent)`,
      ":has([data-slot=input-group-control]:focus-visible):not(:has([data-slot][aria-invalid=true])):not(:is([data-slot=combobox-content] *))":
        colors.ring,
      ":is([data-slot=combobox-content] *):focus-within": "inherit",
      ":has([data-slot][aria-invalid=true])": colors.destructive,
    },
    backgroundColor: {
      default: `light-dark(transparent, color-mix(in oklch, ${colors.input} 30%, transparent))`,
      ":is([data-slot=combobox-content] > *)": `color-mix(in oklch, ${colors.input} 30%, transparent)`,
    },
    boxShadow: {
      default: shadowXs,
      ":is([data-slot=combobox-content] > *)": "none",
      ":has([data-slot=input-group-control]:focus-visible):not(:has([data-slot][aria-invalid=true])):not(:is([data-slot=combobox-content] *))": `${focusRing}, ${shadowXs}`,
      ":has([data-slot][aria-invalid=true])": `${invalidRing}, ${shadowXs}`,
    },
    margin: { default: null, ":is([data-slot=combobox-content] > *)": "0.25rem 0.25rem 0" },
    transitionProperty: "color, box-shadow",
    transitionDuration: "150ms",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    outline: "none",
  },
  addon: {
    display: "flex",
    height: "auto",
    cursor: "text",
    alignItems: "center",
    gap: "0.5rem",
    paddingBlock: "0.375rem",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    fontWeight: 500,
    color: colors.mutedForeground,
    userSelect: "none",
    opacity: { default: null, ":is([data-slot=input-group][data-disabled=true] *)": 0.5 },
  },
  inlineStart: {
    order: -9999,
    justifyContent: "center",
    paddingLeft: "0.5rem",
    marginLeft: { default: null, ":has(> button)": "-0.25rem", ":has(> kbd)": "-0.15rem" },
  },
  inlineEnd: {
    order: 9999,
    justifyContent: "center",
    paddingRight: "0.5rem",
    marginRight: { default: null, ":has(> button)": "-0.25rem", ":has(> kbd)": "-0.15rem" },
  },
  blockStart: {
    order: -9999,
    width: "100%",
    justifyContent: "flex-start",
    paddingInline: "0.625rem",
    paddingTop: "0.5rem",
    paddingBottom: { default: "0.375rem", ":is(.border-b)": "0.5rem" },
  },
  blockEnd: {
    order: 9999,
    width: "100%",
    justifyContent: "flex-start",
    paddingInline: "0.625rem",
    paddingBottom: "0.5rem",
    paddingTop: { default: "0.375rem", ":is(.border-t)": "0.5rem" },
  },
  button: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    boxShadow: {
      default: "none",
      ":focus-visible": focusRing,
    },
  },
  // Button's sizes set paddingLeft/paddingRight (for its `has-data-[icon=…]` paddings), which win over
  // `paddingInline`, so these override the longhands.
  buttonXs: {
    height: "1.5rem",
    gap: "0.25rem",
    borderRadius: `calc(${radius.lg} - 5px)`,
    paddingLeft: "0.375rem",
    paddingRight: "0.375rem",
  },
  buttonSm: {},
  buttonIconXs: {
    width: "1.5rem",
    height: "1.5rem",
    borderRadius: `calc(${radius.lg} - 5px)`,
    padding: 0,
    paddingLeft: 0,
    paddingRight: 0,
  },
  buttonIconSm: { width: "2rem", height: "2rem", padding: 0, paddingLeft: 0, paddingRight: 0 },
  text: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    color: colors.mutedForeground,
  },
  control: {
    flex: "1 1 0%",
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    boxShadow: "none",
  },
  input: {
    paddingTop: { default: null, ":is([data-slot=input-group]:has(> [data-align=block-end]) > *)": "0.75rem" },
    paddingBottom: { default: null, ":is([data-slot=input-group]:has(> [data-align=block-start]) > *)": "0.75rem" },
    paddingRight: { default: null, ":is([data-slot=input-group]:has(> [data-align=inline-end]) > *)": "0.375rem" },
    paddingLeft: { default: null, ":is([data-slot=input-group]:has(> [data-align=inline-start]) > *)": "0.375rem" },
  },
  textarea: { resize: "none", paddingBlock: "0.5rem" },
})

type XStyle = {
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

type DivProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "style"> &
  XStyle & { class?: string; style?: JSX.CSSProperties | string }

function InputGroup(props: DivProps) {
  const rest = omit(props, "class", "style", "xstyle")
  const attrs = () => stylex.attrs(inputGroupMarker, styles.group, props.xstyle)
  return (
    <div
      data-slot="input-group"
      role="group"
      {...rest}
      class={cx(attrs().class, props.class)}
      style={mergeStyle(attrs().style, props.style)}
    />
  )
}

type InputGroupAddonAlign = "inline-start" | "inline-end" | "block-start" | "block-end"
const alignStyles = {
  "inline-start": styles.inlineStart,
  "inline-end": styles.inlineEnd,
  "block-start": styles.blockStart,
  "block-end": styles.blockEnd,
}

type InputGroupAddonProps = DivProps & { align?: InputGroupAddonAlign | null }

/** Focuses the group's input when the addon (not a button inside it) is clicked. */
function focusGroupInput(e: MouseEvent & { currentTarget: HTMLElement }) {
  if ((e.target as HTMLElement).closest("button")) return
  e.currentTarget.parentElement?.querySelector("input")?.focus()
}

function InputGroupAddon(props: InputGroupAddonProps) {
  const rest = omit(props, "class", "style", "align", "xstyle")
  const align = () => props.align ?? "inline-start"
  const alignStyle = () => alignStyles[align()]
  const attrs = () => stylex.attrs(styles.addon, alignStyle(), props.xstyle)
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align()}
      onClick={focusGroupInput}
      {...rest}
      class={cx(attrs().class, props.class)}
      style={mergeStyle(attrs().style, props.style)}
    />
  )
}

type InputGroupButtonSize = "xs" | "sm" | "icon-xs" | "icon-sm"
const buttonSizeStyles = {
  xs: styles.buttonXs,
  sm: styles.buttonSm,
  "icon-xs": styles.buttonIconXs,
  "icon-sm": styles.buttonIconSm,
}

type InputGroupButtonProps = Omit<ButtonProps, "size" | "type"> & {
  size?: InputGroupButtonSize | null
  type?: "button" | "submit" | "reset"
}

function InputGroupButton(props: InputGroupButtonProps) {
  const rest = omit(props, "type", "variant", "size", "xstyle")
  const size = () => props.size ?? "xs"
  const sizeStyle = () => buttonSizeStyles[size()]
  return (
    <Button
      type={props.type ?? "button"}
      data-size={size()}
      variant={props.variant ?? "ghost"}
      {...rest}
      xstyle={[styles.button, sizeStyle(), props.xstyle]}
    />
  )
}

type InputGroupTextProps = Omit<JSX.HTMLAttributes<HTMLSpanElement>, "class" | "style"> &
  XStyle & { class?: string; style?: JSX.CSSProperties | string }

function InputGroupText(props: InputGroupTextProps) {
  const rest = omit(props, "class", "style", "xstyle")
  const attrs = () => stylex.attrs(styles.text, props.xstyle)
  return <span {...rest} class={cx(attrs().class, props.class)} style={mergeStyle(attrs().style, props.style)} />
}

function InputGroupInput(props: InputProps) {
  const rest = omit(props, "xstyle")
  return <Input data-slot="input-group-control" {...rest} xstyle={[styles.control, styles.input, props.xstyle]} />
}

function InputGroupTextarea(props: TextareaProps) {
  const rest = omit(props, "xstyle")
  return (
    <Textarea data-slot="input-group-control" {...rest} xstyle={[styles.control, styles.textarea, props.xstyle]} />
  )
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput, InputGroupTextarea }
