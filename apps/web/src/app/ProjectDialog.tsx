import { type GithubAvailableRepo, PROJECT_COLORS, uuidv7 } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { useNavigate } from "@solidjs/router"
import { createEffect, createSignal, For, Show, useContext } from "solid-js"
import { useCommands } from "../keys/solid.tsx"
import { firstTeam, projectHref, teamProjects } from "../lib/select.ts"
import { color, font, radius } from "../theme/tokens.stylex.ts"
import { CheckIcon, ChevronDownIcon, GithubIcon, ProjectIcon, XIcon } from "../ui/icons.tsx"
import { Button, Dialog, Input } from "../ui/kit.tsx"
import { Sync } from "./context.ts"
import { github } from "./github.ts"
import { GithubRepoPicker } from "./GithubRepoPicker.tsx"

const s = stylex.create({
  dialog: { width: "min(480px, calc(100vw - 32px))" },
  form: { display: "flex", flexDirection: "column", gap: 14, padding: 20 },
  title: { display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: font.lg, fontWeight: 600 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { color: color.fgMuted, fontSize: font.sm, fontWeight: 500 },
  hint: { color: color.fgSubtle, fontSize: font.sm },
  swatches: { display: "flex", gap: 6, flexWrap: "wrap" },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    borderWidth: 0,
    padding: 0,
    display: "grid",
    placeItems: "center",
    color: "#fff",
    cursor: "pointer",
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": `0 0 0 2px ${color.ring}` }
  },
  swatchOn: { boxShadow: `0 0 0 2px ${color.panel}, 0 0 0 4px ${color.fgMuted}` },
  repoButton: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    height: 32,
    paddingInline: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: { default: color.panel, ":hover": color.hover },
    color: color.fg,
    fontFamily: "inherit",
    fontSize: font.md,
    textAlign: "left",
    cursor: "pointer"
  },
  grow: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { color: color.fgMuted },
  error: { color: color.danger, fontSize: font.sm },
  footer: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }
})

export type ProjectDialogMode = { kind: "create" } | { kind: "edit"; projectId: string }

/**
 * Create a project (optionally linked to a GitHub repository, whose issues are
 * imported into it), or rename and recolor one.
 */
export const ProjectDialog = (props: { mode: ProjectDialogMode | null; onClose: () => void }) => {
  const sync = useContext(Sync)
  const navigate = useNavigate()
  const team = () => firstTeam(sync.state)
  const editing = () => (props.mode?.kind === "edit" ? sync.state.projects[props.mode.projectId] : undefined)

  const [name, setName] = createSignal("")
  const [colorValue, setColor] = createSignal(PROJECT_COLORS[0]!)
  const [repo, setRepo] = createSignal<GithubAvailableRepo | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  // Fill the form each time the dialog opens.
  createEffect(
    () => props.mode,
    (mode) => {
      if (!mode) return
      const project = mode.kind === "edit" ? sync.state.projects[mode.projectId] : undefined
      const count = team() ? teamProjects(sync.state, team()!.id).length : 0
      setName(project?.name ?? "")
      setColor(project?.color ?? PROJECT_COLORS[count % PROJECT_COLORS.length]!)
      setRepo(null)
      setError(null)
      setBusy(false)
    }
  )

  const submit = async () => {
    const t = team()
    if (!t || busy()) return
    const project = editing()
    const trimmed = name().trim()
    if (project) {
      if (!trimmed) return setError("A project needs a name.")
      sync.mutate({ _tag: "ProjectUpdate", id: project.id, patch: { name: trimmed, color: colorValue() } })
      return props.onClose()
    }
    const picked = repo()
    if (!picked) {
      if (!trimmed) return setError("A project needs a name.")
      const id = uuidv7()
      sync.mutate({ _tag: "ProjectCreate", id, teamId: t.id, name: trimmed, color: colorValue() })
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

  return (
    <Dialog open={props.mode !== null} onClose={props.onClose} label="Project" scope="project-dialog" sx={s.dialog}>
      <form
        {...stylex.attrs(s.form)}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h2 {...stylex.attrs(s.title)}>
          <ProjectIcon size={16} color={colorValue()} />
          {editing() ? "Edit project" : "New project"}
        </h2>
        <label {...stylex.attrs(s.field)}>
          <span {...stylex.attrs(s.label)}>Name</span>
          <Input
            ref={(el: HTMLInputElement) => requestAnimationFrame(() => el.focus())}
            placeholder={repo() ? repo()!.name : "e.g. Website"}
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <div {...stylex.attrs(s.field)}>
          <span {...stylex.attrs(s.label)}>Color</span>
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
                  {...(colorValue() === c ? stylex.attrs(s.swatch, s.swatchOn) : stylex.attrs(s.swatch))}
                >
                  <Show when={colorValue() === c}><CheckIcon size={12} /></Show>
                </button>
              )}
            </For>
          </div>
        </div>
        <Show when={!editing()}>
          <div {...stylex.attrs(s.field)}>
            <span {...stylex.attrs(s.label)}>GitHub repository (optional)</span>
            <GithubRepoPicker
              onPick={setRepo}
              trigger={(attrs) => (
                <button type="button" {...attrs} {...stylex.attrs(s.repoButton)}>
                  <GithubIcon size={14} />
                  <span {...(repo() ? stylex.attrs(s.grow) : stylex.attrs(s.grow, s.muted))}>
                    {repo() ? `${repo()!.owner}/${repo()!.name}` : "Pick a repository to sync with"}
                  </span>
                  <ChevronDownIcon size={14} />
                </button>
              )}
            />
            <Show
              when={repo()}
              fallback={<span {...stylex.attrs(s.hint)}>Its issues are imported into the project and sync both ways.</span>}
            >
              <span {...stylex.attrs(s.hint)}>
                Issues from {repo()!.owner}/{repo()!.name} are imported now.{" "}
                <Button size="sm" variant="ghost" onClick={() => setRepo(null)}><XIcon size={12} /> Remove</Button>
              </span>
            </Show>
          </div>
        </Show>
        <Show when={error()}>{(e) => <div {...stylex.attrs(s.error)}>{e()}</div>}</Show>
        <div {...stylex.attrs(s.footer)}>
          <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy() || (!name().trim() && !repo())}>
            {busy() ? "Importing…" : editing() ? "Save" : "Create project"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
