import { keyBetween, type Priority, uuidv7 } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { createEffect, createSignal, Show, useContext } from "solid-js"
import { firstTeam, teamStates } from "../lib/select.ts"
import { color, font } from "../theme/tokens.stylex.ts"
import { ChevronRightIcon } from "../ui/icons.tsx"
import { Shortcut, useCommands } from "../keys/solid.tsx"
import { AutoTextarea, Button, Dialog } from "../ui/kit.tsx"
import type { ComposerDefaults } from "./context.ts"
import { Sync } from "./context.ts"
import { AssigneePicker, LabelPicker, PriorityPicker, ProjectPicker, StatePicker } from "./properties.tsx"

const s = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingTop: 14,
    paddingInline: 16,
    color: color.fgMuted,
    fontSize: font.sm
  },
  teamKey: {
    paddingInline: 6,
    paddingBlock: 2,
    borderRadius: 4,
    backgroundColor: color.subtle,
    color: color.fg,
    fontWeight: 500
  },
  body: { paddingInline: 16, paddingTop: 10, paddingBottom: 4 },
  title: { fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.35 },
  description: { marginTop: 8, minHeight: 72, fontSize: font.md, lineHeight: 1.55, color: color.fg },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, paddingInline: 16, paddingBlock: 10 },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    paddingInline: 12,
    paddingBlock: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.border
  },
  hint: { marginRight: "auto", color: color.fgSubtle, fontSize: font.sm, display: "flex", alignItems: "center", gap: 4 }
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
    <Dialog open={props.open} onClose={props.onClose} label="New issue" scope="composer">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div {...stylex.attrs(s.header)}>
          <span {...stylex.attrs(s.teamKey)}>{team()?.key}</span>
          <ChevronRightIcon size={12} />
          <Show when={projectId() ? sync.state.projects[projectId()!] : undefined}>
            {(p) => (
              <>
                <span>{p().name}</span>
                <ChevronRightIcon size={12} />
              </>
            )}
          </Show>
          <span>New issue</span>
        </div>
        <div {...stylex.attrs(s.body)}>
          <AutoTextarea
            ref={(el) => requestAnimationFrame(() => el.focus())}
            placeholder="Issue title"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) e.preventDefault()
            }}
            sx={s.title}
          />
          <AutoTextarea
            placeholder="Add description…"
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            sx={s.description}
          />
        </div>
        <div {...stylex.attrs(s.chips)}>
          <StatePicker teamId={team()?.id ?? ""} value={stateId()} onChange={setStateId} variant="chip" />
          <ProjectPicker teamId={team()?.id ?? ""} value={projectId()} onChange={setProjectId} variant="chip" />
          <PriorityPicker value={priority()} onChange={setPriority} variant="chip" />
          <AssigneePicker value={assigneeId()} onChange={setAssigneeId} variant="chip" />
          <LabelPicker teamId={team()?.id ?? ""} value={labelIds()} onChange={setLabelIds} variant="chip" />
        </div>
        <div {...stylex.attrs(s.footer)}>
          <span {...stylex.attrs(s.hint)}>
            <Shortcut binding="mod+enter" />
            to create
          </span>
          <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={title().trim() === ""}>Create issue</Button>
        </div>
      </form>
    </Dialog>
  )
}
