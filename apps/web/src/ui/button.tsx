import { omit } from "solid-js"
import * as stylex from "@stylexjs/stylex"
import { Button as ButtonPrimitive } from "base-ui-solidjs/button"
import { colors, radius } from "../lib/tokens.stylex"
import { cx } from "../lib/utils"
import { buttonGroupItemStyles } from "./button-group"

// Port of shadcn/ui's base-vega `button` (see the Tailwind variant for the source classes).
// Tailwind `dark:` overrides become `light-dark(light, dark)`, which follows `color-scheme`
// (`darkMode` in lib/theme.ts sets it with the dark tokens).
const styles = stylex.create({
  base: {
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "transparent",
      ":focus-visible": colors.ring,
    },
    backgroundClip: "padding-box",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    fontWeight: 500,
    whiteSpace: "nowrap",
    transitionProperty: "all",
    transitionDuration: "150ms",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    outline: "none",
    userSelect: "none",
    boxShadow: {
      default: null,
      ":focus-visible": `0 0 0 3px color-mix(in oklch, ${colors.ring} 50%, transparent)`,
    },
    transform: {
      default: null,
      ":active:not([aria-haspopup])": "translateY(1px)",
    },
    pointerEvents: { default: null, ":disabled": "none" },
    opacity: { default: null, ":disabled": 0.5 },
  },
  invalid: {
    borderColor: colors.destructive,
    boxShadow: `0 0 0 3px color-mix(in oklch, ${colors.destructive} 20%, transparent)`,
  },
  // variants
  default: {
    backgroundColor: {
      default: colors.primary,
      ":hover": `color-mix(in oklch, ${colors.primary} 80%, transparent)`,
    },
    color: colors.primaryForeground,
  },
  outline: {
    borderColor: {
      default: `light-dark(${colors.border}, ${colors.input})`,
      ":focus-visible": colors.ring,
    },
    backgroundColor: {
      default: `light-dark(${colors.background}, color-mix(in oklch, ${colors.input} 30%, transparent))`,
      ":hover": `light-dark(${colors.muted}, color-mix(in oklch, ${colors.input} 50%, transparent))`,
      ":is([aria-expanded=true])": colors.muted,
    },
    color: {
      default: null,
      ":hover": colors.foreground,
      ":is([aria-expanded=true])": colors.foreground,
    },
    boxShadow: {
      default: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      ":focus-visible": `0 0 0 3px color-mix(in oklch, ${colors.ring} 50%, transparent)`,
    },
  },
  secondary: {
    backgroundColor: {
      default: colors.secondary,
      ":hover": `color-mix(in oklch, ${colors.secondary}, ${colors.foreground} 5%)`,
    },
    color: colors.secondaryForeground,
  },
  ghost: {
    backgroundColor: {
      default: "transparent",
      ":hover": `light-dark(${colors.muted}, color-mix(in oklch, ${colors.muted} 50%, transparent))`,
      ":is([aria-expanded=true])": colors.muted,
    },
    color: {
      default: "inherit",
      ":hover": colors.foreground,
      ":is([aria-expanded=true])": colors.foreground,
    },
  },
  destructive: {
    backgroundColor: {
      default: `light-dark(color-mix(in oklch, ${colors.destructive} 10%, transparent), color-mix(in oklch, ${colors.destructive} 20%, transparent))`,
      ":hover": `light-dark(color-mix(in oklch, ${colors.destructive} 20%, transparent), color-mix(in oklch, ${colors.destructive} 30%, transparent))`,
    },
    color: colors.destructive,
    borderColor: {
      default: "transparent",
      ":focus-visible": `color-mix(in oklch, ${colors.destructive} 40%, transparent)`,
    },
    boxShadow: {
      default: null,
      ":focus-visible": `0 0 0 3px color-mix(in oklch, ${colors.destructive} 20%, transparent)`,
    },
  },
  link: {
    backgroundColor: "transparent",
    color: colors.primary,
    textUnderlineOffset: "4px",
    textDecorationLine: { default: null, ":hover": "underline" },
  },
  // sizes
  sizeDefault: {
    height: "2.25rem",
    gap: "0.375rem",
    // `has-data-[icon=inline-start]:pl-2 has-data-[icon=inline-end]:pr-2`
    paddingLeft: { default: "0.625rem", ":has([data-icon=inline-start])": "0.5rem" },
    paddingRight: { default: "0.625rem", ":has([data-icon=inline-end])": "0.5rem" },
  },
  sizeXs: {
    height: "1.5rem",
    gap: "0.25rem",
    borderRadius: `min(${radius.md}, 8px)`,
    paddingLeft: { default: "0.5rem", ":has([data-icon=inline-start])": "0.375rem" },
    paddingRight: { default: "0.5rem", ":has([data-icon=inline-end])": "0.375rem" },
    fontSize: "0.75rem",
    lineHeight: "1rem",
  },
  sizeSm: {
    height: "2rem",
    gap: "0.25rem",
    borderRadius: `min(${radius.md}, 10px)`,
    paddingLeft: { default: "0.625rem", ":has([data-icon=inline-start])": "0.375rem" },
    paddingRight: { default: "0.625rem", ":has([data-icon=inline-end])": "0.375rem" },
  },
  sizeLg: {
    height: "2.5rem",
    gap: "0.375rem",
    paddingLeft: { default: "0.625rem", ":has([data-icon=inline-start])": "0.5rem" },
    paddingRight: { default: "0.625rem", ":has([data-icon=inline-end])": "0.5rem" },
  },
  sizeIcon: { width: "2.25rem", height: "2.25rem" },
  sizeIconXs: { width: "1.5rem", height: "1.5rem", borderRadius: `min(${radius.md}, 8px)` },
  sizeIconSm: { width: "2rem", height: "2rem", borderRadius: `min(${radius.md}, 10px)` },
  sizeIconLg: { width: "2.5rem", height: "2.5rem" },
})

const variantStyles = {
  default: styles.default,
  outline: styles.outline,
  secondary: styles.secondary,
  ghost: styles.ghost,
  destructive: styles.destructive,
  link: styles.link,
}

const sizeStyles = {
  default: styles.sizeDefault,
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  lg: styles.sizeLg,
  icon: styles.sizeIcon,
  "icon-xs": styles.sizeIconXs,
  "icon-sm": styles.sizeIconSm,
  "icon-lg": styles.sizeIconLg,
}

type ButtonVariant = keyof typeof variantStyles
type ButtonSize = keyof typeof sizeStyles

type ButtonProps = Omit<ButtonPrimitive.Props, "class"> & {
  variant?: ButtonVariant | null
  size?: ButtonSize | null
  class?: string | undefined
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

/** Tailwind's `[&_svg]` icon sizing can't be expressed in StyleX; `Icon` defaults to 16px instead. */
function buttonStyles(opts: { variant?: ButtonVariant | null | undefined; size?: ButtonSize | null | undefined; invalid?: boolean }) {
  return [
    styles.base,
    variantStyles[opts.variant ?? "default"],
    sizeStyles[opts.size ?? "default"],
    opts.invalid && styles.invalid,
    // `in-data-[slot=button-group]:rounded-md` and the group's child rules (see button-group.tsx).
    buttonGroupItemStyles.item,
  ]
}

function Button(props: ButtonProps) {
  const rest = omit(props, "class", "variant", "size", "xstyle")
  const attrs = () =>
    stylex.attrs(
      ...buttonStyles({
        variant: props.variant,
        size: props.size,
        invalid: String(props["aria-invalid"]) === "true",
      }),
      props.xstyle,
    )
  return (
    <ButtonPrimitive
      data-slot="button"
      {...rest}
      class={cx(attrs().class, props.class)}
      style={attrs().style}
    />
  )
}

export { Button, buttonStyles, type ButtonProps, type ButtonVariant, type ButtonSize }
