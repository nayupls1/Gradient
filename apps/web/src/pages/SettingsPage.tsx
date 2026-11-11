import type { GithubStatus } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { useNavigate } from "@solidjs/router"
import { createMemo, createSignal, For, onSettled, Show, useContext } from "solid-js"
import { Sync } from "../app/context.ts"
import { github } from "../app/github.ts"
import { agentCommands, useMcpUrl } from "../app/agents.ts"
import { GithubRepoPicker } from "../app/GithubRepoPicker.tsx"
import { ProjectGlyph } from "../app/ProjectGlyph.tsx"
import { firstTeam, formatRelative, projectHref } from "../lib/select.ts"
import type { JSX } from "@solidjs/web"
import { type ColorTokens, paletteById, palettes } from "../theme/presets.ts"
import { activeScheme, type Mode, resolveColors, theme, updateTheme } from "../theme/theme.ts"
import { color, font, radius } from "../theme/tokens.stylex.ts"
import { UserAvatar } from "../app/UserAvatar.tsx"
import { Button, type ButtonProps } from "../ui/button.tsx"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx"
import { BotIcon, CheckIcon, CopyIcon, ExternalIcon, GithubIcon, MonitorIcon, MoonIcon, PaletteIcon, SunIcon } from "../ui/icons.tsx"
import { Input } from "../ui/input.tsx"
import { Label } from "../ui/label.tsx"
import { Separator } from "../ui/separator.tsx"
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx"
import { PageHeader } from "./Header.tsx"

const s = stylex.create({
  page: { overflowY: "auto", flexGrow: 1 },
  column: { maxWidth: 760, marginInline: "auto", paddingInline: 32, paddingBlock: 32 },
  section: { marginBottom: 40 },
  h2: { display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: font.lg, fontWeight: 600 },
  lede: { marginTop: 4, marginBottom: 16, color: color.fgMuted, fontSize: font.md },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(124px, 1fr))", gap: 12 },
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
    height: 76,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    overflow: "hidden",
    display: "grid",
    gridTemplateColumns: "1fr 1fr"
  },
  fieldLabel: { display: "block", marginBottom: 8, marginTop: 4, color: color.fgMuted },
  modes: { marginBottom: 20 },
  agentRow: { display: "flex", alignItems: "center", gap: 10 },
  agentName: { width: 96, flexShrink: 0, fontSize: font.md, fontWeight: 500 },
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
  custom: { marginTop: 16 },
  customGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 },
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
  account: { display: "flex", alignItems: "center", gap: 10 },
  accountName: { fontSize: font.md, fontWeight: 600 },
  device: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: color.subtle
  },
  userCode: { fontFamily: font.mono, fontSize: 20, fontWeight: 600, letterSpacing: "0.12em", color: color.fg },
  repoList: {
    display: "flex",
    flexDirection: "column",
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    maxHeight: 240,
    overflowY: "auto"
  },
  repoRowStack: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: color.border
  },
  projectLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: color.fgMuted,
    fontSize: font.sm,
    textDecoration: "none",
    whiteSpace: "nowrap"
  },
  nowrap: { whiteSpace: "nowrap", flexShrink: 0 },
  repoName: { fontWeight: 600, fontSize: font.md, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 },
  spacer: { flexGrow: 1 },
  repoRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBlock: 6,
    paddingInline: 10
  },
  link: { display: "inline-flex", alignItems: "center", gap: 4, color: color.accent, fontSize: font.md, textDecoration: "none" },
  repoInput: { flexGrow: 1, flexBasis: 0, width: "auto", minWidth: 200 },
  webhooks: { display: "flex", flexDirection: "column", gap: 8 },
  webhooksTrigger: { textAlign: "left", cursor: "pointer" }
})

/** A tiny rendering of the app in one palette and scheme. */
const Swatch = (props: { colors: ColorTokens }) => (
  <div style={{ display: "grid", "grid-template-columns": "30% 1fr", height: "100%", "background-color": props.colors.bg }}>
    <div style={{ "border-right": `1px solid ${props.colors.border}`, padding: "9px 7px", display: "grid", gap: "5px", "align-content": "start" }}>
      <div style={{ height: "5px", width: "70%", "border-radius": "3px", background: props.colors.fg, opacity: 0.85 }} />
      <div style={{ height: "4px", width: "85%", "border-radius": "3px", background: props.colors.fgSubtle }} />
      <div style={{ height: "4px", width: "60%", "border-radius": "3px", background: props.colors.fgSubtle }} />
    </div>
    <div style={{ padding: "9px", display: "grid", gap: "6px", "align-content": "start", background: props.colors.panel }}>
      <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
        <div style={{ height: "5px", width: "45%", "border-radius": "3px", background: props.colors.fg }} />
        <div style={{ height: "9px", width: "22%", "border-radius": "4px", background: props.colors.accent }} />
      </div>
      <For each={[0.9, 0.7]}>
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

const MODES: ReadonlyArray<{ value: Mode; label: string; icon: () => JSX.Element }> = [
  { value: "system", label: "System", icon: () => <MonitorIcon size={14} /> },
  { value: "light", label: "Light", icon: () => <SunIcon size={14} /> },
  { value: "dark", label: "Dark", icon: () => <MoonIcon size={14} /> }
]

const Appearance = () => {
  const scheme = () => activeScheme()
  const colors = createMemo(() => resolveColors(theme(), scheme()))
  const customized = () => Object.keys(theme().custom[scheme()]).length > 0
  const setColor = (key: keyof ColorTokens, value: string) =>
    updateTheme((t) => ({ ...t, custom: { ...t.custom, [scheme()]: { ...t.custom[scheme()], [key]: value } } }))
  const resetColors = () => updateTheme((t) => ({ ...t, custom: { ...t.custom, [scheme()]: {} } }))
  const toHex = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : "#888888")

  return (
    <section {...stylex.attrs(s.section)}>
      <h2 {...stylex.attrs(s.h2)}><PaletteIcon size={16} /> Appearance</h2>
      <p {...stylex.attrs(s.lede)}>Mode and palette are separate: every palette has a light and a dark version. Saved in this browser.</p>

      <Label xstyle={s.fieldLabel}>Mode</Label>
      <ToggleGroup
        variant="outline"
        size="sm"
        aria-label="Mode"
        xstyle={s.modes}
        value={[theme().mode]}
        onValueChange={(value: ReadonlyArray<string>) => {
          const mode = value[0] as Mode | undefined
          if (mode) updateTheme((t) => ({ ...t, mode }))
        }}
      >
        <For each={MODES}>
          {(m) => (
            <ToggleGroupItem value={m.value}>
              {m.icon()}
              {m.label}
            </ToggleGroupItem>
          )}
        </For>
      </ToggleGroup>

      <Label xstyle={s.fieldLabel}>Palette</Label>
      <div {...stylex.attrs(s.grid)}>
        <For each={palettes}>
          {(palette) => (
            <button type="button" onClick={() => updateTheme((t) => ({ ...t, palette: palette.id }))} {...stylex.attrs(s.card)}>
              <div {...stylex.attrs(s.swatch, theme().palette === palette.id && s.swatchActive)}>
                <Swatch colors={palette.light} />
                <Swatch colors={palette.dark} />
                <Show when={theme().palette === palette.id}>
                  <span {...stylex.attrs(s.check)}><CheckIcon size={11} /></span>
                </Show>
              </div>
              <span>{palette.name}</span>
            </button>
          )}
        </For>
      </div>

      <Card size="sm" xstyle={s.custom}>
        <CardHeader>
          <CardTitle>Custom colors</CardTitle>
          <CardDescription>Changes apply to the {scheme()} version of {paletteById(theme().palette).name}.</CardDescription>
          <Show when={customized()}>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={resetColors}>Reset</Button>
            </CardAction>
          </Show>
        </CardHeader>
        <CardContent>
          <div {...stylex.attrs(s.customGrid)}>
            <For each={EDITABLE}>
              {(field) => (
                <label {...stylex.attrs(s.colorField)}>
                  <input
                    type="color"
                    value={toHex(colors()[field.key])}
                    onInput={(e) => setColor(field.key, e.currentTarget.value)}
                    {...stylex.attrs(s.colorInput)}
                  />
                  {field.label}
                </label>
              )}
            </For>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

/** The one-liners that connect a coding agent to this Gradient over MCP. */
const Agents = () => {
  const url = useMcpUrl()
  const commands = createMemo(() => agentCommands(url(), null))
  const [copied, setCopied] = createSignal<string | null>(null)
  const copy = async (text: string) => {
    await navigator.clipboard?.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied(null), 1500)
  }
  return (
    <section {...stylex.attrs(s.section)}>
      <h2 {...stylex.attrs(s.h2)}><BotIcon size={16} /> Agents</h2>
      <p {...stylex.attrs(s.lede)}>
        Gradient is an MCP server. Agents read and change issues through the same sync engine as this app, so their edits show up here live.
        Each agent needs an agent key: <a href="/profile" {...stylex.attrs(s.link)}>create one on your profile</a>, which fills it into these commands.
      </p>
      <Card size="sm">
        <CardContent>
        <For each={commands()} keyed={(c) => c.name}>
          {(entry) => (
            <div {...stylex.attrs(s.agentRow)}>
              <span {...stylex.attrs(s.agentName)}>{entry().name}</span>
              <code {...stylex.attrs(s.code, s.grow)}>{entry().command}</code>
              <Button size="icon-sm" variant="ghost" title="Copy" onClick={() => copy(entry().command)}>
                <Show when={copied() === entry().command} fallback={<CopyIcon size={14} />}>
                  <CheckIcon size={14} />
                </Show>
              </Button>
            </div>
          )}
        </For>
        <div {...stylex.attrs(s.subtle)}>
          Tools: list, get, create and update issues, create projects (optionally from a GitHub repo), describe the workspace, and check or start the GitHub sign-in. The server also publishes a Gradient skill with the conventions agents should follow.
        </div>
        </CardContent>
      </Card>
    </section>
  )
}

const VIA: Record<NonNullable<GithubStatus["tokenSource"]>, string> = {
  app: "Through the Gradient GitHub App. Gradient sees only the repositories you install it on.",
  env: "Using the token from GITHUB_TOKEN.",
  "gh-cli": "Using your GitHub CLI login."
}

const minutesLeft = (expiresAt: number) => Math.max(1, Math.round((expiresAt - Date.now()) / 60_000))

/** The account Gradient talks to GitHub as, and the device-flow sign-in. */
const GithubAccount = () => {
  const sync = useContext(Sync)
  const status = () => github.status()
  const connected = () => status()?.tokenSource != null
  const [copied, setCopied] = createSignal(false)
  const copyCode = (code: string) => {
    void navigator.clipboard?.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const description = () => {
    const st = status()
    if (!st) return "Checking the connection…"
    if (st.tokenSource) {
      return VIA[st.tokenSource] + (st.tokenSource !== "app" && st.signIn.available ? " Sign in to use the Gradient app instead." : "")
    }
    return st.signIn.available
      ? "Sign in to sync issues with your repositories."
      : "Set GITHUB_TOKEN or run gh auth login, then restart the server. Sign-in with GitHub needs GITHUB_APP_CLIENT_ID."
  }

  return (
    <>
      <div {...stylex.attrs(s.account)}>
        <Show when={status()?.login} fallback={<span {...stylex.attrs(s.dot, s.off)} />}>
          {(login) => <UserAvatar name={login()} src={status()?.avatarUrl ?? null} size={24} />}
        </Show>
        <div {...stylex.attrs(s.grow)}>
          <div {...stylex.attrs(s.accountName)}>
            <Show when={connected()} fallback="Not connected to GitHub">
              {status()?.tokenSource === "app" ? "Signed in" : "Connected"}
              {status()?.login ? ` as @${status()?.login}` : ""}
            </Show>
          </div>
          <div {...stylex.attrs(s.subtle)}>{description()}</div>
        </div>
        <Show when={status()?.tokenSource === "app"}>
          <Button size="xs" variant="ghost" onClick={() => void github.signOut(sync)}>Sign out</Button>
        </Show>
        <Show when={status()?.signIn.available && status()?.tokenSource !== "app" && !status()?.signIn.pending}>
          <Button size="sm" variant={connected() ? "outline" : "default"} onClick={() => void github.signIn(sync)}>
            <GithubIcon size={14} /> Sign in with GitHub
          </Button>
        </Show>
      </div>
      <Show when={status()?.signIn.pending}>
        {(pending) => (
          <div {...stylex.attrs(s.device)}>
            <div {...stylex.attrs(s.subtle)}>Enter this code on GitHub to sign in</div>
            <div {...stylex.attrs(s.row)}>
              <code {...stylex.attrs(s.userCode)}>{pending().userCode}</code>
              <Button size="icon-sm" variant="ghost" title="Copy code" onClick={() => copyCode(pending().userCode)}>
                <Show when={copied()} fallback={<CopyIcon size={14} />}><CheckIcon size={14} /></Show>
              </Button>
              <span {...stylex.attrs(s.grow)} />
              <Button
                size="sm"
                onClick={() => {
                  copyCode(pending().userCode)
                  window.open(pending().verificationUri, "_blank", "noopener")
                }}
              >
                Copy code and open GitHub <ExternalIcon size={14} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void github.cancel(sync)}>Cancel</Button>
            </div>
            <div {...stylex.attrs(s.subtle)}>
              Waiting for you to approve Gradient on GitHub. The code expires in {minutesLeft(pending().expiresAt)} min.
            </div>
          </div>
        )}
      </Show>
      <Show when={github.error() ?? status()?.notice}>
        {(text) => <div {...stylex.attrs(s.error)}>{text()}</div>}
      </Show>
    </>
  )
}

const GithubSettings = () => {
  const sync = useContext(Sync)
  const navigate = useNavigate()
  const url = useMcpUrl()
  const team = () => firstTeam(sync.state)
  const repos = () => Object.values(sync.state.githubRepos).sort((a, b) => a.createdAt - b.createdAt)
  const status = () => github.status()
  const connected = () => status()?.tokenSource != null
  const [target, setTarget] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal<{ error: boolean; text: string } | null>(null)

  onSettled(() => {
    // Pick up a sign-in that is already waiting (started by an agent, or before a reload),
    // and refresh when coming back from installing the app on github.com.
    const load = () =>
      github.refresh(sync).then((current) => {
        if (current?.signIn.pending) void github.wait(sync)
        void github.loadRepos(sync, current)
      })
    void load()
    window.addEventListener("focus", load)
    return () => window.removeEventListener("focus", load)
  })

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

  /** Link a repository into a new project named after it, then open that project. */
  const linkRepo = (owner: string, name: string) => {
    const t = team()
    if (!t) return
    return run(async () => {
      const result = await github.linkRepo(sync, { teamId: t.id, projectId: null, owner, name, pushExisting: false })
      setTarget("")
      navigate(projectHref(result.projectId))
      return `Linked ${owner}/${name}. Imported ${result.imported} issue${result.imported === 1 ? "" : "s"}.`
    })
  }
  const linkTyped = () => {
    const [owner, name] = target().trim().replace(/^https?:\/\/github\.com\//, "").split("/")
    if (!owner || !name) return setMessage({ error: true, text: "Use the form owner/name." })
    return linkRepo(owner, name)
  }

  return (
    <section {...stylex.attrs(s.section)}>
      <h2 {...stylex.attrs(s.h2)}><GithubIcon size={16} /> GitHub</h2>
      <p {...stylex.attrs(s.lede)}>
        Each project can sync with one repository: title, description, open/closed, labels and assignee, both ways.
      </p>
      <Card size="sm">
        <CardContent>
        <GithubAccount />
        <Separator />
        <Label xstyle={s.fieldLabel}>Linked repositories</Label>
        <Show
          when={repos().length > 0}
          fallback={<div {...stylex.attrs(s.subtle)}>None yet. Link one below, or from a project's header.</div>}
        >
          <div {...stylex.attrs(s.repoList)}>
            <For each={repos()} keyed={(r) => r.id}>
              {(r) => {
                const project = () => sync.state.projects[r().projectId]
                return (
                  <div {...stylex.attrs(s.repoRowStack)}>
                    <div {...stylex.attrs(s.repoRow)}>
                      <span {...stylex.attrs(s.dot, r().lastError ? s.bad : s.ok)} />
                      <a href={`https://github.com/${r().owner}/${r().name}`} target="_blank" rel="noreferrer" {...stylex.attrs(s.repoName)}>
                        {r().owner}/{r().name}
                      </a>
                      <Show when={project()}>
                        {(p) => (
                          <a href={projectHref(p().id)} {...stylex.attrs(s.projectLink)}>
                            <ProjectGlyph project={p()} size={13} />
                            {p().name}
                          </a>
                        )}
                      </Show>
                      <span {...stylex.attrs(s.subtle, s.nowrap)}>
                        {r().lastSyncedAt ? `synced ${formatRelative(r().lastSyncedAt!)}` : "not synced yet"}
                      </span>
                      <span {...stylex.attrs(s.spacer)} />
                      <Button size="xs" variant="ghost" disabled={busy()} onClick={() => run(async () => (await sync.call((c) => c.GithubSyncNow({ repoId: r().id })), `Synced ${r().owner}/${r().name}.`))}>
                        Sync now
                      </Button>
                      <Button size="xs" variant="destructive" disabled={busy()} onClick={() => confirm(`Unlink ${r().owner}/${r().name}? Issues stay in their project.`) && run(async () => (await sync.call((c) => c.GithubUnlinkRepo({ repoId: r().id })), "Unlinked."))}>
                        Unlink
                      </Button>
                    </div>
                    <Show when={r().lastError}>{(e) => <div {...stylex.attrs(s.error)}>{e()}</div>}</Show>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>

        <Label xstyle={s.fieldLabel}>Link a repository</Label>
        <div {...stylex.attrs(s.row)}>
          <GithubRepoPicker
            onPick={(r) => void linkRepo(r.owner, r.name)}
            trigger={(p) => (
              <Button {...(p as ButtonProps)} size="sm" disabled={busy() || !connected()}>
                <GithubIcon size={14} /> {busy() ? "Importing…" : "Choose a repository"}
              </Button>
            )}
          />
          <span {...stylex.attrs(s.subtle)}>Creates a project named after it and imports its issues.</span>
        </div>
        <Show when={status()?.tokenSource === "app" && status()?.signIn.installUrl}>
          {(href) => (
            <div {...stylex.attrs(s.subtle)}>
              Missing one? The Gradient app only sees repositories it is installed on.{" "}
              <a href={href()} target="_blank" rel="noreferrer" {...stylex.attrs(s.link)}>
                Install on more repositories <ExternalIcon size={13} />
              </a>
            </div>
          )}
        </Show>
        <div {...stylex.attrs(s.row)}>
          <Input
            placeholder="or type owner/repository"
            value={target()}
            onInput={(e) => setTarget(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && linkTyped()}
            xstyle={s.repoInput}
          />
          <Button variant="outline" disabled={busy() || !connected() || !target().trim()} onClick={linkTyped}>Link</Button>
        </div>
        <Show when={message()}>
          {(m) => <div {...stylex.attrs(m().error ? s.error : s.muted)}>{m().text}</div>}
        </Show>

        <Show when={repos().length > 0}>
          <Collapsible xstyle={s.webhooks}>
            <CollapsibleTrigger xstyle={[s.subtle, s.webhooksTrigger]}>
              Changes from GitHub arrive every {status()?.pollIntervalSeconds ?? 15}s. Instant updates with webhooks…
            </CollapsibleTrigger>
            <CollapsibleContent xstyle={s.webhooks}>
              <div {...stylex.attrs(s.subtle)}>
                {status()?.webhookSecretSet ? "Forward each repository's webhooks:" : "Set GITHUB_WEBHOOK_SECRET, restart, then forward each repository's webhooks:"}
              </div>
              <For each={repos()} keyed={(r) => r.id}>
                {(r) => (
                  <code {...stylex.attrs(s.code)}>
                    gh webhook forward --repo={r().owner}/{r().name} --events=issues --url={url().replace(/\/mcp$/, "")}/webhooks/github --secret=$GITHUB_WEBHOOK_SECRET
                  </code>
                )}
              </For>
            </CollapsibleContent>
          </Collapsible>
        </Show>
        </CardContent>
      </Card>
    </section>
  )
}

export const SettingsPage = () => (
  <>
    <PageHeader title="Settings" />
    <div {...stylex.attrs(s.page)}>
      <div {...stylex.attrs(s.column)}>
        <Appearance />
        <Agents />
        <GithubSettings />
      </div>
    </div>
  </>
)
