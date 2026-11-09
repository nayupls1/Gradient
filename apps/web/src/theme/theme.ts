import { createSignal } from "solid-js"
import { type ColorTokens, paletteById, type Scheme } from "./presets.ts"
import { color } from "./tokens.stylex.ts"

export type Mode = "system" | "light" | "dark"

/**
 * Two independent choices: the mode (light, dark, or follow the OS) and the
 * palette. Custom colors override the palette, separately for each scheme.
 */
export interface Theme {
  readonly mode: Mode
  readonly palette: string
  readonly custom: { readonly light: Partial<ColorTokens>; readonly dark: Partial<ColorTokens> }
}

const STORAGE_KEY = "gradient.theme.v2"
const media = window.matchMedia("(prefers-color-scheme: dark)")
const defaults: Theme = { mode: "system", palette: "neutral", custom: { light: {}, dark: {} } }

const load = (): Theme => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Theme>) }
  } catch {
    // Storage can be unavailable (private mode); fall back to the default.
  }
  return defaults
}

/** StyleX compiles each token to a hashed CSS variable; read its name off the token. */
const varName = (token: string) => token.match(/var\((--[^),\s]+)/)?.[1]

export const schemeOf = (theme: Theme): Scheme =>
  theme.mode === "system" ? (media.matches ? "dark" : "light") : theme.mode

export const resolveColors = (theme: Theme, scheme: Scheme = schemeOf(theme)): ColorTokens => ({
  ...paletteById(theme.palette)[scheme],
  ...theme.custom[scheme]
})

const apply = (theme: Theme) => {
  const scheme = schemeOf(theme)
  const root = document.documentElement
  for (const [key, value] of Object.entries(resolveColors(theme, scheme))) {
    const name = varName(String((color as unknown as Record<string, string>)[key]))
    if (name) root.style.setProperty(name, value)
  }
  root.style.colorScheme = scheme
  root.dataset.scheme = scheme
}

const [theme, setThemeSignal] = createSignal<Theme>(load())
const [systemDark, setSystemDark] = createSignal(media.matches)
apply(theme())
media.addEventListener("change", () => {
  setSystemDark(media.matches)
  if (theme().mode === "system") apply(theme())
})

export { theme }

/** The scheme on screen now. Reactive to both the mode setting and the OS. */
export const activeScheme = (): Scheme => {
  const t = theme()
  return t.mode === "system" ? (systemDark() ? "dark" : "light") : t.mode
}

export const updateTheme = (patch: (current: Theme) => Theme) => {
  const next = patch(theme())
  setThemeSignal(next)
  apply(next)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Not fatal: the theme still applies for this session.
  }
}
