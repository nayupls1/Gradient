import * as stylex from "@stylexjs/stylex"

/**
 * Named StyleX markers for Tailwind's named `group/*` and `peer/*` variants
 * (`stylex.when.ancestor(":is([data-x])", marker)`, `stylex.when.siblingBefore(...)`).
 * Markers must be defined in a `.stylex.ts` file.
 */
export const sidebarMarker = stylex.defineMarker()
export const sidebarMenuItemMarker = stylex.defineMarker()
export const sidebarMenuButtonMarker = stylex.defineMarker()
export const sidebarRailMarker = stylex.defineMarker()
