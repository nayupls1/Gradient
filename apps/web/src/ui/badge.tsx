import { omit } from "solid-js"
import * as stylex from "@stylexjs/stylex"
import { mergeProps } from "base-ui-solidjs/merge-props"
import { useRender } from "base-ui-solidjs/use-render"
import { colors, radius } from "../lib/tokens.stylex"
import { cx } from "../lib/utils"

// Port of shadcn/ui's base-vega `badge` (see the Tailwind variant for the source classes).
// `[a]:hover:` becomes `:is(a):hover` (only when rendered as a link). `[&>svg]:size-3!` can't
// reach children in StyleX: give icons `size={12}`.
const styles = stylex.create({
  base: {
    display: "inline-flex",
    height: "1.25rem",
    width: "fit-content",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: "0.25rem",
    overflow: "hidden",
    borderRadius: radius["4xl"],
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: "transparent",
      ":focus-visible": colors.ring,
      ":is([aria-invalid=true])": colors.destructive,
    },
    paddingInline: "0.5rem",
    paddingBlock: "0.125rem",
    paddingInlineStart: { default: null, ":has([data-icon=inline-start])": "0.375rem" },
    paddingInlineEnd: { default: null, ":has([data-icon=inline-end])": "0.375rem" },
    fontSize: "0.75rem",
    lineHeight: "1rem",
    fontWeight: 500,
    whiteSpace: "nowrap",
    transitionProperty: "all",
    transitionDuration: "150ms",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    boxShadow: {
      default: null,
      ":focus-visible": `0 0 0 3px color-mix(in oklch, ${colors.ring} 50%, transparent)`,
      ":is([aria-invalid=true])": `0 0 0 0 light-dark(color-mix(in oklch, ${colors.destructive} 20%, transparent), color-mix(in oklch, ${colors.destructive} 40%, transparent))`,
    },
  },
  default: {
    backgroundColor: {
      default: colors.primary,
      ":is(a):hover": `color-mix(in oklch, ${colors.primary} 80%, transparent)`,
    },
    color: colors.primaryForeground,
  },
  secondary: {
    backgroundColor: {
      default: colors.secondary,
      ":is(a):hover": `color-mix(in oklch, ${colors.secondary} 80%, transparent)`,
    },
    color: colors.secondaryForeground,
  },
  destructive: {
    backgroundColor: {
      default: `light-dark(color-mix(in oklch, ${colors.destructive} 10%, transparent), color-mix(in oklch, ${colors.destructive} 20%, transparent))`,
      ":is(a):hover": `color-mix(in oklch, ${colors.destructive} 20%, transparent)`,
    },
    color: colors.destructive,
    boxShadow: {
      default: null,
      ":focus-visible": `0 0 0 3px light-dark(color-mix(in oklch, ${colors.destructive} 20%, transparent), color-mix(in oklch, ${colors.destructive} 40%, transparent))`,
    },
  },
  outline: {
    borderColor: {
      default: colors.border,
      ":focus-visible": colors.ring,
      ":is([aria-invalid=true])": colors.destructive,
    },
    backgroundColor: { default: null, ":is(a):hover": colors.muted },
    color: { default: colors.foreground, ":is(a):hover": colors.mutedForeground },
  },
  ghost: {
    backgroundColor: {
      default: null,
      ":hover": `light-dark(${colors.muted}, color-mix(in oklch, ${colors.muted} 50%, transparent))`,
    },
    color: { default: null, ":hover": colors.mutedForeground },
  },
  link: {
    color: colors.primary,
    textUnderlineOffset: "4px",
    textDecorationLine: { default: null, ":hover": "underline" },
  },
})

const variantStyles = {
  default: styles.default,
  secondary: styles.secondary,
  destructive: styles.destructive,
  outline: styles.outline,
  ghost: styles.ghost,
  link: styles.link,
}

type BadgeVariant = keyof typeof variantStyles

type BadgeProps = Omit<useRender.ComponentProps<"span">, "class"> & {
  variant?: BadgeVariant | null
  class?: string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

function badgeStyles(opts: { variant?: BadgeVariant | null | undefined } = {}) {
  return [styles.base, variantStyles[opts.variant ?? "default"]]
}

function Badge(props: BadgeProps) {
  const rest = omit(props, "class", "variant", "render", "children", "xstyle")
  return useRender({
    defaultTagName: "span",
    get render() {
      return props.render
    },
    get props() {
      return mergeProps<Record<string, unknown>>(
        { class: cx(stylex.attrs(...badgeStyles({ variant: props.variant }), props.xstyle).class, props.class) },
        rest,
      )
    },
    get children() {
      return props.children
    },
    state: () => ({ slot: "badge", variant: props.variant ?? "default" }),
  })
}

export { Badge, badgeStyles, type BadgeProps, type BadgeVariant }
