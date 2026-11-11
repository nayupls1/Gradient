import { omit } from "solid-js"
import * as stylex from "@stylexjs/stylex"
import { Tooltip as TooltipPrimitive } from "base-ui-solidjs/tooltip"
import { colors, radius } from "../lib/tokens.stylex"
import { animate } from "../lib/animate"
import { tooltipContentMarker } from "../lib/markers.stylex"
import { cx } from "../lib/utils"

// Port of shadcn/ui's base-vega `tooltip` (see the Tailwind variant for the source classes).
const styles = stylex.create({
  positioner: {
    isolation: "isolate",
    zIndex: 50,
  },
  content: {
    zIndex: 50,
    display: "inline-flex",
    width: "fit-content",
    maxWidth: "20rem",
    transformOrigin: "var(--transform-origin)",
    alignItems: "center",
    gap: "0.375rem",
    borderRadius: radius.md,
    backgroundColor: colors.foreground,
    paddingBlock: "0.375rem",
    paddingLeft: "0.75rem",
    // `has-data-[slot=kbd]:pr-1.5`
    paddingRight: { default: "0.75rem", ":has([data-slot=kbd])": "0.375rem" },
    fontSize: "0.75rem",
    lineHeight: "1rem",
    color: colors.background,
  },
  arrow: {
    zIndex: 50,
    width: "0.625rem",
    height: "0.625rem",
    // `translate-y-[calc(-50%-2px)]`, `-translate-y-1/2` on the left/right sides.
    translate: {
      default: "0 calc(-50% - 2px)",
      ":is([data-side=left],[data-side=right],[data-side=inline-start],[data-side=inline-end])": "0 -50%",
    },
    rotate: "45deg",
    borderRadius: "2px",
    backgroundColor: colors.foreground,
    fill: colors.foreground,
    // `top-1/2!` overrides the `top` Base UI sets inline on the left/right sides.
    top: {
      default: null,
      ":is([data-side=bottom])": "0.25rem",
      ":is([data-side=left],[data-side=right],[data-side=inline-start],[data-side=inline-end])": "50% !important",
    },
    left: {
      default: null,
      ":is([data-side=right],[data-side=inline-end])": "-0.25rem",
    },
    right: {
      default: null,
      ":is([data-side=left],[data-side=inline-start])": "-0.25rem",
    },
    bottom: {
      default: null,
      ":is([data-side=top])": "-0.625rem",
    },
  },
})

type XStyle = { class?: string; xstyle?: stylex.StyleXStyles }

function TooltipProvider(props: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" {...props} delay={props.delay ?? 0} />
}

function Tooltip(props: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

type TooltipContentProps = Omit<TooltipPrimitive.Popup.Props, "class"> &
  Pick<TooltipPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset"> &
  XStyle

/**
 * shadcn's `**:data-[slot=kbd]:*` descendant styles (relative, isolate, z-50, rounded-sm on a Kbd
 * inside the tooltip) live in kbd.tsx as ancestor conditions on `tooltipContentMarker`.
 */
function TooltipContent(props: TooltipContentProps) {
  const rest = omit(props, "class", "xstyle", "side", "sideOffset", "align", "alignOffset", "children")
  const attrs = () =>
    stylex.attrs(
      tooltipContentMarker,
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
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={props.align ?? "center"}
        alignOffset={props.alignOffset ?? 0}
        side={props.side ?? "top"}
        sideOffset={props.sideOffset ?? 4}
        class={stylex.attrs(styles.positioner).class}
      >
        <TooltipPrimitive.Popup data-slot="tooltip-content" {...rest} class={cx(attrs().class, props.class)}>
          {props.children}
          <TooltipPrimitive.Arrow class={stylex.attrs(styles.arrow).class} />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
