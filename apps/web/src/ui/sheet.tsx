import { omit, Show } from "solid-js"
import type { ComponentProps } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { Dialog as SheetPrimitive } from "base-ui-solidjs/dialog"
import { X } from "lucide"
import { Icon } from "./icon"
import { colors } from "../lib/tokens.stylex"
import { a11y } from "../lib/a11y"
import { cx } from "../lib/utils"
import { Button, type ButtonProps } from "./button"

// Port of shadcn/ui's base-vega `sheet` (see the Tailwind variant for the source classes).
// The sheet uses Base UI's transition-based animation, not tw-animate keyframes: the popup and the
// backdrop start/end at `opacity: 0` (and the popup 2.5rem off its side) while Base UI sets
// `data-starting-style`/`data-ending-style`, and CSS transitions run between the states.
// `data-[side=*]:data-starting-style:translate-*` becomes one style per side (picked from `side`)
// with `:is([data-starting-style])`/`:is([data-ending-style])` conditions.

// Tailwind v4's `transition` utility (minus `-webkit-backdrop-filter`, which LightningCSS drops from StyleX's output).
const TRANSITION_PROPERTY =
  "color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to, opacity, box-shadow, transform, translate, scale, rotate, filter, backdrop-filter, display, content-visibility, overlay, pointer-events"
const EASE_IN_OUT = "cubic-bezier(0.4, 0, 0.2, 1)"
const sm = "@media (min-width: 40rem)"

const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    backgroundColor: "rgb(0 0 0 / 0.1)",
    transitionProperty: "opacity",
    transitionTimingFunction: EASE_IN_OUT,
    transitionDuration: "150ms",
    opacity: {
      default: null,
      ":is([data-starting-style])": 0,
      ":is([data-ending-style])": 0,
    },
    backdropFilter: "blur(4px)",
  },
  content: {
    position: "fixed",
    zIndex: 50,
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    backgroundColor: colors.popover,
    backgroundClip: "padding-box",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    color: colors.popoverForeground,
    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    transitionProperty: TRANSITION_PROPERTY,
    transitionTimingFunction: EASE_IN_OUT,
    transitionDuration: "200ms",
    opacity: {
      default: null,
      ":is([data-starting-style])": 0,
      ":is([data-ending-style])": 0,
    },
  },
  bottom: {
    insetInline: 0,
    bottom: 0,
    height: "auto",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    translate: {
      default: null,
      ":is([data-starting-style])": "0 2.5rem",
      ":is([data-ending-style])": "0 2.5rem",
    },
  },
  left: {
    insetBlock: 0,
    left: 0,
    height: "100%",
    width: "75%",
    maxWidth: { default: null, [sm]: "24rem" },
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.border,
    translate: {
      default: null,
      ":is([data-starting-style])": "-2.5rem 0",
      ":is([data-ending-style])": "-2.5rem 0",
    },
  },
  right: {
    insetBlock: 0,
    right: 0,
    height: "100%",
    width: "75%",
    maxWidth: { default: null, [sm]: "24rem" },
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: colors.border,
    translate: {
      default: null,
      ":is([data-starting-style])": "2.5rem 0",
      ":is([data-ending-style])": "2.5rem 0",
    },
  },
  top: {
    insetInline: 0,
    top: 0,
    height: "auto",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    translate: {
      default: null,
      ":is([data-starting-style])": "0 -2.5rem",
      ":is([data-ending-style])": "0 -2.5rem",
    },
  },
  close: {
    position: "absolute",
    top: "1rem",
    right: "1rem",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
    padding: "1rem",
  },
  footer: {
    marginTop: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    padding: "1rem",
  },
  title: {
    fontWeight: 500,
    color: colors.foreground,
  },
  description: {
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    color: colors.mutedForeground,
  },
})

const sideStyles = {
  top: styles.top,
  right: styles.right,
  bottom: styles.bottom,
  left: styles.left,
}

type XStyle = { class?: string; xstyle?: stylex.StyleXStyles }

function Sheet(props: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger(props: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose(props: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal(props: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

type SheetOverlayProps = Omit<SheetPrimitive.Backdrop.Props, "class"> & XStyle

function SheetOverlay(props: SheetOverlayProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.overlay, props.xstyle)
  return <SheetPrimitive.Backdrop data-slot="sheet-overlay" {...rest} class={cx(attrs().class, props.class)} />
}

type SheetContentProps = Omit<SheetPrimitive.Popup.Props, "class"> &
  XStyle & {
    side?: "top" | "right" | "bottom" | "left"
    showCloseButton?: boolean
  }

function SheetContent(props: SheetContentProps) {
  const rest = omit(props, "class", "xstyle", "children", "side", "showCloseButton")
  const side = () => props.side ?? "right"
  const sideStyle = () => sideStyles[side()]
  const attrs = () => stylex.attrs(styles.content, sideStyle(), props.xstyle)
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup data-slot="sheet-content" data-side={side()} {...rest} class={cx(attrs().class, props.class)}>
        {props.children}
        <Show when={props.showCloseButton ?? true}>
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={(p) => <Button {...(p as ButtonProps)} variant="ghost" size="icon-sm" xstyle={styles.close} />}
          >
            <Icon icon={X} />
            <span {...stylex.attrs(a11y.srOnly)}>Close</span>
          </SheetPrimitive.Close>
        </Show>
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

type DivProps = Omit<ComponentProps<"div">, "class"> & XStyle

function SheetHeader(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.header, props.xstyle)
  return <div data-slot="sheet-header" {...rest} class={cx(attrs().class, props.class)} />
}

function SheetFooter(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.footer, props.xstyle)
  return <div data-slot="sheet-footer" {...rest} class={cx(attrs().class, props.class)} />
}

type SheetTitleProps = Omit<SheetPrimitive.Title.Props, "class"> & XStyle

function SheetTitle(props: SheetTitleProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.title, props.xstyle)
  return <SheetPrimitive.Title data-slot="sheet-title" {...rest} class={cx(attrs().class, props.class)} />
}

type SheetDescriptionProps = Omit<SheetPrimitive.Description.Props, "class"> & XStyle

function SheetDescription(props: SheetDescriptionProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.description, props.xstyle)
  return (
    <SheetPrimitive.Description data-slot="sheet-description" {...rest} class={cx(attrs().class, props.class)} />
  )
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
