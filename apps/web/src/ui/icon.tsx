import { omit } from "solid-js"
import type { JSX } from "@solidjs/web"
import type { IconNode } from "lucide"

export type { IconNode }

export type IconProps = JSX.SvgSVGAttributes<SVGSVGElement> & {
  /** A lucide icon node, e.g. `import { ChevronDown } from "lucide"`. */
  icon: IconNode
  size?: number | string
  "stroke-width"?: number | string
}

// Gradient edit: the shapes are set as markup built once per icon, instead of a
// `<For>` of `<Dynamic>` elements per shape. Lists draw several icons per row, and
// those components made each row noticeably slower to render. Lucide's data is
// static and trusted; attribute values are escaped all the same.
const markup = new WeakMap<IconNode, string>()
const escape = (v: unknown) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
const shapes = (icon: IconNode) => {
  let html = markup.get(icon)
  if (html === undefined) {
    html = icon
      .map(([tag, attrs]) => `<${tag}${Object.entries(attrs ?? {}).map(([k, v]) => ` ${k}="${escape(v)}"`).join("")}></${tag}>`)
      .join("")
    markup.set(icon, html)
  }
  return html
}

/**
 * Renders a vanilla `lucide` icon node as an SVG. `lucide-solid` targets Solid 1,
 * so components use this with icon data from the framework-agnostic `lucide` package:
 *
 *   import { ChevronDown } from "lucide"
 *   <Icon icon={ChevronDown} class="size-4" />
 */
export function Icon(props: IconProps) {
  const rest = omit(props, "icon", "size")
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={2}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...rest}
      innerHTML={shapes(props.icon)}
    />
  )
}
