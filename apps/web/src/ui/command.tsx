import { omit } from "solid-js"
import type { ComponentProps, JSX } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { Check, Search } from "lucide"
import { Icon } from "./icon"
import { colors, radius } from "../lib/tokens.stylex"
import { a11y } from "../lib/a11y"
import { commandItemMarker } from "../lib/markers/command.stylex"
import { cx } from "../lib/utils"
import {
  CommandEmptyPrimitive,
  CommandGroupPrimitive,
  CommandInputPrimitive,
  CommandItemPrimitive,
  CommandListPrimitive,
  CommandRoot,
  CommandSeparatorPrimitive,
  type CommandGroupPrimitiveProps,
  type CommandInputPrimitiveProps,
  type CommandItemPrimitiveProps,
  type CommandListPrimitiveProps,
  type CommandRootProps,
  type CommandSeparatorPrimitiveProps,
} from "../lib/cmdk"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog"
import { InputGroup, InputGroupAddon } from "./input-group"

// Port of shadcn/ui's base-vega `command` (see the Tailwind variant for the source classes), on
// ../lib/cmdk, a Solid port of cmdk's parts.
// - `**:[[cmdk-group-heading]]:*` on the group → the heading's own class (`headingClass`).
// - `group-*/command-item` on the check icon and shortcut → `commandItemMarker` ancestor conditions.
// - `[&_svg]:shrink-0 size-4` → the check icon is styled directly; icons you put in an item need
//   `flexShrink: 0` themselves (`Icon` defaults to 16px).
// - `in-data-[slot=dialog-content]:rounded-lg!` → `:is([data-slot=dialog-content] *)` on the item.

const styles = stylex.create({
  root: {
    display: "flex",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: radius.xl,
    backgroundColor: colors.popover,
    padding: "0.25rem",
    color: colors.popoverForeground,
  },
  dialogContent: {
    top: "33.333333%",
    translate: "-50% 0",
    overflow: "hidden",
    borderRadius: radius.xl,
    padding: 0,
  },
  inputWrapper: {
    paddingTop: "0.25rem",
    paddingInline: "0.25rem",
    paddingBottom: 0,
  },
  inputGroup: {
    height: "2rem",
    borderRadius: radius.lg,
    borderColor: `color-mix(in oklch, ${colors.input} 30%, transparent)`,
    backgroundColor: `color-mix(in oklch, ${colors.input} 30%, transparent)`,
    boxShadow: "none",
  },
  inputAddon: {
    paddingLeft: "0.5rem",
  },
  input: {
    width: "100%",
    borderWidth: 0,
    padding: 0,
    // InputGroup's `has-[>[data-align=inline-start]]:[&>input]:pl-1.5` (the search addon is inline-start).
    paddingInlineStart: "0.375rem",
    backgroundColor: "transparent",
    color: "inherit",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    outlineStyle: { default: "none", "@media (forced-colors: active)": "solid" },
    outlineWidth: { default: null, "@media (forced-colors: active)": "2px" },
    outlineColor: { default: null, "@media (forced-colors: active)": "transparent" },
    outlineOffset: { default: null, "@media (forced-colors: active)": "2px" },
    cursor: { default: null, ":disabled": "not-allowed" },
    opacity: { default: null, ":disabled": 0.5 },
  },
  searchIcon: {
    width: "1rem",
    height: "1rem",
    flexShrink: 0,
    opacity: 0.5,
  },
  list: {
    scrollbarWidth: "none",
    "::-webkit-scrollbar": { display: "none" },
    maxHeight: "18rem",
    scrollPaddingBlock: "0.25rem",
    overflowX: "hidden",
    overflowY: "auto",
    outlineStyle: "none",
  },
  empty: {
    paddingBlock: "1.5rem",
    textAlign: "center",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
  },
  group: {
    overflow: "hidden",
    padding: "0.25rem",
    color: colors.foreground,
  },
  groupHeading: {
    paddingInline: "0.5rem",
    paddingBlock: "0.375rem",
    fontSize: "0.75rem",
    lineHeight: "1rem",
    fontWeight: 500,
    color: colors.mutedForeground,
  },
  separator: {
    marginInline: "-0.25rem",
    height: "1px",
    width: "auto",
    backgroundColor: colors.border,
  },
  item: {
    position: "relative",
    display: "flex",
    cursor: "default",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: {
      default: radius.sm,
      ":is([data-slot=dialog-content] *)": radius.lg,
    },
    paddingInline: "0.5rem",
    paddingBlock: "0.375rem",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    outlineStyle: { default: "none", "@media (forced-colors: active)": "solid" },
    outlineWidth: { default: null, "@media (forced-colors: active)": "2px" },
    outlineColor: { default: null, "@media (forced-colors: active)": "transparent" },
    outlineOffset: { default: null, "@media (forced-colors: active)": "2px" },
    userSelect: "none",
    pointerEvents: { default: null, ":is([data-disabled=true])": "none" },
    opacity: { default: null, ":is([data-disabled=true])": 0.5 },
    backgroundColor: { default: null, ":is([data-selected=true])": colors.muted },
    color: { default: null, ":is([data-selected=true])": colors.foreground },
  },
  check: {
    pointerEvents: "none",
    flexShrink: 0,
    marginLeft: "auto",
    display: {
      default: null,
      [stylex.when.ancestor(":has([data-slot=command-shortcut])", commandItemMarker)]: "none",
    },
    opacity: {
      default: 0,
      [stylex.when.ancestor(":is([data-checked=true])", commandItemMarker)]: 1,
    },
  },
  shortcut: {
    marginLeft: "auto",
    fontSize: "0.75rem",
    lineHeight: "1rem",
    letterSpacing: "0.1em",
    color: {
      default: colors.mutedForeground,
      [stylex.when.ancestor(":is([data-selected=true])", commandItemMarker)]: colors.foreground,
    },
  },
})

type XStyle = { class?: string; xstyle?: stylex.StyleXStyles }
type WithXStyle<P> = Omit<P, "class"> & XStyle

function Command(props: WithXStyle<CommandRootProps>) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.root, props.xstyle)
  return <CommandRoot data-slot="command" {...rest} class={cx(attrs().class, props.class)} />
}

type CommandDialogProps = Omit<ComponentProps<typeof Dialog>, "children"> &
  XStyle & {
    title?: string
    description?: string
    showCloseButton?: boolean
    children: JSX.Element
  }

function CommandDialog(props: CommandDialogProps) {
  const rest = omit(props, "title", "description", "children", "class", "xstyle", "showCloseButton")
  return (
    <Dialog {...rest}>
      <DialogHeader xstyle={a11y.srOnly}>
        <DialogTitle>{props.title ?? "Command Palette"}</DialogTitle>
        <DialogDescription>{props.description ?? "Search for a command to run..."}</DialogDescription>
      </DialogHeader>
      <DialogContent
        xstyle={[styles.dialogContent, props.xstyle]}
        class={props.class}
        showCloseButton={props.showCloseButton ?? false}
      >
        {props.children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput(props: WithXStyle<CommandInputPrimitiveProps>) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.input, props.xstyle)
  return (
    <div data-slot="command-input-wrapper" {...stylex.attrs(styles.inputWrapper)}>
      <InputGroup xstyle={styles.inputGroup}>
        <CommandInputPrimitive data-slot="command-input" {...rest} class={cx(attrs().class, props.class)} />
        <InputGroupAddon xstyle={styles.inputAddon}>
          <Icon icon={Search} {...stylex.attrs(styles.searchIcon)} />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function CommandList(props: WithXStyle<CommandListPrimitiveProps>) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.list, props.xstyle)
  return <CommandListPrimitive data-slot="command-list" {...rest} class={cx(attrs().class, props.class)} />
}

function CommandEmpty(props: WithXStyle<ComponentProps<typeof CommandEmptyPrimitive>>) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.empty, props.xstyle)
  return <CommandEmptyPrimitive data-slot="command-empty" {...rest} class={cx(attrs().class, props.class)} />
}

function CommandGroup(props: WithXStyle<CommandGroupPrimitiveProps>) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.group, props.xstyle)
  return (
    <CommandGroupPrimitive
      data-slot="command-group"
      headingClass={stylex.attrs(styles.groupHeading).class}
      {...rest}
      class={cx(attrs().class, props.class)}
    />
  )
}

function CommandSeparator(props: WithXStyle<CommandSeparatorPrimitiveProps>) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.separator, props.xstyle)
  return <CommandSeparatorPrimitive data-slot="command-separator" {...rest} class={cx(attrs().class, props.class)} />
}

function CommandItem(props: WithXStyle<CommandItemPrimitiveProps>) {
  const rest = omit(props, "class", "xstyle", "children")
  const attrs = () => stylex.attrs(commandItemMarker, styles.item, props.xstyle)
  return (
    <CommandItemPrimitive data-slot="command-item" {...rest} class={cx(attrs().class, props.class)}>
      {props.children}
      <Icon icon={Check} {...stylex.attrs(styles.check)} />
    </CommandItemPrimitive>
  )
}

function CommandShortcut(props: Omit<ComponentProps<"span">, "class"> & XStyle) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.shortcut, props.xstyle)
  return <span data-slot="command-shortcut" {...rest} class={cx(attrs().class, props.class)} />
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
