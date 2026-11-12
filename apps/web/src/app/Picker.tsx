import * as stylex from "@stylexjs/stylex"
import type { ComponentRenderFn, HTMLProps } from "base-ui-solidjs/types"
import type { JSX } from "@solidjs/web"
import { createSignal, For, merge, omit, Show, untrack } from "solid-js"
import { KeyScope } from "../keys/solid.tsx"
import { colors } from "../lib/tokens.stylex.ts"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../ui/command.tsx"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx"

/*
 * The property picker: shadcn's combobox pattern (a Popover around a Command).
 * Type to filter, arrow keys to move, Enter to pick. Single select closes on
 * pick; multi select stays open.
 */

const s = stylex.create({
  content: { width: "auto", minWidth: 220, maxWidth: 320, padding: 0, gap: 0 },
  label: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  hint: { marginLeft: "auto", color: colors.mutedForeground, fontSize: "0.75rem", whiteSpace: "nowrap", flexShrink: 0 }
})

export interface PickerItem<V> {
  value: V
  label: string
  /** A render function, so the icon is created inside the list that shows it. */
  icon?: () => JSX.Element
  hint?: string
  /** Right-aligned extra, such as a shortcut. Also a render function. */
  trailing?: () => JSX.Element
  /** Extra words to match when filtering. */
  keywords?: string
}

/** Opens and closes a picker from outside, so keyboard commands can open it. */
export interface PickerApi {
  open(): void
  close(): void
}

/** Renders the trigger with Base UI's props: `(props) => <Button {...props}>…</Button>`. */
export type PickerTrigger = ComponentRenderFn<HTMLProps, unknown>

export interface PickerListProps<V> {
  items: ReadonlyArray<PickerItem<V>>
  selected: ReadonlyArray<V>
  multiple?: boolean
  placeholder: string
  onPick: (value: V) => void
  onCreate?: (query: string) => void
  /** Shown when nothing matches, e.g. "Loading…" while items are on their way. */
  emptyText?: string
  close: () => void
  inputRef?: (el: HTMLInputElement) => void
}

/** Plain substring match on the label and keywords, in list order (cmdk's fuzzy score is too loose for names). */
const matches = (_value: string, search: string, keywords?: string[]) =>
  (keywords ?? []).join(" ").toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0

export const PickerList = <V,>(props: PickerListProps<V>) => {
  const [query, setQuery] = createSignal("")
  const canCreate = () => !!props.onCreate && query().trim() !== "" &&
    !props.items.some((i) => i.label.toLowerCase() === query().trim().toLowerCase())
  const pick = (item: PickerItem<V>) => {
    props.onPick(item.value)
    if (!props.multiple) props.close()
  }
  return (
    <Command filter={matches} loop>
      <CommandInput
        ref={(el: HTMLInputElement) => props.inputRef?.(el)}
        placeholder={props.placeholder}
        value={query()}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{props.emptyText ?? "No results"}</CommandEmpty>
        {/* The group pads the items, so they line up with the search field (shadcn's combobox does the same). */}
        <CommandGroup>
          <For each={props.items}>
            {(item, index) => (
              <CommandItem
                value={`${index()}:${item.label}`}
                keywords={[item.label, item.keywords ?? ""]}
                data-checked={String(props.selected.includes(item.value))}
                onSelect={() => pick(item)}
              >
                {item.icon?.()}
                <span {...stylex.attrs(s.label)}>{item.label}</span>
                <Show when={item.hint}>
                  <span {...stylex.attrs(s.hint)}>{item.hint}</span>
                </Show>
                {item.trailing?.()}
              </CommandItem>
            )}
          </For>
          <Show when={canCreate()}>
            <CommandItem forceMount value={`create:${query()}`} onSelect={() => props.onCreate!(query().trim())}>
              <span {...stylex.attrs(s.label)}>Create “{query().trim()}”</span>
            </CommandItem>
          </Show>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/** A trigger plus a PickerList in a popover: the building block for property pickers. */
export const Picker = <V,>(props: Omit<PickerListProps<V>, "close" | "inputRef"> & {
  trigger: PickerTrigger
  align?: "start" | "end"
  apiRef?: (api: PickerApi) => void
}) => {
  const [open, setOpen] = createSignal(false)
  const input: { current: HTMLElement | null } = { current: null }
  untrack(() => props.apiRef?.({ open: () => setOpen(true), close: () => setOpen(false) }))
  const listProps = omit(props, "trigger", "align", "apiRef")
  return (
    <Popover open={open()} onOpenChange={(next) => setOpen(next)}>
      <PopoverTrigger render={props.trigger} />
      <PopoverContent
        align={props.align ?? "start"}
        initialFocus={input}
        xstyle={s.content}
        // The popup is portalled, but Solid still bubbles its clicks to the trigger's ancestors (a list row).
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <KeyScope name="picker" blocking>
          <PickerList {...merge(listProps, { close: () => setOpen(false), inputRef: (el: HTMLInputElement) => (input.current = el) })} />
        </KeyScope>
      </PopoverContent>
    </Popover>
  )
}
