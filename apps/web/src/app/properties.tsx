import type { Issue, Priority } from "@gradient/domain"
import { PROJECT_COLORS, uuidv7 } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import type { HTMLProps } from "base-ui-solidjs/types"
import { For, omit, Show, useContext } from "solid-js"
import type { JSX } from "@solidjs/web"
import { projectRepo, suggestProjectKey, teamLabels, teamProjects, teamStates, users } from "../lib/select.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { PriorityIcon, priorityLabel, ProjectIcon, StateIcon, TagIcon, UserIcon } from "../ui/icons.tsx"
import { Button, type ButtonProps } from "../ui/button.tsx"
import { Picker, type PickerApi } from "./Picker.tsx"
import { ProjectGlyph } from "./ProjectGlyph.tsx"
import { UserAvatar } from "./UserAvatar.tsx"
import { Sync } from "./context.ts"

const s = stylex.create({
  row: { width: "100%", justifyContent: "flex-start", fontWeight: 400 },
  muted: { color: colors.mutedForeground },
  dot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  text: { overflow: "hidden", textOverflow: "ellipsis" }
})

type Variant = "chip" | "row" | "icon"

/** A picker's trigger: an outline chip (composer), a full-width row (issue sidebar) or an icon (list rows). */
const Trigger = (props: HTMLProps & { variant: Variant; title: string; children: JSX.Element }) => {
  const rest = omit(props, "variant")
  return (
    <Button
      {...(rest as ButtonProps)}
      variant={props.variant === "chip" ? "outline" : "ghost"}
      size={props.variant === "icon" ? "icon-xs" : props.variant === "chip" ? "xs" : "sm"}
      {...(props.variant === "row" ? { xstyle: s.row } : {})}
    />
  )
}

export const StatePicker = (props: { teamId: string; value: string; onChange: (id: string) => void; variant: Variant; apiRef?: (api: PickerApi) => void }) => {
  const sync = useContext(Sync)
  const current = () => sync.state.workflowStates[props.value]
  return (
    <Picker
      {...(props.apiRef ? { apiRef: props.apiRef } : {})}
      placeholder="Change status…"
      items={teamStates(sync.state, props.teamId).map((st) => ({
        value: st.id,
        label: st.name,
        icon: () => <StateIcon type={st.type} color={st.color} />
      }))}
      selected={[props.value]}
      onPick={props.onChange}
      trigger={(p) => (
        <Trigger {...p} variant={props.variant} title={`Status: ${current()?.name ?? ""}`}>
          <Show when={current()}>{(st) => <StateIcon type={st().type} color={st().color} />}</Show>
          <Show when={props.variant !== "icon"}>
            <span {...stylex.attrs(s.text)}>{current()?.name}</span>
          </Show>
        </Trigger>
      )}
    />
  )
}

const PRIORITIES: ReadonlyArray<Priority> = [0, 1, 2, 3, 4]

export const PriorityPicker = (props: { value: Priority; onChange: (p: Priority) => void; variant: Variant; apiRef?: (api: PickerApi) => void }) => (
  <Picker
    {...(props.apiRef ? { apiRef: props.apiRef } : {})}
    placeholder="Set priority…"
    items={PRIORITIES.map((p) => ({ value: p, label: priorityLabel[p], icon: () => <PriorityIcon priority={p} />, hint: String(p) }))}
    selected={[props.value]}
    onPick={props.onChange}
    trigger={(p) => (
      <Trigger {...p} variant={props.variant} title={`Priority: ${priorityLabel[props.value]}`}>
        <PriorityIcon priority={props.value} />
        <Show when={props.variant !== "icon"}>
          <span {...stylex.attrs(props.value === 0 && s.muted)}>
            {props.value === 0 && props.variant === "chip" ? "Priority" : priorityLabel[props.value]}
          </span>
        </Show>
      </Trigger>
    )}
  />
)

export const AssigneePicker = (props: { value: string | null; onChange: (id: string | null) => void; variant: Variant; apiRef?: (api: PickerApi) => void }) => {
  const sync = useContext(Sync)
  const current = () => (props.value ? sync.state.users[props.value] : undefined)
  return (
    <Picker<string | null>
      {...(props.apiRef ? { apiRef: props.apiRef } : {})}
      placeholder="Assign to…"
      align={props.variant === "icon" ? "end" : "start"}
      items={[
        { value: null, label: "No assignee", icon: () => <UserIcon size={14} /> },
        ...users(sync.state).map((u) => ({
          value: u.id,
          label: u.id === sync.state.viewerId ? `${u.name} (you)` : u.name,
          icon: () => <UserAvatar name={u.name} src={u.avatarUrl} size={16} />,
          ...(u.githubLogin ? { hint: `@${u.githubLogin}` } : {})
        }))
      ]}
      selected={[props.value]}
      onPick={props.onChange}
      trigger={(p) => (
        <Trigger {...p} variant={props.variant} title={`Assignee: ${current()?.name ?? "none"}`}>
          <UserAvatar name={current()?.name ?? null} src={current()?.avatarUrl ?? null} size={props.variant === "icon" ? 18 : 16} />
          <Show when={props.variant !== "icon"}>
            <span {...stylex.attrs(s.text, props.value === null && s.muted)}>{current()?.name ?? (props.variant === "chip" ? "Assignee" : "Unassigned")}</span>
          </Show>
        </Trigger>
      )}
    />
  )
}

const LABEL_COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#0090ff", "#8e4ec6", "#d6409f", "#8b8d98"]

export const LabelPicker = (props: {
  teamId: string
  value: ReadonlyArray<string>
  onChange: (ids: ReadonlyArray<string>) => void
  variant: Variant
  apiRef?: (api: PickerApi) => void
}) => {
  const sync = useContext(Sync)
  const selected = () => props.value.map((id) => sync.state.labels[id]).filter((l) => l !== undefined)
  return (
    <Picker
      {...(props.apiRef ? { apiRef: props.apiRef } : {})}
      multiple
      placeholder="Add labels…"
      items={teamLabels(sync.state, props.teamId).map((l) => ({
        value: l.id,
        label: l.name,
        icon: () => <span {...stylex.attrs(s.dot)} style={{ "background-color": l.color }} />
      }))}
      selected={props.value}
      onPick={(id) =>
        props.onChange(props.value.includes(id) ? props.value.filter((x) => x !== id) : [...props.value, id])}
      onCreate={(name) => {
        const id = uuidv7()
        const colorIndex = teamLabels(sync.state, props.teamId).length % LABEL_COLORS.length
        sync.mutate({ _tag: "LabelCreate", id, teamId: props.teamId, name, color: LABEL_COLORS[colorIndex]! })
        props.onChange([...props.value, id])
      }}
      trigger={(p) => (
        <Trigger {...p} variant={props.variant} title="Labels">
          <Show
            when={selected().length > 0}
            fallback={
              <>
                <TagIcon size={14} />
                <Show when={props.variant !== "icon"}>
                  <span {...stylex.attrs(s.muted)}>{props.variant === "chip" ? "Labels" : "Add labels"}</span>
                </Show>
              </>
            }
          >
            <For each={selected()}>{(l) => <span {...stylex.attrs(s.dot)} style={{ "background-color": l.color }} />}</For>
            <span {...stylex.attrs(s.text)}>
              {selected().length === 1 ? selected()[0]!.name : `${selected().length} labels`}
            </span>
          </Show>
        </Trigger>
      )}
    />
  )
}

export const ProjectPicker = (props: {
  teamId: string
  value: string | null
  onChange: (id: string | null) => void
  variant: Variant
  apiRef?: (api: PickerApi) => void
}) => {
  const sync = useContext(Sync)
  const current = () => (props.value ? sync.state.projects[props.value] : undefined)
  return (
    <Picker<string | null>
      {...(props.apiRef ? { apiRef: props.apiRef } : {})}
      placeholder="Move to project…"
      items={[
        { value: null, label: "No project", icon: () => <ProjectIcon size={14} color="currentColor" /> },
        ...teamProjects(sync.state, props.teamId).map((p) => {
          const repo = projectRepo(sync.state, p.id)
          return {
            value: p.id,
            label: p.name,
            icon: () => <ProjectGlyph project={p} size={14} />,
            keywords: p.key,
            hint: repo ? `${p.key} · ${repo.owner}/${repo.name}` : p.key
          }
        })
      ]}
      selected={[props.value]}
      onPick={props.onChange}
      onCreate={(name) => {
        const id = uuidv7()
        const color = PROJECT_COLORS[teamProjects(sync.state, props.teamId).length % PROJECT_COLORS.length]!
        sync.mutate({ _tag: "ProjectCreate", id, teamId: props.teamId, key: suggestProjectKey(sync.state, props.teamId, name), name, color })
        props.onChange(id)
      }}
      trigger={(p) => (
        <Trigger {...p} variant={props.variant} title={`Project: ${current()?.name ?? "none"}`}>
          <ProjectGlyph project={current()} size={14} />
          <Show when={props.variant !== "icon"}>
            <span {...stylex.attrs(s.text, props.value === null && s.muted)}>
              {current()?.name ?? (props.variant === "chip" ? "Project" : "No project")}
            </span>
          </Show>
        </Trigger>
      )}
    />
  )
}

/** Shorthand for issue property edits from any view. */
export const useIssueActions = () => {
  const sync = useContext(Sync)
  return {
    update: (issue: Issue, patch: Parameters<typeof updatePatch>[0]) =>
      sync.mutate({ _tag: "IssueUpdate", id: issue.id, patch: updatePatch(patch) })
  }
}

const updatePatch = (patch: {
  title?: string
  description?: string
  stateId?: string
  priority?: Priority
  assigneeId?: string | null
  labelIds?: ReadonlyArray<string>
  projectId?: string | null
}) => patch
