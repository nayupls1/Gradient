import * as stylex from "@stylexjs/stylex"

/**
 * Marks a menu item (dropdown-menu, context-menu, menubar) so its parts can react to the item's
 * state, like shadcn's `group/dropdown-menu-item` + `group-focus/dropdown-menu-item:*`:
 *
 *   color: { default: colors.mutedForeground, [stylex.when.ancestor(":is([data-highlighted])", menuItem)]: colors.accentForeground }
 */
export const menuItem = stylex.defineMarker()
