import * as stylex from "@stylexjs/stylex"
import { useLocation, useNavigate } from "@solidjs/router"
import type { JSX } from "@solidjs/web"
import { createEffect, createSignal, For, onSettled, Show, useContext } from "solid-js"
import { Shortcut, useCommands } from "../keys/solid.tsx"
import {
  allTeams,
  currentTeam,
  myTeams,
  projectHref,
  projectIdFromPath,
  projectRepo,
  teamFromPath,
  teamHref,
  teamProjects,
  teamSettingsHref,
  viewerIsAdmin
} from "../lib/select.ts"
import { updateTheme, activeScheme } from "../theme/theme.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { color } from "../theme/tokens.stylex.ts"
import { Button } from "../ui/button.tsx"
import { GithubIcon, PlusIcon, SettingsIcon, UserPlusIcon, UsersIcon } from "../ui/icons.tsx"
import { auth } from "./auth.ts"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  useSidebar
} from "../ui/sidebar.tsx"
import { Toaster, toast } from "../ui/sonner.tsx"
import { CommandSurfaces } from "./CommandMenu.tsx"
import { Composer } from "./Composer.tsx"
import { type ComposerDefaults, ComposerContext, ProjectDialogsContext, Sync, WorkspaceDialogsContext } from "./context.ts"
import { InviteDialog } from "./InviteDialog.tsx"
import { ProjectDialog, type ProjectDialogMode } from "./ProjectDialog.tsx"
import { ProjectGlyph } from "./ProjectGlyph.tsx"
import { TeamBadge } from "./TeamBadge.tsx"
import { TeamDialog } from "./TeamDialog.tsx"
import { UserAvatar } from "./UserAvatar.tsx"
import { github } from "./github.ts"

const s = stylex.create({
  workspace: { display: "flex", alignItems: "center", gap: 8, paddingInline: 6, height: 32, fontWeight: 600 },
  logo: { flexShrink: 0, color: color.fg },
  newIssue: { width: "100%", justifyContent: "flex-start" },
  grow: { flexGrow: 1, textAlign: "left" },
  teamName: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 },
  browse: { color: colors.mutedForeground },
  projectName: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  projectGh: { color: colors.mutedForeground, display: "inline-flex", flexShrink: 0 },
  emptyProjects: { paddingInline: 8, paddingBlock: 4, color: colors.mutedForeground, fontSize: "0.75rem" },
  status: { display: "flex", alignItems: "center", gap: 8, paddingInline: 8, height: 28, color: colors.mutedForeground, fontSize: "0.75rem" },
  statusDot: { width: 6, height: 6, borderRadius: "50%" },
  online: { backgroundColor: "#46a758" },
  connecting: { backgroundColor: "#f5a524" },
  offline: { backgroundColor: colors.destructive },
  main: { minWidth: 0, minHeight: 0, height: "100svh", overflow: "hidden", backgroundColor: color.bg, color: color.fg },
  loading: { display: "grid", placeItems: "center", height: "100%", color: colors.mutedForeground }
})

/**
 * The app mark from `public/favicon.svg`: a 3×3 grid of dots fading toward the
 * corner. Drawn inline in `currentColor` so it follows the app's theme rather
 * than the OS scheme the favicon uses.
 */
const logoDots = [0, 1, 2].flatMap((row) =>
  [0, 1, 2].map((col) => ({ cx: 7 + col * 9, cy: 7 + row * 9, r: 4.2 - (row + col) * 0.55, opacity: 1 - (row + col) * 0.2 }))
)

export const Logo = (props: { size?: number }) => (
  <svg {...stylex.attrs(s.logo)} width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
    <For each={logoDots}>{(d) => <circle cx={d.cx} cy={d.cy} r={d.r} opacity={d.opacity} />}</For>
  </svg>
)

/** A sidebar link, marked active for the current route. */
const NavLink = (props: { href: string; children: JSX.Element; sub?: boolean; match?: (path: string) => boolean }) => {
  const location = useLocation()
  const active = () => (props.match ? props.match(location.pathname) : location.pathname === props.href)
  return (
    <Show
      when={props.sub}
      fallback={<SidebarMenuButton isActive={active()} render={<a href={props.href} />}>{props.children}</SidebarMenuButton>}
    >
      <SidebarMenuSubButton isActive={active()} href={props.href}>{props.children}</SidebarMenuSubButton>
    </Show>
  )
}

/** ⌘B, as a command, so it shows in ⌘K and "?" (shadcn binds it with a window listener). */
const SidebarCommands = () => {
  const sidebar = useSidebar()
  useCommands([
    { id: "sidebar.toggle", title: "Toggle sidebar", group: "Appearance", keys: ["mod+b"], run: () => sidebar.toggleSidebar() }
  ])
  return null
}

/** Sync errors (rejected changes) show as toasts until they expire or are dismissed. */
const ErrorToasts = () => {
  const sync = useContext(Sync)
  const shown = new Set<string>()
  createEffect(
    () => sync.state.errors.map((e) => ({ id: e.id, message: e.message })),
    (errors) => {
      for (const error of errors) {
        if (shown.has(error.id)) continue
        shown.add(error.id)
        const dismiss = () => sync.dismissError(error.id)
        toast.error(error.message, { id: error.id, duration: 6000, onDismiss: dismiss, onAutoClose: dismiss })
      }
    }
  )
  return <Toaster />
}

export const Shell = (props: { children: JSX.Element }) => {
  const sync = useContext(Sync)
  const navigate = useNavigate()
  const location = useLocation()
  const [composer, setComposer] = createSignal<{ open: boolean; defaults: ComposerDefaults }>({ open: false, defaults: {} })
  // New issues land in the team and project being viewed, unless the caller says otherwise.
  const openComposer = (defaults: ComposerDefaults = {}) => {
    const team = teamFromPath(sync.state, location.pathname)
    setComposer({
      open: true,
      defaults: { projectId: projectIdFromPath(location.pathname) ?? null, ...(team ? { teamId: team.id } : {}), ...defaults }
    })
  }
  const team = () => currentTeam(sync.state, location.pathname)
  const viewer = () => sync.state.users[sync.state.viewerId]
  const teams = () => myTeams(sync.state)
  const [projectDialog, setProjectDialog] = createSignal<ProjectDialogMode | null>(null)
  const projectDialogs = {
    create: (teamId?: string) => {
      const id = teamId ?? team()?.id
      setProjectDialog({ kind: "create", ...(id ? { teamId: id } : {}) })
    },
    edit: (projectId: string, focus?: "icon") =>
      setProjectDialog({ kind: "edit", projectId, ...(focus ? { focus } : {}) })
  }
  const [teamDialog, setTeamDialog] = createSignal(false)
  const [inviteDialog, setInviteDialog] = createSignal<ReadonlyArray<string> | null>(null)
  const workspaceDialogs = {
    createTeam: () => setTeamDialog(true),
    invite: (teamIds?: ReadonlyArray<string>) => setInviteDialog(teamIds ?? (team() ? [team()!.id] : []))
  }

  useCommands([
    { id: "issue.create", title: "New issue", group: "General", keys: ["c"], run: () => openComposer() },
    {
      id: "nav.issues",
      title: "Go to the team's issues",
      group: "Navigation",
      keys: ["g i"],
      run: () => navigate(team() ? teamHref(team()!) : "/")
    },
    { id: "project.create", title: "New project", group: "General", keys: ["shift+c"], run: () => projectDialogs.create() },
    { id: "team.create", title: "New team", group: "Teams", run: () => workspaceDialogs.createTeam() },
    { id: "nav.teams", title: "Go to teams", group: "Navigation", keys: ["g t"], run: () => navigate("/teams") },
    {
      id: "nav.teamSettings",
      title: "Go to team settings",
      group: "Navigation",
      when: () => team() !== undefined,
      run: () => navigate(teamSettingsHref(team()!))
    },
    { id: "nav.members", title: "Go to members", group: "Navigation", keys: ["g m"], run: () => navigate("/members") },
    {
      id: "member.invite",
      title: "Invite people",
      group: "Teams",
      when: () => viewerIsAdmin(sync.state),
      run: () => workspaceDialogs.invite()
    },
    { id: "nav.settings", title: "Go to settings", group: "Navigation", keys: ["g s", "mod+,"], run: () => navigate("/settings") },
    { id: "nav.profile", title: "Go to profile", group: "Navigation", keys: ["g p"], run: () => navigate("/profile") },
    { id: "auth.signOut", title: "Sign out", group: "Account", run: () => void auth.signOut() },
    {
      id: "theme.toggleMode",
      title: "Switch light / dark",
      group: "Appearance",
      run: () => updateTheme((t) => ({ ...t, mode: activeScheme() === "dark" ? "light" : "dark" }))
    },
    {
      id: "github.signIn",
      title: "Sign in with GitHub",
      group: "GitHub",
      when: () => github.status()?.signIn.available === true && github.status()?.tokenSource !== "app",
      run: () => {
        navigate("/settings")
        void github.signIn(sync)
      }
    },
    {
      id: "github.signOut",
      title: "Sign out of GitHub",
      group: "GitHub",
      when: () => github.status()?.tokenSource === "app",
      run: () => void github.signOut(sync)
    }
  ])
  // The GitHub commands above need to know whether sign-in is possible.
  onSettled(() => void github.refresh(sync))

  return (
    <ComposerContext value={{ open: openComposer }}>
      <ProjectDialogsContext value={projectDialogs}>
      <WorkspaceDialogsContext value={workspaceDialogs}>
      <SidebarProvider>
        <SidebarCommands />
        <Sidebar>
          <SidebarHeader>
            <div {...stylex.attrs(s.workspace)}>
              <Logo />
              Gradient
            </div>
            <Button variant="outline" size="sm" xstyle={s.newIssue} onClick={() => openComposer()}>
              <PlusIcon size={14} />
              <span {...stylex.attrs(s.grow)}>New issue</span>
              <Shortcut binding="c" />
            </Button>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Your teams</SidebarGroupLabel>
              <SidebarGroupAction title="New team" onClick={() => workspaceDialogs.createTeam()}>
                <PlusIcon size={14} />
              </SidebarGroupAction>
              <SidebarMenu>
                <For each={teams()} keyed={(t) => t.id}>
                  {(t) => (
                    <SidebarMenuItem>
                      <NavLink href={teamHref(t())} match={(p) => p === teamHref(t()) || (p === "/" && team()?.id === t().id)}>
                        <TeamBadge team={t()} />
                        <span {...stylex.attrs(s.teamName)}>{t().name}</span>
                      </NavLink>
                      <SidebarMenuAction showOnHover title={`New project in ${t().name}`} onClick={() => projectDialogs.create(t().id)}>
                        <PlusIcon size={14} />
                      </SidebarMenuAction>
                      <Show when={teamProjects(sync.state, t().id).length > 0}>
                        <SidebarMenuSub>
                          <For each={teamProjects(sync.state, t().id)} keyed={(p) => p.id}>
                            {(project) => (
                              <SidebarMenuSubItem>
                                <NavLink sub href={projectHref(project().id)}>
                                  <ProjectGlyph project={project()} size={14} />
                                  <span {...stylex.attrs(s.projectName)}>{project().name}</span>
                                  <Show when={projectRepo(sync.state, project().id)}>
                                    {(r) => (
                                      <span {...stylex.attrs(s.projectGh)} title={`Syncs with ${r().owner}/${r().name}`}>
                                        <GithubIcon size={12} />
                                      </span>
                                    )}
                                  </Show>
                                </NavLink>
                              </SidebarMenuSubItem>
                            )}
                          </For>
                        </SidebarMenuSub>
                      </Show>
                    </SidebarMenuItem>
                  )}
                </For>
                <SidebarMenuItem>
                  <NavLink href="/teams" match={(p) => p === "/teams"}>
                    <UsersIcon size={15} />
                    <span {...stylex.attrs(s.browse)}>
                      {teams().length < allTeams(sync.state).length ? "Browse all teams" : "All teams"}
                    </span>
                  </NavLink>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <NavLink href="/profile">
                  <UserAvatar name={viewer()?.name ?? auth.session()?.user.name ?? null} src={viewer()?.avatarUrl ?? null} size={16} />
                  <span {...stylex.attrs(s.projectName)}>{viewer()?.name ?? auth.session()?.user.name ?? "Profile"}</span>
                </NavLink>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavLink href="/members">
                  <UserPlusIcon size={15} />
                  Members
                </NavLink>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavLink href="/settings">
                  <SettingsIcon size={15} />
                  Settings
                </NavLink>
              </SidebarMenuItem>
            </SidebarMenu>
            <div {...stylex.attrs(s.status)} title="Sync connection">
              <span {...stylex.attrs(s.statusDot, s[sync.state.connection])} />
              {sync.state.connection === "online" ? "Synced" : sync.state.connection === "connecting" ? "Connecting…" : "Offline, retrying"}
            </div>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset xstyle={s.main}>
          <Show when={sync.state.ready} fallback={<div {...stylex.attrs(s.loading)}>Loading…</div>}>
            {props.children}
          </Show>
        </SidebarInset>
      </SidebarProvider>
      <Composer open={composer().open} defaults={composer().defaults} onClose={() => setComposer((c) => ({ ...c, open: false }))} />
      <CommandSurfaces />
      <ProjectDialog mode={projectDialog()} onClose={() => setProjectDialog(null)} />
      <TeamDialog open={teamDialog()} onClose={() => setTeamDialog(false)} />
      <InviteDialog open={inviteDialog() !== null} teamIds={inviteDialog() ?? []} onClose={() => setInviteDialog(null)} />
      <ErrorToasts />
      </WorkspaceDialogsContext>
      </ProjectDialogsContext>
    </ComposerContext>
  )
}
