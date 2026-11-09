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
    expect(Object.keys(tools).sort()).toEqual(["create_issue", "describe_workspace", "get_issue", "list_issues", "update_issue"])
    expect(tools.list_issues.annotations.readOnlyHint).toBe(true)
    expect(tools.create_issue.annotations.destructiveHint).toBe(false)
  })

  test("describes the workspace in names, not ids", async () => {
    const { data } = await call("describe_workspace")
    expect(data.team.key).toBe("GRD")
    expect(data.states.map((s: any) => s.name)).toContain("In Progress")
    expect(data.labels).toContain("Bug")
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

  test("bad names come back as tool errors that list the valid values", async () => {
    const result = await call("update_issue", { id: "GRD-1", state: "Doing" })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain("In Progress")
    const missing = await call("get_issue", { id: "GRD-999" })
    expect(missing.isError).toBe(true)
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
