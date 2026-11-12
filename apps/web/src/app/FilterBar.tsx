import type { Issue, Priority } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import type { JSX } from "@solidjs/web"
import { createMemo, createSignal, For, Show, untrack, useContext } from "solid-js"
import { emptyFilter, facetCount, filterOptions, type IssueFilter, ME, toggle, UNASSIGNED } from "../lib/filter.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { Button, type ButtonProps } from "../ui/button.tsx"
import { BlockedIcon, FilterIcon, PriorityIcon, priorityLabel, SearchIcon, UserIcon, XIcon } from "../ui/icons.tsx"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../ui/input-group.tsx"
import { Sync } from "./context.ts"
import { Picker, type PickerApi, type PickerItem } from "./Picker.tsx"
import { UserAvatar } from "./UserAvatar.tsx"

/*
 * Search and filters for the issue list: a search field and one Filter menu
 * in the header, and the active filters as removable chips under it. Each
 * list (a team's issues, a project's) keeps its own filter for the session,
 * so opening an issue and coming back finds the list as it was left.
 */

const filters = createSignal<Readonly<Record<string, IssueFilter>>>({})

export const filterFor = (view: string): IssueFilter => filters[0]()[view] ?? emptyFilter
export const setFilterFor = (view: string, next: IssueFilter) => filters[1]({ ...filters[0](), [view]: next })

/** Handles for keyboard commands: focus the search, open the filter menu. */
export interface FilterApis {
  search?: HTMLInputElement
  menu?: PickerApi
}

const s = stylex.create({
  search: {
    height: "1.75rem",
    width: {
      default: 180,
      ":focus-within": 240,
      "@media (max-width: 40rem)": { default: 112, ":focus-within": 168 }
    },
    flexShrink: 0,
    transitionProperty: "width",
    transitionDuration: "150ms"
  },
  chips: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    flexShrink: 0,
    paddingBlock: 6,
    paddingLeft: 14,
    paddingRight: 20,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border
  },
  chip: { fontWeight: 400, maxWidth: 240, paddingRight: 4 },
  chipText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  facet: { color: colors.mutedForeground },
  remove: { display: "inline-flex", color: colors.mutedForeground, marginLeft: 2 },
  dot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  /** On a phone the Filter button is just its icon. */
  filterText: { display: { default: null, "@media (max-width: 40rem)": "none" } }
})

/** One menu item per filter value; the value says which facet it belongs to. */
type Choice = `a:${string}` | `l:${string}` | `p:${Priority}` | "blocked"

const pick = (f: IssueFilter, c: Choice): IssueFilter =>
  c === "blocked"
    ? { ...f, blocked: !f.blocked }
    : c.startsWith("a:")
    ? { ...f, assignees: toggle(f.assignees, c.slice(2)) }
    : c.startsWith("l:")
    ? { ...f, labels: toggle(f.labels, c.slice(2)) }
    : { ...f, priorities: toggle(f.priorities, Number(c.slice(2)) as Priority) }

const chosen = (f: IssueFilter): Array<Choice> => [
  ...f.assignees.map((a) => `a:${a}` as const),
  ...f.labels.map((l) => `l:${l}` as const),
  ...f.priorities.map((p) => `p:${p}` as const),
  ...(f.blocked ? ["blocked" as const] : [])
]

/** How a value reads and looks, in the menu and on its chip. */
const useDescribe = () => {
  const sync = useContext(Sync)
  return (c: Choice): { facet: string; label: string; icon: () => JSX.Element; keywords?: string } => {
    if (c === "blocked") return { facet: "Status", label: "Blocked", icon: () => <BlockedIcon size={14} /> }
    const value = c.slice(2)
    if (c.startsWith("a:")) {
      if (value === UNASSIGNED) return { facet: "Assignee", label: "No assignee", icon: () => <UserIcon size={14} /> }
      const user = sync.state.users[value === ME ? sync.state.viewerId : value]
      const name = user?.name ?? "Unknown"
      return {
        facet: "Assignee",
        label: name,
        icon: () => <UserAvatar name={name} src={user?.avatarUrl ?? null} size={16} />,
        keywords: [user?.githubLogin ?? "", value === ME ? "me" : ""].join(" ")
      }
    }
    if (c.startsWith("l:")) {
      const label = sync.state.labels[value]
      return {
        facet: "Label",
        label: label?.name ?? "Unknown",
        icon: () => <span {...stylex.attrs(s.dot)} style={{ "background-color": label?.color ?? "transparent" }} />
      }
    }
    const p = Number(value) as Priority
    return { facet: "Priority", label: priorityLabel[p], icon: () => <PriorityIcon priority={p} /> }
  }
}

/** The search field. `/` focuses it; Escape clears and leaves it; ↓ or Enter goes to the first result. */
export const SearchField = (props: { filter: IssueFilter; onChange: (next: IssueFilter) => void; apis: FilterApis }) => {
  const apis = untrack(() => props.apis)
  return (
    <InputGroup xstyle={s.search} role="search">
      <InputGroupAddon>
        <SearchIcon size={14} />
      </InputGroupAddon>
      <InputGroupInput
        ref={(el: HTMLInputElement) => (apis.search = el)}
        type="text"
        enterkeyhint="search"
        autocomplete="off"
        spellcheck={false}
        placeholder="Search"
        aria-label="Search issues"
        title="Search issues (/)"
        value={props.filter.query}
        onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) =>
          props.onChange({ ...props.filter, query: e.currentTarget.value })}
      />
      <Show when={props.filter.query !== ""}>
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            title="Clear search"
            onClick={() => {
              props.onChange({ ...props.filter, query: "" })
              apis.search?.focus()
            }}
          >
            <XIcon size={12} />
          </InputGroupButton>
        </InputGroupAddon>
      </Show>
    </InputGroup>
  )
}

/**
 * One menu for every filter: type to find a person, label or priority
 * among those the list's issues use, pick as many as needed.
 */
export const FilterMenu = (props: {
  issues: ReadonlyArray<Issue>
  filter: IssueFilter
  onChange: (next: IssueFilter) => void
  apis: FilterApis
}) => {
  const sync = useContext(Sync)
  const describe = useDescribe()
  const apis = untrack(() => props.apis)
  const items = createMemo((): Array<PickerItem<Choice>> => {
    const o = filterOptions(sync.state, props.issues, props.filter)
    const choices: Array<Choice> = [
      ...o.assignees.map((a) => `a:${a}` as const),
      ...o.labels.map((l) => `l:${l}` as const),
      ...o.priorities.map((p) => `p:${p}` as const),
      ...(o.blocked ? ["blocked" as const] : [])
    ]
    return choices.map((c) => {
      const d = describe(c)
      return { value: c, label: d.label, icon: d.icon, hint: d.facet, keywords: `${d.facet} ${d.keywords ?? ""}` }
    })
  })
  const count = () => facetCount(props.filter)
  return (
    <Picker<Choice>
      apiRef={(a) => (apis.menu = a)}
      multiple
      align="end"
      placeholder="Filter by person, label, priority…"
      emptyText="Nothing to filter by"
      items={items()}
      selected={chosen(props.filter)}
      onPick={(c) => props.onChange(pick(props.filter, c))}
      trigger={(p) => (
        <Button
          {...(p as ButtonProps)}
          variant={count() > 0 ? "secondary" : "ghost"}
          size="xs"
          title="Filter (f)"
        >
          <FilterIcon size={13} />
          <span {...stylex.attrs(s.filterText)}>Filter</span>
        </Button>
      )}
    />
  )
}

/** The active filters, each removable; shown under the header only while there are some. */
export const ActiveFilters = (props: { filter: IssueFilter; onChange: (next: IssueFilter) => void }) => {
  const describe = useDescribe()
  return (
    <Show when={facetCount(props.filter) > 0}>
      <div {...stylex.attrs(s.chips)}>
        <For each={chosen(props.filter)}>
          {(c) => {
            const d = () => describe(c)
            return (
              <Button
                variant="outline"
                size="xs"
                xstyle={s.chip}
                title={`Remove ${d().facet.toLowerCase()} ${d().label}`}
                onClick={() => props.onChange(pick(props.filter, c))}
              >
                {d().icon()}
                <span {...stylex.attrs(s.facet)}>{d().facet}</span>
                <span {...stylex.attrs(s.chipText)}>{d().label}</span>
                <span {...stylex.attrs(s.remove)}>
                  <XIcon size={12} />
                </span>
              </Button>
            )
          }}
        </For>
        <Button
          variant="ghost"
          size="xs"
          title="Clear filters (shift+f)"
          onClick={() => props.onChange({ ...emptyFilter, query: props.filter.query })}
        >
          Clear
        </Button>
      </div>
    </Show>
  )
}
