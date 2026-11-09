import * as stylex from "@stylexjs/stylex"
import { useLocation } from "@solidjs/router"
import { createSignal, Show, useContext } from "solid-js"
import type { JSX } from "@solidjs/web"
import { useHotkeys } from "../lib/hotkeys.ts"
import { firstTeam } from "../lib/select.ts"
import { color, font, radius } from "../theme/tokens.stylex.ts"
import { InboxIcon, PlusIcon, SettingsIcon } from "../ui/icons.tsx"
import { Kbd, Toaster } from "../ui/kit.tsx"
import { Composer } from "./Composer.tsx"
import { type ComposerDefaults, ComposerContext, Sync } from "./context.ts"

const s = stylex.create({
  shell: {
    display: "grid",
    gridTemplateColumns: "232px 1fr",
    height: "100vh",
    backgroundColor: color.bg,
    color: color.fg
  },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    paddingInline: 10,
    paddingBlock: 12,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: color.border,
    minHeight: 0
  },
  workspace: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingInline: 6,
    height: 32,
    marginBottom: 6,
    fontSize: font.md,
    fontWeight: 600
  },
  logo: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundImage: `linear-gradient(135deg, ${color.fgSubtle}, ${color.fg})`
  },
  newIssue: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 30,
    paddingInline: 8,
    marginBottom: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: { default: color.panel, ":hover": color.hover },
    color: color.fg,
    fontFamily: "inherit",
    fontSize: font.md,
    fontWeight: 500,
    cursor: "pointer",
    boxShadow: `0 1px 2px ${color.shadow}`
  },
  grow: { flexGrow: 1, textAlign: "left" },
  section: {
    marginTop: 14,
    marginBottom: 2,
    paddingInline: 8,
    color: color.fgSubtle,
    fontSize: font.xs,
    fontWeight: 500
  },
  link: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 28,
    paddingInline: 8,
    borderRadius: radius.md,
    color: { default: color.fgMuted, ":hover": color.fg },
    backgroundColor: { default: "transparent", ":hover": color.hover },
    fontSize: font.md,
    fontWeight: 500,
    textDecoration: "none"
  },
  linkActive: { backgroundColor: color.active, color: color.fg },
  teamBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: color.subtle,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    fontSize: 9,
    fontWeight: 700,
    color: color.fgMuted
  },
  indent: { paddingLeft: 32 },
  teamRow: { backgroundColor: { default: "transparent", ":hover": "transparent" }, color: color.fg, cursor: "default" },
  spacer: { flexGrow: 1 },
  status: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingInline: 8,
    height: 28,
    color: color.fgSubtle,
    fontSize: font.sm
  },
  statusDot: { width: 6, height: 6, borderRadius: "50%" },
  online: { backgroundColor: "#46a758" },
  connecting: { backgroundColor: "#f5a524" },
  offline: { backgroundColor: color.danger },
  main: { minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" },
  loading: { display: "grid", placeItems: "center", height: "100%", color: color.fgSubtle, fontSize: font.md }
})

const NavLink = (props: { href: string; children: JSX.Element; indent?: boolean }) => {
  const location = useLocation()
  const active = () => location.pathname === props.href
  return (
    <a href={props.href} {...stylex.attrs(s.link, props.indent && s.indent, active() && s.linkActive)}>
      {props.children}
    </a>
  )
}

export const Shell = (props: { children: JSX.Element }) => {
  const sync = useContext(Sync)
  const [composer, setComposer] = createSignal<{ open: boolean; defaults: ComposerDefaults }>({ open: false, defaults: {} })
  const openComposer = (defaults: ComposerDefaults = {}) => setComposer({ open: true, defaults })
  useHotkeys({ c: () => openComposer() })
  const team = () => firstTeam(sync.state)

  return (
    <ComposerContext value={{ open: openComposer }}>
      <div {...stylex.attrs(s.shell)}>
        <nav {...stylex.attrs(s.sidebar)}>
          <div {...stylex.attrs(s.workspace)}>
            <span {...stylex.attrs(s.logo)} />
            Gradient
          </div>
          <button type="button" onClick={() => openComposer()} {...stylex.attrs(s.newIssue)}>
            <PlusIcon size={14} />
            <span {...stylex.attrs(s.grow)}>New issue</span>
            <Kbd>C</Kbd>
          </button>
          <NavLink href="/my-issues">
            <InboxIcon size={15} />
            My issues
          </NavLink>
          <div {...stylex.attrs(s.section)}>Your team</div>
          <div {...stylex.attrs(s.link, s.teamRow)}>
            <span {...stylex.attrs(s.teamBadge)}>{team()?.key.slice(0, 1) ?? "·"}</span>
            {team()?.name ?? "Team"}
          </div>
          <NavLink href="/" indent>Issues</NavLink>
          <NavLink href="/active" indent>Active</NavLink>
          <NavLink href="/backlog" indent>Backlog</NavLink>
          <div {...stylex.attrs(s.spacer)} />
          <NavLink href="/settings">
            <SettingsIcon size={15} />
            Settings
          </NavLink>
          <div {...stylex.attrs(s.status)} title="Sync connection">
            <span {...stylex.attrs(s.statusDot, s[sync.state.connection])} />
            {sync.state.connection === "online" ? "Synced" : sync.state.connection === "connecting" ? "Connecting…" : "Offline, retrying"}
          </div>
        </nav>
        <main {...stylex.attrs(s.main)}>
          <Show when={sync.state.ready} fallback={<div {...stylex.attrs(s.loading)}>Loading…</div>}>
            {props.children}
          </Show>
        </main>
      </div>
      <Composer open={composer().open} defaults={composer().defaults} onClose={() => setComposer((c) => ({ ...c, open: false }))} />
      <Toaster errors={sync.state.errors} onDismiss={sync.dismissError} />
    </ComposerContext>
  )
}

