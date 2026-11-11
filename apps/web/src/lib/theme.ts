import * as stylex from "@stylexjs/stylex"
import { darkTheme } from "./tokens.stylex"

const styles = stylex.create({
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
})

/**
 * Styles for the app root. Dark mode swaps the token values and sets `color-scheme: dark`,
 * which drives the `light-dark()` values components use for Tailwind's `dark:` overrides.
 *
 *   <html {...stylex.attrs(isDark ? darkMode : lightMode)}>
 */
export const lightMode = styles.light
export const darkMode = [darkTheme, styles.dark]
