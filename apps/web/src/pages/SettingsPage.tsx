import type { GithubStatus } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { createMemo, createSignal, For, onSettled, Show, useContext } from "solid-js"
import { Sync } from "../app/context.ts"
import { github } from "../app/github.ts"
import { firstTeam, formatRelative } from "../lib/select.ts"
import type { JSX } from "@solidjs/web"
import { type ColorTokens, paletteById, palettes } from "../theme/presets.ts"
import { activeScheme, type Mode, resolveColors, theme, updateTheme } from "../theme/theme.ts"
import { color, font, radius } from "../theme/tokens.stylex.ts"
import { BotIcon, CheckIcon, CopyIcon, ExternalIcon, GithubIcon, MonitorIcon, MoonIcon, PaletteIcon, SunIcon } from "../ui/icons.tsx"
import { Avatar, Button, Input } from "../ui/kit.tsx"
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
  fieldLabel: { marginBottom: 8, marginTop: 4, color: color.fgMuted, fontSize: font.sm, fontWeight: 500 },
  segmented: {
    display: "inline-flex",
    padding: 2,
    gap: 2,
    marginBottom: 20,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.subtle
  },
  segment: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 26,
    paddingInline: 10,
    borderRadius: 4,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: color.fgMuted, ":hover": color.fg },
    fontFamily: "inherit",
    fontSize: font.md,
    fontWeight: 500,
    cursor: "pointer"
  },
  segmentOn: { backgroundColor: color.panel, color: color.fg, boxShadow: `0 1px 2px ${color.shadow}` },
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
  account: { display: "flex", alignItems: "center", gap: 10 },
  accountName: { fontSize: font.md, fontWeight: 600 },
  divider: { height: 1, backgroundColor: color.border, marginInline: -16 },
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
  repoRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBlock: 6,
    paddingInline: 10,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: color.border
  },
  link: { display: "inline-flex", alignItems: "center", gap: 4, color: color.accent, fontSize: font.md, textDecoration: "none" },
  repoInput: { flexGrow: 1, flexBasis: 0, width: "auto", minWidth: 200 }
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

      <div {...stylex.attrs(s.fieldLabel)}>Mode</div>
      <div {...stylex.attrs(s.segmented)} role="radiogroup" aria-label="Mode">
        <For each={MODES}>
          {(m) => (
            <button
              type="button"
              role="radio"
              aria-checked={theme().mode === m.value ? "true" : "false"}
              onClick={() => updateTheme((t) => ({ ...t, mode: m.value }))}
              {...stylex.attrs(s.segment, theme().mode === m.value && s.segmentOn)}
            >
              {m.icon()}
              {m.label}
            </button>
          )}
        </For>
      </div>

      <div {...stylex.attrs(s.fieldLabel)}>Palette</div>
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

      <div {...stylex.attrs(s.custom)}>
        <div {...stylex.attrs(s.row)}>
          <div {...stylex.attrs(s.grow)}>
            <div style={{ "font-weight": 600, "font-size": "13px" }}>Custom colors</div>
            <div {...stylex.attrs(s.subtle)}>
              Changes apply to the {scheme()} version of {paletteById(theme().palette).name}.
            </div>
          </div>
          <Show when={customized()}>
            <Button variant="ghost" onClick={resetColors}>Reset</Button>
          </Show>
        </div>
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
      </div>
    </section>
  )
}

/** The server's MCP URL, from the server itself (it knows its host and port). */
const useMcpUrl = () => {
  const sync = useContext(Sync)
  const [url, setUrl] = createSignal("http://127.0.0.1:4100/mcp")
  sync.call((c) => c.ServerInfo()).then((info) => setUrl(info.mcpUrl), () => {})
  return url
}

/** The one-liners that connect a coding agent to this Gradient over MCP. */
const Agents = () => {
  const url = useMcpUrl()
  const commands = createMemo(() => [
    { name: "Claude Code", command: `claude mcp add --transport http --scope user gradient ${url()}` },
    { name: "Codex", command: `codex mcp add gradient --url ${url()}` }
  ])
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
      </p>
      <div {...stylex.attrs(s.panel)}>
        <For each={commands()} keyed={(c) => c.name}>
          {(entry) => (
            <div {...stylex.attrs(s.agentRow)}>
              <span {...stylex.attrs(s.agentName)}>{entry().name}</span>
              <code {...stylex.attrs(s.code, s.grow)}>{entry().command}</code>
              <Button size="icon" variant="ghost" title="Copy" onClick={() => copy(entry().command)}>
                <Show when={copied() === entry().command} fallback={<CopyIcon size={14} />}>
                  <CheckIcon size={14} />
                </Show>
              </Button>
            </div>
          )}
        </For>
        <div {...stylex.attrs(s.subtle)}>
          Tools: list, get, create and update issues, describe the workspace (states, labels, people), and check or start the GitHub sign-in. The server also publishes a Gradient skill with the conventions agents should follow.
        </div>
      </div>
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
          {(login) => <Avatar name={login()} src={status()?.avatarUrl ?? null} size={24} />}
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
          <Button size="sm" variant="ghost" onClick={() => void github.signOut(sync)}>Sign out</Button>
        </Show>
        <Show when={status()?.signIn.available && status()?.tokenSource !== "app" && !status()?.signIn.pending}>
          <Button size="sm" variant={connected() ? "default" : "primary"} onClick={() => void github.signIn(sync)}>
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
              <Button size="icon" variant="ghost" title="Copy code" onClick={() => copyCode(pending().userCode)}>
                <Show when={copied()} fallback={<CopyIcon size={14} />}><CheckIcon size={14} /></Show>
              </Button>
              <span {...stylex.attrs(s.grow)} />
              <Button
                variant="primary"
                onClick={() => {
                  copyCode(pending().userCode)
                  window.open(pending().verificationUri, "_blank", "noopener")
                }}
              >
                Copy code and open GitHub <ExternalIcon size={14} />
              </Button>
              <Button variant="ghost" onClick={() => void github.cancel(sync)}>Cancel</Button>
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
  const url = useMcpUrl()
  const team = () => firstTeam(sync.state)
  const repo = () => Object.values(sync.state.githubRepos).find((r) => r.teamId === team()?.id)
  const status = () => github.status()
  const connected = () => status()?.tokenSource != null
  const viaApp = () => status()?.tokenSource === "app"
  const [target, setTarget] = createSignal("")
  const [pushExisting, setPushExisting] = createSignal(false)
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

  const linkRepo = (owner: string, name: string) => {
    const t = team()
    if (!t) return
    return run(async () => {
      const result = await sync.call((c) => c.GithubLinkRepo({ teamId: t.id, owner, name, pushExisting: pushExisting() }))
      setTarget("")
      return `Linked. Imported ${result.imported} issue${result.imported === 1 ? "" : "s"}${result.pushed ? `, created ${result.pushed} on GitHub` : ""}.`
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
        Link the team to one repository. Issues sync both ways: title, description, open/closed, labels and assignee.
      </p>
      <div {...stylex.attrs(s.panel)}>
        <GithubAccount />
        <div {...stylex.attrs(s.divider)} />
        <Show
          when={repo()}
          fallback={
            <>
              <Show when={viaApp()}>
                <div {...stylex.attrs(s.fieldLabel)}>Repositories Gradient can access</div>
                <Show
                  when={github.repos()}
                  fallback={<div {...stylex.attrs(github.reposError() ? s.error : s.subtle)}>{github.reposError() ?? "Loading…"}</div>}
                >
                  {(list) => (
                    <Show
                      when={list().length > 0}
                      fallback={
                        <div {...stylex.attrs(s.subtle)}>
                          The Gradient app is not installed on any repository yet. Install it, then come back here.
                        </div>
                      }
                    >
                      <div {...stylex.attrs(s.repoList)}>
                        <For each={list()} keyed={(r) => `${r.owner}/${r.name}`}>
                          {(r) => (
                            <div {...stylex.attrs(s.repoRow)}>
                              <span {...stylex.attrs(s.repo)}>{r().owner}/{r().name}</span>
                              <Show when={r().private}><span {...stylex.attrs(s.subtle)}>private</span></Show>
                              <span {...stylex.attrs(s.grow)} />
                              <Button size="sm" disabled={busy()} onClick={() => linkRepo(r().owner, r().name)}>Link</Button>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  )}
                </Show>
                <div {...stylex.attrs(s.row)}>
                  <Show when={status()?.signIn.installUrl}>
                    {(href) => (
                      <a href={href()} target="_blank" rel="noreferrer" {...stylex.attrs(s.link)}>
                        Install on {github.repos()?.length ? "more " : ""}repositories <ExternalIcon size={13} />
                      </a>
                    )}
                  </Show>
                  <Button size="sm" variant="ghost" onClick={() => void github.loadRepos(sync)}>Refresh</Button>
                </div>
                <div {...stylex.attrs(s.fieldLabel)}>Or enter a repository</div>
              </Show>
              <div {...stylex.attrs(s.row)}>
                <Input
                  placeholder="owner/repository"
                  value={target()}
                  onInput={(e) => setTarget(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && linkTyped()}
                  sx={s.repoInput}
                />
                <Button variant={viaApp() ? "default" : "primary"} disabled={busy() || !connected()} onClick={linkTyped}>
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
                gh webhook forward --repo={r().owner}/{r().name} --events=issues --url={url().replace(/\/mcp$/, "")}/webhooks/github --secret=$GITHUB_WEBHOOK_SECRET
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
        <Agents />
        <GithubSettings />
      </div>
    </div>
  </>
)
