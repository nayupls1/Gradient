import * as stylex from "@stylexjs/stylex"
import type { JSX } from "@solidjs/web"
import { createContext, createSignal, For, onSettled, useContext } from "solid-js"
import { colors } from "../lib/tokens.stylex.ts"
import { Kbd, KbdGroup } from "../ui/kbd.tsx"
import { type CommandDef, createKeymap, type Keymap } from "./core.ts"

/*
 * Solid bindings for the keymap: one window listener, plus hooks that tie
 * commands and scopes to component lifetimes.
 */

const OVERRIDES_KEY = "gradient.keymap"

const loadOverrides = (): Record<string, ReadonlyArray<string> | null> => {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? "{}")
  } catch {
    return {}
  }
}

const isEditable = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  if (el.isContentEditable) return true
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true
  if (el.tagName !== "INPUT") return false
  return !["checkbox", "radio", "button", "submit", "color", "range"].includes((el as HTMLInputElement).type)
}

const KeymapContext = createContext<Keymap>()

export const KeymapProvider = (props: { children: JSX.Element }) => {
  const keymap = createKeymap({
    overrides: loadOverrides(),
    ...(import.meta.env.DEV
      ? { onConflict: (binding: string, ids: ReadonlyArray<string>) => console.warn(`[keys] "${binding}" is bound to ${ids.join(", ")}`) }
      : {})
  })
  onSettled(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (keymap.handle(e, { editable: isEditable(e.target) }).handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const onStorage = (e: StorageEvent) => e.key === OVERRIDES_KEY && keymap.setOverrides(loadOverrides())
    window.addEventListener("keydown", onKey)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("storage", onStorage)
    }
  })
  return <KeymapContext value={keymap}>{props.children}</KeymapContext>
}

export const useKeymap = () => useContext(KeymapContext)

/** Register commands while the calling component is mounted. Handlers read live state when they run. */
export const useCommands = (defs: ReadonlyArray<CommandDef>) => {
  const keymap = useKeymap()
  onSettled(() => keymap.register(defs))
}

/** Push a scope while mounted. A blocking scope (modal) hides every scope below it. */
export const useScope = (name: string, opts: { blocking?: boolean } = {}) => {
  const keymap = useKeymap()
  onSettled(() => keymap.pushScope(name, opts))
}

export const KeyScope = (props: { name: string; blocking?: boolean; children: JSX.Element }) => {
  useScope(props.name, { blocking: props.blocking ?? false })
  return <>{props.children}</>
}

/** A version signal that ticks whenever commands, scopes or overrides change. */
export const useKeymapVersion = () => {
  const keymap = useKeymap()
  const [version, setVersion] = createSignal(0)
  onSettled(() => keymap.subscribe(() => setVersion((v) => v + 1)))
  return version
}

const s = stylex.create({
  then: { color: colors.mutedForeground, fontSize: "0.6875rem" }
})

/** Renders a binding for this platform, e.g. ⌘ K, or G then I. */
export const Shortcut = (props: { binding: string }) => {
  const keymap = useKeymap()
  return (
    <KbdGroup>
      <For each={keymap.format(props.binding)} keyed={false}>
        {(chord, i) => (
          <>
            {i > 0 && <span {...stylex.attrs(s.then)}>then</span>}
            <For each={chord()} keyed={false}>{(key) => <Kbd>{key()}</Kbd>}</For>
          </>
        )}
      </For>
    </KbdGroup>
  )
}
