export const TOKEN_KEYS = [
  "bg", "panel", "subtle", "hover", "active", "border", "borderStrong", "fg", "fgMuted", "fgSubtle",
  "accent", "accentFg", "ring", "danger", "shadow", "overlay"
] as const

export type ColorTokens = Record<(typeof TOKEN_KEYS)[number], string>

export interface Preset {
  readonly id: string
  readonly name: string
  readonly scheme: "light" | "dark"
  readonly colors: ColorTokens
}

const light = (overrides: Partial<ColorTokens>): ColorTokens => ({
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
  overlay: "rgba(0, 0, 0, 0.18)",
  ...overrides
})

const dark = (overrides: Partial<ColorTokens>): ColorTokens => ({
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
  ring: "rgba(236, 236, 238, 0.2)",
  danger: "#ec5d5d",
  shadow: "rgba(0, 0, 0, 0.4)",
  overlay: "rgba(0, 0, 0, 0.5)",
  ...overrides
})

/** Deliberately bland: neutral greys, with a few gentle tints to choose from. */
export const presets: ReadonlyArray<Preset> = [
  { id: "paper", name: "Paper", scheme: "light", colors: light({}) },
  { id: "graphite", name: "Graphite", scheme: "dark", colors: dark({}) },
  {
    id: "slate",
    name: "Slate",
    scheme: "light",
    colors: light({
      bg: "#f8f9fb",
      subtle: "#f1f3f6",
      hover: "#ebeef2",
      active: "#e3e7ec",
      border: "#e1e5ea",
      borderStrong: "#cdd3db",
      fg: "#1a1f27",
      fgMuted: "#5f6773",
      fgSubtle: "#939aa5",
      accent: "#3b5bdb",
      ring: "rgba(59, 91, 219, 0.25)"
    })
  },
  {
    id: "sand",
    name: "Sand",
    scheme: "light",
    colors: light({
      bg: "#faf8f5",
      panel: "#fffdfa",
      subtle: "#f3efe9",
      hover: "#eee9e1",
      active: "#e7e0d6",
      border: "#e7e1d8",
      borderStrong: "#d6cdc0",
      fg: "#26221d",
      fgMuted: "#6f675c",
      fgSubtle: "#a1978a",
      accent: "#a0522d",
      ring: "rgba(160, 82, 45, 0.22)"
    })
  },
  {
    id: "midnight",
    name: "Midnight",
    scheme: "dark",
    colors: dark({
      bg: "#0e1117",
      panel: "#141924",
      subtle: "#18202c",
      hover: "#1d2633",
      active: "#243041",
      border: "#232c3a",
      borderStrong: "#303c4e",
      fg: "#e6eaf2",
      fgMuted: "#98a2b3",
      fgSubtle: "#667085",
      accent: "#7c9cff",
      accentFg: "#0e1117",
      ring: "rgba(124, 156, 255, 0.28)"
    })
  },
  {
    id: "moss",
    name: "Moss",
    scheme: "dark",
    colors: dark({
      bg: "#101311",
      panel: "#161a17",
      subtle: "#1b201c",
      hover: "#212722",
      active: "#283029",
      border: "#29302a",
      borderStrong: "#364037",
      fg: "#e7ece7",
      fgMuted: "#9ca79d",
      fgSubtle: "#6b766c",
      accent: "#8fbf8f",
      accentFg: "#101311",
      ring: "rgba(143, 191, 143, 0.25)"
    })
  }
]

export const presetById = (id: string) => presets.find((p) => p.id === id)
