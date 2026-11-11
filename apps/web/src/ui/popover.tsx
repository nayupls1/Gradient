import { omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { Popover as PopoverPrimitive } from "base-ui-solidjs/popover"
import { colors, radius } from "../lib/tokens.stylex"
import { animate } from "../lib/animate"
import { cx } from "../lib/utils"

// Port of shadcn/ui's base-vega `popover` (see the Tailwind variant for the source classes).
const styles = stylex.create({
  positioner: {
    isolation: "isolate",
    zIndex: 50,
  },
  content: {
    zIndex: 50,
    display: "flex",
    width: "18rem",
    transformOrigin: "var(--transform-origin)",
    flexDirection: "column",
    gap: "1rem",
    borderRadius: radius.md,
    backgroundColor: colors.popover,
    padding: "1rem",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    color: colors.popoverForeground,
    boxShadow: `0 0 0 1px color-mix(in oklch, ${colors.foreground} 10%, transparent), 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`,
    outline: "2px solid transparent",
    outlineOffset: "2px",
    transitionDuration: "100ms",
    animationDuration: "100ms",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
  },
  title: {
    fontWeight: 500,
  },
  description: {
    color: colors.mutedForeground,
  },
})

type XStyle = { class?: string; xstyle?: stylex.StyleXStyles }

function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

type PopoverContentProps = Omit<PopoverPrimitive.Popup.Props, "class"> &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset"> &
  XStyle

function PopoverContent(props: PopoverContentProps) {
  const rest = omit(props, "class", "xstyle", "align", "alignOffset", "side", "sideOffset")
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
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={props.align ?? "center"}
        alignOffset={props.alignOffset ?? 0}
        side={props.side ?? "bottom"}
        sideOffset={props.sideOffset ?? 4}
        class={stylex.attrs(styles.positioner).class}
      >
        <PopoverPrimitive.Popup data-slot="popover-content" {...rest} class={cx(attrs().class, props.class)} />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

type DivProps = Omit<ComponentProps<"div">, "class"> & XStyle

function PopoverHeader(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.header, props.xstyle)
  return <div data-slot="popover-header" {...rest} class={cx(attrs().class, props.class)} />
}

type PopoverTitleProps = Omit<PopoverPrimitive.Title.Props, "class"> & XStyle

function PopoverTitle(props: PopoverTitleProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.title, props.xstyle)
  return <PopoverPrimitive.Title data-slot="popover-title" {...rest} class={cx(attrs().class, props.class)} />
}

type PopoverDescriptionProps = Omit<PopoverPrimitive.Description.Props, "class"> & XStyle

function PopoverDescription(props: PopoverDescriptionProps) {
  const rest = omit(props, "class", "xstyle")
  const attrs = () => stylex.attrs(styles.description, props.xstyle)
  return (
    <PopoverPrimitive.Description data-slot="popover-description" {...rest} class={cx(attrs().class, props.class)} />
  )
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger }
