import * as stylex from "@stylexjs/stylex"
import { createSignal, onSettled, Show } from "solid-js"
import { type AuthConfig, auth, authClient, authErrorMessage } from "../app/auth.ts"
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
  hint: { color: color.fgSubtle, fontSize: font.sm }
})

type Mode = "sign-in" | "sign-up"

/**
 * Sign in, or create an account. The very first account takes over the
 * workspace (its issues, its GitHub connection); after that, sign-up is only
 * offered when the server allows it.
 */
export const AuthPage = () => {
  const [config, setConfig] = createSignal<AuthConfig | null>(null)
  const [mode, setMode] = createSignal<Mode>("sign-in")
  const [name, setName] = createSignal("")
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  onSettled(() => {
    void auth.config().then((c) => {
      setConfig(c)
      if (c.firstAccount) setMode("sign-up")
    })
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

  const title = () =>
    mode() === "sign-in" ? "Sign in to Gradient" : config()?.firstAccount ? "Set up Gradient" : "Create your account"
  const description = () =>
    mode() === "sign-in"
      ? "Use the email and password of your account."
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
              <Show when={mode() === "sign-up"}>
                <div {...stylex.attrs(s.field)}>
                  <Label for="auth-name">Name</Label>
                  <Input
                    id="auth-name"
                    autocomplete="name"
                    required
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
                  autofocus
                  value={email()}
                  onInput={(e) => setEmail(e.currentTarget.value)}
                />
              </div>
              <div {...stylex.attrs(s.field)}>
                <Label for="auth-password">Password</Label>
                <Input
                  id="auth-password"
                  type="password"
                  autocomplete={mode() === "sign-up" ? "new-password" : "current-password"}
                  required
                  minlength={mode() === "sign-up" ? 8 : undefined}
                  maxlength={128}
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                />
                <Show when={mode() === "sign-up"}>
                  <span {...stylex.attrs(s.hint)}>At least 8 characters.</span>
                </Show>
              </div>
              <Show when={error()}>{(message) => <div role="alert" {...stylex.attrs(s.error)}>{message()}</div>}</Show>
              <Button type="submit" xstyle={s.submit} disabled={busy()}>
                {busy() ? "One moment…" : mode() === "sign-in" ? "Sign in" : "Create account"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <Show when={config()?.signUpOpen && !config()?.firstAccount}>
          <div {...stylex.attrs(s.switch)}>
            {mode() === "sign-in" ? "New here? " : "Have an account? "}
            <button type="button" {...stylex.attrs(s.link)} onClick={() => switchTo(mode() === "sign-in" ? "sign-up" : "sign-in")}>
              {mode() === "sign-in" ? "Create an account" : "Sign in"}
            </button>
          </div>
        </Show>
        <Show when={config() && !config()!.signUpOpen && mode() === "sign-in"}>
          <div {...stylex.attrs(s.hint)}>No account? Ask the owner of this Gradient for one.</div>
        </Show>
      </div>
    </main>
  )
}
