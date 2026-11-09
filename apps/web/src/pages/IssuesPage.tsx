import type { Issue, WorkflowState } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, Show, untrack, useContext } from "solid-js"
import { ComposerContext, Sync } from "../app/context.ts"
import { type PickerApis, useIssueCommands } from "../app/issueCommands.ts"
import { AssigneePicker, PriorityPicker, StatePicker, useIssueActions } from "../app/properties.tsx"
import { Shortcut, useCommands, useScope } from "../keys/solid.tsx"
import { compareIssues, firstTeam, formatDate, issueHref, issueKey, teamStates } from "../lib/select.ts"
import { color, font, radius } from "../theme/tokens.stylex.ts"
import { ChevronDownIcon, ChevronRightIcon, GithubIcon, PlusIcon, StateIcon } from "../ui/icons.tsx"
import { Button } from "../ui/kit.tsx"
import { PageHeader } from "./Header.tsx"

const s = stylex.create({
  list: { flexGrow: 1, overflowY: "auto", paddingBottom: 40, outline: "none" },
  group: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingLeft: 14,
    paddingRight: 12,
    position: "sticky",
    top: 0,
    zIndex: 1,
    backgroundColor: color.subtle,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
    fontSize: font.md,
    fontWeight: 500,
    userSelect: "none"
  },
  groupToggle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: color.fg,
    fontFamily: "inherit",
    fontSize: "inherit",
    fontWeight: "inherit",
    cursor: "pointer"
  },
  chevron: { color: color.fgSubtle, display: "inline-flex" },
  count: { color: color.fgSubtle, fontWeight: 400 },
  spacer: { flexGrow: 1 },
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: 40,
    paddingLeft: 12,
    paddingRight: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
    backgroundColor: "transparent",
    fontSize: font.md,
    cursor: "pointer",
    color: color.fg,
    textDecoration: "none",
    outline: "none"
  },
  rowFocused: {
    backgroundColor: color.hover,
    boxShadow: `inset 2px 0 0 ${color.accent}`
  },
  key: {
    width: 58,
    flexShrink: 0,
    color: color.fgSubtle,
    fontSize: font.sm,
    fontVariantNumeric: "tabular-nums"
  },
  title: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 500
  },
  labels: { display: "flex", gap: 4, flexShrink: 0 },
  label: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    height: 20,
    paddingInline: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    color: color.fgMuted,
    fontSize: font.xs,
    fontWeight: 500
  },
  dot: { width: 7, height: 7, borderRadius: "50%" },
  meta: { color: color.fgSubtle, fontSize: font.sm, width: 48, textAlign: "right", flexShrink: 0 },
  gh: { color: color.fgSubtle, display: "inline-flex", flexShrink: 0 },
  empty: {
    display: "grid",
    placeItems: "center",
    alignContent: "center",
    gap: 12,
    height: "60%",
    color: color.fgMuted,
    fontSize: font.md
  },
  headerCount: {
    color: color.fgSubtle,
    fontWeight: 400,
    paddingInline: 6,
    borderRadius: radius.sm,
    backgroundColor: color.subtle
  }
})

const IssueRow = (props: {
  issue: Issue
  focused: boolean
  onFocus: () => void
  apis: (apis: PickerApis) => void
}) => {
  const sync = useContext(Sync)
  const actions = useIssueActions()
  const navigate = useNavigate()
  const apis: PickerApis = {}
  untrack(() => props.apis(apis))
  let el: HTMLDivElement | undefined
  createEffect(
    () => props.focused,
    (focused) => {
      if (focused) el?.scrollIntoView({ block: "nearest" })
    }
  )
  const labels = () => props.issue.labelIds.map((id) => sync.state.labels[id]).filter((l) => l !== undefined)
  return (
    <div
      ref={el}
      role="link"
      aria-current={props.focused ? "true" : undefined}
      data-issue={props.issue.id}
      onClick={() => navigate(issueHref(sync.state, props.issue))}
      onMouseMove={() => !props.focused && props.onFocus()}
      {...stylex.attrs(s.row, props.focused && s.rowFocused)}
    >
      <PriorityPicker
        variant="icon"
        value={props.issue.priority}
        onChange={(priority) => actions.update(props.issue, { priority })}
        apiRef={(a) => (apis.priority = a)}
      />
      <span {...stylex.attrs(s.key)}>{issueKey(sync.state, props.issue)}</span>
      <StatePicker
        variant="icon"
        teamId={props.issue.teamId}
        value={props.issue.stateId}
        onChange={(stateId) => actions.update(props.issue, { stateId })}
        apiRef={(a) => (apis.status = a)}
      />
      <span {...stylex.attrs(s.title)}>{props.issue.title}</span>
      <div {...stylex.attrs(s.labels)}>
        <For each={labels()}>
          {(label) => (
            <span {...stylex.attrs(s.label)}>
              <span {...stylex.attrs(s.dot)} style={{ "background-color": label.color }} />
              {label.name}
            </span>
          )}
        </For>
      </div>
      <Show when={props.issue.github}>
        {(gh) => (
          <span {...stylex.attrs(s.gh)} title={`${gh().owner}/${gh().repo}#${gh().number}`}>
            <GithubIcon size={13} />
          </span>
        )}
      </Show>
      <span {...stylex.attrs(s.meta)}>{formatDate(props.issue.createdAt)}</span>
      <AssigneePicker
        variant="icon"
        value={props.issue.assigneeId}
        onChange={(assigneeId) => actions.update(props.issue, { assigneeId })}
        apiRef={(a) => (apis.assignee = a)}
      />
    </div>
  )
}

const Group = (props: {
  state: WorkflowState
  issues: ReadonlyArray<Issue>
  collapsed: boolean
  onToggle: () => void
  focusedId: string | null
  onFocus: (id: string) => void
  registerApis: (id: string, apis: PickerApis) => void
}) => {
  const composer = useContext(ComposerContext)
  return (
    <section>
      <div {...stylex.attrs(s.group)}>
        <button type="button" onClick={() => props.onToggle()} {...stylex.attrs(s.groupToggle)}>
          <span {...stylex.attrs(s.chevron)}>
            <Show when={props.collapsed} fallback={<ChevronDownIcon size={13} />}>
              <ChevronRightIcon size={13} />
            </Show>
          </span>
          <StateIcon type={props.state.type} color={props.state.color} />
          {props.state.name}
          <span {...stylex.attrs(s.count)}>{props.issues.length}</span>
        </button>
        <span {...stylex.attrs(s.spacer)} />
        <Button variant="ghost" size="icon-sm" title={`New issue in ${props.state.name}`} onClick={() => composer.open({ stateId: props.state.id })}>
          <PlusIcon size={14} />
        </Button>
      </div>
      <Show when={!props.collapsed}>
        <For each={props.issues}>
          {(issue) => (
            <IssueRow
              issue={issue}
              focused={props.focusedId === issue.id}
              onFocus={() => props.onFocus(issue.id)}
              apis={(apis) => props.registerApis(issue.id, apis)}
            />
          )}
        </For>
      </Show>
    </section>
  )
}

export const IssuesPage = () => {
  const sync = useContext(Sync)
  const composer = useContext(ComposerContext)
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const [focusTarget, setFocusedId] = createSignal<string | null>(null)
  const apis = new Map<string, PickerApis>()

  const groups = createMemo(() => {
    const team = firstTeam(sync.state)
    if (!team) return []
    const visible = Object.values(sync.state.issues).filter((i) => i.teamId === team.id && i.archivedAt === null)
    return teamStates(sync.state, team.id)
      .map((state) => ({ state, issues: visible.filter((i) => i.stateId === state.id).sort(compareIssues) }))
      .filter((g) => g.issues.length > 0)
  })
  const total = () => groups().reduce((n, g) => n + g.issues.length, 0)
  /** Rows the keyboard can reach, top to bottom. */
  const order = createMemo(() => groups().flatMap((g) => (collapsed().has(g.state.id) ? [] : g.issues.map((i) => i.id))))
  /** The focused row, dropped automatically when that issue leaves the list. */
  const focusedId = createMemo(() => {
    const id = focusTarget()
    return id && order().includes(id) ? id : null
  })
  const focused = () => {
    const id = focusedId()
    return id ? sync.state.issues[id] : undefined
  }

  const move = (delta: number) => {
    const ids = order()
    if (ids.length === 0) return
    const index = ids.indexOf(focusedId() ?? "")
    const next = index === -1 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(Math.max(index + delta, 0), ids.length - 1)
    setFocusedId(ids[next]!)
  }

  useScope("issues.list")
  const scope = "issues.list"
  const group = "List"
  useCommands([
    { id: "list.next", title: "Next issue", group, keys: ["j", "arrowdown"], scope, repeat: true, run: () => move(1) },
    { id: "list.previous", title: "Previous issue", group, keys: ["k", "arrowup"], scope, repeat: true, run: () => move(-1) },
    { id: "list.first", title: "First issue", group, keys: ["home"], scope, run: () => setFocusedId(order()[0] ?? null) },
    { id: "list.last", title: "Last issue", group, keys: ["end"], scope, run: () => setFocusedId(order().at(-1) ?? null) },
    {
      id: "list.open",
      title: "Open issue",
      group,
      keys: ["enter", "o"],
      scope,
      when: () => focused() !== undefined,
      run: () => navigate(issueHref(sync.state, focused()!))
    },
    {
      id: "list.toggleGroup",
      title: "Collapse or expand the focused group",
      group,
      keys: ["shift+enter"],
      scope,
      when: () => focused() !== undefined,
      run: () => {
        const stateId = focused()!.stateId
        setCollapsed((c) => {
          const next = new Set(c)
          if (next.has(stateId)) next.delete(stateId)
          else next.add(stateId)
          return next
        })
      }
    },
    { id: "list.clearFocus", title: "Clear focus", group, keys: ["escape"], scope, hidden: true, when: () => focusedId() !== null, run: () => setFocusedId(null) }
  ])
  useIssueCommands({ scope, issue: focused, apis: () => apis.get(focusedId() ?? "") })

  return (
    <>
      <PageHeader
        title={
          <>
            Issues
            <span {...stylex.attrs(s.headerCount)}>{total()}</span>
          </>
        }
        actions={
          <Button size="sm" onClick={() => composer.open()}>
            <PlusIcon size={13} />
            New issue
            <Shortcut binding="c" />
          </Button>
        }
      />
      <div {...stylex.attrs(s.list)}>
        <Show
          when={groups().length > 0}
          fallback={
            <div {...stylex.attrs(s.empty)}>
              No issues yet.
              <Button variant="primary" onClick={() => composer.open()}>Create an issue</Button>
            </div>
          }
        >
          <For each={groups()} keyed={(g) => g.state.id}>
            {(g) => (
              <Group
                state={g().state}
                issues={g().issues}
                collapsed={collapsed().has(g().state.id)}
                onToggle={() =>
                  setCollapsed((c) => {
                    const next = new Set(c)
                    const id = g().state.id
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })}
                focusedId={focusedId()}
                onFocus={setFocusedId}
                registerApis={(id, a) => apis.set(id, a)}
              />
            )}
          </For>
        </Show>
      </div>
    </>
  )
}
