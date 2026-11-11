import { invitePath } from "@gradient/domain"
import { createSignal } from "solid-js"

/*
 * Invites are not part of the synced model (their links are secrets, shown
 * once to the admin who makes them), so pages that list them reload when one
 * is made or revoked.
 */

const [invitesVersion, setInvitesVersion] = createSignal(0)

export const invites = {
  /** Bumps after an invite is created or revoked; read it to reload a list. */
  version: invitesVersion,
  changed: () => setInvitesVersion((v) => v + 1)
}

/** The link someone opens to accept an invite. */
export const inviteUrl = (token: string) => `${location.origin}${invitePath(token)}`

/** The message of an RPC error (MemberError and friends), or the error itself. */
export const errorText = (e: unknown) => (e as { message?: string } | null)?.message ?? String(e)

export const roleLabel = { admin: "Admin", member: "Member" } as const
