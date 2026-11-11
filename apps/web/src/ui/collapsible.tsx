import { omit } from "solid-js"
import type * as stylex from "@stylexjs/stylex"
import { Collapsible as CollapsiblePrimitive } from "base-ui-solidjs/collapsible"
import { sxMerge } from "../lib/sx"

// Port of shadcn/ui's base-vega `collapsible`: unstyled, so `xstyle` is the only addition.

type XStyle = { class?: string; xstyle?: stylex.StyleXStyles }

type CollapsibleProps = Omit<CollapsiblePrimitive.Root.Props, "class"> & XStyle
type CollapsibleTriggerProps = Omit<CollapsiblePrimitive.Trigger.Props, "class"> & XStyle
type CollapsibleContentProps = Omit<CollapsiblePrimitive.Panel.Props, "class"> & XStyle

function Collapsible(props: CollapsibleProps) {
  const rest = omit(props, "class", "style", "xstyle")
  const a = () => sxMerge([props.xstyle], props.class, props.style)
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...rest} class={a().class} style={a().style} />
}

function CollapsibleTrigger(props: CollapsibleTriggerProps) {
  const rest = omit(props, "class", "style", "xstyle")
  const a = () => sxMerge([props.xstyle], props.class, props.style)
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...rest} class={a().class} style={a().style} />
}

function CollapsibleContent(props: CollapsibleContentProps) {
  const rest = omit(props, "class", "style", "xstyle")
  const a = () => sxMerge([props.xstyle], props.class, props.style)
  return <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...rest} class={a().class} style={a().style} />
}

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  type CollapsibleProps,
  type CollapsibleTriggerProps,
  type CollapsibleContentProps,
}
