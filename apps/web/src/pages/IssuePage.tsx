import * as stylex from "@stylexjs/stylex"
import { useNavigate, useParams } from "@solidjs/router"
import { createSignal, Show, useContext } from "solid-js"
import { Sync } from "../app/context.ts"
import { type PickerApis, useIssueCommands } from "../app/issueCommands.ts"
import { AssigneePicker, LabelPicker, PriorityPicker, ProjectPicker, StatePicker, useIssueActions } from "../app/properties.tsx"
import { useCommands, useScope } from "../keys/solid.tsx"
import { findIssue, formatRelative, issueKey, projectHref } from "../lib/select.ts"
import { color, font, radius } from "../theme/tokens.stylex.ts"
import { ArchiveIcon, ChevronRightIcon, GithubIcon, MoreIcon, RestoreIcon, TrashIcon } from "../ui/icons.tsx"
import { AutoTextarea, Avatar, Button, PickerList, Popover } from "../ui/kit.tsx"
import { PageHeader } from "./Header.tsx"

const s = stylex.create({
  layout: { display: "grid", gridTemplateColumns: "1fr 280px", flexGrow: 1, minHeight: 0 },
  main: { overflowY: "auto", paddingTop: 36, paddingBottom: 80 },
  column: { maxWidth: 720, marginInline: "auto", paddingInline: 32 },
  title: { fontSize: font.xl, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.3 },
  description: { marginTop: 14, minHeight: 120, fontSize: 14, lineHeight: 1.65, color: color.fg },
  archived: {
    marginBottom: 16,
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
    color: color.fgMuted,
    fontSize: font.md,
    display: "flex",
    alignItems: "center",
    gap: 10
  },
  side: {
    overflowY: "auto",
    paddingBlock: 20,
    paddingInline: 16,
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: color.border,
    display: "flex",
    flexDirection: "column",
    gap: 2
  },
  prop: { display: "grid", gridTemplateColumns: "84px 1fr", alignItems: "center", minHeight: 32 },
  propLabel: { color: color.fgMuted, fontSize: font.sm },
  divider: { height: 1, backgroundColor: color.border, marginBlock: 14 },
  meta: { display: "flex", alignItems: "center", gap: 8, color: color.fgMuted, fontSize: font.sm, minHeight: 26 },
  ghLink: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: { default: color.fgMuted, ":hover": color.fg },
    fontSize: font.sm,
    textDecoration: "none",
    minHeight: 26
  },
  crumb: { color: color.fgMuted, textDecoration: "none", fontWeight: 500 },
  crumbSep: { color: color.fgSubtle, display: "inline-flex" },
  missing: { display: "grid", placeItems: "center", height: "60%", color: color.fgMuted }
})

export const IssuePage = () => {
  const sync = useContext(Sync)
  const params = useParams()
  const navigate = useNavigate()
  const actions = useIssueActions()
  const issue = () => findIssue(sync.state, params.ref ?? "")
  const apis: PickerApis = {}
  let titleEl: HTMLTextAreaElement | undefined
  let descriptionEl: HTMLTextAreaElement | undefined

  useScope("issue.detail")
  useIssueCommands({ scope: "issue.detail", issue, apis: () => apis })
  useCommands([
    { id: "issue.back", title: "Back to issues", group: "Navigation", keys: ["escape", "u"], scope: "issue.detail", run: () => navigate("/") },
    { id: "issue.editTitle", title: "Edit title", group: "Issue", keys: ["e"], scope: "issue.detail", run: () => titleEl?.focus() },
    { id: "issue.editDescription", title: "Edit description", group: "Issue", keys: ["d"], scope: "issue.detail", run: () => descriptionEl?.focus() },
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

  return (
    <Show when={issue()} fallback={<div {...stylex.attrs(s.missing)}>This issue does not exist, or was deleted.</div>}>
      {(current) => (
        <>
          <PageHeader
            title={
              <>
                <a href="/" {...stylex.attrs(s.crumb)}>{sync.state.teams[current().teamId]?.name}</a>
                <span {...stylex.attrs(s.crumbSep)}><ChevronRightIcon size={12} /></span>
                <Show when={current().projectId ? sync.state.projects[current().projectId!] : undefined}>
                  {(p) => (
                    <>
                      <a href={projectHref(p().id)} {...stylex.attrs(s.crumb)}>{p().name}</a>
                      <span {...stylex.attrs(s.crumbSep)}><ChevronRightIcon size={12} /></span>
                    </>
                  )}
                </Show>
                <span>{issueKey(sync.state, current())}</span>
              </>
            }
            actions={
              <Popover
                align="end"
                trigger={(attrs) => (
                  <Button variant="ghost" size="icon-sm" title="More actions" {...attrs}>
                    <MoreIcon size={15} />
                  </Button>
                )}
              >
                {(api) => (
                  <PickerList
                    placeholder="Actions…"
                    selected={[]}
                    close={api.close}
                    items={[
                      current().archivedAt === null
                        ? { value: "archive", label: "Archive", icon: () => <ArchiveIcon size={14} /> }
                        : { value: "unarchive", label: "Restore from archive", icon: () => <RestoreIcon size={14} /> },
                      { value: "delete", label: "Delete…", icon: () => <TrashIcon size={14} /> }
                    ]}
                    onPick={(action) => {
                      const id = current().id
                      if (action === "archive") sync.mutate({ _tag: "IssueArchive", id })
                      if (action === "unarchive") sync.mutate({ _tag: "IssueUnarchive", id })
                      if (action === "delete" && confirm("Delete this issue? This cannot be undone.")) {
                        sync.mutate({ _tag: "IssueDelete", id })
                        navigate("/")
                      }
                    }}
                  />
                )}
              </Popover>
            }
          />
          <div {...stylex.attrs(s.layout)}>
            <div {...stylex.attrs(s.main)}>
              <div {...stylex.attrs(s.column)}>
                <Show when={current().archivedAt !== null}>
                  <div {...stylex.attrs(s.archived)}>
                    <ArchiveIcon size={14} />
                    This issue is archived.
                    <Button size="sm" onClick={() => sync.mutate({ _tag: "IssueUnarchive", id: current().id })}>Restore</Button>
                  </div>
                </Show>
                <AutoTextarea
                  ref={(el) => (titleEl = el)}
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
                  sx={s.title}
                />
                <AutoTextarea
                  ref={(el) => (descriptionEl = el)}
                  aria-label="Description"
                  placeholder="Add a description…"
                  value={description()}
                  onInput={(e) => setDescription(e.currentTarget.value)}
                  onBlur={commitDescription}
                  sx={s.description}
                />
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
              <div {...stylex.attrs(s.divider)} />
              <Show when={current().github}>
                {(gh) => (
                  <a href={gh().url} target="_blank" rel="noreferrer" {...stylex.attrs(s.ghLink)}>
                    <GithubIcon size={14} />
                    {gh().owner}/{gh().repo}#{gh().number}
                  </a>
                )}
              </Show>
              <div {...stylex.attrs(s.meta)}>
                <Avatar name={sync.state.users[current().creatorId]?.name ?? null} src={sync.state.users[current().creatorId]?.avatarUrl ?? null} size={16} />
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
