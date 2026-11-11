import { omit } from "solid-js"
import * as stylex from "@stylexjs/stylex"
import { Separator as SeparatorPrimitive } from "base-ui-solidjs/separator"
import { colors } from "../lib/tokens.stylex"
import { cx } from "../lib/utils"

const styles = stylex.create({
  base: { flexShrink: 0, backgroundColor: colors.border },
  horizontal: { height: "1px", width: "100%" },
  vertical: { width: "1px", alignSelf: "stretch" },
})

type SeparatorProps = Omit<SeparatorPrimitive.Props, "class"> & {
  class?: string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

function Separator(props: SeparatorProps) {
  const rest = omit(props, "class", "orientation", "xstyle")
  const orientation = () => props.orientation ?? "horizontal"
  const isVertical = () => orientation() === "vertical"
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation()}
      {...rest}
      class={cx(
        stylex.attrs(styles.base, isVertical() ? styles.vertical : styles.horizontal, props.xstyle).class,
        props.class,
      )}
    />
  )
}

export { Separator, type SeparatorProps }
