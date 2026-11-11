import type { Invite, Role, User } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { createEffect, createSignal, For, Show, useContext } from "solid-js"
import { Sync, WorkspaceDialogsContext } from "../app/context.ts"
import { errorText, invites, roleLabel } from "../app/members.ts"
import { TeamBadge } from "../app/TeamBadge.tsx"
import { UserAvatar } from "../app/UserAvatar.tsx"
import { KeyScope } from "../keys/solid.tsx"
import { allTeams, formatDate, membership, teamHref, viewerIsAdmin, workspaceMembers } from "../lib/select.ts"
import { Badge } from "../ui/badge.tsx"
import { Button, type ButtonProps } from "../ui/button.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu.tsx"
import { MailIcon, MoreIcon, TrashIcon, UserPlusIcon, UsersIcon, XIcon } from "../ui/icons.tsx"
import { PageHeader } from "./Header.tsx"
import { page } from "./people.stylex.ts"

/** An admin's actions on someone: change their role, or remove them from the workspace. */
const MemberMenu = (props: { user: User; onError: (message: string) => void }) => {
  const sync = useContext(Sync)
  const run = (work: () => Promise<unknown>) => void work().catch((e) => props.onError(errorText(e)))
  const setRole = (role: Role) => run(() => sync.call((c) => c.MemberSetRole({ userId: props.user.id, role })))
  const remove = () => {
    if (!confirm(`Remove ${props.user.name} from the workspace? Their account, sessions and agent keys are deleted; their issues stay.`)) return
    run(() => sync.call((c) => c.MemberRemove({ userId: props.user.id })))
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(p) => (
          <Button {...(p as ButtonProps)} variant="ghost" size="icon-sm" title={`Manage ${props.user.name}`}>
            <MoreIcon size={15} />
          </Button>
        )}
      />
      <DropdownMenuContent align="end" xstyle={page.menu}>
        <KeyScope name="menu" blocking>
          <Show
            when={props.user.role === "admin"}
            fallback={<DropdownMenuItem onClick={() => setRole("admin")}>Make admin</DropdownMenuItem>}
          >
            <DropdownMenuItem onClick={() => setRole("member")}>Make member</DropdownMenuItem>
          </Show>
          <Show when={props.user.id !== sync.state.viewerId}>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={remove}>
              <TrashIcon size={14} /> Remove from workspace
            </DropdownMenuItem>
          </Show>
        </KeyScope>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The people in the workspace, their roles and teams, and (for admins) the
 * invites still waiting to be accepted.
 */
export const MembersPage = () => {
  const sync = useContext(Sync)
  const dialogs = useContext(WorkspaceDialogsContext)
  const isAdmin = () => viewerIsAdmin(sync.state)
  const [emails, setEmails] = createSignal<Record<string, string>>({})
  const [pending, setPending] = createSignal<ReadonlyArray<Invite> | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  // Admins see email addresses and invites. Reload when someone joins, leaves or is invited.
  createEffect(
    () => ({ admin: isAdmin(), version: invites.version(), people: workspaceMembers(sync.state).length }),
    ({ admin }) => {
      if (!admin) return
      sync.call((c) => c.MemberEmails()).then(setEmails, () => {})
      sync.call((c) => c.InviteList()).then(setPending, (e) => setError(errorText(e)))
    }
  )

  const teamsOf = (userId: string) => allTeams(sync.state).filter((t) => membership(sync.state, t.id, userId))
  const revoke = (invite: Invite) => {
    if (!confirm(`Revoke the invite${invite.email ? ` for ${invite.email}` : ""}? Its link stops working.`)) return
    sync.call((c) => c.InviteRevoke({ id: invite.id })).then(() => invites.changed(), (e) => setError(errorText(e)))
  }
  const teamNames = (ids: ReadonlyArray<string>) =>
    ids.flatMap((id) => sync.state.teams[id]?.name ?? []).join(", ") || "no team"

  return (
    <>
      <PageHeader
        title={<><UserPlusIcon size={15} /> Members</>}
        actions={
          <Show when={isAdmin()}>
            <Button variant="outline" size="xs" onClick={() => dialogs.invite()}>
              <UserPlusIcon size={13} /> Invite people
            </Button>
          </Show>
        }
      />
      <div {...stylex.attrs(page.scroll)}>
        <div {...stylex.attrs(page.column)}>
          <section {...stylex.attrs(page.section)}>
            <h2 {...stylex.attrs(page.h2)}><UsersIcon size={16} /> People</h2>
            <p {...stylex.attrs(page.lede)}>
              {isAdmin()
                ? "Everyone with an account. Admins invite and remove people and change roles."
                : "Everyone with an account. Ask an admin to invite someone new."}
            </p>
            <div {...stylex.attrs(page.list)}>
              <For each={workspaceMembers(sync.state)} keyed={(u) => u.id}>
                {(user) => (
                  <div {...stylex.attrs(page.item)}>
                    <UserAvatar name={user().name} src={user().avatarUrl} size={24} />
                    <div {...stylex.attrs(page.itemText)}>
                      <span {...stylex.attrs(page.itemTitle)}>
                        {user().name}
                        <Show when={user().id === sync.state.viewerId}><span {...stylex.attrs(page.subtle)}>(you)</span></Show>
                      </span>
                      <span {...stylex.attrs(page.subtle)}>
                        {[emails()[user().id], user().githubLogin ? `@${user().githubLogin}` : null].filter(Boolean).join(" · ") || " "}
                      </span>
                    </div>
                    <div {...stylex.attrs(page.badges)}>
                      <For each={teamsOf(user().id)} keyed={(t) => t.id}>
                        {(t) => (
                          <a href={teamHref(t())} title={t().name}>
                            <TeamBadge team={t()} />
                          </a>
                        )}
                      </For>
                    </div>
                    <Badge variant={user().role === "admin" ? "secondary" : "outline"}>{roleLabel[user().role ?? "member"]}</Badge>
                    <Show when={isAdmin()}>
                      <MemberMenu user={user()} onError={setError} />
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <Show when={error()}>{(e) => <div role="alert" {...stylex.attrs(page.error)}>{e()}</div>}</Show>
          </section>

          <Show when={isAdmin()}>
            <section {...stylex.attrs(page.section)}>
              <h2 {...stylex.attrs(page.h2)}><MailIcon size={16} /> Invites</h2>
              <p {...stylex.attrs(page.lede)}>Links that have not been used yet. Each works once; revoke one to stop it.</p>
              <div {...stylex.attrs(page.list)}>
                <For
                  each={pending() ?? []}
                  keyed={(i) => i.id}
                  fallback={<div {...stylex.attrs(page.empty)}>{pending() ? "No open invites." : "Loading…"}</div>}
                >
                  {(invite) => {
                    const expired = () => invite().expiresAt <= Date.now()
                    const inviter = () => (invite().invitedBy ? sync.state.users[invite().invitedBy!]?.name : undefined)
                    return (
                      <div {...stylex.attrs(page.item)}>
                        <div {...stylex.attrs(page.itemText)}>
                          <span {...stylex.attrs(page.itemTitle)}>{invite().email ?? "Anyone with the link"}</span>
                          <span {...stylex.attrs(page.subtle)}>
                            {roleLabel[invite().role]} in {teamNames(invite().teamIds)}
                            {inviter() ? ` · by ${inviter()}` : ""} · {expired() ? "expired" : `until ${formatDate(invite().expiresAt)}`}
                          </span>
                        </div>
                        <Show when={expired()}>
                          <Badge variant="outline">Expired</Badge>
                        </Show>
                        <Button size="icon-sm" variant="ghost" title="Revoke invite" onClick={() => revoke(invite())}>
                          <XIcon size={14} />
                        </Button>
                      </div>
                    )
                  }}
                </For>
              </div>
            </section>
          </Show>
        </div>
      </div>
    </>
  )
}
