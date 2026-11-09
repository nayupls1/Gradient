import { onSettled } from "solid-js"

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
}

/** Single-key shortcuts that stay quiet while the user is typing or a modal is open. */
export const useHotkeys = (map: Record<string, (e: KeyboardEvent) => void>) => {
  onSettled(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      if (document.querySelector("dialog[open]")) return
      const action = map[e.key.toLowerCase()]
      if (action) {
        e.preventDefault()
        action(e)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  })
}
