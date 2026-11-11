import { createContext, omit, useContext } from "solid-js"
import type { JSX } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { colors, radius } from "../lib/tokens.stylex"
import { alertMarker } from "../lib/markers.stylex"
import { cx } from "../lib/utils"

// Port of shadcn/ui's base-vega `alert` (see the Tailwind variant for the source classes).
// StyleX can't style the icon child (`*:[svg]:row-span-2 translate-y-0.5`): spread
// `alertIconStyles` on it (`<Icon icon={Info} {...stylex.attrs(alertIconStyles)} />`). Without
// it the title and description still take the second column. Links and paragraphs inside the
// title/description (`[&_a]`, `[&_p]`) aren't styled.
type AlertVariant = "default" | "destructive"
const AlertVariantContext = createContext<() => AlertVariant>(() => "default")

const styles = stylex.create({
  alert: {
    position: "relative",
    display: "grid",
    width: "100%",
    gridTemplateColumns: { default: null, ":has(> svg)": "auto 1fr" },
    gap: "0.125rem",
    columnGap: { default: "0.125rem", ":has(> svg)": "0.625rem" },
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    paddingInline: "1rem",
    paddingBlock: "0.75rem",
    paddingRight: { default: "1rem", ":has([data-slot=alert-action])": "4.5rem" },
    textAlign: "left",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
  },
  default: { backgroundColor: colors.card, color: colors.cardForeground },
  destructive: { backgroundColor: colors.card, color: colors.destructive },
  title: {
    fontWeight: 500,
    gridColumnStart: { default: null, [stylex.when.ancestor(":has(> svg)", alertMarker)]: "2" },
  },
  description: {
    gridColumnStart: { default: null, [stylex.when.ancestor(":has(> svg)", alertMarker)]: "2" },
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    textWrap: { default: "balance", "@media (min-width: 48rem)": "pretty" },
    color: colors.mutedForeground,
  },
  descriptionDestructive: {
    color: `color-mix(in oklch, ${colors.destructive} 90%, transparent)`,
  },
  action: { position: "absolute", top: "0.625rem", right: "0.75rem" },
  icon: {
    gridRow: "span 2 / span 2",
    transform: "translateY(0.125rem)",
    color: "currentColor",
    width: "1rem",
    height: "1rem",
  },
})

/** Styles for the alert's leading icon (Tailwind's `*:[svg]:` classes). */
const alertIconStyles = styles.icon

const variantStyles = { default: styles.default, destructive: styles.destructive }

function alertStyles(variant: AlertVariant) {
  return [alertMarker, styles.alert, variantStyles[variant]]
}

function descriptionStyles(variant: AlertVariant) {
  return [styles.description, variant === "destructive" && styles.descriptionDestructive]
}

type DivProps = Omit<JSX.IntrinsicElements["div"], "class"> & {
  class?: string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}
type AlertProps = DivProps & { variant?: AlertVariant | null }

function Alert(props: AlertProps) {
  const rest = omit(props, "class", "variant", "xstyle")
  const variant = () => props.variant ?? "default"
  return (
    <AlertVariantContext value={variant}>
      <div
        data-slot="alert"
        role="alert"
        {...rest}
        class={cx(stylex.attrs(...alertStyles(variant()), props.xstyle).class, props.class)}
      />
    </AlertVariantContext>
  )
}

function AlertTitle(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  return <div data-slot="alert-title" {...rest} class={cx(stylex.attrs(styles.title, props.xstyle).class, props.class)} />
}

function AlertDescription(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  const variant = useContext(AlertVariantContext)
  return (
    <div
      data-slot="alert-description"
      {...rest}
      class={cx(stylex.attrs(...descriptionStyles(variant()), props.xstyle).class, props.class)}
    />
  )
}

function AlertAction(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  return <div data-slot="alert-action" {...rest} class={cx(stylex.attrs(styles.action, props.xstyle).class, props.class)} />
}

export { Alert, AlertTitle, AlertDescription, AlertAction, alertIconStyles, type AlertProps, type AlertVariant }
