export const TOKEN_KEYS = [
  "bg", "panel", "subtle", "hover", "active", "border", "borderStrong", "fg", "fgMuted", "fgSubtle",
  "accent", "accentFg", "link", "ring", "danger", "shadow", "overlay"
] as const

export type ColorTokens = Record<(typeof TOKEN_KEYS)[number], string>
export type Scheme = "light" | "dark"

/**
 * A palette is a set of tints. It never decides light or dark: every palette
 * has both, and the mode setting (system, light, dark) picks one.
 */
export interface Palette {
  readonly id: string
  readonly name: string
  readonly light: ColorTokens
  readonly dark: ColorTokens
}

const light = (o: Partial<ColorTokens> = {}): ColorTokens => ({
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
  link: "#2563c9",
  ring: "rgba(28, 28, 27, 0.18)",
  danger: "#d93f3f",
  shadow: "rgba(0, 0, 0, 0.08)",
  overlay: "rgba(0, 0, 0, 0.18)",
  ...o
})

const dark = (o: Partial<ColorTokens> = {}): ColorTokens => ({
  bg: "#111112",
  panel: "#18181a",
  subtle: "#1c1c1f",
  hover: "#222225",
  active: "#29292d",
  border: "#2a2a2e",
  borderStrong: "#38383d",
  fg: "#ececee",
  fgMuted: "#a0a0a7",
  fgSubtle: "#6c6c74",
  accent: "#ececee",
  accentFg: "#111112",
  link: "#7aa7ff",
  ring: "rgba(236, 236, 238, 0.2)",
  danger: "#ec5d5d",
  shadow: "rgba(0, 0, 0, 0.4)",
  overlay: "rgba(0, 0, 0, 0.5)",
  ...o
})

/** Deliberately bland: neutral greys first, then a few gentle tints. */
export const palettes: ReadonlyArray<Palette> = [
  { id: "neutral", name: "Neutral", light: light(), dark: dark() },
  {
    id: "slate",
    name: "Slate",
    light: light({
      bg: "#f8f9fb", subtle: "#f1f3f6", hover: "#ebeef2", active: "#e3e7ec", border: "#e1e5ea",
      borderStrong: "#cdd3db", fg: "#1a1f27", fgMuted: "#5f6773", fgSubtle: "#939aa5",
      accent: "#3b5bdb", link: "#3354d1", ring: "rgba(59, 91, 219, 0.25)"
    }),
    dark: dark({
      bg: "#0e1117", panel: "#141924", subtle: "#18202c", hover: "#1d2633", active: "#243041",
      border: "#232c3a", borderStrong: "#303c4e", fg: "#e6eaf2", fgMuted: "#98a2b3", fgSubtle: "#667085",
      accent: "#7c9cff", accentFg: "#0e1117", link: "#8fabff", ring: "rgba(124, 156, 255, 0.28)"
    })
  },
  {
    id: "stone",
    name: "Stone",
    light: light({
      bg: "#faf8f5", panel: "#fffdfa", subtle: "#f3efe9", hover: "#eee9e1", active: "#e7e0d6",
      border: "#e7e1d8", borderStrong: "#d6cdc0", fg: "#26221d", fgMuted: "#6f675c", fgSubtle: "#a1978a",
      accent: "#a0522d", link: "#9a4a24", ring: "rgba(160, 82, 45, 0.22)"
    }),
    dark: dark({
      bg: "#141210", panel: "#1b1815", subtle: "#201d19", hover: "#27231e", active: "#2f2a24",
      border: "#2e2924", borderStrong: "#3c362f", fg: "#ece7e1", fgMuted: "#a89f94", fgSubtle: "#776e64",
      accent: "#d9845a", accentFg: "#141210", link: "#e3976f", ring: "rgba(217, 132, 90, 0.25)"
    })
  },
  {
    id: "moss",
    name: "Moss",
    light: light({
      bg: "#f8faf8", subtle: "#f0f4f0", hover: "#e9eee9", active: "#e0e7e0", border: "#dfe6df",
      borderStrong: "#cbd5cb", fg: "#1b221c", fgMuted: "#5c6a5e", fgSubtle: "#8f9c91",
      accent: "#3d7a4a", link: "#2f7040", ring: "rgba(61, 122, 74, 0.22)"
    }),
    dark: dark({
      bg: "#101311", panel: "#161a17", subtle: "#1b201c", hover: "#212722", active: "#283029",
      border: "#29302a", borderStrong: "#364037", fg: "#e7ece7", fgMuted: "#9ca79d", fgSubtle: "#6b766c",
      accent: "#8fbf8f", accentFg: "#101311", link: "#9fd09f", ring: "rgba(143, 191, 143, 0.25)"
    })
  },
  {
    id: "iris",
    name: "Iris",
    light: light({
      bg: "#f9f9fc", subtle: "#f2f2f8", hover: "#ececf4", active: "#e4e4ef", border: "#e3e3ee",
      borderStrong: "#d0d0e0", fg: "#1d1c26", fgMuted: "#64627a", fgSubtle: "#9896ad",
      accent: "#5b4fd6", link: "#5145cc", ring: "rgba(91, 79, 214, 0.24)"
    }),
    dark: dark({
      bg: "#111018", panel: "#17161f", subtle: "#1c1b26", hover: "#22212d", active: "#2a2837",
      border: "#2a2836", borderStrong: "#383545", fg: "#ebeaf3", fgMuted: "#a3a0b8", fgSubtle: "#716e86",
      accent: "#a59cff", accentFg: "#111018", link: "#b3abff", ring: "rgba(165, 156, 255, 0.26)"
    })
  }
]

export const paletteById = (id: string) => palettes.find((p) => p.id === id) ?? palettes[0]!

/**
 * The shadcn components (`ui/`) use shadcn's token names (`lib/tokens.stylex.ts`).
 * Each one maps to a Gradient token, so palettes and custom colors style them too.
 */
const UI_TOKENS = {
  background: "bg",
  foreground: "fg",
  card: "panel",
  cardForeground: "fg",
  popover: "panel",
  popoverForeground: "fg",
  primary: "accent",
  primaryForeground: "accentFg",
  secondary: "subtle",
  secondaryForeground: "fg",
  muted: "hover",
  mutedForeground: "fgMuted",
  accent: "hover",
  accentForeground: "fg",
  destructive: "danger",
  border: "border",
  input: "border",
  ring: "fgSubtle",
  sidebar: "bg",
  sidebarForeground: "fg",
  sidebarPrimary: "accent",
  sidebarPrimaryForeground: "accentFg",
  sidebarAccent: "hover",
  sidebarAccentForeground: "fg",
  sidebarBorder: "border",
  sidebarRing: "fgSubtle"
} as const satisfies Record<string, keyof ColorTokens>

export const uiTokensFrom = (tokens: ColorTokens): Record<keyof typeof UI_TOKENS, string> =>
  Object.fromEntries(Object.entries(UI_TOKENS).map(([ui, own]) => [ui, tokens[own]])) as Record<keyof typeof UI_TOKENS, string>
