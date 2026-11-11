import { omit, Show } from "solid-js"
import type { ComponentProps } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { Dialog as DialogPrimitive } from "base-ui-solidjs/dialog"
import { X } from "lucide"
import { Icon } from "./icon"
import { colors, radius } from "../lib/tokens.stylex"
import { animate } from "../lib/animate"
import { a11y } from "../lib/a11y"
import { cx } from "../lib/utils"
import { Button, type ButtonProps } from "./button"

// Port of shadcn/ui's base-vega `dialog` (see the Tailwind variant for the source classes).
const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    isolation: "isolate",
    zIndex: 50,
    backgroundColor: "rgb(0 0 0 / 0.1)",
    backdropFilter: "blur(4px)",
    transitionDuration: "100ms",
    animationDuration: "100ms",
  },
  content: {
    position: "fixed",
    top: "50%",
    left: "50%",
    zIndex: 50,
    display: "grid",
    width: "100%",
    maxWidth: {
      default: "calc(100% - 2rem)",
      "@media (min-width: 40rem)": "28rem",
    },
    translate: "-50% -50%",
    gap: "1.5rem",
    borderRadius: radius.xl,
    backgroundColor: colors.popover,
    padding: "1.5rem",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    color: colors.popoverForeground,
    boxShadow: `0 0 0 1px color-mix(in oklch, ${colors.foreground} 10%, transparent)`,
    transitionDuration: "100ms",
    animationDuration: "100ms",
    outline: "none",
  },
  close: {
    position: "absolute",
    top: "1rem",
    right: "1rem",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  footer: {
    display: "flex",
    flexDirection: {
      default: "column-reverse",
      "@media (min-width: 40rem)": "row",
    },
    justifyContent: {
      default: null,
      "@media (min-width: 40rem)": "flex-end",
    },
    gap: "0.5rem",
  },
  title: {
    lineHeight: 1,
    fontWeight: 500,
  },
  description: {
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    color: colors.mutedForeground,
  },
})

type XStyle = { class?: string | undefined; xstyle?: stylex.StyleXStyles }

function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal(props: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

type DialogOverlayProps = Omit<DialogPrimitive.Backdrop.Props, "class"> & XStyle

function DialogOverlay(props: DialogOverlayProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(animate.openClosed, animate.fadeIn0, animate.fadeOut0, styles.overlay, props.xstyle)
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      {...rest}
      class={cx(attrs().class, props.class)}
    />
  )
}

type DialogContentProps = Omit<DialogPrimitive.Popup.Props, "class"> &
  XStyle & {
    showCloseButton?: boolean
  }

function DialogContent(props: DialogContentProps) {
  const rest = omit(props, "class", "xstyle", "children", "showCloseButton")
  const attrs = () =>
    stylex.attrs(
      animate.openClosed,
      animate.fadeIn0,
      animate.fadeOut0,
      animate.zoomIn95,
      animate.zoomOut95,
      styles.content,
      props.xstyle,
    )
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        {...rest}
        class={cx(attrs().class, props.class)}
       
      >
        {props.children}
        <Show when={props.showCloseButton ?? true}>
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={(p) => <Button {...(p as ButtonProps)} variant="ghost" size="icon-sm" xstyle={styles.close} />}
          >
            <Icon icon={X} />
            <span {...stylex.attrs(a11y.srOnly)}>Close</span>
          </DialogPrimitive.Close>
        </Show>
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

type DivProps = Omit<ComponentProps<"div">, "class"> & XStyle

function DialogHeader(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.header, props.xstyle)
  return <div data-slot="dialog-header" {...rest} class={cx(attrs().class, props.class)} />
}

function DialogFooter(props: DivProps & { showCloseButton?: boolean }) {
  const rest = omit(props, "class", "xstyle", "showCloseButton", "children")
  const attrs = () => stylex.attrs(styles.footer, props.xstyle)
  return (
    <div data-slot="dialog-footer" {...rest} class={cx(attrs().class, props.class)}>
      {props.children}
      <Show when={props.showCloseButton}>
        <DialogPrimitive.Close render={(p) => <Button {...(p as ButtonProps)} variant="outline" />}>Close</DialogPrimitive.Close>
      </Show>
    </div>
  )
}

type DialogTitleProps = Omit<DialogPrimitive.Title.Props, "class"> & XStyle

function DialogTitle(props: DialogTitleProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.title, props.xstyle)
  return (
    <DialogPrimitive.Title data-slot="dialog-title" {...rest} class={cx(attrs().class, props.class)} />
  )
}

type DialogDescriptionProps = Omit<DialogPrimitive.Description.Props, "class"> & XStyle

/** shadcn's `*:[a]:underline` link styling has no StyleX equivalent; style links in the description directly. */
function DialogDescription(props: DialogDescriptionProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.description, props.xstyle)
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      {...rest}
      class={cx(attrs().class, props.class)}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
