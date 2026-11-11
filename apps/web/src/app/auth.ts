import { apiKeyClient } from "@better-auth/api-key/client"
import type { InvitePreview } from "@gradient/domain"
import { createAuthClient } from "better-auth/client"
import { createSignal } from "solid-js"

/*
 * Accounts (Better Auth, email and password). The server keeps the session in
 * an HttpOnly cookie; this module only knows whether there is one, and who.
 * The sync engine needs a session: without one the app shows the sign-in page.
 */

export const authClient = createAuthClient({
  baseURL: `${location.origin}/api/auth`,
  plugins: [apiKeyClient()]
})

export type Session = typeof authClient.$Infer.Session

/** What the sign-in page needs before anyone is signed in (`/api/auth-config`). */
export interface AuthConfig {
  readonly signUpOpen: boolean
  readonly firstAccount: boolean
}

/** `undefined` until the first check finishes, then the session or null. */
const [session, setSession] = createSignal<Session | null | undefined>(undefined)

/** Ask the server who is signed in. A network failure keeps what we knew. */
const refresh = async () => {
  try {
    const { data, error } = await authClient.getSession()
    if (!error) setSession(data ?? null)
  } catch {
    if (session() === undefined) setSession(null)
  }
  return session()
}

let lastCheck = 0
/**
 * The sync connection dropped. If the session is gone (signed out elsewhere,
 * revoked, expired), go back to the sign-in page; if the server is just
 * unreachable, keep retrying. Checks at most every few seconds.
 */
const connectionLost = () => {
  if (Date.now() - lastCheck < 5000) return
  lastCheck = Date.now()
  void refresh()
}

const signOut = async () => {
  await authClient.signOut().catch(() => {})
  setSession(null)
}

/** Readable message for a Better Auth error, or a fallback. */
export const authErrorMessage = (error: { message?: string | undefined; status?: number } | null | undefined, fallback: string) =>
  error?.message || (error?.status === 429 ? "Too many attempts. Wait a minute and try again." : fallback)

/** The token of an invite link the page was opened with (`/invite/<token>`), if any. */
export const inviteTokenFromPath = (path = location.pathname) => path.match(/^\/invite\/([^/?#]+)/)?.[1] ?? null

/** What an invite offers, or the reason it cannot be used. */
const invitePreview = async (token: string): Promise<{ ok: true; invite: InvitePreview } | { ok: false; message: string }> => {
  try {
    const res = await fetch(`/api/invites/${encodeURIComponent(token)}`)
    const body = (await res.json()) as InvitePreview & { message?: string }
    return res.ok ? { ok: true, invite: body } : { ok: false, message: body.message ?? "This invite link is not valid." }
  } catch {
    return { ok: false, message: "Gradient is not reachable. Is the server running?" }
  }
}

/** Create an account from an invite; the response signs it in. Returns an error message, or null. */
const acceptInvite = async (token: string, account: { name: string; email: string; password: string }) => {
  const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(account)
  })
  if (res.ok) return null
  const body = (await res.json().catch(() => ({}))) as { message?: string }
  return authErrorMessage({ message: body.message, status: res.status }, "Could not create the account.")
}

export const auth = {
  session,
  refresh,
  /** After sign-in or sign-up: the cookie is set, load the session it belongs to. */
  signedIn: refresh,
  /** The server said this connection's session has ended. */
  sessionEnded: () => setSession(null),
  connectionLost,
  signOut,
  invitePreview,
  acceptInvite,
  config: async (): Promise<AuthConfig> => {
    const res = await fetch("/api/auth-config")
    return res.ok ? ((await res.json()) as AuthConfig) : { signUpOpen: false, firstAccount: false }
  }
}
