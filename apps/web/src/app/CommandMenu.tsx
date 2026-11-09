import * as stylex from "@stylexjs/stylex"
import { createSignal, For } from "solid-js"
import type { CommandInfo } from "../keys/core.ts"
import { Shortcut, useCommands, useKeymap } from "../keys/solid.tsx"
import { color, font } from "../theme/tokens.stylex.ts"
import { KeyboardIcon } from "../ui/icons.tsx"
import { Dialog, PickerList } from "../ui/kit.tsx"

const s = stylex.create({
  menu: { width: "min(560px, calc(100vw - 32px))" },
  list: { padding: 6, maxHeight: "60vh", overflowY: "auto" },
  help: { width: "min(620px, calc(100vw - 32px))", overflow: "hidden" },
  helpFrame: { display: "flex", flexDirection: "column", maxHeight: "76vh" },
  helpBody: { paddingInline: 20, paddingBottom: 20, overflowY: "auto", minHeight: 0, outline: "none" },
  helpTitle: { display: "flex", alignItems: "center", gap: 8, margin: 0, padding: 20, paddingBottom: 8, fontSize: font.lg, fontWeight: 600 },
  helpNote: { margin: 0, paddingInline: 20, paddingBottom: 12, color: color.fgMuted, fontSize: font.sm },
  group: { marginTop: 14, marginBottom: 4, color: color.fgSubtle, fontSize: font.xs, fontWeight: 500 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 32,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
    fontSize: font.md
  },
  keys: { display: "flex", gap: 8 },
})

const groupBy = (commands: ReadonlyArray<CommandInfo>) => {
  const groups = new Map<string, Array<CommandInfo>>()
  for (const c of commands) groups.set(c.group, [...(groups.get(c.group) ?? []), c])
  return [...groups.entries()]
}

/**
 * ⌘K lists every command that can run where you are, with its shortcut.
 * "?" lists every command and binding in the app.
 */
export const CommandSurfaces = () => {
  const keymap = useKeymap()
  const [menu, setMenu] = createSignal<ReadonlyArray<CommandInfo> | null>(null)
  const [help, setHelp] = createSignal<ReadonlyArray<CommandInfo> | null>(null)

  useCommands([
    {
      id: "app.commandMenu",
      title: "Open command menu",
      group: "General",
      keys: ["mod+k"],
      hidden: true,
      // Snapshot what can run *here* before the menu's own scope hides it.
      run: () => setMenu(keymap.list({ eligibleOnly: true }).filter((c) => !c.hidden))
    },
    {
      id: "app.shortcuts",
      title: "Keyboard shortcuts",
      group: "General",
      keys: ["?"],
      run: () => setHelp(keymap.list().filter((c) => !c.hidden || c.keys.length > 0))
    }
  ])

  const run = (id: string) => {
    setMenu(null)
    // Let the menu close and its scope pop before the command runs.
    queueMicrotask(() => keymap.run(id, { force: true }))
  }

  return (
    <>
      <Dialog open={menu() !== null} onClose={() => setMenu(null)} label="Command menu" scope="commandMenu" sx={s.menu}>
        <div {...stylex.attrs(s.list)}>
          <PickerList
            placeholder="Type a command…"
            selected={[]}
            close={() => setMenu(null)}
            items={(menu() ?? []).map((c) => ({
              value: c.id,
              label: c.title,
              keywords: `${c.group} ${c.id}`,
              hint: c.group,
              ...(c.keys[0] ? { trailing: () => <Shortcut binding={c.keys[0]!} /> } : {})
            }))}
            onPick={run}
          />
        </div>
      </Dialog>
      <Dialog open={help() !== null} onClose={() => setHelp(null)} label="Keyboard shortcuts" scope="shortcutHelp" sx={s.help}>
        <div {...stylex.attrs(s.helpFrame)}>
        <h2 {...stylex.attrs(s.helpTitle)}>
          <KeyboardIcon size={16} /> Keyboard shortcuts
        </h2>
        <p {...stylex.attrs(s.helpNote)}>
          Remap any command by id in localStorage under <code>gradient.keymap</code>, for example{" "}
          <code>{`{"issue.status": ["shift+s"]}`}</code>.
        </p>
        <div {...stylex.attrs(s.helpBody)} tabindex="-1">
          <For each={groupBy(help() ?? [])} keyed={([group]) => group}>
            {(entry) => (
              <>
                <div {...stylex.attrs(s.group)}>{entry()[0]}</div>
                <For each={entry()[1]} keyed={(c) => c.id}>
                  {(c) => (
                    <div {...stylex.attrs(s.row)} title={c().id}>
                      <span>{c().title}</span>
                      <span {...stylex.attrs(s.keys)}>
                        <For each={c().keys}>{(k) => <Shortcut binding={k} />}</For>
                      </span>
                    </div>
                  )}
                </For>
              </>
            )}
          </For>
        </div>
        </div>
      </Dialog>
    </>
  )
}
