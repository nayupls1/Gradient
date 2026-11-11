import { For, omit } from "solid-js"
import { Dynamic, type JSX } from "@solidjs/web"
import type { IconNode } from "lucide"

export type { IconNode }

export type IconProps = JSX.SvgSVGAttributes<SVGSVGElement> & {
  /** A lucide icon node, e.g. `import { ChevronDown } from "lucide"`. */
  icon: IconNode
  size?: number | string
  "stroke-width"?: number | string
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
    >
      <For each={props.icon}>
        {(node) => <Dynamic component={node[0]} {...(node[1] as Record<string, string>)} />}
      </For>
    </svg>
  )
}
