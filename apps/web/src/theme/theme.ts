import { createSignal } from "solid-js"
import { type ColorTokens, type Preset, presetById, presets } from "./presets.ts"
import { color } from "./tokens.stylex.ts"

/**
 * A theme is either a preset, "system" (Paper or Graphite, following the OS),
 * or a custom set of colors that starts from a preset.
 */
export type ThemeChoice =
  | { readonly kind: "system" }
  | { readonly kind: "preset"; readonly id: string }
  | { readonly kind: "custom"; readonly base: string; readonly colors: Partial<ColorTokens> }

const STORAGE_KEY = "gradient.theme"
const media = window.matchMedia("(prefers-color-scheme: dark)")

const load = (): ThemeChoice => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as ThemeChoice
  } catch {
    // Storage can be unavailable (private mode); fall back to the default.
  }
  return { kind: "system" }
}

/** StyleX compiles each token to a hashed CSS variable; read its name off the token. */
const varName = (token: string) => token.match(/var\((--[^),\s]+)/)?.[1]

export const resolveTheme = (choice: ThemeChoice): { preset: Preset; colors: ColorTokens } => {
  if (choice.kind === "system") {
    const preset = presetById(media.matches ? "graphite" : "paper")!
    return { preset, colors: preset.colors }
  }
  if (choice.kind === "preset") {
    const preset = presetById(choice.id) ?? presets[0]!
    return { preset, colors: preset.colors }
  }
  const preset = presetById(choice.base) ?? presets[0]!
  return { preset, colors: { ...preset.colors, ...choice.colors } }
}

const apply = (choice: ThemeChoice) => {
  const { preset, colors } = resolveTheme(choice)
  const root = document.documentElement
  for (const [key, value] of Object.entries(colors)) {
    const name = varName(String((color as unknown as Record<string, string>)[key]))
    if (name) root.style.setProperty(name, value)
  }
  root.style.colorScheme = preset.scheme
  root.dataset.scheme = preset.scheme
}

const [theme, setThemeSignal] = createSignal<ThemeChoice>(load())
apply(theme())
media.addEventListener("change", () => {
  if (theme().kind === "system") apply(theme())
})

export { theme }

export const setTheme = (choice: ThemeChoice) => {
  setThemeSignal(choice)
  apply(choice)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice))
  } catch {
    // Not fatal: the theme still applies for this session.
  }
}
