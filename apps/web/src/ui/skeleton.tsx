import { omit } from "solid-js"
import type { JSX } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { colors, radius } from "../lib/tokens.stylex"
import { cx } from "../lib/utils"

// Tailwind's `animate-pulse`.
const pulse = stylex.keyframes({
  "50%": { opacity: 0.5 },
})

const styles = stylex.create({
  base: {
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite",
    borderRadius: radius.md,
    backgroundColor: colors.muted,
  },
})

type SkeletonProps = Omit<JSX.IntrinsicElements["div"], "class"> & {
  class?: string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

function Skeleton(props: SkeletonProps) {
  const rest = omit(props, "class", "xstyle")
  return <div data-slot="skeleton" {...rest} class={cx(stylex.attrs(styles.base, props.xstyle).class, props.class)} />
}

export { Skeleton, type SkeletonProps }
