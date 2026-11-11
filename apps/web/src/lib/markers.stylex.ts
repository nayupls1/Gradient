import * as stylex from "@stylexjs/stylex"

/**
 * Markers for Tailwind's `group-*` / `peer-*` variants, used with `stylex.when.ancestor(...)` and
 * `stylex.when.siblingBefore(...)`. Named groups (`group/card`, `group/field`, ...) get their own
 * marker so a condition only matches the element shadcn names, like the Tailwind variant, where
 * `stylex.defaultMarker()` would match any marked ancestor.
 */
export const groupMarker = stylex.defineMarker()
export const peerMarker = stylex.defineMarker()
export const cardMarker = stylex.defineMarker()
export const avatarGroupMarker = stylex.defineMarker()
export const alertMarker = stylex.defineMarker()
export const fieldMarker = stylex.defineMarker()
export const fieldGroupMarker = stylex.defineMarker()
export const fieldLabelMarker = stylex.defineMarker()
export const inputGroupMarker = stylex.defineMarker()
export const toggleGroupMarker = stylex.defineMarker()
export const toggleMarker = stylex.defineMarker()
export const comboboxContentMarker = stylex.defineMarker()
export const calendarDayMarker = stylex.defineMarker()
export const tooltipContentMarker = stylex.defineMarker()
export const bubbleMarker = stylex.defineMarker()
export const messageMarker = stylex.defineMarker()
export const markerMarker = stylex.defineMarker()
export const attachmentMarker = stylex.defineMarker()
export const traceTriggerMarker = stylex.defineMarker()
export const traceLineMarker = stylex.defineMarker()
export const codeBlockMarker = stylex.defineMarker()
export const scrollerMarker = stylex.defineMarker()
export const choiceMarker = stylex.defineMarker()
