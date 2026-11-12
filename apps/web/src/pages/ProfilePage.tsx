import * as stylex from "@stylexjs/stylex"
import { createEffect, createSignal, For, onSettled, Show, useContext } from "solid-js"
import { agentCommands, useMcpUrl } from "../app/agents.ts"
import { auth, authClient, authErrorMessage } from "../app/auth.ts"
import { Sync } from "../app/context.ts"
import { GithubConnect } from "../app/GithubConnect.tsx"
import { githubAccount } from "../app/githubAccount.ts"
import { UserAvatar } from "../app/UserAvatar.tsx"
import { formatRelative } from "../lib/select.ts"
import { color, font, radius } from "../theme/tokens.stylex.ts"
import { Badge } from "../ui/badge.tsx"
import { Button } from "../ui/button.tsx"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx"
import { CheckIcon, CopyIcon, DeviceIcon, GithubIcon, KeyIcon, LockIcon, SignOutIcon, TrashIcon, UserIcon } from "../ui/icons.tsx"
import { Input } from "../ui/input.tsx"
import { Label } from "../ui/label.tsx"
import { PageHeader } from "./Header.tsx"

const s = stylex.create({
  page: { overflowY: "auto", flexGrow: 1 },
  column: { maxWidth: 760, marginInline: "auto", paddingInline: 32, paddingBlock: 32 },
  section: { marginBottom: 32 },
  h2: { display: "flex", alignItems: "center", gap: 8, margin: 0, marginBottom: 12, fontSize: font.lg, fontWeight: 600 },
  identity: { display: "flex", alignItems: "center", gap: 14, marginBottom: 16 },
  identityName: { fontSize: font.lg, fontWeight: 600 },
  muted: { color: color.fgMuted, fontSize: font.md },
  subtle: { color: color.fgSubtle, fontSize: font.sm },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  grow: { flexGrow: 1, flexBasis: 0, minWidth: 200 },
  error: { color: color.danger, fontSize: font.sm },
  success: { color: color.fgMuted, fontSize: font.sm },
  checkbox: { display: "flex", alignItems: "center", gap: 8, fontSize: font.md, color: color.fgMuted },
  checkboxInput: { margin: 0, accentColor: color.accent },
  list: {
    display: "flex",
    flexDirection: "column",
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingBlock: 8,
    paddingInline: 12,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: color.border
  },
  itemText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flexGrow: 1 },
  itemTitle: { fontSize: font.md, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  empty: { paddingBlock: 10, paddingInline: 12, color: color.fgMuted, fontSize: font.md },
  icon: { color: color.fgMuted, display: "inline-flex", flexShrink: 0 },
  code: {
    display: "block",
    flexGrow: 1,
    minWidth: 0,
    paddingBlock: 8,
    paddingInline: 10,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
    fontFamily: font.mono,
    fontSize: font.sm,
    color: color.fg,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all"
  },
  newKey: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 12,
    marginBottom: 12,
    borderRadius: radius.md,
    backgroundColor: color.subtle
  },
  /** Inside the grey "new key" panel, code sits on the card surface instead. */
  codeOnSubtle: { backgroundColor: color.panel },
  agentName: { width: 96, flexShrink: 0, fontSize: font.md, fontWeight: 500 },
  codeRow: { display: "flex", alignItems: "flex-start", gap: 8 }
})

/** "Chrome on macOS" from a user agent string, enough to recognise a device. */
const describeAgent = (ua: string | null | undefined) => {
  if (!ua) return "Unknown device"
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari" : /curl|Bun|node/i.test(ua) ? "Script" : "Browser"
  const os = /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android"
    : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : null
  return os ? `${browser} on ${os}` : browser
}

const time = (d: Date | string | null | undefined) => (d ? formatRelative(new Date(d).getTime()) : "never")

const CopyButton = (props: { text: string }) => {
  const [copied, setCopied] = createSignal(false)
  const copy = async () => {
    await navigator.clipboard?.writeText(props.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Button size="icon-sm" variant="ghost" title="Copy" onClick={copy}>
      <Show when={copied()} fallback={<CopyIcon size={14} />}><CheckIcon size={14} /></Show>
    </Button>
  )
}

/** Name (shown on issues) and email. */
const Account = () => {
  const sync = useContext(Sync)
  const user = () => auth.session()?.user
  const viewer = () => sync.state.users[sync.state.viewerId]
  const [name, setName] = createSignal(user()?.name ?? "")
  const [message, setMessage] = createSignal<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = createSignal(false)
  const changed = () => name().trim() !== "" && name().trim() !== user()?.name

  const save = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!changed() || busy()) return
    setBusy(true)
    const { error } = await authClient.updateUser({ name: name().trim() })
    setBusy(false)
    if (error) return setMessage({ text: authErrorMessage(error, "Could not save the name."), error: true })
    await auth.refresh()
    setMessage({ text: "Saved." })
  }

  return (
    <section {...stylex.attrs(s.section)}>
      <h2 {...stylex.attrs(s.h2)}><UserIcon size={16} /> Account</h2>
      <Card size="sm">
        <CardContent>
          <div {...stylex.attrs(s.identity)}>
            <UserAvatar name={user()?.name ?? null} src={viewer()?.avatarUrl ?? null} size={24} />
            <div>
              <div {...stylex.attrs(s.identityName)}>{user()?.name}</div>
              <div {...stylex.attrs(s.muted)}>
                {user()?.email}
                <Show when={viewer()?.githubLogin}>{(login) => <> · GitHub @{login()}</>}</Show>
              </div>
            </div>
          </div>
          <form {...stylex.attrs(s.form)} onSubmit={save}>
            <div {...stylex.attrs(s.field)}>
              <Label for="profile-name">Name</Label>
              <div {...stylex.attrs(s.row)}>
                <Input
                  id="profile-name"
                  autocomplete="name"
                  maxlength={80}
                  value={name()}
                  onInput={(e) => {
                    setName(e.currentTarget.value)
                    setMessage(null)
                  }}
                  xstyle={s.grow}
                />
                <Button type="submit" variant="outline" disabled={!changed() || busy()}>Save</Button>
              </div>
              <span {...stylex.attrs(s.subtle)}>Shown on issues you create or are assigned, and to agents.</span>
            </div>
            <Show when={message()}>{(m) => <div {...stylex.attrs(m().error ? s.error : s.success)}>{m().text}</div>}</Show>
          </form>
        </CardContent>
      </Card>
    </section>
  )
}

const Password = () => {
  const [current, setCurrent] = createSignal("")
  const [next, setNext] = createSignal("")
  const [confirm, setConfirm] = createSignal("")
  const [signOutOthers, setSignOutOthers] = createSignal(true)
  const [message, setMessage] = createSignal<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = createSignal(false)

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (busy()) return
    if (next() !== confirm()) return setMessage({ text: "The new passwords do not match.", error: true })
    setBusy(true)
    const { error } = await authClient.changePassword({
      currentPassword: current(),
      newPassword: next(),
      revokeOtherSessions: signOutOthers()
    })
    setBusy(false)
    if (error) return setMessage({ text: authErrorMessage(error, "Could not change the password."), error: true })
    setCurrent("")
    setNext("")
    setConfirm("")
    setMessage({ text: signOutOthers() ? "Password changed. Other devices are signed out." : "Password changed." })
    sessionsChanged()
  }

  return (
    <section {...stylex.attrs(s.section)}>
      <h2 {...stylex.attrs(s.h2)}><LockIcon size={16} /> Password</h2>
      <Card size="sm">
        <CardContent>
          <form {...stylex.attrs(s.form)} onSubmit={submit}>
            <div {...stylex.attrs(s.field)}>
              <Label for="password-current">Current password</Label>
              <Input
                id="password-current"
                type="password"
                autocomplete="current-password"
                required
                value={current()}
                onInput={(e) => setCurrent(e.currentTarget.value)}
              />
            </div>
            <div {...stylex.attrs(s.row)}>
              <div {...stylex.attrs(s.field, s.grow)}>
                <Label for="password-new">New password</Label>
                <Input
                  id="password-new"
                  type="password"
                  autocomplete="new-password"
                  required
                  minlength={8}
                  maxlength={128}
                  value={next()}
                  onInput={(e) => setNext(e.currentTarget.value)}
                />
              </div>
              <div {...stylex.attrs(s.field, s.grow)}>
                <Label for="password-confirm">Repeat new password</Label>
                <Input
                  id="password-confirm"
                  type="password"
                  autocomplete="new-password"
                  required
                  value={confirm()}
                  onInput={(e) => setConfirm(e.currentTarget.value)}
                />
              </div>
            </div>
            <label {...stylex.attrs(s.checkbox)}>
              <input
                type="checkbox"
                checked={signOutOthers()}
                onChange={(e) => setSignOutOthers(e.currentTarget.checked)}
                {...stylex.attrs(s.checkboxInput)}
              />
              Sign out on other devices
            </label>
            <Show when={message()}>{(m) => <div {...stylex.attrs(m().error ? s.error : s.success)}>{m().text}</div>}</Show>
            <div>
              <Button type="submit" variant="outline" disabled={busy()}>Change password</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  )
}

type SessionRow = NonNullable<Awaited<ReturnType<typeof authClient.listSessions>>["data"]>[number]

/** Bumped when something else (a password change) may have ended sessions. */
const [sessionsVersion, setSessionsVersion] = createSignal(0)
const sessionsChanged = () => setSessionsVersion((v) => v + 1)

/** Where this account is signed in; sign out any of them. */
const Sessions = () => {
  const [sessions, setSessions] = createSignal<ReadonlyArray<SessionRow>>([])
  const [error, setError] = createSignal<string | null>(null)
  const currentToken = () => auth.session()?.session.token
  const others = () => sessions().filter((x) => x.token !== currentToken())

  const load = async () => {
    const { data, error } = await authClient.listSessions()
    if (error) return setError(authErrorMessage(error, "Could not load sessions."))
    setError(null)
    setSessions([...(data ?? [])].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()))
  }
  // Load now, and again after a password change that may have signed other devices out.
  createEffect(() => sessionsVersion(), () => void load())

  const revoke = async (token: string) => {
    const { error } = await authClient.revokeSession({ token })
    if (error) return setError(authErrorMessage(error, "Could not sign that session out."))
    await load()
  }
  const revokeOthers = async () => {
    const { error } = await authClient.revokeOtherSessions()
    if (error) return setError(authErrorMessage(error, "Could not sign the other sessions out."))
    await load()
  }

  return (
    <section {...stylex.attrs(s.section)}>
      <h2 {...stylex.attrs(s.h2)}><DeviceIcon size={16} /> Sessions</h2>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Signed in</CardTitle>
          <CardDescription>Sessions last 7 days and renew while you use them.</CardDescription>
        </CardHeader>
        <CardContent>
          <div {...stylex.attrs(s.list)}>
            <For each={sessions()} keyed={(x) => x.id} fallback={<div {...stylex.attrs(s.empty)}>Loading…</div>}>
              {(row) => (
                <div {...stylex.attrs(s.item)}>
                  <span {...stylex.attrs(s.icon)}><DeviceIcon size={15} /></span>
                  <div {...stylex.attrs(s.itemText)}>
                    <span {...stylex.attrs(s.itemTitle)}>{describeAgent(row().userAgent)}</span>
                    <span {...stylex.attrs(s.subtle)}>
                      {row().ipAddress ? `${row().ipAddress} · ` : ""}active {time(row().updatedAt)}
                    </span>
                  </div>
                  <Show
                    when={row().token === currentToken()}
                    fallback={<Button size="sm" variant="ghost" onClick={() => revoke(row().token)}>Sign out</Button>}
                  >
                    <Badge variant="secondary">This device</Badge>
                  </Show>
                </div>
              )}
            </For>
          </div>
          <Show when={error()}>{(e) => <div {...stylex.attrs(s.error)}>{e()}</div>}</Show>
          <Show when={others().length > 1}>
            <div>
              <Button size="sm" variant="outline" onClick={revokeOthers}>Sign out all other sessions</Button>
            </div>
          </Show>
        </CardContent>
      </Card>
    </section>
  )
}

type KeyRow = NonNullable<Awaited<ReturnType<typeof authClient.apiKey.list>>["data"]>["apiKeys"][number]

/** Agent keys: how coding agents (MCP) act as you. */
const AgentKeys = () => {
  const url = useMcpUrl()
  const [keys, setKeys] = createSignal<ReadonlyArray<KeyRow>>([])
  const [loaded, setLoaded] = createSignal(false)
  const [name, setName] = createSignal("")
  const [created, setCreated] = createSignal<{ id: string; name: string; key: string } | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  const load = async () => {
    const { data, error } = await authClient.apiKey.list()
    setLoaded(true)
    if (error) return setError(authErrorMessage(error, "Could not load agent keys."))
    setKeys([...(data?.apiKeys ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))
  }
  onSettled(() => void load())

  const create = async (event: SubmitEvent) => {
    event.preventDefault()
    const keyName = name().trim()
    if (!keyName || busy()) return
    setBusy(true)
    const { data, error } = await authClient.apiKey.create({ name: keyName })
    setBusy(false)
    if (error || !data) return setError(authErrorMessage(error, "Could not create the key."))
    setError(null)
    setName("")
    setCreated({ id: data.id, name: keyName, key: data.key })
    await load()
  }

  const remove = async (row: KeyRow) => {
    if (!confirm(`Delete "${row.name ?? "agent key"}"? Agents using it lose access right away.`)) return
    const { error } = await authClient.apiKey.delete({ keyId: row.id })
    if (error) return setError(authErrorMessage(error, "Could not delete the key."))
    if (created()?.id === row.id) setCreated(null)
    await load()
  }

  return (
    <section {...stylex.attrs(s.section)}>
      <h2 {...stylex.attrs(s.h2)}><KeyIcon size={16} /> Agent keys</h2>
      <Card size="sm">
        <CardHeader>
          <CardTitle>MCP access</CardTitle>
          <CardDescription>
            Coding agents connect to Gradient over MCP with a key and act as you. Make one key per agent or machine, so you can revoke it alone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Show when={created()}>
            {(c) => (
              <div {...stylex.attrs(s.newKey)}>
                <div {...stylex.attrs(s.muted)}>
                  Your new key for <strong>{c().name}</strong>. Copy it now: it is stored hashed and is not shown again.
                </div>
                <div {...stylex.attrs(s.codeRow)}>
                  <code {...stylex.attrs(s.code, s.codeOnSubtle)}>{c().key}</code>
                  <CopyButton text={c().key} />
                </div>
                <For each={agentCommands(url(), c().key)} keyed={(x) => x.name}>
                  {(entry) => (
                    <div {...stylex.attrs(s.codeRow)}>
                      <span {...stylex.attrs(s.agentName)}>{entry().name}</span>
                      <code {...stylex.attrs(s.code, s.codeOnSubtle)}>{entry().command}</code>
                      <CopyButton text={entry().command} />
                    </div>
                  )}
                </For>
                <div>
                  <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>Done</Button>
                </div>
              </div>
            )}
          </Show>
          <form {...stylex.attrs(s.row)} onSubmit={create}>
            <Input
              placeholder="Name, e.g. Claude Code on my laptop"
              aria-label="Key name"
              maxlength={64}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              xstyle={s.grow}
            />
            <Button type="submit" variant="outline" disabled={busy() || !name().trim()}>Create key</Button>
          </form>
          <div {...stylex.attrs(s.list)}>
            <For
              each={keys()}
              keyed={(k) => k.id}
              fallback={<div {...stylex.attrs(s.empty)}>{loaded() ? "No agent keys yet." : "Loading…"}</div>}
            >
              {(row) => (
                <div {...stylex.attrs(s.item)}>
                  <span {...stylex.attrs(s.icon)}><KeyIcon size={15} /></span>
                  <div {...stylex.attrs(s.itemText)}>
                    <span {...stylex.attrs(s.itemTitle)}>{row().name ?? "Agent key"}</span>
                    <span {...stylex.attrs(s.subtle)}>
                      {row().start ? `${row().start}… · ` : ""}created {time(row().createdAt)} · last used {time(row().lastRequest)}
                    </span>
                  </div>
                  <Button size="icon-sm" variant="ghost" title="Delete key" onClick={() => remove(row())}>
                    <TrashIcon size={14} />
                  </Button>
                </div>
              )}
            </For>
          </div>
          <Show when={error()}>{(e) => <div {...stylex.attrs(s.error)}>{e()}</div>}</Show>
        </CardContent>
      </Card>
    </section>
  )
}

/**
 * Your own GitHub account: comments, reviews and merges you make in Gradient
 * go out as it. The workspace's connection only syncs issues (and stands in
 * for you when it is yours).
 */
const Github = () => {
  const acting = () => githubAccount.account()?.actingAs ?? null
  return (
    <section {...stylex.attrs(s.section)} id="github">
      <h2 {...stylex.attrs(s.h2)}><GithubIcon size={16} /> GitHub</h2>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Your GitHub account</CardTitle>
          <CardDescription>
            Comments, reviews and merges you make in Gradient go out as this account, so GitHub shows they are yours
            and applies your permissions. Agents with your keys act as it too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div {...stylex.attrs(s.form)}>
            <Show when={acting()?.via === "workspace" ? acting() : null}>
              {(who) => (
                <span {...stylex.attrs(s.muted)}>
                  You act as @{who().login} through the workspace's GitHub connection, which is yours. Connect an account
                  here to use a different one.
                </span>
              )}
            </Show>
            <GithubConnect />
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

export const ProfilePage = () => (
  <>
    <PageHeader
      title="Profile"
      actions={
        <Button size="sm" variant="ghost" onClick={() => void auth.signOut()}>
          <SignOutIcon size={14} />
          Sign out
        </Button>
      }
    />
    <div {...stylex.attrs(s.page)}>
      <div {...stylex.attrs(s.column)}>
        <Account />
        <Github />
        <Password />
        <Sessions />
        <AgentKeys />
      </div>
    </div>
  </>
)
