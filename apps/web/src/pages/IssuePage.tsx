import * as stylex from "@stylexjs/stylex"
import { Archive } from "lucide"
import { useNavigate, useParams } from "@solidjs/router"
import { createSignal, Show, useContext } from "solid-js"
import { Sync } from "../app/context.ts"
import { type PickerApis, useIssueCommands } from "../app/issueCommands.ts"
import { AssigneePicker, LabelPicker, PriorityPicker, ProjectPicker, StatePicker, useIssueActions } from "../app/properties.tsx"
import { IssuePullRequests, IssueRelations, type RelationApis } from "../app/relations.tsx"
import { KeyScope, useCommands, useScope } from "../keys/solid.tsx"
import { Markdown } from "../app/Markdown.tsx"
import { findIssue, formatRelative, issueKey, issueRepo, projectHref } from "../lib/select.ts"
import { bareTextarea } from "../app/styles.ts"
import { UserAvatar } from "../app/UserAvatar.tsx"
import { colors } from "../lib/tokens.stylex.ts"
import { Alert, AlertAction, alertIconStyles, AlertTitle } from "../ui/alert.tsx"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../ui/breadcrumb.tsx"
import { Button, type ButtonProps } from "../ui/button.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu.tsx"
import { Icon } from "../ui/icon.tsx"
import { ArchiveIcon, GithubIcon, MoreIcon, RestoreIcon, TrashIcon } from "../ui/icons.tsx"
import { Separator } from "../ui/separator.tsx"
import { Textarea } from "../ui/textarea.tsx"
import { PageHeader } from "./Header.tsx"

const s = stylex.create({
  layout: { display: "grid", gridTemplateColumns: "1fr 280px", flexGrow: 1, minHeight: 0 },
  main: { overflowY: "auto", paddingTop: 36, paddingBottom: 80 },
  column: { display: "flex", flexDirection: "column", maxWidth: 720, marginInline: "auto", paddingInline: 32 },
  title: { fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.3 },
  description: { marginTop: 14, minHeight: 120, fontSize: 14, lineHeight: 1.65 },
  rendered: { cursor: "text", paddingBottom: 24 },
  placeholder: { color: colors.mutedForeground },
  archived: { marginBottom: 16 },
  side: {
    overflowY: "auto",
    paddingBlock: 20,
    paddingInline: 16,
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: colors.border,
    display: "flex",
    flexDirection: "column",
    gap: 2
  },
  prop: { display: "grid", gridTemplateColumns: "84px minmax(0, 1fr)", alignItems: "center", minHeight: 32 },
  propLabel: { color: colors.mutedForeground, fontSize: "0.75rem" },
  divider: { marginBlock: 14 },
  meta: { display: "flex", alignItems: "center", gap: 8, color: colors.mutedForeground, fontSize: "0.75rem", minHeight: 26 },
  ghLink: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: { default: colors.mutedForeground, ":hover": colors.foreground },
    fontSize: "0.75rem",
    minHeight: 26
  },
  missing: { display: "grid", placeItems: "center", height: "60%", color: colors.mutedForeground }
})

export const IssuePage = () => {
  const sync = useContext(Sync)
  const params = useParams()
  const navigate = useNavigate()
  const actions = useIssueActions()
  const issue = () => findIssue(sync.state, params.ref ?? "")
  const apis: PickerApis = {}
  const relationApis: RelationApis = {}
  let titleEl: HTMLTextAreaElement | undefined
  let descriptionEl: HTMLTextAreaElement | undefined

  useScope("issue.detail")
  useIssueCommands({ scope: "issue.detail", issue, apis: () => apis })
  useCommands([
    { id: "issue.back", title: "Back to issues", group: "Navigation", keys: ["escape", "u"], scope: "issue.detail", run: () => navigate("/") },
    { id: "issue.editTitle", title: "Edit title", group: "Issue", keys: ["e"], scope: "issue.detail", run: () => titleEl?.focus() },
    { id: "issue.editDescription", title: "Edit description", group: "Issue", keys: ["d"], scope: "issue.detail", run: () => editDescription() },
    { id: "issue.blockedBy", title: "Mark as blocked by…", group: "Issue", keys: ["b"], scope: "issue.detail", run: () => relationApis.blockedBy?.open() },
    { id: "issue.blocks", title: "Mark as blocking…", group: "Issue", keys: ["shift+b"], scope: "issue.detail", run: () => relationApis.blocks?.open() },
    { id: "issue.related", title: "Relate to…", group: "Issue", keys: ["shift+r"], scope: "issue.detail", run: () => relationApis.related?.open() },
    {
      id: "issue.blur",
      title: "Stop editing",
      group: "Issue",
      keys: ["escape"],
      scope: "issue.detail",
      allowInInput: true,
      hidden: true,
      when: () => document.activeElement === titleEl || document.activeElement === descriptionEl,
      run: () => (document.activeElement as HTMLElement | null)?.blur()
    }
  ])

  // Drafts follow the synced value until the user edits; commit on blur.
  const [title, setTitle] = createSignal(() => issue()?.title ?? "")
  const [description, setDescription] = createSignal(() => issue()?.description ?? "")

  const commitTitle = () => {
    const current = issue()
    const next = title().trim()
    if (!current) return
    if (next === "") setTitle(current.title)
    else if (next !== current.title) actions.update(current, { title: next })
  }
  const commitDescription = () => {
    const current = issue()
    if (current && description() !== current.description) actions.update(current, { description: description() })
  }

  // The description shows as markdown and turns into a textarea while edited.
  const [editingDescription, setEditingDescription] = createSignal(false)
  const editDescription = () => {
    if (editingDescription()) descriptionEl?.focus()
    else setEditingDescription(true)
  }
  /** Clicks on the rendered description edit it, unless they hit a link or control, or end a text selection. */
  const onDescriptionClick = (e: MouseEvent) => {
    if ((e.target as Element).closest("a, summary, input, button")) return
    if (window.getSelection()?.isCollapsed === false) return
    setEditingDescription(true)
  }

  return (
    <Show when={issue()} fallback={<div {...stylex.attrs(s.missing)}>This issue does not exist, or was deleted.</div>}>
      {(current) => (
        <>
          <PageHeader
            title={
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="/">{sync.state.teams[current().teamId]?.name}</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <Show when={current().projectId ? sync.state.projects[current().projectId!] : undefined}>
                    {(p) => (
                      <>
                        <BreadcrumbItem>
                          <BreadcrumbLink href={projectHref(p().id)}>{p().name}</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                      </>
                    )}
                  </Show>
                  <BreadcrumbItem>
                    <BreadcrumbPage>{issueKey(sync.state, current())}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            }
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={(p) => (
                    <Button {...(p as ButtonProps)} variant="ghost" size="icon-sm" title="More actions">
                      <MoreIcon size={15} />
                    </Button>
                  )}
                />
                <DropdownMenuContent align="end">
                  <KeyScope name="menu" blocking>
                    <Show
                      when={current().archivedAt === null}
                      fallback={
                        <DropdownMenuItem onClick={() => sync.mutate({ _tag: "IssueUnarchive", id: current().id })}>
                          <RestoreIcon size={14} /> Restore from archive
                        </DropdownMenuItem>
                      }
                    >
                      <DropdownMenuItem onClick={() => sync.mutate({ _tag: "IssueArchive", id: current().id })}>
                        <ArchiveIcon size={14} /> Archive
                      </DropdownMenuItem>
                    </Show>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        if (!confirm("Delete this issue? This cannot be undone.")) return
                        sync.mutate({ _tag: "IssueDelete", id: current().id })
                        navigate("/")
                      }}
                    >
                      <TrashIcon size={14} /> Delete…
                    </DropdownMenuItem>
                  </KeyScope>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
          <div {...stylex.attrs(s.layout)}>
            <div {...stylex.attrs(s.main)}>
              <div {...stylex.attrs(s.column)}>
                <Show when={current().archivedAt !== null}>
                  <Alert xstyle={s.archived}>
                    <Icon icon={Archive} {...stylex.attrs(alertIconStyles)} />
                    <AlertTitle>This issue is archived.</AlertTitle>
                    <AlertAction>
                      <Button size="xs" variant="outline" onClick={() => sync.mutate({ _tag: "IssueUnarchive", id: current().id })}>
                        Restore
                      </Button>
                    </AlertAction>
                  </Alert>
                </Show>
                <Textarea
                  ref={(el: HTMLTextAreaElement) => (titleEl = el)}
                  rows={1}
                  aria-label="Title"
                  value={title()}
                  onInput={(e) => setTitle(e.currentTarget.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      e.currentTarget.blur()
                    }
                  }}
                  xstyle={[bareTextarea, s.title]}
                />
                <Show
                  when={editingDescription()}
                  fallback={
                    <div {...stylex.attrs(s.description, s.rendered)} onClick={onDescriptionClick}>
                      <Show when={description().trim() !== ""} fallback={<span {...stylex.attrs(s.placeholder)}>Add a description…</span>}>
                        <Markdown source={description()} repo={issueRepo(sync.state, current())} />
                      </Show>
                    </div>
                  }
                >
                  <Textarea
                    ref={(el: HTMLTextAreaElement) => {
                      descriptionEl = el
                      // Focus once mounted, with the caret at the end, without jumping the page there.
                      requestAnimationFrame(() => {
                        el.focus({ preventScroll: true })
                        el.setSelectionRange(el.value.length, el.value.length)
                      })
                    }}
                    aria-label="Description"
                    placeholder="Add a description…"
                    value={description()}
                    onInput={(e) => setDescription(e.currentTarget.value)}
                    onBlur={() => {
                      commitDescription()
                      setEditingDescription(false)
                    }}
                    xstyle={[bareTextarea, s.description]}
                  />
                </Show>
              </div>
            </div>
            <aside {...stylex.attrs(s.side)}>
              <div {...stylex.attrs(s.prop)}>
                <span {...stylex.attrs(s.propLabel)}>Status</span>
                <StatePicker apiRef={(a) => (apis.status = a)} variant="row" teamId={current().teamId} value={current().stateId} onChange={(stateId) => actions.update(current(), { stateId })} />
              </div>
              <div {...stylex.attrs(s.prop)}>
                <span {...stylex.attrs(s.propLabel)}>Priority</span>
                <PriorityPicker apiRef={(a) => (apis.priority = a)} variant="row" value={current().priority} onChange={(priority) => actions.update(current(), { priority })} />
              </div>
              <div {...stylex.attrs(s.prop)}>
                <span {...stylex.attrs(s.propLabel)}>Assignee</span>
                <AssigneePicker apiRef={(a) => (apis.assignee = a)} variant="row" value={current().assigneeId} onChange={(assigneeId) => actions.update(current(), { assigneeId })} />
              </div>
              <div {...stylex.attrs(s.prop)}>
                <span {...stylex.attrs(s.propLabel)}>Project</span>
                <ProjectPicker apiRef={(a) => (apis.project = a)} variant="row" teamId={current().teamId} value={current().projectId} onChange={(projectId) => actions.update(current(), { projectId })} />
              </div>
              <div {...stylex.attrs(s.prop)}>
                <span {...stylex.attrs(s.propLabel)}>Labels</span>
                <LabelPicker apiRef={(a) => (apis.labels = a)} variant="row" teamId={current().teamId} value={current().labelIds} onChange={(labelIds) => actions.update(current(), { labelIds })} />
              </div>
              <Separator xstyle={s.divider} />
              <IssueRelations issue={current()} apis={relationApis} />
              <IssuePullRequests issue={current()} />
              <Separator xstyle={s.divider} />
              <Show when={current().github}>
                {(gh) => (
                  <a href={gh().url} target="_blank" rel="noreferrer" {...stylex.attrs(s.ghLink)}>
                    <GithubIcon size={14} />
                    {gh().owner}/{gh().repo}#{gh().number}
                  </a>
                )}
              </Show>
              <div {...stylex.attrs(s.meta)}>
                <UserAvatar name={sync.state.users[current().creatorId]?.name ?? null} src={sync.state.users[current().creatorId]?.avatarUrl ?? null} size={16} />
                Created by {sync.state.users[current().creatorId]?.name ?? "someone"} · {formatRelative(current().createdAt)}
              </div>
              <div {...stylex.attrs(s.meta)}>Updated {formatRelative(current().updatedAt)}</div>
            </aside>
          </div>
        </>
      )}
    </Show>
  )
}
