import { omit } from "solid-js"
import type { JSX } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { groupMarker, peerMarker } from "../lib/markers.stylex"
import { cx } from "../lib/utils"
import { mergeStyle } from "../lib/style"

// Port of shadcn/ui's base-vega `label`. `group-data-[disabled=true]:` and `peer-disabled:`
// become `stylex.when.ancestor` / `stylex.when.siblingBefore` on `groupMarker` / `peerMarker`.
const styles = stylex.create({
  base: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.875rem",
    lineHeight: 1,
    fontWeight: 500,
    userSelect: "none",
    pointerEvents: {
      default: null,
      [stylex.when.ancestor(":is([data-disabled=true])", groupMarker)]: "none",
    },
    cursor: {
      default: null,
      [stylex.when.siblingBefore(":disabled", peerMarker)]: "not-allowed",
    },
    opacity: {
      default: null,
      [stylex.when.ancestor(":is([data-disabled=true])", groupMarker)]: 0.5,
      [stylex.when.siblingBefore(":disabled", peerMarker)]: 0.5,
    },
  },
})

type LabelProps = Omit<JSX.LabelHTMLAttributes<HTMLLabelElement>, "class" | "style"> & {
  class?: string
  style?: JSX.CSSProperties
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

function Label(props: LabelProps) {
  const rest = omit(props, "class", "style", "xstyle")
  const attrs = () => stylex.attrs(styles.base, props.xstyle)
  return <label data-slot="label" {...rest} class={cx(attrs().class, props.class)} style={mergeStyle(attrs().style, props.style)} />
}

export { Label, type LabelProps }
