import type { GithubStatus } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { createMemo, createSignal, For, Show, useContext } from "solid-js"
import { Sync } from "../app/context.ts"
import { firstTeam, formatRelative } from "../lib/select.ts"
import { type ColorTokens, type Preset, presetById, presets } from "../theme/presets.ts"
import { resolveTheme, setTheme, theme } from "../theme/theme.ts"
import { color, font, radius } from "../theme/tokens.stylex.ts"
import { CheckIcon, GithubIcon, PaletteIcon } from "../ui/icons.tsx"
import { Button, Input } from "../ui/kit.tsx"
import { PageHeader } from "./Header.tsx"

const s = stylex.create({
  page: { overflowY: "auto", flexGrow: 1 },
  column: { maxWidth: 760, marginInline: "auto", paddingInline: 32, paddingBlock: 32 },
  section: { marginBottom: 40 },
  h2: { display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: font.lg, fontWeight: 600 },
  lede: { marginTop: 4, marginBottom: 16, color: color.fgMuted, fontSize: font.md },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: color.fg,
    fontFamily: "inherit",
    fontSize: font.md,
    fontWeight: 500,
    textAlign: "left",
    cursor: "pointer"
  },
  swatch: {
    position: "relative",
    height: 84,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    overflow: "hidden",
    display: "grid",
    gridTemplateColumns: "34% 1fr"
  },
  swatchActive: { boxShadow: `0 0 0 2px ${color.accent}`, borderColor: "transparent" },
  check: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    backgroundColor: color.accent,
    color: color.accentFg
  },
  cardName: { display: "flex", alignItems: "center", gap: 6 },
  cardScheme: { color: color.fgSubtle, fontWeight: 400, fontSize: font.sm },
  custom: {
    marginTop: 16,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.panel
  },
  customGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10, marginTop: 12 },
  colorField: { display: "flex", alignItems: "center", gap: 10, fontSize: font.md },
  colorInput: {
    width: 28,
    height: 28,
    padding: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: "transparent",
    cursor: "pointer"
  },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  muted: { color: color.fgMuted, fontSize: font.md },
  subtle: { color: color.fgSubtle, fontSize: font.sm },
  panel: {
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.panel,
    display: "flex",
    flexDirection: "column",
    gap: 12
  },
  statusRow: { display: "flex", alignItems: "center", gap: 8, fontSize: font.md },
  dot: { width: 7, height: 7, borderRadius: "50%" },
  ok: { backgroundColor: "#46a758" },
  off: { backgroundColor: color.fgSubtle },
  bad: { backgroundColor: color.danger },
  repo: { fontWeight: 600, fontSize: font.md },
  error: { color: color.danger, fontSize: font.sm },
  code: {
    display: "block",
    paddingBlock: 8,
    paddingInline: 10,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
    fontFamily: font.mono,
    fontSize: font.sm,
    color: color.fgMuted,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all"
  },
  checkboxLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: font.md, color: color.fgMuted },
  grow: { flexGrow: 1, minWidth: 200 },
  repoInput: { flexGrow: 1, flexBasis: 0, width: "auto", minWidth: 200 }
})

/** A tiny rendering of the app in the preset's colors. */
const Swatch = (props: { colors: ColorTokens; active: boolean }) => (
  <div {...stylex.attrs(s.swatch, props.active && s.swatchActive)} style={{ "background-color": props.colors.bg }}>
    <div style={{ "border-right": `1px solid ${props.colors.border}`, padding: "10px 8px", display: "grid", gap: "5px", "align-content": "start" }}>
      <div style={{ height: "6px", width: "70%", "border-radius": "3px", background: props.colors.fg, opacity: 0.85 }} />
      <div style={{ height: "5px", width: "85%", "border-radius": "3px", background: props.colors.fgSubtle }} />
      <div style={{ height: "5px", width: "60%", "border-radius": "3px", background: props.colors.fgSubtle }} />
    </div>
    <div style={{ padding: "10px", display: "grid", gap: "6px", "align-content": "start", background: props.colors.panel }}>
      <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
        <div style={{ height: "6px", width: "45%", "border-radius": "3px", background: props.colors.fg }} />
        <div style={{ height: "10px", width: "22%", "border-radius": "4px", background: props.colors.accent }} />
      </div>
      <For each={[0.9, 0.7, 0.8]}>
        {(w) => (
          <div style={{ display: "flex", gap: "5px", "align-items": "center", "border-top": `1px solid ${props.colors.border}`, "padding-top": "5px" }}>
            <div style={{ width: "6px", height: "6px", "border-radius": "50%", border: `1.5px solid ${props.colors.fgMuted}` }} />
            <div style={{ height: "4px", width: `${w * 70}%`, "border-radius": "2px", background: props.colors.fgMuted }} />
          </div>
        )}
      </For>
    </div>
  </div>
)

const EDITABLE: ReadonlyArray<{ key: keyof ColorTokens; label: string }> = [
  { key: "bg", label: "Background" },
  { key: "panel", label: "Surface" },
  { key: "subtle", label: "Subtle surface" },
  { key: "border", label: "Border" },
  { key: "fg", label: "Text" },
  { key: "fgMuted", label: "Muted text" },
  { key: "accent", label: "Accent" },
  { key: "accentFg", label: "Text on accent" }
]

const Appearance = () => {
  const current = () => theme()
  const resolved = createMemo(() => resolveTheme(current()))
  const activeId = () => {
    const t = current()
    return t.kind === "system" ? "system" : t.kind === "preset" ? t.id : "custom"
  }
  const pick = (preset: Preset | "system") => setTheme(preset === "system" ? { kind: "system" } : { kind: "preset", id: preset.id })
  const customize = () => {
    const { preset, colors } = resolved()
    setTheme({ kind: "custom", base: preset.id, colors: { accent: colors.accent } })
  }
  const setColor = (key: keyof ColorTokens, value: string) => {
    const t = current()
    if (t.kind !== "custom") return
    setTheme({ ...t, colors: { ...t.colors, [key]: value } })
  }
  const toHex = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : "#888888")

  return (
    <section {...stylex.attrs(s.section)}>
      <h2 {...stylex.attrs(s.h2)}><PaletteIcon size={16} /> Appearance</h2>
      <p {...stylex.attrs(s.lede)}>Pick a preset, or start from one and change any color. Saved in this browser.</p>
      <div {...stylex.attrs(s.grid)}>
        <button type="button" onClick={() => pick("system")} {...stylex.attrs(s.card)}>
          <div style={{ position: "relative" }}>
            <Swatch colors={resolveTheme({ kind: "system" }).colors} active={activeId() === "system"} />
            <Show when={activeId() === "system"}><span {...stylex.attrs(s.check)}><CheckIcon size={11} /></span></Show>
          </div>
          <span {...stylex.attrs(s.cardName)}>System <span {...stylex.attrs(s.cardScheme)}>Paper / Graphite</span></span>
        </button>
        <For each={presets}>
          {(preset) => (
            <button type="button" onClick={() => pick(preset)} {...stylex.attrs(s.card)}>
              <div style={{ position: "relative" }}>
                <Swatch colors={preset.colors} active={activeId() === preset.id} />
                <Show when={activeId() === preset.id}><span {...stylex.attrs(s.check)}><CheckIcon size={11} /></span></Show>
              </div>
              <span {...stylex.attrs(s.cardName)}>{preset.name} <span {...stylex.attrs(s.cardScheme)}>{preset.scheme}</span></span>
            </button>
          )}
        </For>
      </div>
      <div {...stylex.attrs(s.custom)}>
        <div {...stylex.attrs(s.row)}>
          <div {...stylex.attrs(s.grow)}>
            <div style={{ "font-weight": 600, "font-size": "13px" }}>Custom colors</div>
            <div {...stylex.attrs(s.subtle)}>
              <Show when={current().kind === "custom"} fallback={"Start from the current theme and tweak it."}>
                Based on {presetById((current() as { base: string }).base)?.name}.
              </Show>
            </div>
          </div>
          <Show
            when={current().kind === "custom"}
            fallback={<Button onClick={customize}>Customize</Button>}
          >
            <Button variant="ghost" onClick={() => pick(resolved().preset)}>Reset to {resolved().preset.name}</Button>
          </Show>
        </div>
        <Show when={current().kind === "custom"}>
          <div {...stylex.attrs(s.customGrid)}>
            <For each={EDITABLE}>
              {(field) => (
                <label {...stylex.attrs(s.colorField)}>
                  <input
                    type="color"
                    value={toHex(resolved().colors[field.key])}
                    onInput={(e) => setColor(field.key, e.currentTarget.value)}
                    {...stylex.attrs(s.colorInput)}
                  />
                  {field.label}
                </label>
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  )
}

const GithubSettings = () => {
  const sync = useContext(Sync)
  const team = () => firstTeam(sync.state)
  const repo = () => Object.values(sync.state.githubRepos).find((r) => r.teamId === team()?.id)
  const [status, setStatus] = createSignal<GithubStatus | null>(null)
  const [target, setTarget] = createSignal("")
  const [pushExisting, setPushExisting] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal<{ error: boolean; text: string } | null>(null)

  sync.call((c) => c.GithubStatus()).then(setStatus, () => setStatus(null))

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setMessage(null)
    try {
      setMessage({ error: false, text: await work() })
    } catch (e) {
      setMessage({ error: true, text: (e as { message?: string }).message ?? String(e) })
    } finally {
      setBusy(false)
    }
  }

  const link = () => {
    const [owner, name] = target().trim().replace(/^https?:\/\/github\.com\//, "").split("/")
    const t = team()
    if (!owner || !name || !t) return setMessage({ error: true, text: "Use the form owner/name." })
    return run(async () => {
      const result = await sync.call((c) => c.GithubLinkRepo({ teamId: t.id, owner, name, pushExisting: pushExisting() }))
      setTarget("")
      return `Linked. Imported ${result.imported} issue${result.imported === 1 ? "" : "s"}${result.pushed ? `, created ${result.pushed} on GitHub` : ""}.`
    })
  }

  return (
    <section {...stylex.attrs(s.section)}>
      <h2 {...stylex.attrs(s.h2)}><GithubIcon size={16} /> GitHub</h2>
      <p {...stylex.attrs(s.lede)}>
        Link the team to one repository. Issues sync both ways: title, description, open/closed, labels and assignee.
      </p>
      <div {...stylex.attrs(s.panel)}>
        <div {...stylex.attrs(s.statusRow)}>
          <span {...stylex.attrs(s.dot, status()?.tokenSource ? s.ok : s.off)} />
          <Show when={status()?.tokenSource} fallback={<span>No GitHub token. Set <code>GITHUB_TOKEN</code> or run <code>gh auth login</code>, then restart the server.</span>}>
            <span>
              Connected{status()?.login ? ` as @${status()?.login}` : ""} · token from {status()?.tokenSource === "env" ? "GITHUB_TOKEN" : "gh CLI"}
            </span>
          </Show>
        </div>
        <Show
          when={repo()}
          fallback={
            <>
              <div {...stylex.attrs(s.row)}>
                <Input
                  placeholder="owner/repository"
                  value={target()}
                  onInput={(e) => setTarget(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && link()}
                  sx={s.repoInput}
                />
                <Button variant="primary" disabled={busy() || !status()?.tokenSource} onClick={link}>
                  {busy() ? "Linking…" : "Link repository"}
                </Button>
              </div>
              <label {...stylex.attrs(s.checkboxLabel)}>
                <input type="checkbox" checked={pushExisting()} onChange={(e) => setPushExisting(e.currentTarget.checked)} />
                Also create this team's existing issues on GitHub
              </label>
            </>
          }
        >
          {(r) => (
            <>
              <div {...stylex.attrs(s.row)}>
                <span {...stylex.attrs(s.dot, r().lastError ? s.bad : s.ok)} />
                <a href={`https://github.com/${r().owner}/${r().name}`} target="_blank" rel="noreferrer" {...stylex.attrs(s.repo)}>
                  {r().owner}/{r().name}
                </a>
                <span {...stylex.attrs(s.subtle)}>
                  {r().lastSyncedAt ? `synced ${formatRelative(r().lastSyncedAt!)}` : "not synced yet"}
                </span>
                <span {...stylex.attrs(s.grow)} />
                <Button size="sm" disabled={busy()} onClick={() => run(async () => (await sync.call((c) => c.GithubSyncNow({ repoId: r().id })), "Synced."))}>
                  Sync now
                </Button>
                <Button size="sm" variant="danger" disabled={busy()} onClick={() => confirm(`Unlink ${r().owner}/${r().name}? Issues stay in Gradient.`) && run(async () => (await sync.call((c) => c.GithubUnlinkRepo({ repoId: r().id })), "Unlinked."))}>
                  Unlink
                </Button>
              </div>
              <Show when={r().lastError}>{(e) => <div {...stylex.attrs(s.error)}>{e()}</div>}</Show>
              <div {...stylex.attrs(s.subtle)}>
                Changes from GitHub arrive every {status()?.pollIntervalSeconds ?? 15}s. For instant updates, forward webhooks
                {status()?.webhookSecretSet ? "" : " (set GITHUB_WEBHOOK_SECRET first)"}:
              </div>
              <code {...stylex.attrs(s.code)}>
                gh webhook forward --repo={r().owner}/{r().name} --events=issues --url=http://localhost:4100/webhooks/github --secret=$GITHUB_WEBHOOK_SECRET
              </code>
            </>
          )}
        </Show>
        <Show when={message()}>
          {(m) => <div {...stylex.attrs(m().error ? s.error : s.muted)}>{m().text}</div>}
        </Show>
      </div>
    </section>
  )
}

export const SettingsPage = () => (
  <>
    <PageHeader title="Settings" />
    <div {...stylex.attrs(s.page)}>
      <div {...stylex.attrs(s.column)}>
        <Appearance />
        <GithubSettings />
      </div>
    </div>
  </>
)
