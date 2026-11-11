/**
 * A Solid 2 port of cmdk's parts (https://github.com/pacocoursey/cmdk), unstyled. shadcn's `command`
 * is built on cmdk, which is React-only; this keeps cmdk's API, DOM (`cmdk-*` attributes, roles, ARIA),
 * fuzzy filtering (`command-score`) and keyboard navigation.
 *
 * Differences from cmdk: matching items are not re-sorted by score (they keep their order), filtered-out
 * items stay mounted but hidden (`display: none`), and there's no `Command.Loading`/`useCommandState`.
 */
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  omit,
  onSettled,
  Show,
  untrack,
  useContext,
  type Accessor,
} from "solid-js"
import type { ComponentProps, JSX } from "@solidjs/web"

// ---------------------------------------------------------------------------------------------
// command-score (cmdk's fuzzy matcher, ported verbatim)

const SCORE_CONTINUE_MATCH = 1
const SCORE_SPACE_WORD_JUMP = 0.9
const SCORE_NON_SPACE_WORD_JUMP = 0.8
const SCORE_CHARACTER_JUMP = 0.17
const SCORE_TRANSPOSITION = 0.1
const PENALTY_SKIPPED = 0.999
const PENALTY_CASE_MISMATCH = 0.9999
const PENALTY_NOT_COMPLETE = 0.99
const IS_GAP_REGEXP = /[\\/_+.#"@[({&]/
const COUNT_GAPS_REGEXP = /[\\/_+.#"@[({&]/g
const IS_SPACE_REGEXP = /[\s-]/
const COUNT_SPACE_REGEXP = /[\s-]/g

function commandScoreInner(
  string: string,
  abbreviation: string,
  lowerString: string,
  lowerAbbreviation: string,
  stringIndex: number,
  abbreviationIndex: number,
  memo: Record<string, number>,
): number {
  if (abbreviationIndex === abbreviation.length) {
    return stringIndex === string.length ? SCORE_CONTINUE_MATCH : PENALTY_NOT_COMPLETE
  }
  const memoKey = `${stringIndex},${abbreviationIndex}`
  if (memo[memoKey] !== undefined) return memo[memoKey]

  const abbreviationChar = lowerAbbreviation.charAt(abbreviationIndex)
  let index = lowerString.indexOf(abbreviationChar, stringIndex)
  let highScore = 0
  while (index >= 0) {
    let score = commandScoreInner(string, abbreviation, lowerString, lowerAbbreviation, index + 1, abbreviationIndex + 1, memo)
    if (score > highScore) {
      if (index === stringIndex) {
        score *= SCORE_CONTINUE_MATCH
      } else if (IS_GAP_REGEXP.test(string.charAt(index - 1))) {
        score *= SCORE_NON_SPACE_WORD_JUMP
        const wordBreaks = string.slice(stringIndex, index - 1).match(COUNT_GAPS_REGEXP)
        if (wordBreaks && stringIndex > 0) score *= Math.pow(PENALTY_SKIPPED, wordBreaks.length)
      } else if (IS_SPACE_REGEXP.test(string.charAt(index - 1))) {
        score *= SCORE_SPACE_WORD_JUMP
        const spaceBreaks = string.slice(stringIndex, index - 1).match(COUNT_SPACE_REGEXP)
        if (spaceBreaks && stringIndex > 0) score *= Math.pow(PENALTY_SKIPPED, spaceBreaks.length)
      } else {
        score *= SCORE_CHARACTER_JUMP
        if (stringIndex > 0) score *= Math.pow(PENALTY_SKIPPED, index - stringIndex)
      }
      if (string.charAt(index) !== abbreviation.charAt(abbreviationIndex)) score *= PENALTY_CASE_MISMATCH
    }
    if (
      (score < SCORE_TRANSPOSITION &&
        lowerString.charAt(index - 1) === lowerAbbreviation.charAt(abbreviationIndex + 1)) ||
      (lowerAbbreviation.charAt(abbreviationIndex + 1) === lowerAbbreviation.charAt(abbreviationIndex) &&
        lowerString.charAt(index - 1) !== lowerAbbreviation.charAt(abbreviationIndex))
    ) {
      const transposedScore = commandScoreInner(
        string,
        abbreviation,
        lowerString,
        lowerAbbreviation,
        index + 1,
        abbreviationIndex + 2,
        memo,
      )
      if (transposedScore * SCORE_TRANSPOSITION > score) score = transposedScore * SCORE_TRANSPOSITION
    }
    if (score > highScore) highScore = score
    index = lowerString.indexOf(abbreviationChar, index + 1)
  }
  memo[memoKey] = highScore
  return highScore
}

function formatInput(string: string) {
  return string.toLowerCase().replace(COUNT_SPACE_REGEXP, " ")
}

/** cmdk's default filter: a fuzzy score in [0, 1] (0 hides the item). */
export function commandScore(string: string, abbreviation: string, aliases?: string[]): number {
  const full = aliases && aliases.length > 0 ? `${string} ${aliases.join(" ")}` : string
  return commandScoreInner(full, abbreviation, formatInput(full), formatInput(abbreviation), 0, 0, {})
}

// ---------------------------------------------------------------------------------------------
// Context

type ItemEntry = {
  id: string
  value: Accessor<string>
  keywords: Accessor<string[]>
  groupId: string | undefined
  forceMount: Accessor<boolean>
}

type CommandContextValue = {
  search: Accessor<string>
  setSearch: (search: string) => void
  selected: Accessor<string | undefined>
  setSelected: (value: string | undefined) => void
  isItemVisible: (id: string) => boolean
  isGroupVisible: (id: string, forceMount: boolean) => boolean
  count: Accessor<number>
  register: (entry: ItemEntry) => () => void
  disablePointerSelection: Accessor<boolean>
  listId: string
  labelId: string
  inputId: string
}

const CommandContext = createContext<CommandContextValue>()
const GroupContext = createContext<{ id: string; forceMount: Accessor<boolean> } | null>(null)

const SELECT_EVENT = "cmdk-item-select"
const VALID_ITEMS = '[cmdk-item=""]:not([aria-disabled="true"]):not([data-cmdk-hidden])'

const srOnlyStyle: JSX.CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: "0",
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  "white-space": "nowrap",
  "border-width": "0",
}

// ---------------------------------------------------------------------------------------------
// Root

export type CommandRootProps = Omit<ComponentProps<"div">, "onKeyDown"> & {
  /** Accessible label for the command menu (rendered visually hidden). */
  label?: string
  /** Whether items are filtered by the search. @default true */
  shouldFilter?: boolean
  /** Custom filter: return a score in [0, 1]; 0 hides the item. Defaults to cmdk's fuzzy `commandScore`. */
  filter?: (value: string, search: string, keywords?: string[]) => number
  /** Initially selected item value (uncontrolled). */
  defaultValue?: string
  /** Selected item value (controlled). */
  value?: string
  onValueChange?: (value: string) => void
  /** Wrap keyboard navigation around the ends. @default false */
  loop?: boolean
  /** Don't select items on pointer move. @default false */
  disablePointerSelection?: boolean
  /** Ctrl+N/J/P/K navigation. @default true */
  vimBindings?: boolean
  onKeyDown?: (event: KeyboardEvent) => void
}

export function CommandRoot(props: CommandRootProps) {
  const rest = omit(
    props,
    "label",
    "shouldFilter",
    "filter",
    "defaultValue",
    "value",
    "onValueChange",
    "loop",
    "disablePointerSelection",
    "vimBindings",
    "onKeyDown",
    "children",
  )
  const listId = createUniqueId()
  const labelId = createUniqueId()
  const inputId = createUniqueId()
  let root: HTMLDivElement | undefined

  const [search, setSearch] = createSignal("")
  const [items, setItems] = createSignal<ItemEntry[]>([])
  const [selectedInternal, setSelectedInternal] = createSignal<string | undefined>(untrack(() => props.defaultValue))
  const selected = () => (props.value !== undefined ? props.value : selectedInternal())
  const setSelected = (value: string | undefined) => {
    if (value === selected()) return
    setSelectedInternal(value)
    if (value !== undefined) props.onValueChange?.(value)
  }

  const scores = createMemo(() => {
    const query = search()
    const filter = props.filter ?? commandScore
    const filtering = props.shouldFilter !== false && query !== ""
    const map = new Map<string, number>()
    for (const item of items()) {
      map.set(item.id, filtering && !item.forceMount() ? filter(item.value(), query, item.keywords()) : 1)
    }
    return map
  })

  const isItemVisible = (id: string) => (scores().get(id) ?? 1) > 0
  const isGroupVisible = (id: string, forceMount: boolean) =>
    forceMount || items().some((item) => item.groupId === id && isItemVisible(item.id)) || !items().some((i) => i.groupId === id)
  const count = createMemo(() => items().filter((item) => isItemVisible(item.id)).length)

  const register = (entry: ItemEntry) => {
    setItems((list) => [...list, entry])
    return () => setItems((list) => list.filter((item) => item !== entry))
  }

  const validItems = () => (root ? Array.from(root.querySelectorAll<HTMLElement>(VALID_ITEMS)) : [])
  const selectedItem = () =>
    root?.querySelector<HTMLElement>(`${VALID_ITEMS}[aria-selected="true"]`) ?? undefined

  const scrollSelectedIntoView = () => {
    queueMicrotask(() => {
      const item = selectedItem()
      if (!item) return
      if (item.parentElement?.firstElementChild === item) {
        // First item of a group: reveal the group heading too.
        item.closest("[cmdk-group]")?.querySelector("[cmdk-group-heading]")?.scrollIntoView({ block: "nearest" })
      }
      item.scrollIntoView({ block: "nearest" })
    })
  }

  const selectFirst = () => {
    const first = validItems()[0]
    setSelected(first?.getAttribute("data-value") ?? undefined)
  }

  // Select the first match whenever the search changes or the selection is filtered out.
  createEffect(
    () => [search(), count()] as const,
    ([query]) => {
      queueMicrotask(() => {
        const current = untrack(selected)
        const stillThere = current !== undefined && validItems().some((el) => el.getAttribute("data-value") === current)
        if (query !== lastSearch || !stillThere) selectFirst()
        lastSearch = query
      })
    },
  )
  let lastSearch = ""

  const updateSelectedByItem = (change: 1 | -1) => {
    const list = validItems()
    const current = selectedItem()
    const index = current ? list.indexOf(current) : -1
    let next = list[index + change]
    if (props.loop) next = index + change < 0 ? list[list.length - 1] : index + change === list.length ? list[0] : next
    if (next) setSelected(next.getAttribute("data-value") ?? undefined)
  }

  const updateSelectedByGroup = (change: 1 | -1) => {
    const current = selectedItem()
    let group = current?.closest("[cmdk-group]")
    let item: HTMLElement | undefined | null
    while (group && !item) {
      group = change > 0 ? nextSibling(group, "[cmdk-group]") : previousSibling(group, "[cmdk-group]")
      item = group?.querySelector<HTMLElement>(VALID_ITEMS)
    }
    if (item) setSelected(item.getAttribute("data-value") ?? undefined)
    else updateSelectedByItem(change)
  }

  const last = () => {
    const list = validItems()
    setSelected(list[list.length - 1]?.getAttribute("data-value") ?? undefined)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    props.onKeyDown?.(event)
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
    const vim = props.vimBindings !== false && event.ctrlKey
    switch (event.key) {
      case "n":
      case "j":
        if (vim) {
          event.preventDefault()
          updateSelectedByItem(1)
        }
        break
      case "ArrowDown":
        event.preventDefault()
        if (event.metaKey) last()
        else if (event.altKey) updateSelectedByGroup(1)
        else updateSelectedByItem(1)
        break
      case "p":
      case "k":
        if (vim) {
          event.preventDefault()
          updateSelectedByItem(-1)
        }
        break
      case "ArrowUp":
        event.preventDefault()
        if (event.metaKey) selectFirst()
        else if (event.altKey) updateSelectedByGroup(-1)
        else updateSelectedByItem(-1)
        break
      case "Home":
        event.preventDefault()
        selectFirst()
        break
      case "End":
        event.preventDefault()
        last()
        break
      case "Enter": {
        event.preventDefault()
        selectedItem()?.dispatchEvent(new Event(SELECT_EVENT))
        break
      }
    }
    if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End" || vim) scrollSelectedIntoView()
  }

  const context: CommandContextValue = {
    search,
    setSearch,
    selected,
    setSelected,
    isItemVisible,
    isGroupVisible,
    count,
    register,
    disablePointerSelection: () => props.disablePointerSelection ?? false,
    listId,
    labelId,
    inputId,
  }

  return (
    <CommandContext value={context}>
      <div
        ref={(el) => {
          root = el
        }}
        tabindex={-1}
        cmdk-root=""
        {...rest}
        onKeyDown={onKeyDown}
      >
        <label cmdk-label="" for={inputId} id={labelId} style={srOnlyStyle}>
          {props.label}
        </label>
        {props.children}
      </div>
    </CommandContext>
  )
}

function nextSibling(el: Element, selector: string) {
  let sibling = el.nextElementSibling
  while (sibling) {
    if (sibling.matches(selector)) return sibling
    sibling = sibling.nextElementSibling
  }
  return undefined
}

function previousSibling(el: Element, selector: string) {
  let sibling = el.previousElementSibling
  while (sibling) {
    if (sibling.matches(selector)) return sibling
    sibling = sibling.previousElementSibling
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------
// Input

export type CommandInputPrimitiveProps = Omit<ComponentProps<"input">, "value" | "onInput" | "type"> & {
  /** Search text (controlled). */
  value?: string
  onValueChange?: (search: string) => void
}

export function CommandInputPrimitive(props: CommandInputPrimitiveProps) {
  const rest = omit(props, "value", "onValueChange")
  const ctx = useContext(CommandContext)
  createEffect(
    () => props.value,
    (value) => {
      if (value != null) ctx.setSearch(value)
    },
  )
  const activeId = () => {
    const value = ctx.selected()
    return value === undefined ? undefined : itemIdFor(value)
  }
  return (
    <input
      cmdk-input=""
      autocomplete="off"
      autocorrect="off"
      spellcheck={false}
      aria-autocomplete="list"
      role="combobox"
      aria-expanded="true"
      aria-controls={ctx.listId}
      aria-labelledby={ctx.labelId}
      aria-activedescendant={activeId()}
      id={ctx.inputId}
      type="text"
      {...rest}
      value={props.value ?? ctx.search()}
      onInput={(event) => {
        const value = event.currentTarget.value
        if (props.value == null) ctx.setSearch(value)
        props.onValueChange?.(value)
      }}
    />
  )
}

// Item ids are derived from values so the input can point `aria-activedescendant` at the selection.
const itemIds = new Map<string, string>()
function itemIdFor(value: string) {
  let id = itemIds.get(value)
  if (!id) {
    id = `cmdk-item-${itemIds.size}`
    itemIds.set(value, id)
  }
  return id
}

// ---------------------------------------------------------------------------------------------
// List, Empty, Group, Separator, Item

export type CommandListPrimitiveProps = ComponentProps<"div"> & { label?: string }

export function CommandListPrimitive(props: CommandListPrimitiveProps) {
  const rest = omit(props, "label", "children")
  const ctx = useContext(CommandContext)
  let sizer: HTMLDivElement | undefined
  let list: HTMLDivElement | undefined
  onSettled(() => {
    if (!sizer || !list || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      list?.style.setProperty("--cmdk-list-height", `${sizer?.offsetHeight ?? 0}px`)
    })
    observer.observe(sizer)
    return () => observer.disconnect()
  })
  return (
    <div
      ref={(el) => {
        list = el
      }}
      cmdk-list=""
      role="listbox"
      tabindex={-1}
      id={ctx.listId}
      aria-label={props.label ?? "Suggestions"}
      {...rest}
    >
      <div
        ref={(el) => {
          sizer = el
        }}
        cmdk-list-sizer=""
      >
        {props.children}
      </div>
    </div>
  )
}

export function CommandEmptyPrimitive(props: ComponentProps<"div">) {
  const ctx = useContext(CommandContext)
  return (
    <Show when={ctx.count() === 0}>
      <div cmdk-empty="" role="presentation" {...props} />
    </Show>
  )
}

export type CommandGroupPrimitiveProps = Omit<ComponentProps<"div">, "title"> & {
  heading?: JSX.Element
  /** Value used to identify the group. */
  value?: string
  /** Keep the group visible even when none of its items match. */
  forceMount?: boolean
  /** Class for the heading element (cmdk styles it through `[cmdk-group-heading]`). */
  headingClass?: string | undefined
}

export function CommandGroupPrimitive(props: CommandGroupPrimitiveProps) {
  const rest = omit(props, "heading", "value", "forceMount", "headingClass", "children", "style")
  const ctx = useContext(CommandContext)
  const id = createUniqueId()
  const headingId = createUniqueId()
  const visible = () => ctx.isGroupVisible(id, props.forceMount ?? false)
  return (
    <GroupContext value={{ id, forceMount: () => props.forceMount ?? false }}>
      <div
        cmdk-group=""
        role="presentation"
        data-value={props.value}
        data-cmdk-hidden={visible() ? undefined : ""}
        {...rest}
        style={visible() ? (props.style as JSX.CSSProperties | undefined) : { display: "none" }}
      >
        <Show when={props.heading}>
          <div cmdk-group-heading="" aria-hidden="true" id={headingId} class={props.headingClass}>
            {props.heading}
          </div>
        </Show>
        <div cmdk-group-items="" role="group" aria-labelledby={props.heading ? headingId : undefined}>
          {props.children}
        </div>
      </div>
    </GroupContext>
  )
}

export type CommandSeparatorPrimitiveProps = ComponentProps<"div"> & {
  /** Render even while searching. */
  alwaysRender?: boolean
}

export function CommandSeparatorPrimitive(props: CommandSeparatorPrimitiveProps) {
  const rest = omit(props, "alwaysRender")
  const ctx = useContext(CommandContext)
  return (
    <Show when={props.alwaysRender || ctx.search() === ""}>
      <div cmdk-separator="" role="separator" {...rest} />
    </Show>
  )
}

export type CommandItemPrimitiveProps = Omit<ComponentProps<"div">, "onSelect"> & {
  /** Item value; defaults to the item's text content. */
  value?: string
  /** Extra words to match while filtering. */
  keywords?: string[]
  disabled?: boolean
  onSelect?: (value: string) => void
  /** Keep the item visible regardless of the search. */
  forceMount?: boolean
}

export function CommandItemPrimitive(props: CommandItemPrimitiveProps) {
  const rest = omit(props, "value", "keywords", "disabled", "onSelect", "forceMount", "style")
  const ctx = useContext(CommandContext)
  const group = useContext(GroupContext)
  const id = createUniqueId()
  const [textValue, setTextValue] = createSignal("")
  const value = () => (props.value ?? textValue()).trim()
  let el: HTMLDivElement | undefined

  onSettled(() => {
    setTextValue(el?.textContent ?? "")
    const unregister = ctx.register({
      id,
      value,
      keywords: () => props.keywords ?? [],
      groupId: group?.id,
      forceMount: () => (props.forceMount ?? false) || (group?.forceMount() ?? false),
    })
    const onSelectEvent = () => {
      if (!props.disabled) props.onSelect?.(value())
    }
    el?.addEventListener(SELECT_EVENT, onSelectEvent)
    return () => {
      el?.removeEventListener(SELECT_EVENT, onSelectEvent)
      unregister()
    }
  })

  const visible = () => ctx.isItemVisible(id)
  const selected = () => ctx.selected() === value()

  return (
    <div
      ref={(node) => {
        el = node
      }}
      cmdk-item=""
      role="option"
      id={itemIdFor(value())}
      aria-disabled={props.disabled ? "true" : "false"}
      aria-selected={selected() ? "true" : "false"}
      data-disabled={props.disabled ? "true" : "false"}
      data-selected={selected() ? "true" : "false"}
      data-value={value()}
      data-cmdk-hidden={visible() ? undefined : ""}
      {...rest}
      style={visible() ? (props.style as JSX.CSSProperties | undefined) : { display: "none" }}
      onPointerMove={() => {
        if (props.disabled || ctx.disablePointerSelection()) return
        ctx.setSelected(value())
      }}
      onClick={() => {
        if (!props.disabled) props.onSelect?.(value())
      }}
    />
  )
}
