import { createContext, omit, useContext } from "solid-js"
import type { JSX } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { Avatar as AvatarPrimitive } from "base-ui-solidjs/avatar"
import { colors } from "../lib/tokens.stylex"
import { avatarGroupMarker } from "../lib/markers.stylex"
import { cx } from "../lib/utils"

// Port of shadcn/ui's base-vega `avatar` (see the Tailwind variant for the source classes).
// `group-data-[size=*]/avatar:` on the fallback and badge reads the avatar's size from context, and
// `*:data-[slot=avatar]:` / `-space-x-2` on the group become styles the avatar applies when it is
// inside a group. `[&>svg]` sizes can't reach children in StyleX: size icons yourself.
type AvatarSize = "default" | "sm" | "lg"
const AvatarSizeContext = createContext<() => AvatarSize>(() => "default")
const AvatarGroupContext = createContext(false)


const styles = stylex.create({
  avatar: {
    position: "relative",
    display: "flex",
    width: "2rem",
    height: "2rem",
    flexShrink: 0,
    borderRadius: "9999px",
    userSelect: "none",
    // `after:border after:border-border after:mix-blend-darken dark:after:mix-blend-lighten`:
    // `light-dark()` can't switch a blend mode, so each mode gets its own layer and the other
    // layer's border is transparent.
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "9999px",
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: `light-dark(${colors.border}, transparent)`,
      mixBlendMode: "darken",
    },
    "::before": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "9999px",
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: `light-dark(transparent, ${colors.border})`,
      mixBlendMode: "lighten",
    },
  },
  sm: { width: "1.5rem", height: "1.5rem" },
  lg: { width: "2.5rem", height: "2.5rem" },
  inGroup: {
    boxShadow: `0 0 0 2px ${colors.background}`,
    marginInlineEnd: { default: "-0.5rem", ":last-child": 0 },
  },
  image: {
    aspectRatio: "1 / 1",
    width: "100%",
    height: "100%",
    borderRadius: "9999px",
    objectFit: "cover",
  },
  fallback: {
    display: "flex",
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "9999px",
    backgroundColor: colors.muted,
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    color: colors.mutedForeground,
  },
  fallbackSm: { fontSize: "0.75rem", lineHeight: "1rem" },
  badge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    zIndex: 10,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "9999px",
    backgroundColor: colors.primary,
    color: colors.primaryForeground,
    backgroundBlendMode: "color",
    boxShadow: `0 0 0 2px ${colors.background}`,
    userSelect: "none",
  },
  badgeSm: { width: "0.5rem", height: "0.5rem" },
  badgeDefault: { width: "0.625rem", height: "0.625rem" },
  badgeLg: { width: "0.75rem", height: "0.75rem" },
  group: { display: "flex" },
  groupCount: {
    position: "relative",
    display: "flex",
    width: {
      default: "2rem",
      [stylex.when.ancestor(":has([data-slot=avatar][data-size=lg])", avatarGroupMarker)]: "2.5rem",
      [stylex.when.ancestor(":has([data-slot=avatar][data-size=sm])", avatarGroupMarker)]: "1.5rem",
    },
    height: {
      default: "2rem",
      [stylex.when.ancestor(":has([data-slot=avatar][data-size=lg])", avatarGroupMarker)]: "2.5rem",
      [stylex.when.ancestor(":has([data-slot=avatar][data-size=sm])", avatarGroupMarker)]: "1.5rem",
    },
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "9999px",
    backgroundColor: colors.muted,
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    color: colors.mutedForeground,
    boxShadow: `0 0 0 2px ${colors.background}`,
  },
})

const sizeStyles = { default: null, sm: styles.sm, lg: styles.lg }
const badgeSizeStyles = { default: styles.badgeDefault, sm: styles.badgeSm, lg: styles.badgeLg }

function avatarStyles(size: AvatarSize, inGroup: boolean) {
  return [styles.avatar, sizeStyles[size], inGroup && styles.inGroup]
}

function badgeStyles(size: AvatarSize) {
  return [styles.badge, badgeSizeStyles[size]]
}

type XStyle = {
  class?: string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

type AvatarProps = Omit<AvatarPrimitive.Root.Props, "class"> & XStyle & { size?: AvatarSize }

function Avatar(props: AvatarProps) {
  const rest = omit(props, "class", "size", "xstyle")
  const size = () => props.size ?? "default"
  const groupContext = useContext(AvatarGroupContext)
  const inGroup = () => groupContext
  return (
    <AvatarSizeContext value={size}>
      <AvatarPrimitive.Root
        data-slot="avatar"
        data-size={size()}
        {...rest}
        class={cx(
          stylex.attrs(...avatarStyles(size(), inGroup()), props.xstyle).class,
          props.class,
        )}
      />
    </AvatarSizeContext>
  )
}

type AvatarImageProps = Omit<AvatarPrimitive.Image.Props, "class"> & XStyle

function AvatarImage(props: AvatarImageProps) {
  const rest = omit(props, "class", "xstyle")
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      {...rest}
      class={cx(stylex.attrs(styles.image, props.xstyle).class, props.class)}
    />
  )
}

type AvatarFallbackProps = Omit<AvatarPrimitive.Fallback.Props, "class"> & XStyle

function AvatarFallback(props: AvatarFallbackProps) {
  const rest = omit(props, "class", "xstyle")
  const size = useContext(AvatarSizeContext)
  const isSm = () => size() === "sm"
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      {...rest}
      class={cx(stylex.attrs(styles.fallback, isSm() && styles.fallbackSm, props.xstyle).class, props.class)}
    />
  )
}

type AvatarBadgeProps = Omit<JSX.IntrinsicElements["span"], "class"> & XStyle

function AvatarBadge(props: AvatarBadgeProps) {
  const rest = omit(props, "class", "xstyle")
  const size = useContext(AvatarSizeContext)
  return (
    <span
      data-slot="avatar-badge"
      {...rest}
      class={cx(stylex.attrs(...badgeStyles(size()), props.xstyle).class, props.class)}
    />
  )
}

type DivProps = Omit<JSX.IntrinsicElements["div"], "class"> & XStyle

function AvatarGroup(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  return (
    <AvatarGroupContext value={true}>
      <div
        data-slot="avatar-group"
        {...rest}
        class={cx(stylex.attrs(avatarGroupMarker, styles.group, props.xstyle).class, props.class)}
      />
    </AvatarGroupContext>
  )
}

function AvatarGroupCount(props: DivProps) {
  const rest = omit(props, "class", "xstyle")
  const groupContext = useContext(AvatarGroupContext)
  const inGroup = () => groupContext
  return (
    <div
      data-slot="avatar-group-count"
      {...rest}
      class={cx(stylex.attrs(styles.groupCount, inGroup() && styles.inGroup, props.xstyle).class, props.class)}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
  type AvatarProps,
  type AvatarImageProps,
  type AvatarFallbackProps,
  type AvatarBadgeProps,
}
