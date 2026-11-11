import { createContext, createMemo, createSignal, merge, omit, Show, useContext, type Accessor } from "solid-js"
import type { ComponentProps, JSX } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { useRender } from "base-ui-solidjs/use-render"
import { PanelLeft } from "lucide"
import { Icon } from "./icon"
import { colors, radius } from "../lib/tokens.stylex"
import {
  sidebarMarker,
  sidebarMenuButtonMarker,
  sidebarMenuItemMarker,
  sidebarRailMarker,
} from "../lib/markers/sidebar.stylex"
import { a11y } from "../lib/a11y"
import { cx } from "../lib/utils"
import { useIsMobile } from "../hooks/use-mobile"
import { Button, type ButtonProps } from "./button"
import { Input } from "./input"
import { Separator } from "./separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./sheet"
import { Skeleton } from "./skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

// Port of shadcn/ui's base-vega `sidebar` (see the Tailwind variant for the source classes).
//
// Tailwind's `group-data-[collapsible=icon]:*`, `group-data-[side=*]:*`, `group/menu-item` and
// `peer/menu-button` variants become `stylex.when.ancestor(...)` / `stylex.when.siblingBefore(...)`
// with named markers (lib/markers.stylex.ts): the sidebar root carries `sidebarMarker`, menu items
// `sidebarMenuItemMarker`, menu buttons `sidebarMenuButtonMarker`.
// Not expressible, and handled differently:
// - `[&_svg]:shrink-0` on menu buttons: icons need `flexShrink: 0` themselves, or they collapse to
//   nothing in the 2rem-wide icon mode (`Icon` already defaults to 16px for `[&_svg]:size-4`).
// - `[&>span:last-child]:truncate` on menu buttons: not ported (the button already clips with
//   `overflow: hidden`); truncate the label yourself if you need the ellipsis.
// - `[&>svg]:text-sidebar-accent-foreground` on sub buttons: not ported (icons inherit the text color).
// - The rail's `after:` line is a child `<span>` (StyleX can't combine a parent `:hover` with `::after`).
// - The mobile sheet hides its close button with `showCloseButton={false}` instead of `[&>button]:hidden`.

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "16rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"

const MD = "@media (min-width: 48rem)"
const SM = "@media (min-width: 40rem)"
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)"

const styles = stylex.create({
  wrapper: {
    display: "flex",
    minHeight: "100svh",
    width: "100%",
    backgroundColor: {
      default: null,
      ":has([data-variant=inset])": colors.sidebar,
    },
  },
  static: {
    display: "flex",
    height: "100%",
    width: "var(--sidebar-width)",
    flexDirection: "column",
    backgroundColor: colors.sidebar,
    color: colors.sidebarForeground,
  },
  mobileContent: {
    width: "var(--sidebar-width)",
    backgroundColor: colors.sidebar,
    padding: 0,
    color: colors.sidebarForeground,
  },
  mobileInner: {
    display: "flex",
    height: "100%",
    width: "100%",
    flexDirection: "column",
  },
  root: {
    display: { default: "none", [MD]: "block" },
    color: colors.sidebarForeground,
  },
  gap: {
    position: "relative",
    width: {
      default: "var(--sidebar-width)",
      [stylex.when.ancestor(":is([data-collapsible=offcanvas])", sidebarMarker)]: "0px",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "var(--sidebar-width-icon)",
    },
    backgroundColor: "transparent",
    transitionProperty: "width",
    transitionDuration: "200ms",
    transitionTimingFunction: "linear",
    rotate: {
      default: null,
      [stylex.when.ancestor(":is([data-side=right])", sidebarMarker)]: "180deg",
    },
  },
  gapFloating: {
    width: {
      default: "var(--sidebar-width)",
      [stylex.when.ancestor(":is([data-collapsible=offcanvas])", sidebarMarker)]: "0px",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "calc(var(--sidebar-width-icon) + 1rem)",
    },
  },
  container: {
    position: "fixed",
    top: 0,
    bottom: 0,
    zIndex: 10,
    display: { default: "none", [MD]: "flex" },
    height: "100svh",
    width: {
      default: "var(--sidebar-width)",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "var(--sidebar-width-icon)",
    },
    transitionProperty: "left, right, width",
    transitionDuration: "200ms",
    transitionTimingFunction: "linear",
  },
  containerLeft: {
    left: {
      default: 0,
      [stylex.when.ancestor(":is([data-collapsible=offcanvas])", sidebarMarker)]: "calc(var(--sidebar-width) * -1)",
    },
  },
  containerRight: {
    right: {
      default: 0,
      [stylex.when.ancestor(":is([data-collapsible=offcanvas])", sidebarMarker)]: "calc(var(--sidebar-width) * -1)",
    },
  },
  containerFloating: {
    padding: "0.5rem",
    width: {
      default: "var(--sidebar-width)",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]:
        "calc(var(--sidebar-width-icon) + 1rem + 2px)",
    },
  },
  containerBorderLeft: {
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: colors.border,
  },
  containerBorderRight: {
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: colors.border,
  },
  inner: {
    display: "flex",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: colors.sidebar,
  },
  innerFloating: {
    borderRadius: radius.lg,
    boxShadow: `0 0 0 1px ${colors.sidebarBorder}, 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)`,
  },
  rail: {
    position: "absolute",
    top: 0,
    bottom: 0,
    zIndex: 20,
    display: { default: "none", [SM]: "flex" },
    width: "1rem",
    padding: 0,
    borderWidth: 0,
    backgroundColor: {
      default: "transparent",
      [stylex.when.ancestor(":is([data-collapsible=offcanvas])", sidebarMarker)]: {
        default: "transparent",
        ":hover": colors.sidebar,
      },
    },
    transitionProperty: "all",
    transitionDuration: "150ms",
    transitionTimingFunction: "linear",
    translate: {
      default: "-50% 0",
      [stylex.when.ancestor(":is([data-collapsible=offcanvas])", sidebarMarker)]: "0 0",
    },
    right: {
      default: null,
      [stylex.when.ancestor(":is([data-side=left])", sidebarMarker)]: "-1rem",
      [stylex.when.ancestor(":is([data-side=left][data-collapsible=offcanvas])", sidebarMarker)]: "-0.5rem",
    },
    left: {
      default: null,
      [stylex.when.ancestor(":is([data-side=right])", sidebarMarker)]: 0,
      [stylex.when.ancestor(":is([data-side=right][data-collapsible=offcanvas])", sidebarMarker)]: "-0.5rem",
    },
    cursor: {
      default: null,
      [stylex.when.ancestor(":is([data-side=left])", sidebarMarker)]: "w-resize",
      [stylex.when.ancestor(":is([data-side=right])", sidebarMarker)]: "e-resize",
      [stylex.when.ancestor(":is([data-side=left][data-state=collapsed])", sidebarMarker)]: "e-resize",
      [stylex.when.ancestor(":is([data-side=right][data-state=collapsed])", sidebarMarker)]: "w-resize",
    },
  },
  railLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    insetInlineStart: {
      default: "50%",
      [stylex.when.ancestor(":is([data-collapsible=offcanvas])", sidebarMarker)]: "100%",
    },
    width: "2px",
    backgroundColor: {
      default: null,
      [stylex.when.ancestor(":hover", sidebarRailMarker)]: colors.sidebarBorder,
    },
    pointerEvents: "none",
  },
  inset: {
    position: "relative",
    display: "flex",
    width: "100%",
    flex: "1 1 0%",
    flexDirection: "column",
    backgroundColor: colors.background,
    marginTop: {
      default: null,
      [MD]: { default: null, [stylex.when.siblingBefore(":is([data-variant=inset])", sidebarMarker)]: "0.5rem" },
    },
    marginRight: {
      default: null,
      [MD]: { default: null, [stylex.when.siblingBefore(":is([data-variant=inset])", sidebarMarker)]: "0.5rem" },
    },
    marginBottom: {
      default: null,
      [MD]: { default: null, [stylex.when.siblingBefore(":is([data-variant=inset])", sidebarMarker)]: "0.5rem" },
    },
    marginLeft: {
      default: null,
      [MD]: {
        default: null,
        [stylex.when.siblingBefore(":is([data-variant=inset])", sidebarMarker)]: 0,
        [stylex.when.siblingBefore(":is([data-variant=inset][data-state=collapsed])", sidebarMarker)]: "0.5rem",
      },
    },
    borderRadius: {
      default: null,
      [MD]: { default: null, [stylex.when.siblingBefore(":is([data-variant=inset])", sidebarMarker)]: radius.xl },
    },
    boxShadow: {
      default: null,
      [MD]: {
        default: null,
        [stylex.when.siblingBefore(":is([data-variant=inset])", sidebarMarker)]:
          "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
      },
    },
  },
  input: {
    height: "2rem",
    width: "100%",
    backgroundColor: colors.background,
    boxShadow: {
      default: "none",
      ":focus-visible": `0 0 0 3px color-mix(in oklch, ${colors.ring} 50%, transparent)`,
    },
  },
  headerFooter: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    padding: "0.5rem",
  },
  separator: {
    marginInline: "0.5rem",
    width: "auto",
    backgroundColor: colors.sidebarBorder,
  },
  content: {
    display: "flex",
    minHeight: 0,
    flex: "1 1 0%",
    flexDirection: "column",
    gap: "0.5rem",
    overflow: {
      default: "auto",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "hidden",
    },
    scrollbarWidth: "none",
    "::-webkit-scrollbar": { display: "none" },
  },
  group: {
    position: "relative",
    display: "flex",
    width: "100%",
    minWidth: 0,
    flexDirection: "column",
    padding: "0.5rem",
  },
  groupLabel: {
    display: "flex",
    height: "2rem",
    flexShrink: 0,
    alignItems: "center",
    borderRadius: radius.md,
    paddingInline: "0.5rem",
    fontSize: "0.75rem",
    lineHeight: "1rem",
    fontWeight: 500,
    color: `color-mix(in oklch, ${colors.sidebarForeground} 70%, transparent)`,
    outline: "2px solid transparent",
    outlineOffset: "2px",
    transitionProperty: "margin, opacity",
    transitionDuration: "200ms",
    transitionTimingFunction: "linear",
    marginTop: {
      default: null,
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "-2rem",
    },
    opacity: {
      default: null,
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: 0,
    },
    boxShadow: { default: null, ":focus-visible": `0 0 0 2px ${colors.sidebarRing}` },
  },
  action: {
    position: "absolute",
    display: {
      default: "flex",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "none",
    },
    aspectRatio: "1 / 1",
    width: "1.25rem",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    padding: 0,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": colors.sidebarAccent },
    color: { default: colors.sidebarForeground, ":hover": colors.sidebarAccentForeground },
    outline: "2px solid transparent",
    outlineOffset: "2px",
    transitionProperty: "transform",
    transitionDuration: "150ms",
    transitionTimingFunction: EASE,
    boxShadow: { default: null, ":focus-visible": `0 0 0 2px ${colors.sidebarRing}` },
    "::after": {
      content: '""',
      position: "absolute",
      inset: "-0.5rem",
      display: { default: null, [MD]: "none" },
    },
  },
  groupAction: {
    top: "0.875rem",
    right: "0.75rem",
  },
  groupContent: {
    width: "100%",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
  },
  menu: {
    display: "flex",
    width: "100%",
    minWidth: 0,
    flexDirection: "column",
    gap: "0.25rem",
  },
  menuItem: {
    position: "relative",
  },
  menuButton: {
    display: "flex",
    width: {
      default: "100%",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "2rem",
    },
    alignItems: "center",
    gap: "0.5rem",
    overflow: "hidden",
    borderRadius: radius.md,
    borderWidth: 0,
    paddingBlock: "0.5rem",
    paddingLeft: "0.5rem",
    paddingRight: {
      default: "0.5rem",
      [stylex.when.ancestor(":has([data-sidebar=menu-action])", sidebarMenuItemMarker)]: "2rem",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "0.5rem",
    },
    textAlign: "left",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    color: {
      default: "inherit",
      ":hover": colors.sidebarAccentForeground,
      ":active": colors.sidebarAccentForeground,
      ":is([data-active])": colors.sidebarAccentForeground,
    },
    backgroundColor: {
      default: "transparent",
      ":hover": colors.sidebarAccent,
      ":active": colors.sidebarAccent,
      ":is([data-active])": colors.sidebarAccent,
    },
    fontWeight: { default: null, ":is([data-active])": 500 },
    outline: "2px solid transparent",
    outlineOffset: "2px",
    transitionProperty: "width, height, padding",
    transitionDuration: "150ms",
    transitionTimingFunction: EASE,
    boxShadow: { default: null, ":focus-visible": `0 0 0 2px ${colors.sidebarRing}` },
    pointerEvents: { default: null, ":disabled": "none", ":is([aria-disabled=true])": "none" },
    opacity: { default: null, ":disabled": 0.5, ":is([aria-disabled=true])": 0.5 },
    textDecoration: "none",
  },
  menuButtonOutline: {
    backgroundColor: {
      default: colors.background,
      ":hover": colors.sidebarAccent,
      ":active": colors.sidebarAccent,
      ":is([data-active])": colors.sidebarAccent,
    },
    boxShadow: {
      default: `0 0 0 1px ${colors.sidebarBorder}`,
      ":hover": `0 0 0 1px ${colors.sidebarAccent}`,
      ":focus-visible": `0 0 0 2px ${colors.sidebarRing}`,
    },
  },
  menuButtonSizeDefault: {
    height: {
      default: "2rem",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "2rem",
    },
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
  },
  menuButtonSizeSm: {
    height: {
      default: "1.75rem",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "2rem",
    },
    fontSize: "0.75rem",
    lineHeight: "1rem",
  },
  menuButtonSizeLg: {
    height: {
      default: "3rem",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "2rem",
    },
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    paddingBlock: {
      default: "0.5rem",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: 0,
    },
    paddingLeft: {
      default: "0.5rem",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: 0,
    },
    paddingRight: {
      default: "0.5rem",
      [stylex.when.ancestor(":has([data-sidebar=menu-action])", sidebarMenuItemMarker)]: "2rem",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: 0,
    },
  },
  menuAction: {
    right: "0.25rem",
    top: {
      default: "0.375rem",
      [stylex.when.siblingBefore(":is([data-size=default])", sidebarMenuButtonMarker)]: "0.375rem",
      [stylex.when.siblingBefore(":is([data-size=lg])", sidebarMenuButtonMarker)]: "0.625rem",
      [stylex.when.siblingBefore(":is([data-size=sm])", sidebarMenuButtonMarker)]: "0.25rem",
    },
    color: {
      default: colors.sidebarForeground,
      [stylex.when.siblingBefore(":hover", sidebarMenuButtonMarker)]: colors.sidebarAccentForeground,
      ":hover": colors.sidebarAccentForeground,
    },
  },
  menuActionShowOnHover: {
    color: {
      default: colors.sidebarForeground,
      [stylex.when.siblingBefore(":hover", sidebarMenuButtonMarker)]: colors.sidebarAccentForeground,
      [stylex.when.siblingBefore(":is([data-active])", sidebarMenuButtonMarker)]: colors.sidebarAccentForeground,
      ":hover": colors.sidebarAccentForeground,
    },
    opacity: {
      default: null,
      [MD]: {
        default: 0,
        [stylex.when.ancestor(":hover", sidebarMenuItemMarker)]: 1,
        [stylex.when.ancestor(":focus-within", sidebarMenuItemMarker)]: 1,
        ":is([aria-expanded=true])": 1,
      },
    },
  },
  menuBadge: {
    pointerEvents: "none",
    position: "absolute",
    right: "0.25rem",
    top: {
      default: null,
      [stylex.when.siblingBefore(":is([data-size=default])", sidebarMenuButtonMarker)]: "0.375rem",
      [stylex.when.siblingBefore(":is([data-size=lg])", sidebarMenuButtonMarker)]: "0.625rem",
      [stylex.when.siblingBefore(":is([data-size=sm])", sidebarMenuButtonMarker)]: "0.25rem",
    },
    display: {
      default: "flex",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "none",
    },
    height: "1.25rem",
    minWidth: "1.25rem",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    paddingInline: "0.25rem",
    fontSize: "0.75rem",
    lineHeight: "1rem",
    fontWeight: 500,
    color: {
      default: colors.sidebarForeground,
      [stylex.when.siblingBefore(":hover", sidebarMenuButtonMarker)]: colors.sidebarAccentForeground,
      [stylex.when.siblingBefore(":is([data-active])", sidebarMenuButtonMarker)]: colors.sidebarAccentForeground,
    },
    fontVariantNumeric: "tabular-nums",
    userSelect: "none",
  },
  menuSkeleton: {
    display: "flex",
    height: "2rem",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: radius.md,
    paddingInline: "0.5rem",
  },
  menuSkeletonIcon: {
    width: "1rem",
    height: "1rem",
    borderRadius: radius.md,
  },
  menuSkeletonText: {
    height: "1rem",
    maxWidth: "var(--skeleton-width)",
    flex: "1 1 0%",
  },
  menuSub: {
    marginInline: "0.875rem",
    display: {
      default: "flex",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "none",
    },
    minWidth: 0,
    translate: "1px 0",
    flexDirection: "column",
    gap: "0.25rem",
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: colors.sidebarBorder,
    paddingInline: "0.625rem",
    paddingBlock: "0.125rem",
  },
  menuSubItem: {
    position: "relative",
  },
  menuSubButton: {
    display: {
      default: "flex",
      [stylex.when.ancestor(":is([data-collapsible=icon])", sidebarMarker)]: "none",
    },
    height: "1.75rem",
    minWidth: 0,
    translate: "-1px 0",
    alignItems: "center",
    gap: "0.5rem",
    overflow: "hidden",
    borderRadius: radius.md,
    paddingInline: "0.5rem",
    color: {
      default: colors.sidebarForeground,
      ":hover": colors.sidebarAccentForeground,
      ":active": colors.sidebarAccentForeground,
      ":is([data-active])": colors.sidebarAccentForeground,
    },
    backgroundColor: {
      default: null,
      ":hover": colors.sidebarAccent,
      ":active": colors.sidebarAccent,
      ":is([data-active])": colors.sidebarAccent,
    },
    outline: "2px solid transparent",
    outlineOffset: "2px",
    boxShadow: { default: null, ":focus-visible": `0 0 0 2px ${colors.sidebarRing}` },
    pointerEvents: { default: null, ":disabled": "none", ":is([aria-disabled=true])": "none" },
    opacity: { default: null, ":disabled": 0.5, ":is([aria-disabled=true])": 0.5 },
    fontSize: { default: null, ":is([data-size=md])": "0.875rem", ":is([data-size=sm])": "0.75rem" },
    lineHeight: { default: null, ":is([data-size=md])": "1.25rem", ":is([data-size=sm])": "1rem" },
    textDecoration: "none",
  },
})

type XStyle = { class?: string; xstyle?: stylex.StyleXStyles }

/** Styles, markers, or falsy values (stylex.attrs is generic, so its own parameter type is unusable here). */
type StyleArg = unknown

/**
 * `stylex.attrs` at runtime, plus an extra class. Inline `stylex.attrs(...)` calls get statically
 * evaluated by the StyleX compiler, which throws ("Unsupported expression: Identifier") on conditions
 * that call local accessors (`floatingOrInset() && styles.x`) or on an imported marker alone.
 */
function rx(styles: StyleArg[], extraClass?: string) {
  const a = stylex.attrs(styles as unknown as stylex.StyleXStyles)
  return { class: cx(a.class, extraClass) || undefined, style: a.style }
}

/**
 * shadcn's context holds plain values; in Solid they're getters so readers stay reactive
 * (`const sidebar = useSidebar(); sidebar.open` tracks, don't destructure).
 */
type SidebarContextProps = {
  readonly state: "expanded" | "collapsed"
  readonly open: boolean
  setOpen: (open: boolean | ((open: boolean) => boolean)) => void
  readonly openMobile: boolean
  setOpenMobile: (open: boolean | ((open: boolean) => boolean)) => void
  readonly isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

type DivProps = Omit<ComponentProps<"div">, "class"> & XStyle

type SidebarProviderProps = Omit<DivProps, "style"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  style?: JSX.CSSProperties
}

function SidebarProvider(props: SidebarProviderProps) {
  const rest = omit(props, "defaultOpen", "open", "onOpenChange", "class", "xstyle", "style", "children")
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = createSignal(false)

  // This is the internal state of the sidebar.
  // We use props.open and props.onOpenChange for control from outside the component.
  const [_open, _setOpen] = createSignal(props.defaultOpen ?? true)
  const open: Accessor<boolean> = () => props.open ?? _open()
  const setOpen = (value: boolean | ((value: boolean) => boolean)) => {
    const openState = typeof value === "function" ? value(open()) : value
    if (props.onOpenChange) {
      props.onOpenChange(openState)
    } else {
      _setOpen(openState)
    }

    // This sets the cookie to keep the sidebar state.
    document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
  }

  // Helper to toggle the sidebar.
  const toggleSidebar = () => (isMobile() ? setOpenMobile((open) => !open) : setOpen((open) => !open))

  // Gradient: shadcn's ⌘B window listener is a `sidebar.toggle` command instead (app/Shell.tsx),
  // so it shows in ⌘K and "?" and can be remapped.

  const state = createMemo(() => (open() ? "expanded" : "collapsed"))

  const contextValue: SidebarContextProps = {
    get state() {
      return state()
    },
    get open() {
      return open()
    },
    setOpen,
    get isMobile() {
      return isMobile()
    },
    get openMobile() {
      return openMobile()
    },
    setOpenMobile,
    toggleSidebar,
  }

  const attrs = () => stylex.attrs(styles.wrapper, props.xstyle)
  return (
    <SidebarContext value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={{
          "--sidebar-width": SIDEBAR_WIDTH,
          "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
          ...props.style,
        }}
        class={cx(attrs().class, props.class)}
        {...rest}
      >
        {props.children}
      </div>
    </SidebarContext>
  )
}

type SidebarProps = DivProps & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}

function Sidebar(props: SidebarProps) {
  const rest = omit(props, "side", "variant", "collapsible", "class", "xstyle", "children", "dir")
  const sidebar = useSidebar()
  const side = () => props.side ?? "left"
  const variant = () => props.variant ?? "sidebar"
  const collapsible = () => props.collapsible ?? "offcanvas"
  const floatingOrInset = () => variant() === "floating" || variant() === "inset"
  const isLeft = () => side() === "left"
  const isRight = () => side() === "right"
  const isFloating = () => variant() === "floating"
  const notFloatingOrInset = () => !floatingOrInset()

  return (
    <Show
      when={collapsible() !== "none"}
      fallback={
        <div
          data-slot="sidebar"
          class={cx(stylex.attrs(styles.static, props.xstyle).class, props.class)}
          {...rest}
        >
          {props.children}
        </div>
      }
    >
      <Show
        when={!sidebar.isMobile}
        fallback={
          <Sheet open={sidebar.openMobile} onOpenChange={(open) => sidebar.setOpenMobile(open)}>
            <SheetContent
              dir={props.dir}
              data-sidebar="sidebar"
              data-slot="sidebar"
              data-mobile="true"
              xstyle={styles.mobileContent}
              style={{ "--sidebar-width": SIDEBAR_WIDTH_MOBILE }}
              side={side()}
              showCloseButton={false}
            >
              <SheetHeader xstyle={a11y.srOnly}>
                <SheetTitle>Sidebar</SheetTitle>
                <SheetDescription>Displays the mobile sidebar.</SheetDescription>
              </SheetHeader>
              <div {...stylex.attrs(styles.mobileInner)}>{props.children}</div>
            </SheetContent>
          </Sheet>
        }
      >
        <div
          {...rx([sidebarMarker, styles.root])}
          data-state={sidebar.state}
          data-collapsible={sidebar.state === "collapsed" ? collapsible() : ""}
          data-variant={variant()}
          data-side={side()}
          data-slot="sidebar"
        >
          {/* This is what handles the sidebar gap on desktop */}
          <div data-slot="sidebar-gap" {...rx([styles.gap, floatingOrInset() && styles.gapFloating])} />
          <div
            data-slot="sidebar-container"
            data-side={side()}
            class={
              rx(
                [
                  styles.container,
                  isLeft() && styles.containerLeft,
                  isRight() && styles.containerRight,
                  floatingOrInset() && styles.containerFloating,
                  notFloatingOrInset() && isLeft() && styles.containerBorderLeft,
                  notFloatingOrInset() && isRight() && styles.containerBorderRight,
                  props.xstyle,
                ],
                props.class,
              ).class
            }
            {...rest}
          >
            <div
              data-sidebar="sidebar"
              data-slot="sidebar-inner"
              {...rx([styles.inner, isFloating() && styles.innerFloating])}
            >
              {props.children}
            </div>
          </div>
        </div>
      </Show>
    </Show>
  )
}

function SidebarTrigger(props: ButtonProps) {
  const rest = omit(props, "class", "onClick")
  const sidebar = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      class={props.class}
      onClick={(event: MouseEvent) => {
        const onClick = props.onClick
        if (typeof onClick === "function") (onClick as (event: MouseEvent) => void)(event)
        sidebar.toggleSidebar()
      }}
      {...rest}
    >
      <Icon icon={PanelLeft} />
      <span {...stylex.attrs(a11y.srOnly)}>Toggle Sidebar</span>
    </Button>
  )
}

function SidebarRail(props: Omit<ComponentProps<"button">, "class"> & XStyle) {
  const rest = omit(props, "class", "xstyle", "children")
  const sidebar = useSidebar()

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabindex={-1}
      onClick={() => sidebar.toggleSidebar()}
      title="Toggle Sidebar"
      class={cx(stylex.attrs(sidebarRailMarker, styles.rail, props.xstyle).class, props.class)}
      {...rest}
    >
      <span aria-hidden="true" {...stylex.attrs(styles.railLine)} />
      {props.children}
    </button>
  )
}

function SidebarInset(props: Omit<ComponentProps<"main">, "class"> & XStyle) {
  const rest = omit(props, "class", "xstyle")
  return <main data-slot="sidebar-inset" class={cx(stylex.attrs(styles.inset, props.xstyle).class, props.class)} {...rest} />
}

function SidebarInput(props: ComponentProps<typeof Input>) {
  const rest = omit(props, "xstyle")
  return <Input data-slot="sidebar-input" data-sidebar="input" {...rest} xstyle={[styles.input, props.xstyle]} />
}

function SidebarHeader(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      class={cx(stylex.attrs(styles.headerFooter, props.xstyle).class, props.class)}
      {...rest}
    />
  )
}

function SidebarFooter(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      class={cx(stylex.attrs(styles.headerFooter, props.xstyle).class, props.class)}
      {...rest}
    />
  )
}

function SidebarSeparator(props: ComponentProps<typeof Separator>) {
  const rest = omit(props, "xstyle")
  return (
    <Separator data-slot="sidebar-separator" data-sidebar="separator" {...rest} xstyle={[styles.separator, props.xstyle]} />
  )
}

function SidebarContent(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      class={cx(stylex.attrs(styles.content, props.xstyle).class, props.class)}
      {...rest}
    />
  )
}

function SidebarGroup(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      class={cx(stylex.attrs(styles.group, props.xstyle).class, props.class)}
      {...rest}
    />
  )
}

type RenderProps<T extends keyof JSX.IntrinsicElements> = Omit<useRender.ComponentProps<T>, "class"> & XStyle

function SidebarGroupLabel(props: RenderProps<"div">) {
  const rest = omit(props, "class", "xstyle", "render")
  return useRender({
    defaultTagName: "div",
    props: merge(rest, {
      get class() {
        return cx(stylex.attrs(styles.groupLabel, props.xstyle).class, props.class)
      },
    }),
    get render() {
      return props.render
    },
    state: {
      slot: "sidebar-group-label",
      sidebar: "group-label",
    },
  })
}

function SidebarGroupAction(props: RenderProps<"button">) {
  const rest = omit(props, "class", "xstyle", "render")
  return useRender({
    defaultTagName: "button",
    props: merge(rest, {
      get class() {
        return cx(stylex.attrs(styles.action, styles.groupAction, props.xstyle).class, props.class)
      },
    }),
    get render() {
      return props.render
    },
    state: {
      slot: "sidebar-group-action",
      sidebar: "group-action",
    },
  })
}

function SidebarGroupContent(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      class={cx(stylex.attrs(styles.groupContent, props.xstyle).class, props.class)}
      {...rest}
    />
  )
}

function SidebarMenu(props: Omit<ComponentProps<"ul">, "class"> & XStyle) {
  const rest = omit(props, "class", "xstyle")
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      class={cx(stylex.attrs(styles.menu, props.xstyle).class, props.class)}
      {...rest}
    />
  )
}

function SidebarMenuItem(props: Omit<ComponentProps<"li">, "class"> & XStyle) {
  const rest = omit(props, "class", "xstyle")
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      class={cx(stylex.attrs(sidebarMenuItemMarker, styles.menuItem, props.xstyle).class, props.class)}
      {...rest}
    />
  )
}

const menuButtonVariants = {
  default: null,
  outline: styles.menuButtonOutline,
}

const menuButtonSizes = {
  default: styles.menuButtonSizeDefault,
  sm: styles.menuButtonSizeSm,
  lg: styles.menuButtonSizeLg,
}

type SidebarMenuButtonVariant = keyof typeof menuButtonVariants
type SidebarMenuButtonSize = keyof typeof menuButtonSizes

/** The StyleX counterpart of shadcn's `sidebarMenuButtonVariants` cva. */
function sidebarMenuButtonStyles(opts: { variant?: SidebarMenuButtonVariant | null | undefined; size?: SidebarMenuButtonSize | null | undefined }) {
  return [
    sidebarMenuButtonMarker,
    styles.menuButton,
    menuButtonVariants[opts.variant ?? "default"],
    menuButtonSizes[opts.size ?? "default"],
  ]
}

type TooltipTriggerProps = ComponentProps<typeof TooltipTrigger>

type SidebarMenuButtonProps = RenderProps<"button"> & {
  isActive?: boolean
  tooltip?: string | ComponentProps<typeof TooltipContent>
  variant?: SidebarMenuButtonVariant | null
  size?: SidebarMenuButtonSize | null
}

function SidebarMenuButton(props: SidebarMenuButtonProps) {
  const rest = omit(props, "render", "isActive", "variant", "size", "tooltip", "class", "xstyle")
  const sidebar = useSidebar()
  const comp = (render: RenderProps<"button">["render"]) =>
    useRender({
      defaultTagName: "button",
      props: merge(rest, {
        get class() {
          return cx(
            stylex.attrs(...sidebarMenuButtonStyles({ variant: props.variant, size: props.size }), props.xstyle).class,
            props.class,
          )
        },
      }),
      render,
      state: () => ({
        slot: "sidebar-menu-button",
        sidebar: "menu-button",
        size: props.size ?? "default",
        active: props.isActive ?? false,
      }),
    })

  const tooltipProps = (): ComponentProps<typeof TooltipContent> => {
    const tooltip = props.tooltip
    return typeof tooltip === "string" ? { children: tooltip } : (tooltip ?? {})
  }

  return (
    <Show when={props.tooltip} fallback={comp(props.render)}>
      <Tooltip>
        {/* shadcn: `render: <TooltipTrigger render={render} />`. The function form keeps Base UI's
            props (a component JSX element can't be used as `render` in Solid 2). */}
        {comp((p) => <TooltipTrigger {...(p as TooltipTriggerProps)} render={props.render} />)}
        <TooltipContent
          side="right"
          align="center"
          hidden={sidebar.state !== "collapsed" || sidebar.isMobile}
          {...tooltipProps()}
        />
      </Tooltip>
    </Show>
  )
}

type SidebarMenuActionProps = RenderProps<"button"> & {
  showOnHover?: boolean
}

function SidebarMenuAction(props: SidebarMenuActionProps) {
  const rest = omit(props, "class", "xstyle", "render", "showOnHover")
  return useRender({
    defaultTagName: "button",
    props: merge(rest, {
      get class() {
        return cx(
          stylex.attrs(styles.action, styles.menuAction, props.showOnHover && styles.menuActionShowOnHover, props.xstyle)
            .class,
          props.class,
        )
      },
    }),
    get render() {
      return props.render
    },
    state: {
      slot: "sidebar-menu-action",
      sidebar: "menu-action",
    },
  })
}

function SidebarMenuBadge(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      class={cx(stylex.attrs(styles.menuBadge, props.xstyle).class, props.class)}
      {...rest}
    />
  )
}

function SidebarMenuSkeleton(props: DivProps & { showIcon?: boolean }) {
  const rest = omit(props, "class", "xstyle", "showIcon")
  // Random width between 50 to 90%.
  const width = `${Math.floor(Math.random() * 40) + 50}%`

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      class={cx(stylex.attrs(styles.menuSkeleton, props.xstyle).class, props.class)}
      {...rest}
    >
      <Show when={props.showIcon}>
        <Skeleton xstyle={styles.menuSkeletonIcon} data-sidebar="menu-skeleton-icon" />
      </Show>
      <Skeleton xstyle={styles.menuSkeletonText} data-sidebar="menu-skeleton-text" style={{ "--skeleton-width": width }} />
    </div>
  )
}

function SidebarMenuSub(props: Omit<ComponentProps<"ul">, "class"> & XStyle) {
  const rest = omit(props, "class", "xstyle")
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      class={cx(stylex.attrs(styles.menuSub, props.xstyle).class, props.class)}
      {...rest}
    />
  )
}

function SidebarMenuSubItem(props: Omit<ComponentProps<"li">, "class"> & XStyle) {
  const rest = omit(props, "class", "xstyle")
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      class={cx(stylex.attrs(styles.menuSubItem, props.xstyle).class, props.class)}
      {...rest}
    />
  )
}

type SidebarMenuSubButtonProps = RenderProps<"a"> & {
  size?: "sm" | "md"
  isActive?: boolean
}

function SidebarMenuSubButton(props: SidebarMenuSubButtonProps) {
  const rest = omit(props, "class", "xstyle", "render", "size", "isActive")
  return useRender({
    defaultTagName: "a",
    props: merge(rest, {
      get class() {
        return cx(stylex.attrs(styles.menuSubButton, props.xstyle).class, props.class)
      },
    }),
    get render() {
      return props.render
    },
    state: () => ({
      slot: "sidebar-menu-sub-button",
      sidebar: "menu-sub-button",
      size: props.size ?? "md",
      active: props.isActive ?? false,
    }),
  })
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  sidebarMenuButtonStyles,
  useSidebar,
}
