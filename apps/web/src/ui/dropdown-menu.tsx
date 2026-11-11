import { omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { Menu as MenuPrimitive } from "base-ui-solidjs/menu"
import { Check, ChevronRight } from "lucide"
import { Icon } from "./icon"
import { colors, radius } from "../lib/tokens.stylex"
import { menuItem } from "../lib/menu.stylex"
import { animate } from "../lib/animate"
import { cx } from "../lib/utils"

// Port of shadcn/ui's base-vega `dropdown-menu` (see the Tailwind variant for the source classes).
//
// StyleX has no descendant selectors, so shadcn's child styling is done on the parts themselves:
// - `focus:*` → `:is([data-highlighted])` on the item (Base UI moves focus with the highlight).
// - `not-data-[variant=destructive]:focus:**:text-accent-foreground` / `group-focus/dropdown-menu-item:*`
//   → the shortcut reacts to its item through the `menuItem` marker (`stylex.when.ancestor`).
// - `[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4` → the icons
//   these parts render (chevron, check) are styled directly; `Icon` defaults to 16px. Icons you put
//   in an item inherit its color (`currentColor`), which covers `data-[variant=destructive]:*:[svg]:text-destructive`.
const ring = `0 0 0 1px color-mix(in oklch, ${colors.foreground} 10%, transparent)`

const styles = stylex.create({
  positioner: {
    isolation: "isolate",
    zIndex: 50,
    outlineStyle: "none",
  },
  content: {
    zIndex: 50,
    maxHeight: "var(--available-height)",
    width: "var(--anchor-width)",
    minWidth: "8rem",
    transformOrigin: "var(--transform-origin)",
    overflowX: "hidden",
    overflowY: {
      default: "auto",
      ":is([data-closed])": "hidden",
    },
    borderRadius: radius.md,
    backgroundColor: colors.popover,
    padding: "0.25rem",
    color: colors.popoverForeground,
    boxShadow: `${ring}, 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`,
    transitionDuration: "100ms",
    animationDuration: "100ms",
    outlineStyle: "none",
  },
  subContent: {
    width: "auto",
    minWidth: "96px",
    boxShadow: `${ring}, 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`,
  },
  label: {
    paddingTop: "0.375rem",
    paddingBottom: "0.375rem",
    paddingRight: "0.5rem",
    paddingLeft: {
      default: "0.5rem",
      ":is([data-inset])": "2rem",
    },
    fontSize: "0.75rem",
    lineHeight: "1rem",
    fontWeight: 500,
    color: colors.mutedForeground,
  },
  // Shared by item, sub-trigger, checkbox and radio items.
  itemBase: {
    display: "flex",
    cursor: "default",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: radius.sm,
    paddingTop: "0.375rem",
    paddingBottom: "0.375rem",
    paddingRight: "0.5rem",
    paddingLeft: {
      default: "0.5rem",
      ":is([data-inset])": "2rem",
    },
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    // `outline-hidden`: no outline, but a transparent one in forced-colors mode.
    outlineStyle: { default: "none", "@media (forced-colors: active)": "solid" },
    outlineWidth: { default: null, "@media (forced-colors: active)": "2px" },
    outlineColor: { default: null, "@media (forced-colors: active)": "transparent" },
    outlineOffset: { default: null, "@media (forced-colors: active)": "2px" },
    userSelect: "none",
    backgroundColor: {
      default: null,
      ":is([data-highlighted])": colors.accent,
    },
    color: {
      default: null,
      ":is([data-highlighted])": colors.accentForeground,
    },
    pointerEvents: {
      default: null,
      ":is([data-disabled])": "none",
    },
    opacity: {
      default: null,
      ":is([data-disabled])": 0.5,
    },
  },
  item: {
    position: "relative",
    backgroundColor: {
      default: null,
      ":is([data-highlighted]:not([data-variant=destructive]))": colors.accent,
      ":is([data-highlighted][data-variant=destructive])": `light-dark(color-mix(in oklch, ${colors.destructive} 10%, transparent), color-mix(in oklch, ${colors.destructive} 20%, transparent))`,
    },
    color: {
      default: null,
      ":is([data-highlighted]:not([data-variant=destructive]))": colors.accentForeground,
      ":is([data-variant=destructive])": colors.destructive,
    },
  },
  subTrigger: {
    // Sub-triggers have no disabled styles in shadcn.
    pointerEvents: null,
    opacity: null,
    backgroundColor: {
      default: null,
      ":is([data-highlighted], [data-popup-open], [data-open])": colors.accent,
    },
    color: {
      default: null,
      ":is([data-highlighted], [data-popup-open], [data-open])": colors.accentForeground,
    },
  },
  checkItem: {
    position: "relative",
    paddingRight: "2rem",
  },
  indicator: {
    pointerEvents: "none",
    position: "absolute",
    right: "0.5rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    pointerEvents: "none",
    flexShrink: 0,
  },
  chevron: {
    marginLeft: "auto",
  },
  separator: {
    marginInline: "-0.25rem",
    marginBlock: "0.25rem",
    height: "1px",
    backgroundColor: colors.border,
  },
  shortcut: {
    marginLeft: "auto",
    fontSize: "0.75rem",
    lineHeight: "1rem",
    letterSpacing: "0.1em",
    color: {
      default: colors.mutedForeground,
      [stylex.when.ancestor(":is([data-highlighted])", menuItem)]: colors.accentForeground,
    },
  },
})

type XStyle = { class?: string; xstyle?: stylex.StyleXStyles }

function DropdownMenu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal(props: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

type DropdownMenuContentProps = Omit<MenuPrimitive.Popup.Props, "class"> &
  Pick<MenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset"> &
  XStyle

function DropdownMenuContent(props: DropdownMenuContentProps) {
  const rest = omit(props, "align", "alignOffset", "side", "sideOffset", "class", "xstyle")
  const attrs = () =>
    stylex.attrs(
      animate.openClosed,
      animate.fadeIn0,
      animate.fadeOut0,
      animate.zoomIn95,
      animate.zoomOut95,
      animate.slideInFromSide2,
      styles.content,
      props.xstyle,
    )
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        class={stylex.attrs(styles.positioner).class}
        align={props.align ?? "start"}
        alignOffset={props.alignOffset ?? 0}
        side={props.side ?? "bottom"}
        sideOffset={props.sideOffset ?? 4}
      >
        <MenuPrimitive.Popup data-slot="dropdown-menu-content" {...rest} class={cx(attrs().class, props.class)} />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

type DropdownMenuLabelProps = Omit<MenuPrimitive.GroupLabel.Props, "class"> & XStyle & { inset?: boolean }

function DropdownMenuLabel(props: DropdownMenuLabelProps) {
  const rest = omit(props, "class", "xstyle", "inset")
  const attrs = () => stylex.attrs(styles.label, props.xstyle)
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={props.inset}
      {...rest}
      class={cx(attrs().class, props.class)}
    />
  )
}

type DropdownMenuItemProps = Omit<MenuPrimitive.Item.Props, "class"> &
  XStyle & {
    inset?: boolean
    variant?: "default" | "destructive"
  }

function DropdownMenuItem(props: DropdownMenuItemProps) {
  const rest = omit(props, "class", "xstyle", "inset", "variant")
  const attrs = () => stylex.attrs(menuItem, styles.itemBase, styles.item, props.xstyle)
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={props.inset}
      data-variant={props.variant ?? "default"}
      {...rest}
      class={cx(attrs().class, props.class)}
    />
  )
}

function DropdownMenuSub(props: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

type DropdownMenuSubTriggerProps = Omit<MenuPrimitive.SubmenuTrigger.Props, "class"> & XStyle & { inset?: boolean }

function DropdownMenuSubTrigger(props: DropdownMenuSubTriggerProps) {
  const rest = omit(props, "class", "xstyle", "inset", "children")
  const attrs = () => stylex.attrs(menuItem, styles.itemBase, styles.subTrigger, props.xstyle)
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={props.inset}
      {...rest}
      class={cx(attrs().class, props.class)}
    >
      {props.children}
      <Icon icon={ChevronRight} {...stylex.attrs(styles.icon, styles.chevron)} />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent(props: DropdownMenuContentProps) {
  const rest = omit(props, "xstyle", "align", "alignOffset", "side", "sideOffset")
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      xstyle={[styles.subContent, props.xstyle]}
      align={props.align ?? "start"}
      alignOffset={props.alignOffset ?? -3}
      side={props.side ?? "right"}
      sideOffset={props.sideOffset ?? 0}
      {...rest}
    />
  )
}

type DropdownMenuCheckboxItemProps = Omit<MenuPrimitive.CheckboxItem.Props, "class"> & XStyle & { inset?: boolean }

function DropdownMenuCheckboxItem(props: DropdownMenuCheckboxItemProps) {
  const rest = omit(props, "class", "xstyle", "children", "inset")
  const attrs = () => stylex.attrs(menuItem, styles.itemBase, styles.checkItem, props.xstyle)
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={props.inset}
      {...rest}
      class={cx(attrs().class, props.class)}
    >
      <span {...stylex.attrs(styles.indicator)} data-slot="dropdown-menu-checkbox-item-indicator">
        <MenuPrimitive.CheckboxItemIndicator>
          <Icon icon={Check} {...stylex.attrs(styles.icon)} />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {props.children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

type DropdownMenuRadioItemProps = Omit<MenuPrimitive.RadioItem.Props, "class"> & XStyle & { inset?: boolean }

function DropdownMenuRadioItem(props: DropdownMenuRadioItemProps) {
  const rest = omit(props, "class", "xstyle", "children", "inset")
  const attrs = () => stylex.attrs(menuItem, styles.itemBase, styles.checkItem, props.xstyle)
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={props.inset}
      {...rest}
      class={cx(attrs().class, props.class)}
    >
      <span {...stylex.attrs(styles.indicator)} data-slot="dropdown-menu-radio-item-indicator">
        <MenuPrimitive.RadioItemIndicator>
          <Icon icon={Check} {...stylex.attrs(styles.icon)} />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {props.children}
    </MenuPrimitive.RadioItem>
  )
}

type DropdownMenuSeparatorProps = Omit<MenuPrimitive.Separator.Props, "class"> & XStyle

function DropdownMenuSeparator(props: DropdownMenuSeparatorProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.separator, props.xstyle)
  return <MenuPrimitive.Separator data-slot="dropdown-menu-separator" {...rest} class={cx(attrs().class, props.class)} />
}

type DropdownMenuShortcutProps = Omit<ComponentProps<"span">, "class"> & XStyle

function DropdownMenuShortcut(props: DropdownMenuShortcutProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.shortcut, props.xstyle)
  return <span data-slot="dropdown-menu-shortcut" {...rest} class={cx(attrs().class, props.class)} />
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
