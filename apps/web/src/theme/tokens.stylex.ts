import * as stylex from "@stylexjs/stylex"

/**
 * Color tokens. Values here are only the first-paint default; the active
 * preset (or the user's custom theme) overwrites the CSS variables at runtime,
 * see `theme/theme.ts`.
 */
export const color = stylex.defineVars({
  bg: "#fbfbfa",
  panel: "#ffffff",
  subtle: "#f4f4f3",
  hover: "#efefee",
  active: "#e8e8e6",
  border: "#e6e6e4",
  borderStrong: "#d4d4d1",
  fg: "#1c1c1b",
  fgMuted: "#6b6b68",
  fgSubtle: "#9b9b97",
  accent: "#1c1c1b",
  accentFg: "#ffffff",
  ring: "rgba(28, 28, 27, 0.18)",
  danger: "#d93f3f",
  shadow: "rgba(0, 0, 0, 0.08)",
  overlay: "rgba(0, 0, 0, 0.18)"
})

export const radius = stylex.defineVars({
  sm: "4px",
  md: "6px",
  lg: "10px"
})

export const font = stylex.defineVars({
  sans: "\"Inter Variable\", Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif",
  mono: "ui-monospace, \"SF Mono\", \"JetBrains Mono\", Menlo, monospace",
  xs: "11px",
  sm: "12px",
  md: "13px",
  lg: "15px",
  xl: "22px"
})
