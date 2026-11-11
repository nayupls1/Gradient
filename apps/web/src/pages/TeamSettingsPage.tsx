import { isValidTeamKey, uuidv7 } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createSignal, For, Show, useContext } from "solid-js"
import { Sync, WorkspaceDialogsContext } from "../app/context.ts"
import { Picker } from "../app/Picker.tsx"
import { TeamBadge } from "../app/TeamBadge.tsx"
import { UserAvatar } from "../app/UserAvatar.tsx"
import { roleLabel } from "../app/members.ts"
import {
  allTeams,
  defaultTeam,
  findTeam,
  keyOwner,
  membership,
  teamHref,
  teamMembers,
  teamSettingsHref,
  viewerIsAdmin,
  workspaceMembers
} from "../lib/select.ts"
import { Badge } from "../ui/badge.tsx"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../ui/breadcrumb.tsx"
import { Button, type ButtonProps } from "../ui/button.tsx"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx"
import { PlusIcon, SettingsIcon, TrashIcon, UserPlusIcon, UsersIcon, XIcon } from "../ui/icons.tsx"
import { Input } from "../ui/input.tsx"
import { Label } from "../ui/label.tsx"
import { PageHeader } from "./Header.tsx"
import { page } from "./people.stylex.ts"

/**
 * A team's name, key and members, and deleting it. Members of the team and
 * admins manage it; anyone can join or leave.
 */
export const TeamSettingsPage = () => {
  const sync = useContext(Sync)
  const dialogs = useContext(WorkspaceDialogsContext)
  const navigate = useNavigate()
  const params = useParams()
  const team = () => findTeam(sync.state, params.key ?? "")
  const isMember = () => (team() ? membership(sync.state, team()!.id, sync.state.viewerId) !== undefined : false)
  const isAdmin = () => viewerIsAdmin(sync.state)
  const manages = () => isAdmin() || isMember()

  const [name, setName] = createSignal("")
  const [key, setKey] = createSignal("")
  const [saved, setSaved] = createSignal(false)
  // Fill the form when the team (or its synced values) changes.
  createEffect(
    () => ({ name: team()?.name ?? "", key: team()?.key ?? "" }),
    (current) => {
      setName(current.name)
      setKey(current.key)
    }
  )

  const keyProblem = () => {
    const k = key().trim().toUpperCase()
    if (!k || k === team()?.key) return null
    if (!isValidTeamKey(k)) return "2–5 capital letters or digits, starting with a letter."
    const owner = keyOwner(sync.state, k, team() ? { team: team()!.id } : {})
    return owner ? `${k} is used by ${owner}.` : null
  }
  const changed = () => {
    const t = team()
    return !!t && (name().trim() !== t.name || key().trim().toUpperCase() !== t.key)
  }
  const save = (event: SubmitEvent) => {
    event.preventDefault()
    const t = team()
    if (!t || !changed() || keyProblem() || !name().trim()) return
    const nextKey = key().trim().toUpperCase()
    sync.mutate({
      _tag: "TeamUpdate",
      id: t.id,
      patch: { ...(name().trim() !== t.name ? { name: name().trim() } : {}), ...(nextKey !== t.key ? { key: nextKey } : {}) }
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    // The URL carries the key.
    if (nextKey !== t.key) navigate(teamSettingsHref({ key: nextKey }), { replace: true })
  }

  const members = () =>
    teamMembers(sync.state, team()?.id ?? "")
      .flatMap((m) => {
        const user = sync.state.users[m.userId]
        return user ? [{ membership: m, user }] : []
      })
      .sort((a, b) => a.user.name.localeCompare(b.user.name))
  const candidates = () => {
    const inTeam = new Set(members().map((m) => m.user.id))
    return workspaceMembers(sync.state).filter((u) => !inTeam.has(u.id))
  }
  const add = (userId: string) => {
    const t = team()
    if (t) sync.mutate({ _tag: "TeamMemberAdd", id: uuidv7(), teamId: t.id, userId })
  }
  const remove = (membershipId: string, self: boolean) => {
    const t = team()
    if (!t) return
    if (self && !confirm(`Leave ${t.name}? It leaves your sidebar; you can join again from Teams.`)) return
    sync.mutate({ _tag: "TeamMemberRemove", id: membershipId })
  }

  const issueCount = () => Object.values(sync.state.issues).filter((i) => i.teamId === team()?.id).length
  const repoCount = () => Object.values(sync.state.githubRepos).filter((r) => r.teamId === team()?.id).length
  const deleteBlocker = () => {
    if (!isAdmin()) return "Only admins can delete a team."
    if (allTeams(sync.state).length <= 1) return "The last team cannot be deleted."
    if (repoCount() > 0) return "Unlink its GitHub repositories first."
    if (issueCount() > 0) return `It still has ${issueCount()} issue${issueCount() === 1 ? "" : "s"}. Delete them first.`
    return null
  }
  const deleteTeam = () => {
    const t = team()
    if (!t || deleteBlocker()) return
    if (!confirm(`Delete ${t.name}? Its workflow, labels and projects go with it.`)) return
    sync.mutate({ _tag: "TeamDelete", id: t.id })
    const next = allTeams(sync.state).find((x) => x.id !== t.id) ?? defaultTeam(sync.state)
    navigate(next ? teamHref(next) : "/teams")
  }

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/teams">Teams</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <Show when={team()}>
                {(t) => (
                  <>
                    <BreadcrumbItem>
                      <BreadcrumbLink href={teamHref(t())}>
                        <TeamBadge team={t()} /> {t().name}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                  </>
                )}
              </Show>
              <BreadcrumbItem>
                <BreadcrumbPage>Settings</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        actions={
          <Show when={team()}>
            <Show
              when={isMember()}
              fallback={<Button size="xs" variant="outline" onClick={() => add(sync.state.viewerId)}>Join team</Button>}
            >
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  const mine = membership(sync.state, team()!.id, sync.state.viewerId)
                  if (mine) remove(mine.id, true)
                }}
              >
                Leave team
              </Button>
            </Show>
          </Show>
        }
      />
      <div {...stylex.attrs(page.scroll)}>
        <div {...stylex.attrs(page.column)}>
          <Show when={team()} fallback={<p {...stylex.attrs(page.muted)}>This team does not exist, or was deleted.</p>}>
            {(t) => (
              <>
                <section {...stylex.attrs(page.section)}>
                  <h2 {...stylex.attrs(page.h2)}><SettingsIcon size={16} /> General</h2>
                  <Card size="sm">
                    <CardContent>
                      <form {...stylex.attrs(page.form)} onSubmit={save}>
                        <div {...stylex.attrs(page.field)}>
                          <Label for="team-name">Name and key</Label>
                          <div {...stylex.attrs(page.row)}>
                            <Input
                              id="team-name"
                              maxlength={60}
                              disabled={!manages()}
                              value={name()}
                              onInput={(e) => setName(e.currentTarget.value)}
                              xstyle={page.grow}
                            />
                            <Input
                              aria-label="Key"
                              maxlength={5}
                              disabled={!manages()}
                              value={key()}
                              onInput={(e) => setKey(e.currentTarget.value.toUpperCase())}
                              xstyle={page.keyInput}
                            />
                            <Button type="submit" variant="outline" disabled={!manages() || !changed() || !name().trim() || keyProblem() !== null}>
                              {saved() ? "Saved" : "Save"}
                            </Button>
                          </div>
                          <Show
                            when={keyProblem()}
                            fallback={
                              <span {...stylex.attrs(page.subtle)}>
                                {manages()
                                  ? `Issues without a project are numbered ${t().key}-1, ${t().key}-2… A new key renames them.`
                                  : "Only members of the team and admins can change it."}
                              </span>
                            }
                          >
                            {(problem) => <span {...stylex.attrs(page.error)}>{problem()}</span>}
                          </Show>
                        </div>
                      </form>
                    </CardContent>
                  </Card>
                </section>

                <section {...stylex.attrs(page.section)}>
                  <h2 {...stylex.attrs(page.h2)}><UsersIcon size={16} /> Members</h2>
                  <p {...stylex.attrs(page.lede)}>
                    {members().length} {members().length === 1 ? "person" : "people"}. Members see {t().name} in their sidebar and manage it.
                  </p>
                  <div {...stylex.attrs(page.row, page.section)}>
                    <Show when={manages()}>
                      <Picker<string>
                        placeholder="Add someone…"
                        items={candidates().map((u) => ({
                          value: u.id,
                          label: u.name,
                          icon: () => <UserAvatar name={u.name} src={u.avatarUrl} size={16} />,
                          ...(u.githubLogin ? { hint: `@${u.githubLogin}` } : {})
                        }))}
                        emptyText="Everyone with an account is in this team."
                        selected={[]}
                        onPick={add}
                        trigger={(p) => (
                          <Button {...(p as ButtonProps)} size="sm" variant="outline">
                            <PlusIcon size={14} /> Add member
                          </Button>
                        )}
                      />
                    </Show>
                    <Show when={isAdmin()}>
                      <Button size="sm" variant="ghost" onClick={() => dialogs.invite([t().id])}>
                        <UserPlusIcon size={14} /> Invite someone new
                      </Button>
                    </Show>
                  </div>
                  <div {...stylex.attrs(page.list)}>
                    <For each={members()} keyed={(m) => m.membership.id} fallback={<div {...stylex.attrs(page.empty)}>No one is in this team yet.</div>}>
                      {(m) => {
                        const self = () => m().user.id === sync.state.viewerId
                        return (
                          <div {...stylex.attrs(page.item)}>
                            <UserAvatar name={m().user.name} src={m().user.avatarUrl} size={24} />
                            <div {...stylex.attrs(page.itemText)}>
                              <span {...stylex.attrs(page.itemTitle)}>
                                {m().user.name}
                                <Show when={self()}><span {...stylex.attrs(page.subtle)}>(you)</span></Show>
                              </span>
                              <Show when={m().user.githubLogin}>
                                {(login) => <span {...stylex.attrs(page.subtle)}>@{login()}</span>}
                              </Show>
                            </div>
                            <Show when={m().user.role === "admin"}>
                              <Badge variant="secondary">{roleLabel.admin}</Badge>
                            </Show>
                            <Show when={manages() || self()}>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                title={self() ? "Leave team" : `Remove ${m().user.name} from ${t().name}`}
                                onClick={() => remove(m().membership.id, self())}
                              >
                                <XIcon size={14} />
                              </Button>
                            </Show>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </section>

                <section {...stylex.attrs(page.section)}>
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle>Delete team</CardTitle>
                      <CardDescription>Removes the team with its workflow, labels and projects. A team with issues cannot be deleted.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div {...stylex.attrs(page.row)}>
                        <Button size="sm" variant="destructive" disabled={deleteBlocker() !== null} onClick={deleteTeam}>
                          <TrashIcon size={14} /> Delete {t().name}
                        </Button>
                        <Show when={deleteBlocker()}>{(why) => <span {...stylex.attrs(page.subtle)}>{why()}</span>}</Show>
                      </div>
                    </CardContent>
                  </Card>
                </section>
              </>
            )}
          </Show>
        </div>
      </div>
    </>
  )
}
