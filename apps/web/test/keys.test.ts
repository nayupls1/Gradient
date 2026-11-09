import { describe, expect, test } from "bun:test"
import { chordId, createKeymap, eventToChord, formatBinding, type KeyEventLike, parseBinding } from "../src/keys/core.ts"

const ev = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : undefined,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
})

const setup = () => {
  const ran: Array<string> = []
  const keymap = createKeymap({ platform: "mac", sequenceTimeout: 50 })
  const cmd = (id: string, keys: Array<string>, extra: object = {}) => ({ id, title: id, keys, run: () => ran.push(id), ...extra })
  const press = (e: KeyEventLike, editable = false) => keymap.handle(e, { editable })
  return { ran, keymap, cmd, press }
}

describe("parsing and formatting", () => {
  test("mod is ⌘ on macOS and Ctrl elsewhere", () => {
    expect(parseBinding("mod+k", "mac").map(chordId)).toEqual(["meta+k"])
    expect(parseBinding("mod+k", "other").map(chordId)).toEqual(["ctrl+k"])
  })
  test("sequences, aliases and the plus key", () => {
    expect(parseBinding("g i", "mac").map(chordId)).toEqual(["g", "i"])
    expect(parseBinding("esc", "mac").map(chordId)).toEqual(["escape"])
    expect(parseBinding("mod++", "other").map(chordId)).toEqual(["ctrl++"])
  })
  test("display tokens", () => {
    expect(formatBinding("mod+shift+enter", "mac")).toEqual([["⇧", "⌘", "↵"]])
    expect(formatBinding("mod+k", "other")).toEqual([["Ctrl", "K"]])
    expect(formatBinding("g i", "mac")).toEqual([["G"], ["I"]])
  })
  test("events use the physical key under modifiers and other layouts", () => {
    expect(chordId(eventToChord(ev("å", { code: "KeyA", altKey: true }))!)).toBe("alt+a")
    expect(chordId(eventToChord(ev("л", { code: "KeyK", metaKey: true }))!)).toBe("meta+k")
    expect(chordId(eventToChord(ev("?", { shiftKey: true }))!)).toBe("?")
    expect(eventToChord(ev("Shift"))).toBeNull()
    expect(eventToChord(ev("a", { isComposing: true }))).toBeNull()
  })
})

describe("keymap", () => {
  test("runs a single-key command", () => {
    const { keymap, cmd, press, ran } = setup()
    keymap.register([cmd("create", ["c"])])
    expect(press(ev("c")).ran).toBe("create")
    expect(ran).toEqual(["create"])
  })

  test("sequences wait for the next key and time out", async () => {
    const { keymap, cmd, press, ran } = setup()
    keymap.register([cmd("go.issues", ["g i"]), cmd("info", ["i"])])
    expect(press(ev("g")).pending).toBe(true)
    expect(press(ev("i")).ran).toBe("go.issues")
    press(ev("g"))
    await Bun.sleep(80)
    expect(press(ev("i")).ran).toBe("info")
    expect(ran).toEqual(["go.issues", "info"])
  })

  test("a broken sequence retries the key alone", () => {
    const { keymap, cmd, press } = setup()
    keymap.register([cmd("go.issues", ["g i"]), cmd("create", ["c"])])
    press(ev("g"))
    expect(press(ev("c")).ran).toBe("create")
  })

  test("text fields only let ⌘/Ctrl chords and opted-in commands through", () => {
    const { keymap, cmd, press } = setup()
    keymap.register([cmd("create", ["c"]), cmd("menu", ["mod+k"]), cmd("submit", ["enter"], { allowInInput: true })])
    expect(press(ev("c"), true).handled).toBe(false)
    expect(press(ev("k", { metaKey: true }), true).ran).toBe("menu")
    expect(press(ev("Enter"), true).ran).toBe("submit")
  })

  test("the higher scope wins, and blocking scopes hide the rest", () => {
    const { keymap, cmd, press } = setup()
    keymap.register([cmd("global.s", ["s"]), cmd("list.s", ["s"], { scope: "list" }), cmd("create", ["c"])])
    expect(press(ev("s")).ran).toBe("global.s")
    const leaveList = keymap.pushScope("list")
    expect(press(ev("s")).ran).toBe("list.s")
    const leaveModal = keymap.pushScope("modal", { blocking: true })
    expect(press(ev("s")).handled).toBe(false)
    expect(press(ev("c")).handled).toBe(false)
    leaveModal()
    expect(press(ev("c")).ran).toBe("create")
    leaveList()
    expect(press(ev("s")).ran).toBe("global.s")
  })

  test("the latest registration of an id wins, and unregistering restores the previous", () => {
    const { keymap, press, ran } = setup()
    const off = keymap.register([{ id: "status", title: "", keys: ["s"], run: () => ran.push("row 1") }])
    const off2 = keymap.register([{ id: "status", title: "", keys: ["s"], run: () => ran.push("row 2") }])
    press(ev("s"))
    off2()
    press(ev("s"))
    off()
    expect(press(ev("s")).handled).toBe(false)
    expect(ran).toEqual(["row 2", "row 1"])
  })

  test("auto-repeat only fires commands that ask for it", () => {
    const { keymap, cmd, press } = setup()
    keymap.register([cmd("down", ["j"], { repeat: true }), cmd("create", ["c"])])
    expect(press(ev("j", { repeat: true })).ran).toBe("down")
    expect(press(ev("c", { repeat: true })).handled).toBe(false)
  })

  test("overrides remap and unbind; run() and list() see the effective keys", () => {
    const { keymap, cmd, press, ran } = setup()
    keymap.register([cmd("create", ["c"]), cmd("menu", ["mod+k"], { when: () => false })])
    keymap.setOverrides({ create: ["n"], menu: null })
    expect(press(ev("c")).handled).toBe(false)
    expect(press(ev("n")).ran).toBe("create")
    expect(keymap.list().find((c) => c.id === "menu")!.keys).toEqual([])
    expect(keymap.list({ eligibleOnly: true }).map((c) => c.id)).toEqual(["create"])
    expect(keymap.run("menu")).toBe(false)
    expect(keymap.run("menu", { force: true })).toBe(true)
    expect(ran).toEqual(["create", "menu"])
  })

  test("reports conflicts within a scope", () => {
    const conflicts: Array<string> = []
    const keymap = createKeymap({ platform: "mac", onConflict: (b, ids) => conflicts.push(`${b}:${ids.join(",")}`) })
    keymap.register([{ id: "a", title: "", keys: ["x"], run: () => {} }, { id: "b", title: "", keys: ["x"], run: () => {} }])
    expect(conflicts).toEqual(["x:a,b"])
  })
})
