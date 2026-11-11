import { keyBetween, type Priority, uuidv7 } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { createEffect, createSignal, Show, useContext } from "solid-js"
import { firstTeam, teamStates } from "../lib/select.ts"
import { KeyScope, Shortcut, useCommands } from "../keys/solid.tsx"
import { a11y } from "../lib/a11y.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { Badge } from "../ui/badge.tsx"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../ui/breadcrumb.tsx"
import { Button } from "../ui/button.tsx"
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../ui/dialog.tsx"
import { Textarea } from "../ui/textarea.tsx"
import { bareTextarea } from "./styles.ts"
import type { ComposerDefaults } from "./context.ts"
import { Sync } from "./context.ts"
import { AssigneePicker, LabelPicker, PriorityPicker, ProjectPicker, StatePicker } from "./properties.tsx"

const s = stylex.create({
  dialog: { maxWidth: "min(640px, calc(100vw - 32px))", padding: 0, gap: 0, top: "12vh", translate: "-50% 0" },
  header: { paddingTop: 14, paddingInline: 16 },
  body: { display: "flex", flexDirection: "column", paddingInline: 16, paddingTop: 10, paddingBottom: 4 },
  title: { fontSize: 18, lineHeight: 1.35, fontWeight: 600, letterSpacing: "-0.01em" },
  description: { marginTop: 8, minHeight: 72, fontSize: 13, lineHeight: 1.55 },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, paddingInline: 16, paddingBlock: 10 },
  footer: {
    alignItems: "center",
    paddingInline: 12,
    paddingBlock: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border
  },
  hint: { marginRight: "auto", color: colors.mutedForeground, fontSize: "0.75rem", display: "flex", alignItems: "center", gap: 4 }
})

/** The "New issue" modal. Creating is optimistic: the issue shows in the list before the server answers. */
export const Composer = (props: { open: boolean; defaults: ComposerDefaults; onClose: () => void }) => {
  const sync = useContext(Sync)
  const team = () => firstTeam(sync.state)
  const defaultState = () => {
    const t = team()
    if (!t) return ""
    const states = teamStates(sync.state, t.id)
    return props.defaults.stateId ?? (states.find((st) => st.type === "unstarted") ?? states[0])?.id ?? ""
  }

  const [title, setTitle] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [stateId, setStateId] = createSignal(() => defaultState())
  const [priority, setPriority] = createSignal<Priority>(0)
  const [assigneeId, setAssigneeId] = createSignal<string | null>(null)
  const [labelIds, setLabelIds] = createSignal<ReadonlyArray<string>>([])
  // Starts as the project of the page the composer opened from; the user can pick another.
  const [projectId, setProjectId] = createSignal<string | null>(null)
  createEffect(
    () => props.open,
    (open) => {
      if (open) setProjectId(props.defaults.projectId ?? null)
    }
  )

  const reset = () => {
    setTitle("")
    setDescription("")
    setStateId(defaultState())
    setPriority(0)
    setAssigneeId(null)
    setLabelIds([])
  }

  const submit = () => {
    const t = team()
    if (!t || title().trim() === "") return
    const top = Object.values(sync.state.issues)
      .filter((i) => i.teamId === t.id)
      .reduce<string | null>((max, i) => (max === null || i.sortOrder > max ? i.sortOrder : max), null)
    sync.mutate({
      _tag: "IssueCreate",
      id: uuidv7(),
      teamId: t.id,
      projectId: projectId() && sync.state.projects[projectId()!] ? projectId() : null,
      title: title().trim(),
      description: description(),
      stateId: stateId(),
      priority: priority(),
      assigneeId: assigneeId(),
      labelIds: labelIds(),
      sortOrder: keyBetween(top, null)
    })
    reset()
    props.onClose()
  }

  useCommands([
    { id: "composer.submit", title: "Create issue", group: "New issue", keys: ["mod+enter"], scope: "composer", run: submit }
  ])

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent xstyle={s.dialog} showCloseButton={false}>
      <KeyScope name="composer" blocking>
      <DialogTitle xstyle={a11y.srOnly}>New issue</DialogTitle>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Breadcrumb xstyle={s.header}>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Badge variant="secondary">{(projectId() ? sync.state.projects[projectId()!]?.key : undefined) ?? team()?.key}</Badge>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <Show when={projectId() ? sync.state.projects[projectId()!] : undefined}>
              {(p) => (
                <>
                  <BreadcrumbItem>{p().name}</BreadcrumbItem>
                  <BreadcrumbSeparator />
                </>
              )}
            </Show>
            <BreadcrumbItem>
              <BreadcrumbPage>New issue</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div {...stylex.attrs(s.body)}>
          <Textarea
            ref={(el: HTMLTextAreaElement) => requestAnimationFrame(() => el.focus())}
            rows={1}
            aria-label="Title"
            placeholder="Issue title"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) e.preventDefault()
            }}
            xstyle={[bareTextarea, s.title]}
          />
          <Textarea
            aria-label="Description"
            placeholder="Add description…"
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            xstyle={[bareTextarea, s.description]}
          />
        </div>
        <div {...stylex.attrs(s.chips)}>
          <StatePicker teamId={team()?.id ?? ""} value={stateId()} onChange={setStateId} variant="chip" />
          <ProjectPicker teamId={team()?.id ?? ""} value={projectId()} onChange={setProjectId} variant="chip" />
          <PriorityPicker value={priority()} onChange={setPriority} variant="chip" />
          <AssigneePicker value={assigneeId()} onChange={setAssigneeId} variant="chip" />
          <LabelPicker teamId={team()?.id ?? ""} value={labelIds()} onChange={setLabelIds} variant="chip" />
        </div>
        <DialogFooter xstyle={s.footer}>
          <span {...stylex.attrs(s.hint)}>
            <Shortcut binding="mod+enter" />
            to create
          </span>
          <Button variant="ghost" size="sm" onClick={props.onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={title().trim() === ""}>Create issue</Button>
        </DialogFooter>
      </form>
      </KeyScope>
      </DialogContent>
    </Dialog>
  )
}
