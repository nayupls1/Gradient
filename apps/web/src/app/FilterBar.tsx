import type { Priority } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import type { JSX } from "@solidjs/web"
import { createMemo, createSignal, omit, Show, untrack, useContext } from "solid-js"
import {
  emptyFilter,
  facetCount,
  filterOptions,
  type IssueEntry,
  type IssueFilter,
  isFiltering,
  ME,
  toggle,
  UNASSIGNED,
  withPicked
} from "../lib/filter.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { Button, type ButtonProps } from "../ui/button.tsx"
import { BlockedIcon, PriorityIcon, priorityLabel, SearchIcon, TagIcon, UserIcon, XIcon } from "../ui/icons.tsx"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../ui/input-group.tsx"
import { Kbd } from "../ui/kbd.tsx"
import { Sync } from "./context.ts"
import { Picker, type PickerApi } from "./Picker.tsx"
import { UserAvatar } from "./UserAvatar.tsx"

/*
 * Search and filters for the issue list. Each list (a team's issues, a
 * project's) keeps its own filter for the session, so opening an issue and
 * coming back finds the list as it was left.
 */

const filters = createSignal<Readonly<Record<string, IssueFilter>>>({})

export const filterFor = (view: string): IssueFilter => filters[0]()[view] ?? emptyFilter
export const setFilterFor = (view: string, next: IssueFilter) => filters[1]({ ...filters[0](), [view]: next })

/** Handles for keyboard commands: focus the search, open a facet's picker. */
export interface FilterApis {
  search?: HTMLInputElement
  assignee?: PickerApi
  label?: PickerApi
  priority?: PickerApi
}

const s = stylex.create({
  bar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    minHeight: 40,
    flexShrink: 0,
    paddingBlock: 6,
    paddingLeft: 12,
    paddingRight: 20,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border
  },
  search: { height: "1.75rem", width: 260, maxWidth: "100%", flexShrink: 1 },
  searchInput: { fontSize: "0.8125rem" },
  key: { marginRight: 2 },
  chip: { fontWeight: 400, color: colors.mutedForeground, maxWidth: 220 },
  chipOn: { color: colors.foreground, borderStyle: "solid", backgroundColor: colors.accent },
  chipText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  spacer: { flexGrow: 1 },
  count: { color: colors.mutedForeground, fontSize: "0.75rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  dot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }
})

/** A facet's trigger: muted while unset, filled once it filters. */
const Chip = (props: { active: boolean; title: string; children: JSX.Element } & Record<string, unknown>) => {
  const rest = omit(props, "active", "children")
  return (
    <Button
      {...(rest as ButtonProps)}
      variant="outline"
      size="xs"
      aria-pressed={props.active ? "true" : "false"}
      xstyle={[s.chip, props.active && s.chipOn]}
    >
      {props.children}
    </Button>
  )
}

/** "Label" while unset, the value while one is picked, "Label · 3" for more. */
const summary = (facet: string, names: ReadonlyArray<string>) =>
  names.length === 0 ? facet : names.length === 1 ? names[0]! : `${facet} · ${names.length}`

export const FilterBar = (props: {
  /** The list's issues before filtering: the pickers offer only what they use. */
  entries: ReadonlyArray<IssueEntry>
  teamId: string
  filter: IssueFilter
  onChange: (next: IssueFilter) => void
  shown: number
  total: number
  apis: FilterApis
}) => {
  const sync = useContext(Sync)
  const apis = untrack(() => props.apis)
  const set = (patch: Partial<IssueFilter>) => props.onChange({ ...props.filter, ...patch })
  const [searchEl, setSearchEl] = createSignal<HTMLInputElement>()

  const viewer = () => sync.state.users[sync.state.viewerId]
  const personName = (id: string) =>
    id === ME ? viewer()?.name ?? "Me" : id === UNASSIGNED ? "No assignee" : sync.state.users[id]?.name ?? "Unknown"
  const labelName = (id: string) => sync.state.labels[id]?.name ?? "Unknown"
  /** Rebuilt when the list's issues change, not when the filter does. */
  const options = createMemo(() => filterOptions(sync.state, props.entries))

  return (
    <div {...stylex.attrs(s.bar)} role="search">
      <InputGroup xstyle={s.search}>
        <InputGroupAddon>
          <SearchIcon size={14} />
        </InputGroupAddon>
        <InputGroupInput
          ref={(el: HTMLInputElement) => {
            apis.search = el
            setSearchEl(el)
          }}
          type="text"
          placeholder="Search issues"
          aria-label="Search issues"
          value={props.filter.query}
          onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => set({ query: e.currentTarget.value })}
          xstyle={s.searchInput}
        />
        <InputGroupAddon align="inline-end">
          <Show when={props.filter.query !== ""} fallback={<Kbd xstyle={s.key}>/</Kbd>}>
            <InputGroupButton
              size="icon-xs"
              title="Clear search"
              onClick={() => {
                set({ query: "" })
                searchEl()?.focus()
              }}
            >
              <XIcon size={12} />
            </InputGroupButton>
          </Show>
        </InputGroupAddon>
      </InputGroup>

      <Picker<string>
        apiRef={(a) => (apis.assignee = a)}
        multiple
        placeholder="Filter by assignee…"
        items={withPicked(options().assignees, props.filter.assignees).map((id) => {
          if (id === UNASSIGNED) return { value: id, label: "No assignee", icon: () => <UserIcon size={14} /> }
          const user = sync.state.users[id === ME ? sync.state.viewerId : id]
          const name = user?.name ?? "Unknown"
          return {
            value: id,
            label: name,
            icon: () => <UserAvatar name={name} src={user?.avatarUrl ?? null} size={16} />,
            keywords: [user?.githubLogin ?? "", id === ME ? "me" : ""].join(" "),
            ...(user?.githubLogin ? { hint: `@${user.githubLogin}` } : {})
          }
        })}
        emptyText="Nobody to filter by"
        selected={props.filter.assignees}
        onPick={(v) => set({ assignees: toggle(props.filter.assignees, v) })}
        trigger={(p) => (
          <Chip {...p} active={props.filter.assignees.length > 0} title="Filter by assignee (f a)">
            <UserIcon size={13} />
            <span {...stylex.attrs(s.chipText)}>{summary("Assignee", props.filter.assignees.map(personName))}</span>
          </Chip>
        )}
      />

      <Picker<string>
        apiRef={(a) => (apis.label = a)}
        multiple
        placeholder="Filter by label…"
        emptyText="No labels"
        items={withPicked(options().labels, props.filter.labels).map((id) => {
          const label = sync.state.labels[id]
          return {
            value: id,
            label: label?.name ?? "Unknown",
            icon: () => <span {...stylex.attrs(s.dot)} style={{ "background-color": label?.color ?? "transparent" }} />
          }
        })}
        selected={props.filter.labels}
        onPick={(v) => set({ labels: toggle(props.filter.labels, v) })}
        trigger={(p) => (
          <Chip {...p} active={props.filter.labels.length > 0} title="Filter by label (f l)">
            <TagIcon size={13} />
            <span {...stylex.attrs(s.chipText)}>{summary("Label", props.filter.labels.map(labelName))}</span>
          </Chip>
        )}
      />

      <Picker<Priority>
        apiRef={(a) => (apis.priority = a)}
        multiple
        placeholder="Filter by priority…"
        items={withPicked(options().priorities, props.filter.priorities).map((p) => ({ value: p, label: priorityLabel[p], icon: () => <PriorityIcon priority={p} /> }))}
        selected={props.filter.priorities}
        onPick={(v) => set({ priorities: toggle(props.filter.priorities, v) })}
        trigger={(p) => (
          <Chip {...p} active={props.filter.priorities.length > 0} title="Filter by priority (f p)">
            <PriorityIcon priority={props.filter.priorities.length === 1 ? props.filter.priorities[0]! : 2} size={13} />
            <span {...stylex.attrs(s.chipText)}>{summary("Priority", props.filter.priorities.map((p) => priorityLabel[p]))}</span>
          </Chip>
        )}
      />

      <Chip active={props.filter.blocked} title="Only blocked issues (f b)" onClick={() => set({ blocked: !props.filter.blocked })}>
        <BlockedIcon size={13} />
        Blocked
      </Chip>

      <Show when={isFiltering(props.filter)}>
        <Button
          variant="ghost"
          size="xs"
          title="Clear filters (f x)"
          onClick={() => props.onChange(emptyFilter)}
        >
          <XIcon size={13} />
          {facetCount(props.filter) + (props.filter.query.trim() ? 1 : 0) > 1 ? "Clear all" : "Clear"}
        </Button>
      </Show>

      <span {...stylex.attrs(s.spacer)} />
      <Show when={isFiltering(props.filter)}>
        <span {...stylex.attrs(s.count)} aria-live="polite">{props.shown} of {props.total}</span>
      </Show>
    </div>
  )
}
