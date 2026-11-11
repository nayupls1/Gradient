import { type Invite, INVITE_TTL_DAYS, type InvitePreview, MemberError, type Role, uuidv7 } from "@gradient/domain"
import { Context, Effect, Layer } from "effect"
import { Db, type InviteRow } from "../db/Db.ts"
import { Mutations } from "../sync/Mutations.ts"
import { Auth } from "./Auth.ts"

/*
 * People in the workspace: invites, roles and removal. Admins invite people
 * with a link that works once (optionally only for one email address); the
 * link carries a random token, and only its SHA-256 is stored. Accepting it
 * creates the account even while sign-up is closed, gives it the invite's
 * role and puts it in the invite's teams. Every change clients see goes
 * through `Mutations.transact`.
 */

const fail = (message: string) => Effect.fail(new MemberError({ message }))

/** A token for an invite link: 192 random bits, URL-safe. */
const newToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url")

export const hashToken = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex")

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A Better Auth refusal as the JSON response its own endpoint would send. */
const refusal = (error: unknown) => {
  const e = error as { statusCode?: number; body?: { message?: string; code?: string }; message?: string }
  return Response.json(
    { message: e.body?.message ?? e.message ?? "Could not create the account.", code: e.body?.code ?? null },
    { status: typeof e.statusCode === "number" ? e.statusCode : 500 }
  )
}

const toInvite = (row: InviteRow): Invite => ({
  id: row.id,
  email: row.email,
  role: row.role,
  teamIds: row.teamIds,
  invitedBy: row.invitedBy,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt
})

export interface SignUpBody {
  readonly name: string
  readonly email: string
  readonly password: string
}

const makeMembers = Effect.gen(function*() {
  const db = yield* Db
  const mutations = yield* Mutations
  const { auth, pendingInvites } = yield* Auth

  const requireAdmin = (userId: string, what: string) =>
    Effect.gen(function*() {
      const user = yield* db.getUser(userId)
      if (user?.role !== "admin") return yield* fail(`Only admins can ${what}.`)
      return user
    })

  /** The invite a link points at, if it can still be used. */
  const openInvite = (token: string) =>
    Effect.gen(function*() {
      const row = token ? yield* db.inviteByTokenHash(hashToken(token)) : undefined
      if (!row) return yield* fail("This invite link is not valid. It may have been revoked; ask for a new one.")
      if (row.acceptedAt !== null) return yield* fail("This invite link has already been used.")
      if (row.expiresAt <= Date.now()) return yield* fail("This invite link has expired. Ask for a new one.")
      return row
    })

  const checkEmail = (row: InviteRow, email: string) =>
    row.email && row.email.toLowerCase() !== email.trim().toLowerCase()
      ? fail(`This invite is for ${row.email}.`)
      : Effect.void

  const accountEmail = (accountId: string) =>
    Effect.map(db.sql`SELECT email FROM auth_user WHERE id = ${accountId}`, (rows) => String(rows[0]?.email ?? ""))

  const createInvite = (actorId: string, input: { email: string | null; role: Role; teamIds: ReadonlyArray<string> }) =>
    Effect.gen(function*() {
      const actor = yield* requireAdmin(actorId, "invite people")
      const email = input.email?.trim().toLowerCase() || null
      if (email !== null && !EMAIL.test(email)) return yield* fail(`"${input.email}" is not an email address.`)
      if (email !== null) {
        const taken = yield* db.sql`SELECT 1 FROM auth_user WHERE email = ${email} COLLATE NOCASE`
        if (taken.length > 0) return yield* fail(`${email} already has an account. Add them to a team instead.`)
      }
      const teams = yield* db.teams
      const teamIds = [...new Set(input.teamIds)]
      for (const id of teamIds) {
        if (!teams.some((t) => t.id === id)) return yield* fail("Unknown team.")
      }
      const now = Date.now()
      const token = newToken()
      const row: InviteRow = {
        id: uuidv7(),
        email,
        role: input.role,
        teamIds,
        invitedBy: actor.id,
        createdAt: now,
        expiresAt: now + INVITE_TTL_DAYS * 86_400_000,
        acceptedAt: null,
        acceptedBy: null
      }
      yield* db.putInvite(row, hashToken(token))
      return { invite: toInvite(row), token }
    }).pipe(Effect.catchTag("SqlError", Effect.die))

  const listInvites = (actorId: string) =>
    Effect.gen(function*() {
      yield* requireAdmin(actorId, "see invites")
      return (yield* db.invites).map(toInvite)
    }).pipe(Effect.catchTag("SqlError", Effect.die))

  const revokeInvite = (actorId: string, id: string) =>
    Effect.gen(function*() {
      yield* requireAdmin(actorId, "revoke invites")
      yield* db.deleteInvite(id)
    }).pipe(Effect.catchTag("SqlError", Effect.die))

  /** What the invite page shows before anyone signs in. */
  const preview = (token: string) =>
    Effect.gen(function*() {
      const row = yield* openInvite(token)
      const teams = (yield* db.teams).filter((t) => row.teamIds.includes(t.id))
      const inviter = row.invitedBy ? yield* db.getUser(row.invitedBy) : undefined
      return {
        email: row.email,
        role: row.role,
        teams: teams.map((t) => ({ id: t.id, key: t.key, name: t.name })),
        invitedBy: inviter?.name ?? null,
        expiresAt: row.expiresAt
      } satisfies InvitePreview
    }).pipe(Effect.catchTag("SqlError", Effect.die))

  /**
   * Create an account from an invite and sign it in: Better Auth's own
   * sign-up, let through while sign-up is closed. The invite is claimed first,
   * so it works once even when two people try at the same time, and given back
   * when the sign-up fails (say, a password that is too short).
   */
  const acceptWithSignUp = (token: string, body: SignUpBody, headers: Headers) =>
    Effect.gen(function*() {
      const row = yield* openInvite(token)
      const email = body.email.trim().toLowerCase()
      if (!EMAIL.test(email)) return yield* fail("Enter your email address.")
      yield* checkEmail(row, email)
      if (!(yield* db.claimInvite(row.id, Date.now()))) return yield* fail("This invite link has already been used.")
      pendingInvites.set(email, row)
      const response = yield* Effect.tryPromise(() =>
        auth.api.signUpEmail({ body: { name: body.name.trim(), email, password: body.password }, headers, asResponse: true })
      ).pipe(
        // Better Auth throws its refusals (a short password, a taken email) even when asked for a response.
        Effect.catch((e) => Effect.succeed(refusal(e.cause))),
        Effect.ensuring(Effect.sync(() => pendingInvites.delete(email)))
      )
      if (!response.ok) yield* db.unclaimInvite(row.id)
      return response
    }).pipe(Effect.catchTag("SqlError", Effect.die))

  /** Accept an invite as an account that already exists: join its teams, and take its role when it is higher. */
  const acceptAsViewer = (token: string, viewer: { userId: string; accountId: string }) =>
    Effect.gen(function*() {
      const row = yield* openInvite(token)
      yield* checkEmail(row, yield* accountEmail(viewer.accountId))
      if (!(yield* db.claimInvite(row.id, Date.now()))) return yield* fail("This invite link has already been used.")
      const { value } = yield* mutations.transact({ origin: "system", actorId: viewer.userId }, (tx) =>
        Effect.gen(function*() {
          const user = yield* db.getUser(viewer.userId)
          if (user && row.role === "admin" && user.role !== "admin") {
            yield* db.setRole(user.id, "admin")
            tx.touch("user", user.id)
          }
          const teams = (yield* db.teams).filter((t) => row.teamIds.includes(t.id))
          for (const team of teams) {
            if (yield* db.membership(team.id, viewer.userId)) continue
            const id = uuidv7()
            yield* db.putTeamMember({ id, teamId: team.id, userId: viewer.userId, createdAt: tx.now })
            tx.touch("teamMember", id)
          }
          yield* db.inviteAcceptedBy(row.id, viewer.userId)
          return teams.map((t) => t.id)
        }))
      return { teamIds: value }
    }).pipe(Effect.catchTag("SqlError", Effect.die))

  const setRole = (actorId: string, userId: string, role: Role) =>
    Effect.gen(function*() {
      yield* requireAdmin(actorId, "change roles")
      const user = yield* db.getUser(userId)
      if (!user?.role) return yield* fail("That person has no account.")
      if (user.role === role) return
      if (user.role === "admin" && (yield* db.adminCount) <= 1) {
        return yield* fail(`${user.name} is the last admin. Make someone else an admin first.`)
      }
      yield* mutations.transact({ origin: "system", actorId }, (tx) =>
        Effect.gen(function*() {
          yield* db.setRole(userId, role)
          tx.touch("user", userId)
        }))
    }).pipe(Effect.catchTag("SqlError", Effect.die))

  /**
   * Remove someone from the workspace: delete their account (Better Auth
   * drops its sessions; agent keys and logins go with it), then take their
   * role and team memberships. Their user stays, so issues keep their creator
   * and assignee. Open sync connections end at their next session check.
   */
  const removeMember = (actorId: string, userId: string) =>
    Effect.gen(function*() {
      yield* requireAdmin(actorId, "remove people")
      if (userId === actorId) return yield* fail("You cannot remove yourself.")
      const user = yield* db.getUser(userId)
      if (!user?.role) return yield* fail("That person is not a member of this workspace.")
      const accountId = yield* db.accountOfUser(userId)
      if (accountId) {
        yield* Effect.promise(async () => {
          const context = await auth.$context
          await context.internalAdapter.deleteUserSessions(accountId)
          await context.internalAdapter.deleteUser(accountId)
        })
      }
      yield* mutations.transact({ origin: "system", actorId }, (tx) =>
        Effect.gen(function*() {
          for (const member of yield* db.teamsOfUser(userId)) {
            yield* db.deleteTeamMember(member.id)
            tx.touch("teamMember", member.id, "delete")
          }
          yield* db.setRole(userId, null)
          tx.touch("user", userId)
        }))
    }).pipe(Effect.catchTag("SqlError", Effect.die))

  const emails = (actorId: string) =>
    Effect.gen(function*() {
      yield* requireAdmin(actorId, "see email addresses")
      return Object.fromEntries(yield* db.memberEmails)
    }).pipe(Effect.catchTag("SqlError", Effect.die))

  return { createInvite, listInvites, revokeInvite, preview, acceptWithSignUp, acceptAsViewer, setRole, removeMember, emails }
})

export class Members extends Context.Service<Members, Effect.Success<typeof makeMembers>>()("gradient/Members") {
  static readonly layer = Layer.effect(Members, makeMembers)
}
