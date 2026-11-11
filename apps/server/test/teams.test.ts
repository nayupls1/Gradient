import { afterEach, describe, expect, test } from "bun:test"
import { type Mutation, type Snapshot, uuidv7 } from "@gradient/domain"
import { Effect } from "effect"
import { Db } from "../src/db/Db.ts"
import { type Account, authPost, cookiesOf, createApiKey, OWNER, runRpc, signUp, startServer } from "./helpers.ts"

const GRACE: Account = { name: "Grace Hopper", email: "grace@example.com", password: "compilers all the way" }
const ALAN: Account = { name: "Alan Turing", email: "alan@example.com", password: "imitation game rules" }

const servers: Array<ReturnType<typeof startServer>> = []
afterEach(async () => {
  for (const s of servers.splice(0)) await s.dispose()
})
const start = async () => {
  const server = startServer()
  servers.push(server)
  await server.start()
  return server
}
type Server = Awaited<ReturnType<typeof start>>

const db = <A>(server: Server, f: (db: Db["Service"]) => Effect.Effect<A, unknown>) =>
  server.runtime.runPromise(Effect.flatMap(Effect.service(Db), f) as Effect.Effect<A>)

const bootstrap = (server: Server, cookie: string): Promise<Snapshot> => runRpc(server.port, cookie, (c) => c.Bootstrap())
const mutate = (server: Server, cookie: string, ...mutations: Array<Mutation>) =>
  runRpc(server.port, cookie, (c) => c.Mutate({ clientTxId: uuidv7(), mutations }))
const invite = (server: Server, cookie: string, input: { email?: string | null; role?: "admin" | "member"; teamIds: Array<string> }) =>
  runRpc(server.port, cookie, (c) =>
    c.InviteCreate({ email: input.email ?? null, role: input.role ?? "member", teamIds: input.teamIds }))
const preview = (server: Server, token: string) => fetch(`${server.base}/api/invites/${token}`)
const accept = (server: Server, token: string, account: Account) =>
  fetch(`${server.base}/api/invites/${token}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: server.base },
    body: JSON.stringify(account)
  })

/** The owner (admin) and the seeded team. */
const setup = async () => {
  const server = await start()
  const owner = await signUp(server.base)
  const snap = await bootstrap(server, owner)
  return { server, owner, snap, team: snap.teams[0]! }
}

/** Invite someone into `teamIds` and accept, returning their session cookie. */
const join = async (server: Server, admin: string, account: Account, teamIds: Array<string>, role: "admin" | "member" = "member") => {
  const { token } = await invite(server, admin, { email: account.email, role, teamIds })
  const res = await accept(server, token, account)
  if (!res.ok) throw new Error(`accept failed: ${res.status} ${await res.text()}`)
  return cookiesOf(res)
}

const membersOf = (snap: Snapshot, teamId: string) =>
  snap.teamMembers.filter((m) => m.teamId === teamId).map((m) => snap.users.find((u) => u.id === m.userId)?.name).sort()

describe("teams", () => {
  test("the first account is the admin and a member of the seeded team", async () => {
    const { snap, team } = await setup()
    const me = snap.users.find((u) => u.id === snap.viewerId)!
    expect(me.role).toBe("admin")
    expect(membersOf(snap, team.id)).toEqual([OWNER.name])
  })

  test("creating a team gives it the default workflow and labels, with its creator in it", async () => {
    const { server, owner } = await setup()
    const id = uuidv7()
    await mutate(server, owner, { _tag: "TeamCreate", id, key: "WEB", name: "Web" })
    const snap = await bootstrap(server, owner)
    expect(snap.teams.find((t) => t.id === id)).toMatchObject({ key: "WEB", name: "Web", issueCounter: 0 })
    expect(snap.workflowStates.filter((s) => s.teamId === id).map((s) => s.name)).toEqual([
      "Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled"
    ])
    expect(snap.labels.filter((l) => l.teamId === id).map((l) => l.name).sort()).toEqual(["Bug", "Chore", "Feature", "Improvement"])
    expect(membersOf(snap, id)).toEqual([OWNER.name])

    // Issues in the new team count from 1 and use its key.
    const todo = snap.workflowStates.find((s) => s.teamId === id && s.name === "Todo")!
    await mutate(server, owner, {
      _tag: "IssueCreate", id: uuidv7(), teamId: id, projectId: null, title: "First", description: "",
      stateId: todo.id, priority: 0, assigneeId: null, labelIds: [], sortOrder: "a0"
    })
    const after = await bootstrap(server, owner)
    expect(after.issues.find((i) => i.teamId === id)?.number).toBe(1)
  })

  test("keys are unique across teams and projects", async () => {
    const { server, owner, team } = await setup()
    const create = (key: string, name = `Team ${key}`) => mutate(server, owner, { _tag: "TeamCreate", id: uuidv7(), key, name })
    await expect(create("GRD")).rejects.toThrow(/taken by the team "Gradient"/)
    // The seeded project "App" has the key APP.
    await expect(create("APP")).rejects.toThrow(/taken by the project "App"/)
    await expect(create("w")).rejects.toThrow(/not a valid key/)
    await expect(create("WEB", "gradient")).rejects.toThrow(/already exists/)
    await create("WEB", "Web")
    await expect(
      mutate(server, owner, { _tag: "ProjectCreate", id: uuidv7(), teamId: team.id, key: "WEB", name: "Website", color: "#000000" })
    ).rejects.toThrow(/taken by the team "Web"/)
    const web = (await bootstrap(server, owner)).teams.find((t) => t.key === "WEB")!
    await mutate(server, owner, { _tag: "ProjectCreate", id: uuidv7(), teamId: web.id, key: "SIT", name: "Site", color: "#000000" })
    await expect(
      mutate(server, owner, { _tag: "ProjectCreate", id: uuidv7(), teamId: team.id, key: "SIT", name: "Site", color: "#000000" })
    ).rejects.toThrow(/taken by the project "Site"/)
    await expect(mutate(server, owner, { _tag: "TeamUpdate", id: web.id, patch: { key: "APP" } })).rejects.toThrow(/taken by the project/)
    await mutate(server, owner, { _tag: "TeamUpdate", id: web.id, patch: { key: "WWW", name: "Website team" } })
    expect((await bootstrap(server, owner)).teams.find((t) => t.id === web.id)).toMatchObject({ key: "WWW", name: "Website team" })
  })

  test("anyone joins or leaves a team; managing others takes membership or admin", async () => {
    const { server, owner, team } = await setup()
    const webId = uuidv7()
    await mutate(server, owner, { _tag: "TeamCreate", id: webId, key: "WEB", name: "Web" })
    const grace = await join(server, owner, GRACE, [team.id])
    const alan = await join(server, owner, ALAN, [team.id])
    const snap = await bootstrap(server, grace)
    const graceId = snap.viewerId
    const alanId = snap.users.find((u) => u.name === ALAN.name)!.id

    // Grace is not in Web: she cannot add Alan, but can join herself.
    await expect(mutate(server, grace, { _tag: "TeamMemberAdd", id: uuidv7(), teamId: webId, userId: alanId }))
      .rejects.toThrow(/Only members of the team and admins/)
    const graceInWeb = uuidv7()
    await mutate(server, grace, { _tag: "TeamMemberAdd", id: graceInWeb, teamId: webId, userId: graceId })
    await expect(mutate(server, grace, { _tag: "TeamMemberAdd", id: uuidv7(), teamId: webId, userId: graceId }))
      .rejects.toThrow(/already in Web/)
    // Now she is in it, she can add Alan; Alan cannot rename a team he is not in... until added.
    await expect(mutate(server, alan, { _tag: "TeamUpdate", id: webId, patch: { name: "Alan's" } })).rejects.toThrow(/Only members/)
    await mutate(server, grace, { _tag: "TeamMemberAdd", id: uuidv7(), teamId: webId, userId: alanId })
    expect(membersOf(await bootstrap(server, owner), webId)).toEqual([ALAN.name, OWNER.name, GRACE.name].sort())

    // People without an account cannot be members.
    const ghost = uuidv7()
    await db(server, (d) => d.putUser({ id: ghost, name: "octocat", githubLogin: "octocat", avatarUrl: null, role: null }))
    await expect(mutate(server, owner, { _tag: "TeamMemberAdd", id: uuidv7(), teamId: webId, userId: ghost }))
      .rejects.toThrow(/has no account/)

    // Leaving is always allowed.
    await mutate(server, grace, { _tag: "TeamMemberRemove", id: graceInWeb })
    expect(membersOf(await bootstrap(server, owner), webId)).toEqual([ALAN.name, OWNER.name].sort())
  })

  test("only admins delete teams, and only empty ones; never the last", async () => {
    const { server, owner, team } = await setup()
    await expect(mutate(server, owner, { _tag: "TeamDelete", id: team.id })).rejects.toThrow(/last team/)
    const webId = uuidv7()
    await mutate(server, owner, { _tag: "TeamCreate", id: webId, key: "WEB", name: "Web" })
    await expect(mutate(server, owner, { _tag: "TeamDelete", id: team.id })).rejects.toThrow(/still has \d+ issues/)
    const grace = await join(server, owner, GRACE, [webId])
    await expect(mutate(server, grace, { _tag: "TeamDelete", id: webId })).rejects.toThrow(/Only admins/)
    await mutate(server, owner, { _tag: "ProjectCreate", id: uuidv7(), teamId: webId, key: "SIT", name: "Site", color: "#000000" })
    await mutate(server, owner, { _tag: "TeamDelete", id: webId })
    const snap = await bootstrap(server, owner)
    expect(snap.teams.map((t) => t.id)).toEqual([team.id])
    expect(snap.workflowStates.some((s) => s.teamId === webId)).toBe(false)
    expect(snap.labels.some((l) => l.teamId === webId)).toBe(false)
    expect(snap.projects.some((p) => p.teamId === webId)).toBe(false)
    expect(snap.teamMembers.some((m) => m.teamId === webId)).toBe(false)
  })
})

describe("invites", () => {
  test("an admin's invite creates an account while sign-up is closed, with the invite's role and teams", async () => {
    const { server, owner, team } = await setup()
    const webId = uuidv7()
    await mutate(server, owner, { _tag: "TeamCreate", id: webId, key: "WEB", name: "Web" })
    const { invite: created, token } = await invite(server, owner, { email: "Grace@Example.com", teamIds: [webId] })
    expect(created.email).toBe("grace@example.com")
    expect(created.expiresAt - created.createdAt).toBe(7 * 86_400_000)
    expect(await runRpc(server.port, owner, (c) => c.InviteList())).toHaveLength(1)

    // The token is not stored, only its hash.
    const rows = await db(server, (d) => d.sql`SELECT token_hash FROM invite`)
    expect(String(rows[0]!.token_hash)).not.toContain(token)

    const shown = await (await preview(server, token)).json()
    expect(shown).toMatchObject({ email: "grace@example.com", role: "member", invitedBy: OWNER.name, teams: [{ key: "WEB", name: "Web" }] })

    // Ordinary sign-up stays closed.
    expect((await authPost(server.base, "/sign-up/email", GRACE)).status).toBe(403)
    const wrong = await accept(server, token, { ...GRACE, email: "someone@example.com" })
    expect(wrong.status).toBe(400)
    expect(((await wrong.json()) as { message: string }).message).toContain("for grace@example.com")

    const res = await accept(server, token, GRACE)
    expect(res.status).toBe(200)
    const grace = cookiesOf(res)
    const snap = await bootstrap(server, grace)
    expect(snap.users.find((u) => u.id === snap.viewerId)).toMatchObject({ name: GRACE.name, role: "member" })
    expect(membersOf(snap, webId)).toEqual([GRACE.name, OWNER.name].sort())
    expect(membersOf(snap, team.id)).toEqual([OWNER.name])

    // Used up.
    expect((await accept(server, token, ALAN)).status).toBe(400)
    expect((await preview(server, token)).status).toBe(404)
    expect(await runRpc(server.port, owner, (c) => c.InviteList())).toHaveLength(0)
  })

  test("a failed sign-up gives the invite back", async () => {
    const { server, owner, team } = await setup()
    const { token } = await invite(server, owner, { teamIds: [team.id] })
    const short = await accept(server, token, { ...GRACE, password: "short" })
    expect(short.ok).toBe(false)
    expect((await accept(server, token, GRACE)).status).toBe(200)
  })

  test("an existing email cannot be invited; expired and revoked links stop working", async () => {
    const { server, owner, team } = await setup()
    await expect(invite(server, owner, { email: OWNER.email, teamIds: [team.id] })).rejects.toThrow(/already has an account/)
    await expect(invite(server, owner, { email: "not an email", teamIds: [team.id] })).rejects.toThrow(/not an email/)

    const expired = await invite(server, owner, { teamIds: [team.id] })
    await db(server, (d) => d.sql`UPDATE invite SET expires_at = 1 WHERE id = ${expired.invite.id}`)
    expect(((await (await preview(server, expired.token)).json()) as { message: string }).message).toContain("expired")
    expect((await accept(server, expired.token, GRACE)).status).toBe(400)

    const revoked = await invite(server, owner, { teamIds: [team.id] })
    await runRpc(server.port, owner, (c) => c.InviteRevoke({ id: revoked.invite.id }))
    expect((await preview(server, revoked.token)).status).toBe(404)
  })

  test("only admins invite; an admin invite makes an admin", async () => {
    const { server, owner, team } = await setup()
    const grace = await join(server, owner, GRACE, [team.id])
    await expect(invite(server, grace, { teamIds: [team.id] })).rejects.toThrow(/Only admins can invite/)
    await expect(runRpc(server.port, grace, (c) => c.InviteList())).rejects.toThrow(/Only admins/)
    const alan = await join(server, owner, ALAN, [team.id], "admin")
    const snap = await bootstrap(server, alan)
    expect(snap.users.find((u) => u.id === snap.viewerId)?.role).toBe("admin")
    await invite(server, alan, { teamIds: [team.id] })
  })

  test("a signed-in account accepts an invite to join its teams", async () => {
    const { server, owner, team } = await setup()
    const webId = uuidv7()
    await mutate(server, owner, { _tag: "TeamCreate", id: webId, key: "WEB", name: "Web" })
    const grace = await join(server, owner, GRACE, [team.id])
    const { token } = await invite(server, owner, { role: "admin", teamIds: [webId] })
    expect(await runRpc(server.port, grace, (c) => c.InviteAccept({ token }))).toEqual({ teamIds: [webId] })
    const snap = await bootstrap(server, grace)
    expect(snap.users.find((u) => u.id === snap.viewerId)?.role).toBe("admin")
    expect(membersOf(snap, webId)).toContain(GRACE.name)
    await expect(runRpc(server.port, grace, (c) => c.InviteAccept({ token }))).rejects.toThrow(/already been used/)

    const forAlan = await invite(server, owner, { email: ALAN.email, teamIds: [webId] })
    await expect(runRpc(server.port, grace, (c) => c.InviteAccept({ token: forAlan.token }))).rejects.toThrow(/for alan@example.com/)
  })
})

describe("members", () => {
  test("admins change roles, but the last admin cannot step down", async () => {
    const { server, owner, snap, team } = await setup()
    const grace = await join(server, owner, GRACE, [team.id])
    const graceId = (await bootstrap(server, grace)).viewerId
    await expect(runRpc(server.port, owner, (c) => c.MemberSetRole({ userId: snap.viewerId, role: "member" })))
      .rejects.toThrow(/last admin/)
    await expect(runRpc(server.port, grace, (c) => c.MemberSetRole({ userId: graceId, role: "admin" })))
      .rejects.toThrow(/Only admins/)
    await runRpc(server.port, owner, (c) => c.MemberSetRole({ userId: graceId, role: "admin" }))
    await runRpc(server.port, grace, (c) => c.MemberSetRole({ userId: snap.viewerId, role: "member" }))
    const after = await bootstrap(server, owner)
    expect(after.users.find((u) => u.id === snap.viewerId)?.role).toBe("member")
    expect(after.users.find((u) => u.id === graceId)?.role).toBe("admin")
    const emails = await runRpc(server.port, grace, (c) => c.MemberEmails())
    expect(emails).toEqual({ [snap.viewerId]: OWNER.email, [graceId]: GRACE.email })
  })

  test("removing someone deletes their account and sessions; their user stays on the issues", async () => {
    const { server, owner, snap, team } = await setup()
    const grace = await join(server, owner, GRACE, [team.id])
    const graceId = (await bootstrap(server, grace)).viewerId
    const key = await createApiKey(server.base, grace)
    const issue = snap.issues[0]!
    await mutate(server, grace, { _tag: "IssueUpdate", id: issue.id, patch: { assigneeId: graceId } })

    await expect(runRpc(server.port, owner, (c) => c.MemberRemove({ userId: snap.viewerId }))).rejects.toThrow(/yourself/)
    await expect(runRpc(server.port, grace, (c) => c.MemberRemove({ userId: snap.viewerId }))).rejects.toThrow(/Only admins/)
    await runRpc(server.port, owner, (c) => c.MemberRemove({ userId: graceId }))

    const after = await bootstrap(server, owner)
    expect(after.users.find((u) => u.id === graceId)).toMatchObject({ name: GRACE.name, role: null })
    expect(after.teamMembers.some((m) => m.userId === graceId)).toBe(false)
    expect(after.issues.find((i) => i.id === issue.id)?.assigneeId).toBe(graceId)
    // Her session and agent key are gone, and she cannot sign in.
    const upgrade = await fetch(`${server.base}/rpc`, {
      headers: {
        upgrade: "websocket",
        connection: "upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        cookie: grace
      }
    })
    expect(upgrade.status).toBe(401)
    const mcp = await fetch(`${server.base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${key.key}` } })
    expect(mcp.status).toBe(401)
    expect((await authPost(server.base, "/sign-in/email", { email: GRACE.email, password: GRACE.password })).status).toBe(401)
    // Invited again, she gets a fresh user; the old one keeps the history.
    const again = await join(server, owner, GRACE, [team.id])
    expect((await bootstrap(server, again)).viewerId).not.toBe(graceId)
  })
})

describe("teams over MCP", () => {
  const headers = (key: string, session: string) => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
    authorization: `Bearer ${key}`,
    ...(session ? { "mcp-session-id": session } : {})
  })
  const parse = async (res: Response) => {
    const text = await res.text()
    return JSON.parse(text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))!.slice(5))
  }
  /** An MCP session for an agent key: initialize, then call tools. */
  const mcpSession = async (server: Server, key: string) => {
    const init = await fetch(`${server.base}/mcp`, {
      method: "POST",
      headers: headers(key, ""),
      body: JSON.stringify({
        jsonrpc: "2.0", id: 0, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }
      })
    })
    const session = init.headers.get("mcp-session-id") ?? ""
    await init.text()
    await fetch(`${server.base}/mcp`, {
      method: "POST",
      headers: headers(key, session),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    })
    let id = 1
    return async (name: string, args: object = {}) => {
      const res = await fetch(`${server.base}/mcp`, {
        method: "POST",
        headers: headers(key, session),
        body: JSON.stringify({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } })
      })
      const { result } = await parse(res)
      return { isError: result.isError === true, data: result.structuredContent, text: result.content?.[0]?.text as string }
    }
  }

  test("agents create teams, manage members, invite people and work across teams", async () => {
    const { server, owner } = await setup()
    const call = await mcpSession(server, (await createApiKey(server.base, owner)).key)

    const created = await call("create_team", { name: "Mobile" })
    expect(created.data).toEqual({ name: "Mobile", key: "MOB", members: [OWNER.name] })

    const issue = await call("create_issue", { team: "mob", title: "Offline mode" })
    expect(issue.data.id).toBe("MOB-1")
    // Identifiers find their team without naming it.
    expect((await call("get_issue", { id: "MOB-1" })).data.title).toBe("Offline mode")
    expect((await call("update_issue", { id: "MOB-1", state: "In Progress" })).data.state).toBe("In Progress")
    const linked = await call("link_issues", { id: "MOB-1", relation: "blocks", other: "GRD-1" })
    expect(linked.isError).toBe(true)
    expect(JSON.parse(linked.text).message).toContain("same team")

    const described = await call("describe_workspace", { team: "Mobile" })
    expect(described.data.team).toEqual({ key: "MOB", name: "Mobile", members: [OWNER.name] })
    expect(described.data.teams.map((t: any) => t.key).sort()).toEqual(["GRD", "MOB"])
    expect(described.data.your_role).toBe("admin")
    const unknown = await call("list_issues", { team: "Nope" })
    expect(unknown.isError).toBe(true)
    expect(JSON.parse(unknown.text).message).toContain("\"Mobile\" (MOB)")
    expect((await call("list_issues", { team: "MOB" })).data.issues.map((i: any) => i.id)).toEqual(["MOB-1"])

    const invited = await call("invite_person", { email: GRACE.email, teams: ["Mobile"] })
    expect(invited.data).toMatchObject({ email: GRACE.email, role: "member", teams: ["Mobile"] })
    const token = (invited.data.url as string).split("/invite/")[1]!
    expect(invited.data.url).toBe(`${server.base}/invite/${token}`)
    expect((await accept(server, token, GRACE)).status).toBe(200)

    const missing = await call("add_team_member", { team: "GRD", person: "Nobody" })
    expect(missing.isError).toBe(true)
    expect(JSON.parse(missing.text).message).toContain("invite_person")
    expect((await call("add_team_member", { team: "GRD", person: GRACE.name })).data.members)
      .toEqual([OWNER.name, GRACE.name])
    expect((await call("remove_team_member", { team: "MOB", person: "me" })).data.members).toEqual([GRACE.name])
    expect((await call("update_team", { team: "MOB", name: "Mobile apps", key: "APPS" })).data)
      .toEqual({ name: "Mobile apps", key: "APPS", members: [GRACE.name] })
    expect((await call("get_issue", { id: "APPS-1" })).data.id).toBe("APPS-1")
  })
})
