import type { Issue, WorkflowState } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { useNavigate } from "@solidjs/router"
import { createMemo, createSignal, For, Show, useContext } from "solid-js"
import { AssigneePicker, PriorityPicker, StatePicker, useIssueActions } from "../app/properties.tsx"
import { ComposerContext, Sync } from "../app/context.ts"
import {
  compareIssues,
  firstTeam,
  formatDate,
  issueHref,
  issueKey,
  teamStates,
  type View,
  viewTypes
} from "../lib/select.ts"
import { color, font, radius } from "../theme/tokens.stylex.ts"
import { ChevronDownIcon, ChevronRightIcon, GithubIcon, PlusIcon, StateIcon } from "../ui/icons.tsx"
import { Button } from "../ui/kit.tsx"
import { PageHeader } from "./Header.tsx"

const s = stylex.create({
  list: { flexGrow: 1, overflowY: "auto", paddingBottom: 40 },
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
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: 40,
    paddingLeft: 12,
    paddingRight: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
    backgroundColor: { default: "transparent", ":hover": color.hover },
    fontSize: font.md,
    cursor: "pointer",
    color: color.fg,
    textDecoration: "none"
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

const titles: Record<View, string> = { all: "All issues", active: "Active", backlog: "Backlog", mine: "My issues" }

const IssueRow = (props: { issue: Issue }) => {
  const sync = useContext(Sync)
  const actions = useIssueActions()
  const navigate = useNavigate()
  const labels = () => props.issue.labelIds.map((id) => sync.state.labels[id]).filter((l) => l !== undefined)
  return (
    <div
      role="link"
      tabindex="0"
      onClick={() => navigate(issueHref(sync.state, props.issue))}
      onKeyDown={(e) => e.key === "Enter" && navigate(issueHref(sync.state, props.issue))}
      {...stylex.attrs(s.row)}
    >
      <PriorityPicker variant="icon" value={props.issue.priority} onChange={(priority) => actions.update(props.issue, { priority })} />
      <span {...stylex.attrs(s.key)}>{issueKey(sync.state, props.issue)}</span>
      <StatePicker
        variant="icon"
        teamId={props.issue.teamId}
        value={props.issue.stateId}
        onChange={(stateId) => actions.update(props.issue, { stateId })}
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
      <AssigneePicker variant="icon" value={props.issue.assigneeId} onChange={(assigneeId) => actions.update(props.issue, { assigneeId })} />
    </div>
  )
}

const Group = (props: { state: WorkflowState; issues: ReadonlyArray<Issue> }) => {
  const composer = useContext(ComposerContext)
  const [collapsed, setCollapsed] = createSignal(false)
  return (
    <section>
      <div {...stylex.attrs(s.group)}>
        <button type="button" onClick={() => setCollapsed((c) => !c)} {...stylex.attrs(s.groupToggle)}>
          <span {...stylex.attrs(s.chevron)}>
            <Show when={collapsed()} fallback={<ChevronDownIcon size={12} />}>
              <ChevronRightIcon size={12} />
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
      <Show when={!collapsed()}>
        <For each={props.issues}>{(issue) => <IssueRow issue={issue} />}</For>
      </Show>
    </section>
  )
}

export const IssuesPage = (props: { view: View }) => {
  const sync = useContext(Sync)
  const composer = useContext(ComposerContext)

  const groups = createMemo(() => {
    const team = firstTeam(sync.state)
    if (!team) return []
    const types = viewTypes[props.view]
    const visible = Object.values(sync.state.issues).filter((i) =>
      i.teamId === team.id && i.archivedAt === null && (props.view !== "mine" || i.assigneeId === sync.state.viewerId)
    )
    return teamStates(sync.state, team.id)
      .filter((st) => !types || types.includes(st.type))
      .map((state) => ({ state, issues: visible.filter((i) => i.stateId === state.id).sort(compareIssues) }))
      .filter((g) => g.issues.length > 0)
  })
  const total = () => groups().reduce((n, g) => n + g.issues.length, 0)

  return (
    <>
      <PageHeader
        title={
          <>
            {titles[props.view]}
            <span {...stylex.attrs(s.headerCount)}>{total()}</span>
          </>
        }
        actions={
          <Button size="sm" onClick={() => composer.open()}>
            <PlusIcon size={13} />
            New issue
          </Button>
        }
      />
      <div {...stylex.attrs(s.list)}>
        <Show
          when={groups().length > 0}
          fallback={
            <div {...stylex.attrs(s.empty)}>
              No issues here yet.
              <Button variant="primary" onClick={() => composer.open()}>Create an issue</Button>
            </div>
          }
        >
          <For each={groups()} keyed={(g) => g.state.id}>
            {(group) => <Group state={group().state} issues={group().issues} />}
          </For>
        </Show>
      </div>
    </>
  )
}
