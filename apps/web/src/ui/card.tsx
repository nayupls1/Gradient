import { omit } from "solid-js"
import type { JSX } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { colors, radius } from "../lib/tokens.stylex"
import { cardMarker } from "../lib/markers.stylex"
import { cx } from "../lib/utils"

// Port of shadcn/ui's base-vega `card` (see the Tailwind variant for the source classes).
// `--card-spacing` stays a plain custom property so every part can read it.
// `*:[img:first-child]:rounded-t-xl` can't reach children in StyleX: round a leading image yourself.
const styles = stylex.create({
  card: {
    "--card-spacing": { default: "1.5rem", ":is([data-size=sm])": "1rem" },
    display: "flex",
    flexDirection: "column",
    gap: "var(--card-spacing)",
    overflow: "hidden",
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    paddingBlock: "var(--card-spacing)",
    paddingTop: { default: "var(--card-spacing)", ":has(> img:first-child)": 0 },
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    color: colors.cardForeground,
    boxShadow: `0 0 0 1px color-mix(in oklch, ${colors.foreground} 10%, transparent), 0 1px 2px 0 rgb(0 0 0 / 0.05)`,
  },
  header: {
    containerType: "inline-size",
    containerName: "card-header",
    display: "grid",
    gridAutoRows: "min-content",
    gridTemplateColumns: { default: null, ":has([data-slot=card-action])": "1fr auto" },
    gridTemplateRows: { default: null, ":has([data-slot=card-description])": "auto auto" },
    alignItems: "start",
    gap: "0.25rem",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingInline: "var(--card-spacing)",
    paddingBottom: { default: null, ":is(.border-b)": "var(--card-spacing)" },
  },
  title: {
    fontSize: {
      default: "1rem",
      [stylex.when.ancestor(":is([data-size=sm])", cardMarker)]: "0.875rem",
    },
    lineHeight: 1.5,
    fontWeight: 500,
  },
  description: {
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    color: colors.mutedForeground,
  },
  action: {
    gridColumnStart: "2",
    gridRowStart: "1",
    gridRowEnd: "span 2",
    alignSelf: "start",
    justifySelf: "end",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    paddingInline: "var(--card-spacing)",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingInline: "var(--card-spacing)",
    paddingTop: { default: null, ":is(.border-t)": "var(--card-spacing)" },
  },
})

type DivProps = Omit<JSX.IntrinsicElements["div"], "class"> & {
  class?: string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}
type CardProps = DivProps & { size?: "default" | "sm" }

function Card(props: CardProps) {
  const rest = omit(props, "class", "size", "xstyle")
  return (
    <div
      data-slot="card"
      data-size={props.size ?? "default"}
      {...rest}
      class={cx(stylex.attrs(cardMarker, styles.card, props.xstyle).class, props.class)}
    />
  )
}

function part(slot: string, style: stylex.StyleXStyles) {
  return function CardPart(props: DivProps) {
    const rest = omit(props, "class", "xstyle")
    return <div data-slot={slot} {...rest} class={cx(stylex.attrs(style, props.xstyle).class, props.class)} />
  }
}

const CardHeader = part("card-header", styles.header)
const CardTitle = part("card-title", styles.title)
const CardDescription = part("card-description", styles.description)
const CardAction = part("card-action", styles.action)
const CardContent = part("card-content", styles.content)
const CardFooter = part("card-footer", styles.footer)

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent, type CardProps }
