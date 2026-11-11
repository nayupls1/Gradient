import { omit } from "solid-js"
import type { JSX } from "@solidjs/web"
import * as stylex from "@stylexjs/stylex"
import { mergeProps } from "base-ui-solidjs/merge-props"
import { useRender } from "base-ui-solidjs/use-render"
import { ChevronRight, Ellipsis } from "lucide"
import { Icon } from "./icon"
import { colors } from "../lib/tokens.stylex"
import { cx } from "../lib/utils"

const styles = stylex.create({
  list: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: { default: "0.375rem", "@media (min-width: 40rem)": "0.625rem" },
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    overflowWrap: "break-word",
    color: colors.mutedForeground,
  },
  item: { display: "inline-flex", alignItems: "center", gap: "0.375rem" },
  link: {
    transitionProperty:
      "color, background-color, border-color, outline-color, text-decoration-color, fill, stroke",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    transitionDuration: "150ms",
    color: { default: null, ":hover": colors.foreground },
  },
  page: { fontWeight: 400, color: colors.foreground },
  // `cn-rtl-flip`
  rtlFlip: { transform: { default: null, ":dir(rtl)": "rotate(180deg)" } },
  ellipsis: {
    display: "flex",
    width: "1.25rem",
    height: "1.25rem",
    alignItems: "center",
    justifyContent: "center",
  },
  srOnly: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
})

type XStyle = {
  class?: string
  /** StyleX overrides, merged last. */
  xstyle?: stylex.StyleXStyles
}

type BreadcrumbProps = Omit<JSX.IntrinsicElements["nav"], "class"> & XStyle

function Breadcrumb(props: BreadcrumbProps) {
  const rest = omit(props, "class", "xstyle")
  return (
    <nav
      aria-label="breadcrumb"
      data-slot="breadcrumb"
      {...rest}
      class={cx(stylex.attrs(props.xstyle).class, props.class) || undefined}
    />
  )
}

type BreadcrumbListProps = Omit<JSX.IntrinsicElements["ol"], "class"> & XStyle

function BreadcrumbList(props: BreadcrumbListProps) {
  const rest = omit(props, "class", "xstyle")
  return <ol data-slot="breadcrumb-list" {...rest} class={cx(stylex.attrs(styles.list, props.xstyle).class, props.class)} />
}

type BreadcrumbItemProps = Omit<JSX.IntrinsicElements["li"], "class"> & XStyle

function BreadcrumbItem(props: BreadcrumbItemProps) {
  const rest = omit(props, "class", "xstyle")
  return <li data-slot="breadcrumb-item" {...rest} class={cx(stylex.attrs(styles.item, props.xstyle).class, props.class)} />
}

type BreadcrumbLinkProps = Omit<useRender.ComponentProps<"a">, "class"> & XStyle

function BreadcrumbLink(props: BreadcrumbLinkProps) {
  const rest = omit(props, "class", "render", "children", "xstyle")
  return useRender({
    defaultTagName: "a",
    get render() {
      return props.render
    },
    get props() {
      return mergeProps<Record<string, unknown>>({ class: cx(stylex.attrs(styles.link, props.xstyle).class, props.class) }, rest)
    },
    get children() {
      return props.children
    },
    state: { slot: "breadcrumb-link" },
  })
}

type BreadcrumbPageProps = Omit<JSX.IntrinsicElements["span"], "class"> & XStyle

function BreadcrumbPage(props: BreadcrumbPageProps) {
  const rest = omit(props, "class", "xstyle")
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      {...rest}
      class={cx(stylex.attrs(styles.page, props.xstyle).class, props.class)}
    />
  )
}

type BreadcrumbSeparatorProps = Omit<JSX.IntrinsicElements["li"], "class"> & XStyle

/** `[&>svg]:size-3.5`: the default chevron is 14px; pass `size={14}` to a custom icon. */
function BreadcrumbSeparator(props: BreadcrumbSeparatorProps) {
  const rest = omit(props, "class", "children", "xstyle")
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      {...rest}
      class={cx(stylex.attrs(props.xstyle).class, props.class) || undefined}
    >
      {props.children ?? <Icon icon={ChevronRight} size={14} {...stylex.attrs(styles.rtlFlip)} />}
    </li>
  )
}

type BreadcrumbEllipsisProps = Omit<JSX.IntrinsicElements["span"], "class"> & XStyle

function BreadcrumbEllipsis(props: BreadcrumbEllipsisProps) {
  const rest = omit(props, "class", "xstyle")
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      {...rest}
      class={cx(stylex.attrs(styles.ellipsis, props.xstyle).class, props.class)}
    >
      <Icon icon={Ellipsis} />
      <span {...stylex.attrs(styles.srOnly)}>More</span>
    </span>
  )
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
  type BreadcrumbProps,
  type BreadcrumbListProps,
  type BreadcrumbItemProps,
  type BreadcrumbLinkProps,
  type BreadcrumbPageProps,
  type BreadcrumbSeparatorProps,
  type BreadcrumbEllipsisProps,
}
