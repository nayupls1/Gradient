import type { InvitePreview } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { useNavigate, useParams } from "@solidjs/router"
import { createSignal, For, onSettled, Show, useContext } from "solid-js"
import { auth } from "../app/auth.ts"
import { Sync } from "../app/context.ts"
import { errorText, roleLabel } from "../app/members.ts"
import { TeamBadge } from "../app/TeamBadge.tsx"
import { defaultTeam, membership, teamHref } from "../lib/select.ts"
import { Button } from "../ui/button.tsx"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx"
import { UserPlusIcon } from "../ui/icons.tsx"
import { PageHeader } from "./Header.tsx"
import { page } from "./people.stylex.ts"

const s = stylex.create({
  teams: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 },
  team: { display: "flex", alignItems: "center", gap: 8 }
})

/**
 * An invite link opened while signed in: accept it to join its teams (and
 * become an admin, if it says so). Signed out, the sign-in page handles it.
 */
export const InvitePage = () => {
  const sync = useContext(Sync)
  const params = useParams()
  const navigate = useNavigate()
  const [invite, setInvite] = createSignal<InvitePreview | null>(null)
  const [problem, setProblem] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  onSettled(() => {
    void auth.invitePreview(params.token ?? "").then((result) => {
      if (result.ok) setInvite(result.invite)
      else setProblem(result.message)
    })
  })

  const alreadyIn = () => {
    const i = invite()
    return !!i && i.teams.length > 0 && i.teams.every((t) => membership(sync.state, t.id, sync.state.viewerId))
  }

  const accept = async () => {
    if (busy()) return
    setBusy(true)
    try {
      const { teamIds } = await sync.call((c) => c.InviteAccept({ token: params.token ?? "" }))
      const first = teamIds[0] ? sync.state.teams[teamIds[0]] : defaultTeam(sync.state)
      navigate(first ? teamHref(first) : "/", { replace: true })
    } catch (e) {
      setProblem(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title={<><UserPlusIcon size={15} /> Invite</>} />
      <div {...stylex.attrs(page.scroll)}>
        <div {...stylex.attrs(page.column)}>
          <Card size="sm">
            <CardHeader>
              <CardTitle>{problem() ? "This invite cannot be used" : "You are invited"}</CardTitle>
              <CardDescription>
                <Show when={invite()} fallback={problem() ?? "Loading…"}>
                  {(i) => (
                    <>
                      {i().invitedBy ?? "An admin"} invited you to join as {roleLabel[i().role].toLowerCase()}
                      {i().email ? ` (${i().email})` : ""}.
                    </>
                  )}
                </Show>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Show when={invite() && !problem()}>
                <div {...stylex.attrs(s.teams)}>
                  <For each={invite()!.teams} keyed={(t) => t.id}>
                    {(t) => (
                      <span {...stylex.attrs(s.team)}>
                        <TeamBadge team={t()} /> {t().name}
                      </span>
                    )}
                  </For>
                </div>
                <div {...stylex.attrs(page.row)}>
                  <Button onClick={() => void accept()} disabled={busy()}>
                    {busy() ? "Joining…" : alreadyIn() ? "Accept anyway" : "Accept and join"}
                  </Button>
                  <Button variant="ghost" onClick={() => navigate("/", { replace: true })}>Not now</Button>
                </div>
              </Show>
              <Show when={problem()}>
                <Button variant="outline" onClick={() => navigate("/", { replace: true })}>Go to your issues</Button>
              </Show>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
