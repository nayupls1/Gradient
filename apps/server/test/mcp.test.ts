import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime, Option } from "effect"
import { AppServices, HttpLive } from "../src/app.ts"
import { ServerConfig } from "../src/config.ts"
import { Db } from "../src/db/Db.ts"

const port = 20000 + Math.floor(Math.random() * 20000)
const base = `http://127.0.0.1:${port}`
const server = ManagedRuntime.make(
  Layer.merge(AppServices, HttpLive.pipe(Layer.provide(AppServices))).pipe(
    Layer.provideMerge(Layer.succeed(ServerConfig, {
      port,
      host: "127.0.0.1",
      dbPath: ":memory:",
      webDist: "/nonexistent",
      seedSampleData: true,
      github: {
        enabled: false,
        token: Option.none(),
        tokenSource: null,
        apiUrl: "http://127.0.0.1:1",
        webUrl: "http://127.0.0.1:1",
        app: { clientId: null, slug: null },
        webhookSecret: Option.none(),
        pollIntervalSeconds: 3600
      }
    }))
  )
)

let session = ""
let nextId = 1
const rpc = async (method: string, params: object = {}) => {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(session ? { "mcp-session-id": session } : {})
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params })
  })
  session ||= res.headers.get("mcp-session-id") ?? ""
  const text = await res.text()
  // Responses may come as JSON or as a single SSE event.
  const json = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))!.slice(5)
  return JSON.parse(json)
}
const call = async (name: string, args: object = {}) => {
  const { result } = await rpc("tools/call", { name, arguments: args })
  return { isError: result.isError === true, data: result.structuredContent, text: result.content?.[0]?.text as string }
}

beforeAll(async () => {
  await server.runPromise(Effect.void)
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } })
  await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": session, "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
  })
})
afterAll(() => server.dispose())

describe("MCP", () => {
  test("lists the tools with read-only hints", async () => {
    const { result } = await rpc("tools/list")
    const tools = Object.fromEntries(result.tools.map((t: any) => [t.name, t]))
    expect(Object.keys(tools).sort()).toEqual([
      "create_issue",
      "create_project",
      "describe_workspace",
      "get_issue",
      "github_sign_in",
      "github_status",
      "link_issues",
      "list_issues",
      "unlink_issues",
      "update_issue"
    ])
    expect(tools.github_status.annotations.readOnlyHint).toBe(true)
    expect(tools.list_issues.annotations.readOnlyHint).toBe(true)
    expect(tools.create_issue.annotations.destructiveHint).toBe(false)
  })

  test("describes the workspace in names, not ids", async () => {
    const { data } = await call("describe_workspace")
    expect(data.team.key).toBe("GRD")
    expect(data.states.map((s: any) => s.name)).toContain("In Progress")
    expect(data.labels).toContain("Bug")
    expect(data.projects.map((p: any) => p.name).sort()).toEqual(["App", "Sync engine"])
    expect(data.projects.every((p: any) => p.githubRepo === null)).toBe(true)
  })

  test("projects: create one, file issues into it, filter by it, move issues out", async () => {
    const project = await call("create_project", { name: "Agents" })
    expect(project.data).toMatchObject({ name: "Agents", github_repo: null })
    const dup = await call("create_project", { name: "agents" })
    expect(dup.isError).toBe(true)
    expect(dup.text).toContain("already exists")

    const created = await call("create_issue", { title: "Teach agents about projects", project: "Agents" })
    expect(created.data.project).toBe("Agents")
    // The identifier carries the project's key; the team key with the same number still finds it.
    expect(created.data.id).toMatch(/^AGE-\d+$/)
    const number = created.data.id.split("-")[1]
    expect((await call("get_issue", { id: `GRD-${number}` })).data.title).toBe("Teach agents about projects")
    const listed = await call("list_issues", { project: "agents" })
    expect(listed.data.issues.map((i: any) => i.title)).toEqual(["Teach agents about projects"])

    const moved = await call("update_issue", { id: created.data.id, project: "none" })
    expect(moved.data.project).toBeNull()
    expect(moved.data.id).toBe(`GRD-${number}`)
    const unknown = await call("list_issues", { project: "Nope" })
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toContain("Agents")
  })

  test("create, update and read back an issue through the shared write path", async () => {
    const created = await call("create_issue", {
      title: "Agent-made issue",
      description: "From **MCP**",
      priority: "high",
      assignee: "me",
      labels: ["Bug"]
    })
    expect(created.isError).toBe(false)
    expect(created.data).toMatchObject({ title: "Agent-made issue", state: "Todo", priority: "high", labels: ["Bug"] })
    const id = created.data.id as string
    expect(id).toMatch(/^GRD-\d+$/)

    const updated = await call("update_issue", { id, state: "In Progress", add_labels: ["Feature"], remove_labels: ["Bug"] })
    expect(updated.data).toMatchObject({ state: "In Progress", labels: ["Feature"] })

    const got = await call("get_issue", { id })
    expect(got.data.description).toBe("From **MCP**")

    const listed = await call("list_issues", { state: "started", query: "agent-made" })
    expect(listed.data.issues.map((i: any) => i.id)).toEqual([id])

    // The write went through the sync log, tagged as an agent change.
    const origins = await server.runPromise(
      Effect.gen(function*() {
        const db = yield* Db
        return yield* db.sql`SELECT DISTINCT origin FROM sync_log WHERE model = 'issue' AND origin = 'mcp'`
      })
    )
    expect(origins).toHaveLength(1)
  })

  test("relations: link, read back from both sides, filter by blocked, replace and unlink", async () => {
    const first = (await call("create_issue", { title: "Design the schema" })).data.id as string
    const second = (await call("create_issue", { title: "Build the API" })).data.id as string

    const linked = await call("link_issues", { id: second, relation: "blocked_by", other: first })
    expect(linked.isError).toBe(false)
    expect(linked.data).toMatchObject({ blocked: true, blocked_by: [{ id: first, title: "Design the schema", state: "Todo" }] })
    expect((await call("get_issue", { id: first })).data.blocks.map((i: any) => i.id)).toEqual([second])

    const blocked = await call("list_issues", { blocked: true, query: "Build the API" })
    expect(blocked.data.issues.map((i: any) => i.id)).toEqual([second])
    expect((await call("list_issues", { blocked: false, query: "Build the API" })).data.total).toBe(0)

    // A loop is refused with the reason.
    const third = (await call("create_issue", { title: "Ship the client" })).data.id as string
    await call("link_issues", { id: third, relation: "blocked_by", other: second })
    const loop = await call("link_issues", { id: first, relation: "blocked_by", other: third })
    expect(loop.isError).toBe(true)
    expect(loop.text).toContain(`${first} already blocks ${third}`)

    // Finishing the blocker frees the issue.
    await call("update_issue", { id: first, state: "Done" })
    expect((await call("get_issue", { id: second })).data.blocked).toBe(false)

    const replaced = await call("link_issues", { id: second, relation: "related", other: first })
    expect(replaced.data).toMatchObject({ blocked_by: [], related: [{ id: first }] })
    const removed = await call("unlink_issues", { id: first, other: second })
    expect(removed.data.related).toEqual([])
    const again = await call("unlink_issues", { id: first, other: second })
    expect(again.isError).toBe(true)
    expect(again.text).toContain("are not related")
  })

  test("bad names come back as tool errors that list the valid values", async () => {
    const result = await call("update_issue", { id: "GRD-1", state: "Doing" })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain("In Progress")
    const missing = await call("get_issue", { id: "GRD-999" })
    expect(missing.isError).toBe(true)
  })
})

describe("GitHub tools", () => {
  test("github_status explains how to connect, and sign-in errors say what is missing", async () => {
    const status = await call("github_status")
    expect(status.data.connected).toBe(false)
    expect(status.data.sign_in_available).toBe(false)
    expect(status.data.hint).toContain("GITHUB_TOKEN")
    const signIn = await call("github_sign_in")
    expect(signIn.isError).toBe(true)
    expect(signIn.text).toContain("disabled")
  })
})

describe("local-only guard", () => {
  test("refuses foreign browser origins and rebound hosts, allows local ones", async () => {
    expect((await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } })).status).toBe(403)
    expect((await fetch(`${base}/health`, { headers: { host: "evil.example" } })).status).toBe(403)
    expect((await fetch(`${base}/health`, { headers: { origin: "http://localhost:4200" } })).status).toBe(200)
    expect((await fetch(`${base}/health`)).status).toBe(200)
  })
})
