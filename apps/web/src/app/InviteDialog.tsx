import { INVITE_TTL_DAYS, type Role } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { createEffect, createSignal, createUniqueId, For, Show, useContext } from "solid-js"
import { KeyScope, useCommands } from "../keys/solid.tsx"
import { allTeams } from "../lib/select.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { color, font, radius } from "../theme/tokens.stylex.ts"
import { Button } from "../ui/button.tsx"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog.tsx"
import { CheckIcon, CopyIcon, UserPlusIcon } from "../ui/icons.tsx"
import { Input } from "../ui/input.tsx"
import { Label } from "../ui/label.tsx"
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx"
import { Sync } from "./context.ts"
import { errorText, invites, inviteUrl, roleLabel } from "./members.ts"
import { TeamBadge } from "./TeamBadge.tsx"

const s = stylex.create({
  dialog: { gap: 16 },
  form: { display: "flex", flexDirection: "column", gap: 16 },
  title: { display: "flex", alignItems: "center", gap: 8 },
  field: { display: "flex", flexDirection: "column", gap: 8 },
  hint: { color: colors.mutedForeground, fontSize: "0.75rem" },
  error: { color: colors.destructive, fontSize: "0.75rem" },
  teams: {
    display: "flex",
    flexDirection: "column",
    maxHeight: 180,
    overflowY: "auto",
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border
  },
  team: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBlock: 6,
    paddingInline: 10,
    fontSize: font.md,
    cursor: "pointer",
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: color.border
  },
  checkbox: { margin: 0, accentColor: color.accent },
  teamKey: { marginLeft: "auto", color: color.fgSubtle, fontSize: font.sm, fontFamily: font.mono },
  link: { display: "flex", alignItems: "flex-start", gap: 8 },
  code: {
    flexGrow: 1,
    minWidth: 0,
    paddingBlock: 8,
    paddingInline: 10,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
    fontFamily: font.mono,
    fontSize: font.sm,
    color: color.fg,
    wordBreak: "break-all"
  }
})

export interface InviteDialogProps {
  open: boolean
  /** Teams selected when the dialog opens. */
  teamIds: ReadonlyArray<string>
  onClose: () => void
}

/**
 * Invite someone: an optional email (only that address may accept), a role
 * and the teams they join. The result is a link that works once; Gradient
 * sends no email, so the admin passes it on.
 */
export const InviteDialog = (props: InviteDialogProps) => {
  const sync = useContext(Sync)
  const [email, setEmail] = createSignal("")
  const [role, setRole] = createSignal<Role>("member")
  const [teamIds, setTeamIds] = createSignal<ReadonlyArray<string>>([])
  const [link, setLink] = createSignal<{ url: string; email: string | null } | null>(null)
  const [copied, setCopied] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  createEffect(
    () => (props.open ? [...props.teamIds] : null),
    (initialTeams) => {
      if (!initialTeams) return
      setEmail("")
      setRole("member")
      setTeamIds(initialTeams)
      setLink(null)
      setCopied(false)
      setBusy(false)
      setError(null)
    }
  )

  const toggleTeam = (id: string, on: boolean) =>
    setTeamIds((ids) => (on ? [...ids.filter((x) => x !== id), id] : ids.filter((x) => x !== id)))

  const submit = async () => {
    if (busy() || link()) return
    if (teamIds().length === 0) return setError("Pick at least one team.")
    setBusy(true)
    setError(null)
    try {
      const { invite, token } = await sync.call((c) =>
        c.InviteCreate({ email: email().trim() || null, role: role(), teamIds: [...teamIds()] })
      )
      setLink({ url: inviteUrl(token), email: invite.email })
      invites.changed()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    const url = link()?.url
    if (!url) return
    await navigator.clipboard?.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  useCommands([
    { id: "invite.dialog.submit", title: "Create invite link", group: "Invite", keys: ["mod+enter"], scope: "invite-dialog", run: () => void submit() }
  ])

  const ids = { email: createUniqueId() }

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent xstyle={s.dialog}>
        <KeyScope name="invite-dialog" blocking>
          <DialogHeader>
            <DialogTitle xstyle={s.title}>
              <UserPlusIcon size={16} /> Invite people
            </DialogTitle>
            <DialogDescription>
              Make a link that works once, for {INVITE_TTL_DAYS} days. Whoever opens it creates an account and joins the teams you pick.
            </DialogDescription>
          </DialogHeader>
          <Show
            when={link()}
            fallback={
              <form
                {...stylex.attrs(s.form)}
                onSubmit={(e) => {
                  e.preventDefault()
                  void submit()
                }}
              >
                <div {...stylex.attrs(s.field)}>
                  <Label for={ids.email}>Email</Label>
                  <Input
                    id={ids.email}
                    type="email"
                    ref={(el: HTMLInputElement | null) => el && requestAnimationFrame(() => el.focus())}
                    placeholder="name@example.com (optional)"
                    value={email()}
                    onInput={(e) => setEmail(e.currentTarget.value)}
                  />
                  <span {...stylex.attrs(s.hint)}>With an email, only that address can use the link.</span>
                </div>
                <div {...stylex.attrs(s.field)}>
                  <Label>Role</Label>
                  <ToggleGroup
                    variant="outline"
                    size="sm"
                    aria-label="Role"
                    value={[role()]}
                    onValueChange={(value: ReadonlyArray<string>) => {
                      const next = value[0]
                      if (next === "admin" || next === "member") setRole(next)
                    }}
                  >
                    <ToggleGroupItem value="member">{roleLabel.member}</ToggleGroupItem>
                    <ToggleGroupItem value="admin">{roleLabel.admin}</ToggleGroupItem>
                  </ToggleGroup>
                  <span {...stylex.attrs(s.hint)}>
                    {role() === "admin" ? "Admins also invite and remove people, and change roles." : "Members work on issues, projects and teams."}
                  </span>
                </div>
                <div {...stylex.attrs(s.field)}>
                  <Label>Teams</Label>
                  <div {...stylex.attrs(s.teams)}>
                    <For each={allTeams(sync.state)} keyed={(t) => t.id}>
                      {(team) => (
                        <label {...stylex.attrs(s.team)}>
                          <input
                            type="checkbox"
                            {...stylex.attrs(s.checkbox)}
                            checked={teamIds().includes(team().id)}
                            onChange={(e) => toggleTeam(team().id, e.currentTarget.checked)}
                          />
                          <TeamBadge team={team()} size={16} />
                          {team().name}
                          <span {...stylex.attrs(s.teamKey)}>{team().key}</span>
                        </label>
                      )}
                    </For>
                  </div>
                </div>
                <Show when={error()}>{(e) => <div role="alert" {...stylex.attrs(s.error)}>{e()}</div>}</Show>
                <DialogFooter>
                  <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
                  <Button type="submit" disabled={busy() || teamIds().length === 0}>
                    {busy() ? "Creating…" : "Create invite link"}
                  </Button>
                </DialogFooter>
              </form>
            }
          >
            {(made) => (
              <div {...stylex.attrs(s.form)}>
                <div {...stylex.attrs(s.hint)}>
                  Send this link{made().email ? ` to ${made().email}` : ""}. Copy it now: it is not shown again.
                </div>
                <div {...stylex.attrs(s.link)}>
                  <code {...stylex.attrs(s.code)}>{made().url}</code>
                  <Button size="icon-sm" variant="ghost" title="Copy link" onClick={() => void copy()}>
                    <Show when={copied()} fallback={<CopyIcon size={14} />}><CheckIcon size={14} /></Show>
                  </Button>
                </div>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setLink(null)
                      setEmail("")
                    }}
                  >
                    Invite someone else
                  </Button>
                  <Button onClick={props.onClose}>Done</Button>
                </DialogFooter>
              </div>
            )}
          </Show>
        </KeyScope>
      </DialogContent>
    </Dialog>
  )
}
