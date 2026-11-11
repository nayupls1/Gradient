import {
  type GithubAvailableRepo,
  isValidProjectKey,
  PROJECT_COLORS,
  type ProjectIconChoices,
  uuidv7
} from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { useNavigate } from "@solidjs/router"
import { createEffect, createSignal, createUniqueId, For, Show, useContext } from "solid-js"
import { KeyScope, useCommands } from "../keys/solid.tsx"
import { defaultTeam, keyOwner, projectHref, projectRepo, suggestProjectKey, teamProjects } from "../lib/select.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { font } from "../theme/tokens.stylex.ts"
import { Button, type ButtonProps } from "../ui/button.tsx"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog.tsx"
import { CheckIcon, ChevronDownIcon, GithubIcon, ProjectIcon, XIcon } from "../ui/icons.tsx"
import { Input } from "../ui/input.tsx"
import { Label } from "../ui/label.tsx"
import { Sync } from "./context.ts"
import { github } from "./github.ts"
import { GithubRepoPicker } from "./GithubRepoPicker.tsx"
import { Picker, type PickerApi } from "./Picker.tsx"
import { ProjectGlyph, repoFileUrl } from "./ProjectGlyph.tsx"

const s = stylex.create({
  dialog: { gap: 16 },
  form: { display: "flex", flexDirection: "column", gap: 16 },
  title: { display: "flex", alignItems: "center", gap: 8 },
  field: { display: "flex", flexDirection: "column", gap: 8 },
  hint: { color: colors.mutedForeground, fontSize: "0.75rem" },
  swatches: { display: "flex", gap: 6, flexWrap: "wrap" },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    color: "#fff",
    cursor: "pointer",
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": `0 0 0 3px color-mix(in oklch, ${colors.ring} 50%, transparent)` }
  },
  swatchOn: { boxShadow: `0 0 0 2px ${colors.popover}, 0 0 0 4px ${colors.mutedForeground}` },
  repoButton: { width: "100%", justifyContent: "flex-start", fontWeight: 400 },
  grow: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" },
  muted: { color: colors.mutedForeground },
  error: { color: colors.destructive, fontSize: "0.75rem" },
  keyRow: { display: "flex", alignItems: "center", gap: 10 },
  keyInput: { width: 90, flexShrink: 0, fontFamily: font.mono, letterSpacing: "0.06em", textTransform: "uppercase" },
  thumb: { width: 16, height: 16, flexShrink: 0, objectFit: "contain", borderRadius: 3 }
})

/** What the icon picker holds: "auto", "none", or a repository path. */
type IconPick = { mode: "auto" } | { mode: "none" } | { mode: "repo"; path: string }
const iconValue = (pick: IconPick) => (pick.mode === "repo" ? `repo:${pick.path}` : pick.mode)
const fileName = (path: string) => path.split("/").pop() ?? path

export type ProjectDialogMode = { kind: "create"; teamId?: string } | { kind: "edit"; projectId: string; focus?: "icon" }

/**
 * Create a project (optionally linked to a GitHub repository, whose issues are
 * imported into it), or rename, recolor and pick the icon of one. Icons come
 * from the linked repository: its favicon by default, any image in it, or the
 * plain cube.
 */
export const ProjectDialog = (props: { mode: ProjectDialogMode | null; onClose: () => void }) => {
  const sync = useContext(Sync)
  const navigate = useNavigate()
  const editing = () => (props.mode?.kind === "edit" ? sync.state.projects[props.mode.projectId] : undefined)
  /** The project's team, or the team a new one goes to. */
  const team = () => {
    const mode = props.mode
    if (mode?.kind === "edit") return sync.state.teams[editing()?.teamId ?? ""]
    return (mode?.teamId ? sync.state.teams[mode.teamId] : undefined) ?? defaultTeam(sync.state)
  }

  const [name, setName] = createSignal("")
  const [key, setKey] = createSignal("")
  /** The key follows the name until the user edits it. */
  const [keyEdited, setKeyEdited] = createSignal(false)
  const [colorValue, setColor] = createSignal(PROJECT_COLORS[0]!)
  const [repo, setRepo] = createSignal<GithubAvailableRepo | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [icon, setIcon] = createSignal<IconPick>({ mode: "auto" })
  const [iconChoices, setIconChoices] = createSignal<ProjectIconChoices | null>(null)
  const [iconError, setIconError] = createSignal<string | null>(null)
  let iconPicker: PickerApi | undefined
  /** The repository an edited project takes its icon from. */
  const editingRepo = () => (editing() ? projectRepo(sync.state, editing()!.id) : undefined)

  // Fill the form each time the dialog opens.
  createEffect(
    () => props.mode,
    (mode) => {
      if (!mode) return
      const project = mode.kind === "edit" ? sync.state.projects[mode.projectId] : undefined
      const count = team() ? teamProjects(sync.state, team()!.id).length : 0
      setName(project?.name ?? "")
      setKey(project?.key ?? "")
      setKeyEdited(project !== undefined)
      setColor(project?.color ?? PROJECT_COLORS[count % PROJECT_COLORS.length]!)
      setRepo(null)
      setError(null)
      setBusy(false)
      setIcon(
        project?.iconMode === "repo" && project.icon
          ? { mode: "repo", path: project.icon.path }
          : { mode: project?.iconMode === "none" ? "none" : "auto" }
      )
      setIconChoices(null)
      setIconError(null)
      if (project && projectRepo(sync.state, project.id)) {
        sync.call((c) => c.GithubProjectIcons({ projectId: project.id })).then(
          (choices) => setIconChoices(choices),
          (e) => setIconError((e as { message?: string }).message ?? String(e))
        )
        if (mode.kind === "edit" && mode.focus === "icon") requestAnimationFrame(() => iconPicker?.open())
      }
    }
  )

  /** The file an icon pick shows, for previews: auto's find, the picked file, or none. */
  const iconFile = (pick: IconPick) => {
    if (pick.mode === "none") return null
    if (pick.mode === "auto") return iconChoices()?.auto ?? (editing()?.iconMode === "auto" ? editing()!.icon : null)
    return iconChoices()?.images.find((f) => f.path === pick.path) ??
      (editing()?.icon?.path === pick.path ? editing()!.icon : null)
  }
  const iconPreview = (pick: IconPick, size: number) => {
    const file = iconFile(pick)
    const r = editingRepo()
    return file && r
      ? <img src={repoFileUrl(r.id, file)} alt="" loading="lazy" width={size} height={size} {...stylex.attrs(s.thumb)} />
      : <ProjectIcon size={size} color={colorValue()} />
  }
  const iconLabel = (pick: IconPick) => {
    if (pick.mode === "none") return "Cube"
    if (pick.mode === "repo") return pick.path
    const found = iconFile(pick)
    return found ? `Automatic · ${found.path}` : "Automatic"
  }
  const iconChanged = () => {
    const project = editing()
    if (!project) return false
    const initial: IconPick = project.iconMode === "repo" && project.icon
      ? { mode: "repo", path: project.icon.path }
      : { mode: project.iconMode === "none" ? "none" : "auto" }
    return iconValue(initial) !== iconValue(icon())
  }

  /** What the key will be: the user's, or one derived from the name (or the picked repo's). */
  const effectiveKey = () => {
    const t = team()
    if (keyEdited()) return key().trim().toUpperCase()
    const source = name().trim() || repo()?.name || ""
    return t && source ? suggestProjectKey(sync.state, t.id, source, editing()?.id) : ""
  }
  const keyProblem = () => {
    const k = effectiveKey()
    if (!k) return null
    if (!isValidProjectKey(k)) return "2–5 capital letters or digits, starting with a letter."
    const t = team()
    if (t && t.key.toUpperCase() === k) return `${k} is the team's own key.`
    const owner = keyOwner(sync.state, k, editing() ? { project: editing()!.id } : {})
    return owner ? `${k} is used by ${owner}.` : null
  }

  const submit = async () => {
    const t = team()
    if (!t || busy()) return
    const project = editing()
    const trimmed = name().trim()
    if (keyProblem()) return setError(`Key: ${keyProblem()}`)
    if (project) {
      if (!trimmed) return setError("A project needs a name.")
      sync.mutate({
        _tag: "ProjectUpdate",
        id: project.id,
        patch: { name: trimmed, color: colorValue(), ...(effectiveKey() !== project.key ? { key: effectiveKey() } : {}) }
      })
      if (!iconChanged()) return props.onClose()
      // The server looks the file up in the repository, then saves it through the usual write path.
      const pick = icon()
      setBusy(true)
      setError(null)
      try {
        await sync.call((c) =>
          c.GithubSetProjectIcon({ projectId: project.id, mode: pick.mode, ...(pick.mode === "repo" ? { path: pick.path } : {}) })
        )
        props.onClose()
      } catch (e) {
        setError((e as { message?: string }).message ?? String(e))
      } finally {
        setBusy(false)
      }
      return
    }
    const picked = repo()
    if (!picked) {
      if (!trimmed) return setError("A project needs a name.")
      const id = uuidv7()
      sync.mutate({ _tag: "ProjectCreate", id, teamId: t.id, key: effectiveKey(), name: trimmed, color: colorValue() })
      props.onClose()
      return navigate(projectHref(id))
    }
    // With a repository the server creates the project, links it and imports its issues.
    setBusy(true)
    setError(null)
    try {
      const result = await github.linkRepo(sync, {
        teamId: t.id,
        projectId: null,
        ...(trimmed ? { projectName: trimmed } : {}),
        ...(keyEdited() ? { projectKey: effectiveKey() } : {}),
        owner: picked.owner,
        name: picked.name,
        pushExisting: false
      })
      props.onClose()
      navigate(projectHref(result.projectId))
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  useCommands([
    { id: "project.dialog.submit", title: "Save project", group: "Project", keys: ["mod+enter"], scope: "project-dialog", run: () => void submit() }
  ])

  const ids = { name: createUniqueId(), key: createUniqueId() }

  return (
    <Dialog open={props.mode !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent xstyle={s.dialog}>
      <KeyScope name="project-dialog" blocking>
      <DialogHeader>
        <DialogTitle xstyle={s.title}>
          <Show when={editing()} fallback={<ProjectIcon size={16} color={colorValue()} />}>
            {iconPreview(icon(), 16)}
          </Show>
          {editing() ? "Edit project" : Object.keys(sync.state.teams).length > 1 ? `New project in ${team()?.name ?? "team"}` : "New project"}
        </DialogTitle>
      </DialogHeader>
      <form
        {...stylex.attrs(s.form)}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div {...stylex.attrs(s.field)}>
          <Label for={ids.name}>Name</Label>
          <Input
            id={ids.name}
            ref={(el: HTMLInputElement | null) => el && requestAnimationFrame(() => el.focus())}
            placeholder={repo() ? repo()!.name : "e.g. Website"}
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </div>
        <div {...stylex.attrs(s.field)}>
          <Label for={ids.key}>Key</Label>
          <div {...stylex.attrs(s.keyRow)}>
            <Input
              id={ids.key}
              placeholder="TES"
              maxlength={5}
              value={effectiveKey()}
              onInput={(e) => {
                setKeyEdited(true)
                setKey(e.currentTarget.value.toUpperCase())
              }}
              xstyle={s.keyInput}
            />
            <span {...stylex.attrs(s.hint)}>
              {keyProblem() ?? `Issues read ${effectiveKey() || "KEY"}-12.`}
            </span>
          </div>
        </div>
        <div {...stylex.attrs(s.field)}>
          <Label>Color</Label>
          <div {...stylex.attrs(s.swatches)} role="radiogroup" aria-label="Color">
            <For each={PROJECT_COLORS}>
              {(c) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={colorValue() === c ? "true" : "false"}
                  title={c}
                  onClick={() => setColor(c)}
                  style={{ "background-color": c }}
                  {...stylex.attrs(s.swatch, colorValue() === c && s.swatchOn)}
                >
                  <Show when={colorValue() === c}><CheckIcon size={12} /></Show>
                </button>
              )}
            </For>
          </div>
        </div>
        <Show when={editingRepo()}>
          {(r) => (
            <div {...stylex.attrs(s.field)}>
              <Label>Icon</Label>
              <Picker<string>
                apiRef={(api) => (iconPicker = api)}
                placeholder="Search images…"
                emptyText={iconError() ?? (iconChoices() ? "No matching image" : "Loading images…")}
                items={[
                  {
                    value: "auto",
                    label: "Automatic",
                    hint: iconChoices() ? (iconChoices()!.auto ? fileName(iconChoices()!.auto!.path) : "no favicon found") : "",
                    keywords: "favicon logo default",
                    icon: () => iconPreview({ mode: "auto" }, 16)
                  },
                  { value: "none", label: "Cube", keywords: "none plain box", icon: () => <ProjectIcon size={16} color={colorValue()} /> },
                  ...(iconChoices()?.images ?? []).map((f) => ({
                    value: `repo:${f.path}`,
                    label: f.path,
                    hint: `${Math.max(1, Math.round(f.size / 1024))} KB`,
                    icon: () => <img src={repoFileUrl(r().id, f)} alt="" loading="lazy" width={16} height={16} {...stylex.attrs(s.thumb)} />
                  }))
                ]}
                selected={[iconValue(icon())]}
                onPick={(value) =>
                  setIcon(value === "auto" || value === "none" ? { mode: value } : { mode: "repo", path: value.slice("repo:".length) })}
                trigger={(p) => (
                  <Button {...(p as ButtonProps)} variant="outline" xstyle={s.repoButton}>
                    {iconPreview(icon(), 14)}
                    <span {...stylex.attrs(s.grow)}>{iconLabel(icon())}</span>
                    <ChevronDownIcon size={14} />
                  </Button>
                )}
              />
              <span {...stylex.attrs(s.hint)}>
                From {r().owner}/{r().name}. Automatic uses its favicon (else a logo) and follows it when it changes.
              </span>
            </div>
          )}
        </Show>
        <Show when={!editing()}>
          <div {...stylex.attrs(s.field)}>
            <Label>GitHub repository (optional)</Label>
            <GithubRepoPicker
              onPick={setRepo}
              trigger={(p) => (
                <Button {...(p as ButtonProps)} variant="outline" xstyle={s.repoButton}>
                  <GithubIcon size={14} />
                  <span {...stylex.attrs(s.grow, !repo() && s.muted)}>
                    {repo() ? `${repo()!.owner}/${repo()!.name}` : "Pick a repository to sync with"}
                  </span>
                  <ChevronDownIcon size={14} />
                </Button>
              )}
            />
            <Show
              when={repo()}
              fallback={<span {...stylex.attrs(s.hint)}>Its issues are imported into the project and sync both ways.</span>}
            >
              <span {...stylex.attrs(s.hint)}>
                Issues from {repo()!.owner}/{repo()!.name} are imported now.{" "}
                <Button size="xs" variant="ghost" onClick={() => setRepo(null)}><XIcon size={12} /> Remove</Button>
              </span>
            </Show>
          </div>
        </Show>
        <Show when={error()}>{(e) => <div {...stylex.attrs(s.error)}>{e()}</div>}</Show>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
          <Button type="submit" disabled={busy() || (!name().trim() && !repo())}>
            {busy() ? (editing() ? "Saving…" : "Importing…") : editing() ? "Save" : "Create project"}
          </Button>
        </DialogFooter>
      </form>
      </KeyScope>
      </DialogContent>
    </Dialog>
  )
}
