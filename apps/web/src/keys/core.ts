/**
 * Keyboard command layer, framework free.
 *
 * Everything the app can do from the keyboard is a *command*: an id, a title
 * and a handler, plus optional default bindings. Bindings are strings such as
 * "c", "mod+k", "shift+enter" or sequences such as "g i". The same registry
 * feeds the key handler, the command menu, the shortcut help and any future
 * caller (user remaps, agents, tests) through `run(id)`.
 *
 * Commands live in *scopes*. Active scopes form a stack; a command fires only
 * while its scope is on the stack, and a *blocking* scope (a modal) hides
 * everything beneath it. When two eligible commands share a binding, the one
 * in the higher scope wins, then the one registered last.
 */

export type Platform = "mac" | "other"

export interface Chord {
  readonly key: string
  readonly meta: boolean
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
}

export interface KeyEventLike {
  readonly key: string
  readonly code?: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly repeat?: boolean
  readonly isComposing?: boolean
}

export interface CommandDef {
  /** Stable id, e.g. "issue.setStatus". Used by remaps, the menu and `run`. */
  readonly id: string
  readonly title: string
  /** Heading in the menu and the shortcut help. */
  readonly group?: string
  /** Default bindings. A user override replaces them. */
  readonly keys?: ReadonlyArray<string>
  /** Defaults to "global". */
  readonly scope?: string
  /** Extra guard, evaluated at key time. */
  readonly when?: () => boolean
  /** Fire even while a text field has focus. Chords with ⌘/Ctrl always may. */
  readonly allowInInput?: boolean
  /** Fire again on held-key auto-repeat (navigation). */
  readonly repeat?: boolean
  /** Keep out of the menu and the help (still bound). */
  readonly hidden?: boolean
  readonly run: () => void
}

export interface CommandInfo {
  readonly id: string
  readonly title: string
  readonly group: string
  readonly scope: string
  readonly keys: ReadonlyArray<string>
  readonly hidden: boolean
}

const MODIFIERS = new Set(["meta", "ctrl", "alt", "shift"])
const ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  space: " ",
  spacebar: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  del: "delete",
  plus: "+",
  cmd: "meta",
  command: "meta",
  control: "ctrl",
  option: "alt",
  opt: "alt"
}

export const detectPlatform = (): Platform =>
  typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? "mac" : "other"

/** "mod+shift+k" → Chord. `mod` is ⌘ on macOS and Ctrl elsewhere. */
export const parseChord = (text: string, platform: Platform): Chord => {
  // Split on "+", keeping a trailing "+" as the key itself ("mod++").
  const parts = text.trim().toLowerCase().split(/\+(?!$)/).map((p) => ALIASES[p] ?? p)
  const flags = { meta: false, ctrl: false, alt: false, shift: false }
  let key = ""
  for (const [i, part] of parts.entries()) {
    const isLast = i === parts.length - 1
    if (part === "mod") flags[platform === "mac" ? "meta" : "ctrl"] = true
    else if (MODIFIERS.has(part) && !isLast) flags[part as keyof typeof flags] = true
    else if (isLast) key = part
    else throw new Error(`Unknown modifier "${part}" in "${text}"`)
  }
  if (!key) throw new Error(`No key in "${text}"`)
  return { key, ...flags }
}

/** "g i" → two chords. A lone " " stays the space key. */
export const parseBinding = (text: string, platform: Platform): ReadonlyArray<Chord> =>
  text.trim() === "" ? [parseChord(" ", platform)] : text.trim().split(/\s+/).map((c) => parseChord(c, platform))

export const chordId = (c: Chord) =>
  `${c.ctrl ? "ctrl+" : ""}${c.alt ? "alt+" : ""}${c.shift ? "shift+" : ""}${c.meta ? "meta+" : ""}${c.key}`

/**
 * Read a chord off a key event. Uses the physical key when modifiers or a
 * non-Latin layout change the character, so "mod+k" works on every layout and
 * ⌥ on macOS does not turn "a" into "å".
 */
export const eventToChord = (e: KeyEventLike): Chord | null => {
  if (e.isComposing || ["Shift", "Control", "Alt", "Meta", "OS", "AltGraph", "Dead", "Unidentified"].includes(e.key)) return null
  let key = e.key
  const code = e.code ?? ""
  const physicalLetter = /^Key[A-Z]$/.test(code)
  if (physicalLetter && (e.altKey || e.ctrlKey || e.metaKey || !/^[a-z]$/i.test(key))) key = code.slice(3)
  else if (/^Digit\d$/.test(code) && (e.altKey || e.ctrlKey || e.metaKey)) key = code.slice(5)
  key = key.toLowerCase()
  // A printed symbol already includes shift ("?" is shift+/), so drop the flag.
  const symbol = key.length === 1 && !/[a-z0-9 ]/.test(key)
  return { key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey && !symbol }
}

const KEY_LABELS: Record<string, string> = {
  enter: "↵",
  escape: "Esc",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  backspace: "⌫",
  delete: "Del",
  tab: "Tab",
  " ": "Space"
}

/** Display tokens for one binding: "mod+k" → ["⌘", "K"] on macOS, ["Ctrl", "K"] elsewhere. */
export const formatBinding = (binding: string, platform: Platform): ReadonlyArray<ReadonlyArray<string>> =>
  parseBinding(binding, platform).map((c) => {
    const mac = platform === "mac"
    const out: Array<string> = []
    if (c.ctrl) out.push(mac ? "⌃" : "Ctrl")
    if (c.alt) out.push(mac ? "⌥" : "Alt")
    if (c.shift) out.push(mac ? "⇧" : "Shift")
    if (c.meta) out.push(mac ? "⌘" : "Win")
    out.push(KEY_LABELS[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key[0]!.toUpperCase() + c.key.slice(1)))
    return out
  })

interface Registration {
  readonly token: number
  readonly def: CommandDef
}

interface Scope {
  readonly token: number
  readonly name: string
  readonly blocking: boolean
}

export interface KeymapOptions {
  readonly platform?: Platform
  /** Milliseconds to wait for the next key of a sequence. */
  readonly sequenceTimeout?: number
  /** User remaps: command id → bindings, or null to unbind. */
  readonly overrides?: Readonly<Record<string, ReadonlyArray<string> | null>>
  /** Dev aid: called when two unguarded commands in one scope share a binding. */
  readonly onConflict?: (binding: string, ids: ReadonlyArray<string>) => void
}

export interface HandleResult {
  readonly handled: boolean
  /** The command that ran, if any. */
  readonly ran?: string
  /** True while waiting for the rest of a sequence. */
  readonly pending?: boolean
}

export const createKeymap = (options: KeymapOptions = {}) => {
  const platform = options.platform ?? detectPlatform()
  const timeout = options.sequenceTimeout ?? 1000
  let overrides: Record<string, ReadonlyArray<string> | null> = { ...options.overrides }
  const registry = new Map<string, Array<Registration>>()
  let scopes: Array<Scope> = [{ token: 0, name: "global", blocking: false }]
  let nextToken = 1
  let buffer: Array<string> = []
  let bufferTimer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())

  const current = (id: string) => registry.get(id)?.at(-1)?.def
  const keysOf = (def: CommandDef) => (def.id in overrides ? overrides[def.id] ?? [] : def.keys ?? [])

  /** Scope rank, or -1 when the scope is inactive or hidden by a blocking scope above it. */
  const rank = (scope: string) => {
    const floor = scopes.findLastIndex((s) => s.blocking)
    const index = scopes.findLastIndex((s) => s.name === scope)
    return index >= Math.max(floor, 0) ? index : -1
  }

  const eligible = (def: CommandDef) => rank(def.scope ?? "global") >= 0 && (def.when?.() ?? true)

  const clearBuffer = () => {
    buffer = []
    if (bufferTimer) clearTimeout(bufferTimer)
    bufferTimer = undefined
  }

  const checkConflicts = () => {
    if (!options.onConflict) return
    const seen = new Map<string, Array<string>>()
    for (const regs of registry.values()) {
      const def = regs.at(-1)!.def
      // A `when` guard is how commands share a key on purpose (escape: blur, else go back).
      if (def.when) continue
      for (const binding of keysOf(def)) {
        const id = `${def.scope ?? "global"}|${parseBinding(binding, platform).map(chordId).join(" ")}`
        seen.set(id, [...(seen.get(id) ?? []), def.id])
      }
    }
    for (const [id, ids] of seen) if (ids.length > 1) options.onConflict(id.split("|")[1]!, ids)
  }

  const register = (defs: ReadonlyArray<CommandDef>): (() => void) => {
    const tokens = defs.map((def) => {
      const token = nextToken++
      registry.set(def.id, [...(registry.get(def.id) ?? []), { token, def }])
      return [def.id, token] as const
    })
    checkConflicts()
    notify()
    return () => {
      for (const [id, token] of tokens) {
        const rest = (registry.get(id) ?? []).filter((r) => r.token !== token)
        if (rest.length) registry.set(id, rest)
        else registry.delete(id)
      }
      notify()
    }
  }

  const pushScope = (name: string, opts: { blocking?: boolean } = {}): (() => void) => {
    const token = nextToken++
    scopes = [...scopes, { token, name, blocking: opts.blocking ?? false }]
    clearBuffer()
    notify()
    return () => {
      scopes = scopes.filter((s) => s.token !== token)
      clearBuffer()
      notify()
    }
  }

  const handle = (e: KeyEventLike, ctx: { editable: boolean }): HandleResult => {
    const chord = eventToChord(e)
    if (!chord) return { handled: false }
    const id = chordId(chord)
    const attempt = (sequence: ReadonlyArray<string>): HandleResult | null => {
      let best: { def: CommandDef; rank: number; token: number } | null = null
      let prefix = false
      for (const regs of registry.values()) {
        const { def, token } = regs.at(-1)!
        if (!eligible(def)) continue
        for (const binding of keysOf(def)) {
          const chords = parseBinding(binding, platform)
          const ids = chords.map(chordId)
          if (ids.length < sequence.length || !sequence.every((s, i) => s === ids[i])) continue
          // In a text field only explicit or ⌘/Ctrl-modified bindings may fire.
          const first = chords[0]!
          if (ctx.editable && !def.allowInInput && !first.meta && !first.ctrl) continue
          if (ids.length > sequence.length) {
            prefix = true
            continue
          }
          if (e.repeat && !def.repeat) continue
          const r = rank(def.scope ?? "global")
          if (!best || r > best.rank || (r === best.rank && token > best.token)) best = { def, rank: r, token }
        }
      }
      if (best) {
        clearBuffer()
        best.def.run()
        return { handled: true, ran: best.def.id }
      }
      if (prefix) {
        buffer = [...sequence]
        if (bufferTimer) clearTimeout(bufferTimer)
        bufferTimer = setTimeout(clearBuffer, timeout)
        return { handled: true, pending: true }
      }
      return null
    }
    const result = attempt([...buffer, id])
    if (result) return result
    // A broken sequence: forget it and try the key on its own.
    const hadBuffer = buffer.length > 0
    clearBuffer()
    return (hadBuffer ? attempt([id]) : null) ?? { handled: false }
  }

  /** Run a command by id, if it is registered and (unless forced) eligible now. */
  const run = (id: string, opts: { force?: boolean } = {}) => {
    const def = current(id)
    if (!def || (!opts.force && !eligible(def))) return false
    def.run()
    return true
  }

  /** Commands for menus and help. `eligibleOnly` hides ones that cannot fire right now. */
  const list = (opts: { eligibleOnly?: boolean } = {}): ReadonlyArray<CommandInfo> =>
    [...registry.values()]
      .map((regs) => regs.at(-1)!.def)
      .filter((def) => !opts.eligibleOnly || eligible(def))
      .map((def) => ({
        id: def.id,
        title: def.title,
        group: def.group ?? "General",
        scope: def.scope ?? "global",
        keys: keysOf(def),
        hidden: def.hidden ?? false
      }))

  return {
    platform,
    register,
    pushScope,
    handle,
    run,
    list,
    activeScopes: () => scopes.map((s) => s.name),
    isPending: () => buffer.length > 0,
    setOverrides: (next: Record<string, ReadonlyArray<string> | null>) => {
      overrides = { ...next }
      checkConflicts()
      notify()
    },
    format: (binding: string) => formatBinding(binding, platform),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

export type Keymap = ReturnType<typeof createKeymap>
