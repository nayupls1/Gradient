import type { Issue, StateType, WorkflowState } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, flush, For, onSettled, Show, untrack, useContext } from "solid-js"
import { ComposerContext, ProjectDialogsContext, Sync } from "../app/context.ts"
import { github } from "../app/github.ts"
import { ActiveFilters, type FilterApis, FilterMenu, filterFor, SearchField, setFilterFor } from "../app/FilterBar.tsx"
import { GithubRepoPicker } from "../app/GithubRepoPicker.tsx"
import { type PickerApis, useIssueCommands } from "../app/issueCommands.ts"
import { ProjectGlyph } from "../app/ProjectGlyph.tsx"
import { AssigneePicker, PriorityPicker, StatePicker, useIssueActions } from "../app/properties.tsx"
import { Shortcut, useCommands, useScope } from "../keys/solid.tsx"
import {
  compareIssues,
  defaultTeam,
  findTeam,
  formatDate,
  formatRelative,
  issueHref,
  issueKey,
  openBlockers,
  projectRepo,
  pullRequestsFor,
  teamHref,
  teamSettingsHref,
  teamStates
} from "../lib/select.ts"
import { TeamBadge } from "../app/TeamBadge.tsx"
import { KeyScope } from "../keys/solid.tsx"
import { emptyFilter, isFiltering, matchesFilter } from "../lib/filter.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { type RowRange, rowOffsets, sameRange, scrollToReveal, visibleRows } from "../lib/window.ts"
import { color } from "../theme/tokens.stylex.ts"
import { Badge } from "../ui/badge.tsx"
import { Button, type ButtonProps } from "../ui/button.tsx"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu.tsx"
import {
  BlockedIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GithubIcon,
  MoreIcon,
  PencilIcon,
  PlusIcon,
  PullRequestIcon,
  pullRequestLabel,
  RefreshIcon,
  SettingsIcon,
  StateIcon,
  TrashIcon,
  UnlinkIcon
} from "../ui/icons.tsx"
import { PageHeader } from "./Header.tsx"

/**
 * The list is virtualized: each group renders only the rows near the viewport,
 * with spacers for the rest. That needs fixed heights, so these two are the
 * source of truth for the header and row styles below.
 */
const HEADER_HEIGHT = 36
const ROW_HEIGHT = 40
/** Rows rendered beyond each edge of the viewport, in pixels, so fast scrolling does not show blanks. */
const OVERSCAN = 480

const s = stylex.create({
  // overflowAnchor: rows come and go as the list scrolls; anchoring to one would make the browser fight the scroll.
  list: { flexGrow: 1, overflowY: "auto", overflowAnchor: "none", paddingBottom: 40, outline: "none" },
  group: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: HEADER_HEIGHT,
    paddingLeft: 14,
    paddingRight: 12,
    position: "sticky",
    top: 0,
    zIndex: 1,
    backgroundColor: color.subtle,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    fontWeight: 500,
    userSelect: "none"
  },
  groupToggle: { display: "flex", alignItems: "center", gap: 8, fontWeight: "inherit", cursor: "pointer" },
  chevron: { color: colors.mutedForeground, display: "inline-flex" },
  count: { color: colors.mutedForeground, fontWeight: 400 },
  spacer: { flexGrow: 1 },
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: ROW_HEIGHT,
    paddingLeft: 12,
    paddingRight: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    backgroundColor: "transparent",
    cursor: "pointer",
    outline: "none"
  },
  rowFocused: {
    backgroundColor: color.hover,
    boxShadow: `inset 2px 0 0 ${color.accent}`
  },
  key: {
    width: 58,
    flexShrink: 0,
    color: colors.mutedForeground,
    fontSize: "0.75rem",
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
  label: { color: colors.mutedForeground },
  dot: { width: 7, height: 7, borderRadius: "50%" },
  meta: { color: colors.mutedForeground, fontSize: "0.75rem", width: 48, textAlign: "right", flexShrink: 0 },
  gh: { color: colors.mutedForeground, display: "inline-flex", flexShrink: 0 },
  blocked: { color: colors.destructive, display: "inline-flex", flexShrink: 0 },
  empty: {
    display: "grid",
    placeItems: "center",
    alignContent: "center",
    gap: 12,
    height: "60%",
    color: colors.mutedForeground
  },
  projectChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
    maxWidth: 140,
    color: colors.mutedForeground,
    fontSize: "0.75rem",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis"
  },
  repoChip: { color: colors.mutedForeground },
  repoDot: { width: 6, height: 6, borderRadius: "50%" },
  repoOk: { backgroundColor: "#46a758" },
  repoBad: { backgroundColor: colors.destructive },
  menu: { minWidth: 220 },
  headerCount: { color: colors.mutedForeground, fontWeight: 400 }
})

/**
 * Which status groups are collapsed, remembered per state across reloads. Only
 * explicit choices are stored; a state without one falls back to its type, so
 * Backlog, Done and Canceled start collapsed.
 */
const COLLAPSED_KEY = "gradient.collapsedGroups"
const collapsedByDefault: ReadonlySet<StateType> = new Set(["backlog", "completed", "canceled"])

const loadCollapsed = (): Readonly<Record<string, boolean>> => {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}")
    return raw !== null && typeof raw === "object" ? raw : {}
  } catch {
    return {}
  }
}

const [collapsedGroups, setCollapsedGroups] = createSignal(loadCollapsed())

const isCollapsed = (state: WorkflowState) => collapsedGroups()[state.id] ?? collapsedByDefault.has(state.type)

const toggleCollapsed = (state: WorkflowState) => {
  const next = { ...collapsedGroups(), [state.id]: !isCollapsed(state) }
  setCollapsedGroups(next)
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next))
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for the session.
  }
}

/** Clicks on a row's own controls (pickers, links) should not open the issue. */
const fromControl = (e: MouseEvent) =>
  e.target instanceof Element && e.target.closest("button, a, input, [data-slot=popover-content]") !== null

const IssueRow = (props: {
  issue: Issue
  showProject: boolean
  focused: boolean
  onFocus: () => void
  /** Registers the row's picker handles; the returned function drops them when the row unmounts. */
  apis: (apis: PickerApis) => () => void
}) => {
  const sync = useContext(Sync)
  const actions = useIssueActions()
  const navigate = useNavigate()
  const apis: PickerApis = {}
  const release = untrack(() => props.apis(apis))
  onSettled(() => release)
  const labels = () => props.issue.labelIds.map((id) => sync.state.labels[id]).filter((l) => l !== undefined)
  const blockers = () => openBlockers(sync.state, props.issue.id)
  /** The most relevant pull request that refers to the issue: an open one before a merged or closed one. */
  const pullRequest = () => pullRequestsFor(sync.state, props.issue)[0]
  return (
    <div
      role="link"
      aria-current={props.focused ? "true" : undefined}
      data-issue={props.issue.id}
      onClick={(e) => !fromControl(e) && navigate(issueHref(sync.state, props.issue))}
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
      <Show when={blockers().length > 0}>
        <span
          {...stylex.attrs(s.blocked)}
          title={`Blocked by ${blockers().map((b) => issueKey(sync.state, b)).join(", ")}`}
          aria-label="Blocked"
        >
          <BlockedIcon size={13} />
        </span>
      </Show>
      <span {...stylex.attrs(s.title)}>{props.issue.title}</span>
      <div {...stylex.attrs(s.labels)}>
        <For each={labels()}>
          {(label) => (
            <Badge variant="outline" xstyle={s.label}>
              <span {...stylex.attrs(s.dot)} style={{ "background-color": label.color }} />
              {label.name}
            </Badge>
          )}
        </For>
      </div>
      <Show when={props.showProject && props.issue.projectId ? sync.state.projects[props.issue.projectId] : undefined}>
        {(p) => (
          <span {...stylex.attrs(s.projectChip)} title={`Project: ${p().name}`}>
            <ProjectGlyph project={p()} size={12} />
            {p().name}
          </span>
        )}
      </Show>
      <Show when={pullRequest()}>
        {(pr) => (
          <span {...stylex.attrs(s.gh)} title={`${pullRequestLabel[pr().state]} pull request #${pr().number}: ${pr().title}`}>
            <PullRequestIcon state={pr().state} size={13} />
          </span>
        )}
      </Show>
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
  showProject: boolean
  collapsed: boolean
  onToggle: () => void
  focusedId: string | null
  onFocus: (id: string) => void
  registerApis: (id: string, apis: PickerApis) => () => void
  /** Where the group's first row sits in the list. */
  rowsTop: number
  /** The part of the list to render rows for: the viewport plus overscan. */
  viewTop: number
  viewBottom: number
}) => {
  const composer = useContext(ComposerContext)
  const range = createMemo(
    (): RowRange => visibleRows(props.rowsTop, props.issues.length, ROW_HEIGHT, props.viewTop, props.viewBottom),
    { equals: sameRange }
  )
  const shown = createMemo(() => props.issues.slice(range().start, range().end))
  return (
    <Collapsible render={<section />} open={!props.collapsed} onOpenChange={() => props.onToggle()}>
      <div {...stylex.attrs(s.group)}>
        <CollapsibleTrigger xstyle={s.groupToggle}>
          <span {...stylex.attrs(s.chevron)}>
            <Show when={props.collapsed} fallback={<ChevronDownIcon size={13} />}>
              <ChevronRightIcon size={13} />
            </Show>
          </span>
          <StateIcon type={props.state.type} color={props.state.color} />
          {props.state.name}
          <span {...stylex.attrs(s.count)}>{props.issues.length}</span>
        </CollapsibleTrigger>
        <span {...stylex.attrs(s.spacer)} />
        <Button variant="ghost" size="icon-xs" title={`New issue in ${props.state.name}`} onClick={() => composer.open({ stateId: props.state.id })}>
          <PlusIcon size={14} />
        </Button>
      </div>
      <CollapsibleContent>
        <div aria-hidden="true" style={{ height: `${range().start * ROW_HEIGHT}px` }} />
        <For each={shown()}>
          {(issue) => (
            <IssueRow
              issue={issue}
              showProject={props.showProject}
              focused={props.focusedId === issue.id}
              onFocus={() => props.onFocus(issue.id)}
              apis={(apis) => props.registerApis(issue.id, apis)}
            />
          )}
        </For>
        <div aria-hidden="true" style={{ height: `${(props.issues.length - range().end) * ROW_HEIGHT}px` }} />
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The repository a project syncs with: link one from a dropdown, or see its state and unlink. */
const ProjectRepo = (props: { projectId: string }) => {
  const sync = useContext(Sync)
  const repo = () => projectRepo(sync.state, props.projectId)
  const [busy, setBusy] = createSignal(false)
  const report = (e: unknown) => alert((e as { message?: string }).message ?? String(e))

  const link = async (owner: string, name: string) => {
    const project = sync.state.projects[props.projectId]
    if (!project) return
    const loose = Object.values(sync.state.issues).filter(
      (i) => i.projectId === project.id && i.github === null && i.archivedAt === null
    ).length
    const pushExisting = loose > 0 &&
      confirm(`Also create this project's ${loose} existing issue${loose === 1 ? "" : "s"} on ${owner}/${name}?`)
    setBusy(true)
    try {
      await github.linkRepo(sync, { teamId: project.teamId, projectId: project.id, owner, name, pushExisting })
    } catch (e) {
      report(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show
      when={repo()}
      fallback={
        <GithubRepoPicker
          align="end"
          onPick={(r) => void link(r.owner, r.name)}
          trigger={(p) => (
            <Button {...(p as ButtonProps)} size="xs" variant="ghost" disabled={busy()}>
              <GithubIcon size={13} />
              {busy() ? "Importing…" : "Link GitHub repo"}
            </Button>
          )}
        />
      }
    >
      {(r) => (
        <Badge
          variant="outline"
          xstyle={s.repoChip}
          render={
            <a
              href={`https://github.com/${r().owner}/${r().name}`}
              target="_blank"
              rel="noreferrer"
              title={r().lastError ?? (r().lastSyncedAt ? `Synced ${formatRelative(r().lastSyncedAt!)}` : "Not synced yet")}
            />
          }
        >
          <span {...stylex.attrs(s.repoDot, r().lastError ? s.repoBad : s.repoOk)} />
          <GithubIcon size={12} />
          {r().owner}/{r().name}
        </Badge>
      )}
    </Show>
  )
}

/** Rename, sync, unlink or delete the project. */
const ProjectMenu = (props: { projectId: string }) => {
  const sync = useContext(Sync)
  const dialogs = useContext(ProjectDialogsContext)
  const navigate = useNavigate()
  const repo = () => projectRepo(sync.state, props.projectId)
  const call = (work: () => Promise<unknown>) =>
    work().catch((e) => alert((e as { message?: string }).message ?? String(e)))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(p) => (
          <Button {...(p as ButtonProps)} variant="ghost" size="icon-sm" title="Project actions">
            <MoreIcon size={15} />
          </Button>
        )}
      />
      <DropdownMenuContent align="end" xstyle={s.menu}>
        <KeyScope name="menu" blocking>
          <DropdownMenuItem onClick={() => dialogs.edit(props.projectId)}>
            <PencilIcon size={14} /> Edit project…
          </DropdownMenuItem>
          <Show when={repo()}>
            {(r) => (
              <>
                <DropdownMenuItem onClick={() => void call(() => sync.call((c) => c.GithubSyncNow({ repoId: r().id })))}>
                  <RefreshIcon size={14} /> Sync with GitHub now
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (confirm(`Unlink ${r().owner}/${r().name}? Issues stay in the project.`)) {
                      void call(() => sync.call((c) => c.GithubUnlinkRepo({ repoId: r().id })))
                    }
                  }}
                >
                  <UnlinkIcon size={14} /> Unlink {r().owner}/{r().name}
                </DropdownMenuItem>
              </>
            )}
          </Show>
          <DropdownMenuSeparator />
          <Show
            when={!repo()}
            fallback={
              <DropdownMenuGroup>
                <DropdownMenuLabel>Unlink the repository to delete the project.</DropdownMenuLabel>
              </DropdownMenuGroup>
            }
          >
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                const project = sync.state.projects[props.projectId]
                if (project && confirm(`Delete the project "${project.name}"? Its issues stay, without a project.`)) {
                  const team = sync.state.teams[project.teamId]
                  sync.mutate({ _tag: "ProjectDelete", id: project.id })
                  navigate(team ? teamHref(team) : "/")
                }
              }}
            >
              <TrashIcon size={14} /> Delete project
            </DropdownMenuItem>
          </Show>
        </KeyScope>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const IssuesPage = () => {
  const sync = useContext(Sync)
  const composer = useContext(ComposerContext)
  const projectDialogs = useContext(ProjectDialogsContext)
  const navigate = useNavigate()
  const params = useParams()
  /** The project this page shows, or undefined for all of a team's issues. */
  const projectId = () => params.id
  const project = () => (projectId() ? sync.state.projects[projectId()!] : undefined)
  /** The team shown: the project's, the one in the URL (/team/KEY), else the viewer's first. */
  const team = () =>
    project() ? sync.state.teams[project()!.teamId] : params.key ? findTeam(sync.state, params.key) : defaultTeam(sync.state)
  /** A URL that names a project or team that does not exist. */
  const missing = () => (projectId() ? (project() ? null : "This project does not exist, or was deleted.") : params.key && !team() ? "This team does not exist, or was deleted." : null)
  const [focusTarget, setFocusedId] = createSignal<string | null>(null)
  const apis = new Map<string, PickerApis>()
  const filterApis: FilterApis = {}

  /** Each list keeps its own search and filters: a project's, or a team's. */
  const view = () => projectId() ?? team()?.id ?? ""
  const filter = () => filterFor(view())
  const setFilter = (next: Parameters<typeof setFilterFor>[1]) => setFilterFor(view(), next)
  const filtering = () => isFiltering(filter())

  /** The list's issues before filtering. */
  const unfiltered = createMemo(() => {
    const t = team()
    if (!t) return []
    const only = projectId()
    return Object.values(sync.state.issues).filter(
      (i) => i.teamId === t.id && i.archivedAt === null && (!only || i.projectId === only)
    )
  })
  const groups = createMemo(() => {
    const t = team()
    if (!t) return []
    const f = filter()
    const visible = isFiltering(f) ? unfiltered().filter((i) => matchesFilter(sync.state, i, f)) : unfiltered()
    return teamStates(sync.state, t.id)
      .map((state) => ({ state, issues: visible.filter((i) => i.stateId === state.id).sort(compareIssues) }))
      .filter((g) => g.issues.length > 0)
  })
  const total = () => unfiltered().length
  const shown = () => groups().reduce((n, g) => n + g.issues.length, 0)

  let listEl: HTMLDivElement | undefined
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewportHeight, setViewportHeight] = createSignal(window.innerHeight)
  onSettled(() => {
    if (!listEl) return
    const el = listEl
    setViewportHeight(el.clientHeight)
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight))
    observer.observe(el)
    return () => observer.disconnect()
  })
  /** Where each group's rows start in the list, by state id. Collapsed groups are just a header. */
  const rowsTop = createMemo(() => {
    const gs = groups()
    const offsets = rowOffsets(
      gs.map((g) => ({ rows: isCollapsed(g.state) ? 0 : g.issues.length })),
      { headerHeight: HEADER_HEIGHT, rowHeight: ROW_HEIGHT }
    )
    return new Map(gs.map((g, i) => [g.state.id, offsets[i]!]))
  })

  /**
   * Scrolls the focused row into view by its position, since a row off screen
   * is not in the DOM. The sticky header must not cover it.
   */
  const reveal = (issue: Issue) => {
    const el = listEl
    const group = groups().find((g) => g.state.id === issue.stateId)
    if (!el || !group || isCollapsed(group.state)) return
    const index = group.issues.findIndex((i) => i.id === issue.id)
    const top = rowsTop().get(group.state.id)
    if (index === -1 || top === undefined) return
    const next = scrollToReveal(el.scrollTop, el.clientHeight, top + index * ROW_HEIGHT, ROW_HEIGHT, HEADER_HEIGHT)
    if (next === null) return
    el.scrollTop = next
    setScrollTop(el.scrollTop)
  }
  /** Rows the keyboard can reach, top to bottom. */
  const order = createMemo(() => groups().flatMap((g) => (isCollapsed(g.state) ? [] : g.issues.map((i) => i.id))))
  /** The focused row, dropped automatically when that issue leaves the list. */
  const focusedId = createMemo(() => {
    const id = focusTarget()
    return id && order().includes(id) ? id : null
  })
  const focused = () => {
    const id = focusedId()
    return id ? sync.state.issues[id] : undefined
  }
  /**
   * Keep the focused row in view when the keyboard moves focus, or when the
   * issue moves to another group (a status change). Focus that follows the
   * pointer is already on screen, so it does not scroll.
   */
  let pointerFocus = false
  const focusKey = createMemo(() => {
    const issue = focused()
    return issue ? `${issue.id} ${issue.stateId}` : null
  })
  createEffect(
    () => focusKey(),
    () => {
      const issue = untrack(focused)
      if (issue && !pointerFocus) reveal(issue)
      pointerFocus = false
    }
  )
  const focusFromPointer = (id: string) => {
    pointerFocus = true
    setFocusedId(id)
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
        const state = sync.state.workflowStates[focused()!.stateId]
        if (state) toggleCollapsed(state)
      }
    },
    { id: "list.clearFocus", title: "Clear focus", group, keys: ["escape"], scope, hidden: true, when: () => focusedId() !== null, run: () => setFocusedId(null) },
    {
      id: "filter.search",
      title: "Search issues",
      group: "Filter",
      keys: ["/"],
      scope,
      run: () => {
        filterApis.search?.focus()
        filterApis.search?.select()
      }
    },
    {
      id: "filter.leaveSearch",
      title: "Clear the search and leave it",
      group: "Filter",
      keys: ["escape"],
      scope,
      allowInInput: true,
      hidden: true,
      when: () => document.activeElement === filterApis.search,
      run: () => {
        if (filter().query !== "") setFilter({ ...filter(), query: "" })
        filterApis.search?.blur()
      }
    },
    {
      id: "filter.toResults",
      title: "Go to the first result",
      group: "Filter",
      keys: ["arrowdown", "enter"],
      scope,
      allowInInput: true,
      hidden: true,
      when: () => document.activeElement === filterApis.search,
      run: () => {
        filterApis.search?.blur()
        setFocusedId(order()[0] ?? null)
      }
    },
    { id: "filter.menu", title: "Filter…", group: "Filter", keys: ["f"], scope, run: () => filterApis.menu?.open() },
    {
      id: "filter.mine",
      title: "Show my issues",
      group: "Filter",
      scope,
      run: () => {
        const f = filter()
        const mine = f.assignees.length === 1 && f.assignees[0] === "me"
        setFilter({ ...f, assignees: mine ? [] : ["me"] })
      }
    },
    {
      id: "filter.clear",
      title: "Clear search and filters",
      group: "Filter",
      keys: ["shift+f"],
      scope,
      when: () => filtering(),
      run: () => setFilter(emptyFilter)
    },
    { id: "project.edit", title: "Edit project…", group: "Project", scope, when: () => project() !== undefined, run: () => projectDialogs.edit(project()!.id) },
    {
      id: "project.icon",
      title: "Change project icon…",
      group: "Project",
      scope,
      when: () => project() !== undefined && projectRepo(sync.state, project()!.id) !== undefined,
      run: () => projectDialogs.edit(project()!.id, "icon")
    }
  ])
  useIssueCommands({
    scope,
    issue: focused,
    apis: () => {
      const issue = focused()
      if (!issue) return undefined
      // Scrolled away with the wheel, the focused row is unmounted and its pickers with it:
      // bring it back and render it now, so the picker opens on the row.
      if (!apis.has(issue.id)) {
        reveal(issue)
        flush()
      }
      return apis.get(issue.id)
    }
  })

  return (
    <>
      <PageHeader
        title={
          <Show
            when={project()}
            fallback={
              <>
                <TeamBadge team={team()} />
                {team()?.name ?? "Issues"}
                <Badge variant="secondary" xstyle={s.headerCount}>{filtering() ? `${shown()} / ${total()}` : total()}</Badge>
              </>
            }
          >
            {(p) => (
              <>
                <ProjectGlyph project={p()} size={15} />
                {p().name}
                <Badge variant="secondary" xstyle={s.headerCount}>{filtering() ? `${shown()} / ${total()}` : total()}</Badge>
              </>
            )}
          </Show>
        }
        actions={
          <>
            <Show when={!missing() && team()}>
              <SearchField filter={filter()} onChange={setFilter} apis={filterApis} />
              <FilterMenu issues={unfiltered()} filter={filter()} onChange={setFilter} apis={filterApis} />
            </Show>
            <Show when={project()}>
              {(p) => (
                <>
                  <ProjectRepo projectId={p().id} />
                  <ProjectMenu projectId={p().id} />
                </>
              )}
            </Show>
            <Show when={!project() && team()}>
              {(t) => (
                <Button variant="ghost" size="icon-xs" title={`${t().name} settings`} onClick={() => navigate(teamSettingsHref(t()))}>
                  <SettingsIcon size={14} />
                </Button>
              )}
            </Show>
            <Button variant="outline" size="xs" onClick={() => composer.open()}>
              <PlusIcon size={13} />
              New issue
              <Shortcut binding="c" />
            </Button>
          </>
        }
      />
      <Show when={!missing() && team()}>
        <ActiveFilters filter={filter()} onChange={setFilter} />
      </Show>
      <div ref={listEl} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} {...stylex.attrs(s.list)}>
        <Show
          when={!missing()}
          fallback={<div {...stylex.attrs(s.empty)}>{missing()}</div>}
        >
        <Show
          when={groups().length > 0}
          fallback={
            <Show
              when={!filtering() || total() === 0}
              fallback={
                <div {...stylex.attrs(s.empty)}>
                  No issues match.
                  <Button variant="outline" onClick={() => setFilter(emptyFilter)}>Clear search and filters</Button>
                </div>
              }
            >
              <div {...stylex.attrs(s.empty)}>
                {project() ? `No issues in ${project()!.name} yet.` : "No issues yet."}
                <Button onClick={() => composer.open()}>Create an issue</Button>
              </div>
            </Show>
          }
        >
          <For each={groups()} keyed={(g) => g.state.id}>
            {(g) => (
              <Group
                state={g().state}
                issues={g().issues}
                showProject={!projectId()}
                collapsed={isCollapsed(g().state)}
                onToggle={() => toggleCollapsed(g().state)}
                focusedId={focusedId()}
                onFocus={focusFromPointer}
                registerApis={(id, a) => {
                  apis.set(id, a)
                  return () => {
                    if (apis.get(id) === a) apis.delete(id)
                  }
                }}
                rowsTop={rowsTop().get(g().state.id) ?? 0}
                viewTop={scrollTop() - OVERSCAN}
                viewBottom={scrollTop() + viewportHeight() + OVERSCAN}
              />
            )}
          </For>
        </Show>
        </Show>
      </div>
    </>
  )
}
