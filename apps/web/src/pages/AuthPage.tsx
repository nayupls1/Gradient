import * as stylex from "@stylexjs/stylex"
import type { InvitePreview } from "@gradient/domain"
import { createSignal, For, onSettled, Show } from "solid-js"
import { type AuthConfig, auth, authClient, authErrorMessage, inviteTokenFromPath } from "../app/auth.ts"
import { TeamBadge } from "../app/TeamBadge.tsx"
import { Logo } from "../app/Shell.tsx"
import { color, font } from "../theme/tokens.stylex.ts"
import { Button } from "../ui/button.tsx"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx"
import { Input } from "../ui/input.tsx"
import { Label } from "../ui/label.tsx"

const s = stylex.create({
  page: {
    minHeight: "100svh",
    display: "grid",
    placeItems: "center",
    paddingInline: 16,
    paddingBlock: 32,
    backgroundColor: color.bg,
    color: color.fg
  },
  column: { width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 },
  brand: { display: "flex", alignItems: "center", gap: 10, fontSize: font.lg, fontWeight: 600 },
  card: { width: "100%" },
  form: { display: "flex", flexDirection: "column", gap: 14 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  submit: { width: "100%", marginTop: 4 },
  error: { color: color.danger, fontSize: font.sm },
  switch: { color: color.fgMuted, fontSize: font.md, textAlign: "center" },
  link: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: color.fg,
    fontFamily: "inherit",
    fontSize: "inherit",
    fontWeight: 500,
    textDecoration: "underline",
    textUnderlineOffset: "3px",
    cursor: "pointer"
  },
  hint: { color: color.fgSubtle, fontSize: font.sm },
  teams: { display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 4, fontSize: font.md },
  team: { display: "inline-flex", alignItems: "center", gap: 6 },
  notice: { width: "100%", color: color.fgMuted, fontSize: font.md, textAlign: "center" }
})

type Mode = "sign-in" | "sign-up" | "invite"

/**
 * Sign in, or create an account. The very first account takes over the
 * workspace (its issues, its GitHub connection); after that, people join with
 * an invite link (`/invite/<token>`), or sign up when the server allows it.
 */
export const AuthPage = () => {
  const [config, setConfig] = createSignal<AuthConfig | null>(null)
  const [mode, setMode] = createSignal<Mode>("sign-in")
  const [name, setName] = createSignal("")
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const token = inviteTokenFromPath()
  const [invite, setInvite] = createSignal<InvitePreview | null>(null)
  const [inviteProblem, setInviteProblem] = createSignal<string | null>(null)

  onSettled(() => {
    void auth.config().then((c) => {
      setConfig(c)
      if (c.firstAccount && !token) setMode("sign-up")
    })
    if (token) {
      void auth.invitePreview(token).then((result) => {
        if (!result.ok) return setInviteProblem(result.message)
        setInvite(result.invite)
        setEmail(result.invite.email ?? "")
        setMode("invite")
      })
    }
  })

  const switchTo = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (busy()) return
    setBusy(true)
    setError(null)
    try {
      if (mode() === "invite" && token) {
        const problem = await auth.acceptInvite(token, { name: name().trim(), email: email().trim(), password: password() })
        if (problem) return setError(problem)
        // The invite is used up; open the app at its start page.
        history.replaceState(null, "", "/")
        await auth.signedIn()
        return
      }
      const result = mode() === "sign-up"
        ? await authClient.signUp.email({ name: name().trim(), email: email().trim(), password: password() })
        : await authClient.signIn.email({ email: email().trim(), password: password() })
      if (result.error) {
        setError(authErrorMessage(result.error, mode() === "sign-up" ? "Could not create the account." : "Could not sign in."))
        return
      }
      await auth.signedIn()
    } catch {
      setError("Gradient is not reachable. Is the server running?")
    } finally {
      setBusy(false)
    }
  }

  const inviteTeams = () => invite()?.teams.map((t) => t.name).join(", ") ?? ""
  const title = () =>
    mode() === "invite"
      ? "Join Gradient"
      : mode() === "sign-in" ? "Sign in to Gradient" : config()?.firstAccount ? "Set up Gradient" : "Create your account"
  const description = () =>
    mode() === "invite"
      ? `${invite()?.invitedBy ?? "An admin"} invited you${inviteTeams() ? ` to ${inviteTeams()}` : ""}. Create your account to join.`
      : mode() === "sign-in"
      ? token && invite() ? "Sign in to accept the invite with an account you already have." : "Use the email and password of your account."
      : config()?.firstAccount
      ? "Create the first account. It becomes the owner of this workspace and its issues."
      : "Pick a name people will see on issues."

  return (
    <main {...stylex.attrs(s.page)}>
      <div {...stylex.attrs(s.column)}>
        <div {...stylex.attrs(s.brand)}>
          <Logo size={24} />
          Gradient
        </div>
        <Card xstyle={s.card}>
          <CardHeader>
            <CardTitle>{title()}</CardTitle>
            <CardDescription>{description()}</CardDescription>
          </CardHeader>
          <CardContent>
            <form {...stylex.attrs(s.form)} onSubmit={submit} novalidate={false}>
              <Show when={mode() === "invite" && invite() && invite()!.teams.length > 0}>
                <div {...stylex.attrs(s.teams)}>
                  <For each={invite()!.teams}>
                    {(t) => (
                      <span {...stylex.attrs(s.team)}>
                        <TeamBadge team={t} /> {t.name}
                      </span>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={mode() !== "sign-in"}>
                <div {...stylex.attrs(s.field)}>
                  <Label for="auth-name">Name</Label>
                  <Input
                    id="auth-name"
                    autocomplete="name"
                    required
                    autofocus
                    maxlength={80}
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                  />
                </div>
              </Show>
              <div {...stylex.attrs(s.field)}>
                <Label for="auth-email">Email</Label>
                <Input
                  id="auth-email"
                  type="email"
                  autocomplete="email"
                  required
                  autofocus={mode() === "sign-in"}
                  readonly={mode() === "invite" && !!invite()?.email}
                  value={email()}
                  onInput={(e) => setEmail(e.currentTarget.value)}
                />
              </div>
              <div {...stylex.attrs(s.field)}>
                <Label for="auth-password">Password</Label>
                <Input
                  id="auth-password"
                  type="password"
                  autocomplete={mode() === "sign-in" ? "current-password" : "new-password"}
                  required
                  minlength={mode() === "sign-in" ? undefined : 8}
                  maxlength={128}
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                />
                <Show when={mode() !== "sign-in"}>
                  <span {...stylex.attrs(s.hint)}>At least 8 characters.</span>
                </Show>
              </div>
              <Show when={error()}>{(message) => <div role="alert" {...stylex.attrs(s.error)}>{message()}</div>}</Show>
              <Button type="submit" xstyle={s.submit} disabled={busy()}>
                {busy() ? "One moment…" : mode() === "sign-in" ? "Sign in" : mode() === "invite" ? "Create account and join" : "Create account"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <Show when={inviteProblem()}>
          {(problem) => <div role="alert" {...stylex.attrs(s.notice)}>{problem()}</div>}
        </Show>
        <Show when={invite()}>
          <div {...stylex.attrs(s.switch)}>
            {mode() === "invite" ? "Already have an account? " : "New here? "}
            <button type="button" {...stylex.attrs(s.link)} onClick={() => switchTo(mode() === "invite" ? "sign-in" : "invite")}>
              {mode() === "invite" ? "Sign in" : "Create an account"}
            </button>
          </div>
        </Show>
        <Show when={!invite() && config()?.signUpOpen && !config()?.firstAccount}>
          <div {...stylex.attrs(s.switch)}>
            {mode() === "sign-in" ? "New here? " : "Have an account? "}
            <button type="button" {...stylex.attrs(s.link)} onClick={() => switchTo(mode() === "sign-in" ? "sign-up" : "sign-in")}>
              {mode() === "sign-in" ? "Create an account" : "Sign in"}
            </button>
          </div>
        </Show>
        <Show when={!invite() && config() && !config()!.signUpOpen && mode() === "sign-in"}>
          <div {...stylex.attrs(s.hint)}>No account? Ask an admin of this Gradient for an invite link.</div>
        </Show>
      </div>
    </main>
  )
}
