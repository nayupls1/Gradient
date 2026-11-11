import * as stylex from "@stylexjs/stylex"
import { createSignal, For, Show } from "solid-js"
import type { CommandInfo } from "../keys/core.ts"
import { KeyScope, Shortcut, useCommands, useKeymap } from "../keys/solid.tsx"
import { colors } from "../lib/tokens.stylex.ts"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from "../ui/command.tsx"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog.tsx"
import { KeyboardIcon } from "../ui/icons.tsx"

const s = stylex.create({
  help: { maxWidth: "min(620px, calc(100vw - 32px))", maxHeight: "76vh", gridTemplateRows: "auto minmax(0, 1fr)" },
  title: { display: "flex", alignItems: "center", gap: 8 },
  body: { overflowY: "auto", minHeight: 0, marginInline: "-1.5rem", paddingInline: "1.5rem", outline: "none" },
  group: { marginTop: 14, marginBottom: 4, color: colors.mutedForeground, fontSize: "0.75rem", fontWeight: 500 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 32,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border
  },
  keys: { display: "flex", gap: 8 }
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
      <CommandDialog
        open={menu() !== null}
        onOpenChange={(open) => !open && setMenu(null)}
        title="Command menu"
        description="Run any command available here"
      >
        <KeyScope name="commandMenu" blocking>
          <Command>
            <CommandInput placeholder="Type a command…" />
            <CommandList>
              <CommandEmpty>No results</CommandEmpty>
              <For each={groupBy(menu() ?? [])} keyed={([group]) => group}>
                {(entry) => (
                  <CommandGroup heading={entry()[0]}>
                    <For each={entry()[1]} keyed={(c) => c.id}>
                      {(c) => (
                        <CommandItem value={c().id} keywords={[c().title, c().group]} onSelect={() => run(c().id)}>
                          {c().title}
                          <Show when={c().keys[0]}>
                            {(binding) => (
                              <CommandShortcut>
                                <Shortcut binding={binding()} />
                              </CommandShortcut>
                            )}
                          </Show>
                        </CommandItem>
                      )}
                    </For>
                  </CommandGroup>
                )}
              </For>
            </CommandList>
          </Command>
        </KeyScope>
      </CommandDialog>
      <Dialog open={help() !== null} onOpenChange={(open) => !open && setHelp(null)}>
        <DialogContent xstyle={s.help}>
          <KeyScope name="shortcutHelp" blocking>
            <DialogHeader>
              <DialogTitle xstyle={s.title}>
                <KeyboardIcon size={16} /> Keyboard shortcuts
              </DialogTitle>
              <DialogDescription>
                Remap any command by id in localStorage under <code>gradient.keymap</code>, for example{" "}
                <code>{`{"issue.status": ["shift+s"]}`}</code>.
              </DialogDescription>
            </DialogHeader>
            <div {...stylex.attrs(s.body)} tabindex="-1">
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
          </KeyScope>
        </DialogContent>
      </Dialog>
    </>
  )
}
