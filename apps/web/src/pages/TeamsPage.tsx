import { uuidv7 } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { useNavigate } from "@solidjs/router"
import { For, Show, useContext } from "solid-js"
import { Sync, WorkspaceDialogsContext } from "../app/context.ts"
import { TeamBadge } from "../app/TeamBadge.tsx"
import { UserAvatar } from "../app/UserAvatar.tsx"
import { allTeams, membership, teamHref, teamMembers, teamProjects, teamSettingsHref, viewerIsAdmin } from "../lib/select.ts"
import { Button } from "../ui/button.tsx"
import { PlusIcon, SettingsIcon, UserPlusIcon, UsersIcon } from "../ui/icons.tsx"
import { PageHeader } from "./Header.tsx"
import { page } from "./people.stylex.ts"

const s = stylex.create({
  avatars: { display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }
})

/**
 * Every team in the workspace. Teams are open: anyone can join one, and the
 * teams you are in show in the sidebar.
 */
export const TeamsPage = () => {
  const sync = useContext(Sync)
  const dialogs = useContext(WorkspaceDialogsContext)
  const navigate = useNavigate()
  const people = (teamId: string) =>
    teamMembers(sync.state, teamId).flatMap((m) => sync.state.users[m.userId] ?? [])
  const openIssues = (teamId: string) =>
    Object.values(sync.state.issues).filter((i) => {
      if (i.teamId !== teamId || i.archivedAt !== null) return false
      const type = sync.state.workflowStates[i.stateId]?.type
      return type !== "completed" && type !== "canceled"
    }).length
  const join = (teamId: string) =>
    sync.mutate({ _tag: "TeamMemberAdd", id: uuidv7(), teamId, userId: sync.state.viewerId })
  const leave = (teamId: string) => {
    const mine = membership(sync.state, teamId, sync.state.viewerId)
    if (mine) sync.mutate({ _tag: "TeamMemberRemove", id: mine.id })
  }

  return (
    <>
      <PageHeader
        title={<><UsersIcon size={15} /> Teams</>}
        actions={
          <>
            <Show when={viewerIsAdmin(sync.state)}>
              <Button variant="ghost" size="xs" onClick={() => dialogs.invite()}>
                <UserPlusIcon size={13} /> Invite people
              </Button>
            </Show>
            <Button variant="outline" size="xs" onClick={() => dialogs.createTeam()}>
              <PlusIcon size={13} /> New team
            </Button>
          </>
        }
      />
      <div {...stylex.attrs(page.scroll)}>
        <div {...stylex.attrs(page.column)}>
          <p {...stylex.attrs(page.lede)}>
            Each team has its own issues, workflow, labels and projects. Everyone in the workspace can see every team; join the ones you work in to keep them in your sidebar.
          </p>
          <div {...stylex.attrs(page.list)}>
            <For each={allTeams(sync.state)} keyed={(t) => t.id}>
              {(team) => {
                const member = () => membership(sync.state, team().id, sync.state.viewerId) !== undefined
                const count = () => people(team().id).length
                const projects = () => teamProjects(sync.state, team().id).length
                return (
                  <div {...stylex.attrs(page.item)}>
                    <TeamBadge team={team()} size={24} />
                    <div {...stylex.attrs(page.itemText)}>
                      <a href={teamHref(team())} {...stylex.attrs(page.itemTitle)}>
                        {team().name}
                        <span {...stylex.attrs(page.subtle)}>{team().key}</span>
                      </a>
                      <span {...stylex.attrs(page.subtle)}>
                        {count()} member{count() === 1 ? "" : "s"} · {openIssues(team().id)} open issue{openIssues(team().id) === 1 ? "" : "s"}
                        {projects() > 0 ? ` · ${projects()} project${projects() === 1 ? "" : "s"}` : ""}
                      </span>
                    </div>
                    <div {...stylex.attrs(s.avatars)}>
                      <For each={people(team().id).slice(0, 5)} keyed={(u) => u.id}>
                        {(u) => (
                          <span title={u().name}>
                            <UserAvatar name={u().name} src={u().avatarUrl} size={18} />
                          </span>
                        )}
                      </For>
                    </div>
                    <div {...stylex.attrs(page.actions)}>
                      <Show
                        when={member()}
                        fallback={<Button size="sm" variant="outline" onClick={() => join(team().id)}>Join</Button>}
                      >
                        <Button size="sm" variant="ghost" onClick={() => leave(team().id)}>Leave</Button>
                      </Show>
                      <Button size="icon-sm" variant="ghost" title={`${team().name} settings`} onClick={() => navigate(teamSettingsHref(team()))}>
                        <SettingsIcon size={14} />
                      </Button>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </div>
    </>
  )
}
