/** An in-memory stand-in for the slice of the GitHub REST API that Gradient uses. */
export interface FakeIssue {
  number: number
  title: string
  body: string | null
  state: "open" | "closed"
  state_reason: string | null
  labels: Array<{ name: string; color: string }>
  assignees: Array<{ login: string; avatar_url: string }>
  user: { login: string; avatar_url: string }
  updated_at: string
  pull_request?: { url: string }
}

export const makeFakeGithub = (
  repo = { owner: "acme", name: "widgets" },
  port = 0,
  options: { autoApproveDeviceAfterMs?: number; tokenExpiresIn?: number } = {}
) => {
  const issues: Array<FakeIssue> = []
  const requests: Array<{ method: string; path: string; body: any }> = []
  let failWrites = 0
  // Device-flow sign-in: one outstanding code at a time is enough for tests.
  let device: { code: string; userCode: string; state: "pending" | "approved" | "denied"; issuedAt: number } | null = null
  let tokenCounter = 0
  const appTokens = new Map<string, string>() // token -> login
  const revoked = new Set<string>()
  let installed: Array<{ owner: string; name: string; private: boolean }> = []
  let clock = Date.parse("2026-01-01T00:00:00Z")
  const tick = () => {
    clock += 1000
    return new Date(clock).toISOString().replace(/\.\d{3}Z$/, "Z")
  }
  const toJson = (i: FakeIssue) => ({
    ...i,
    html_url: `https://github.com/${repo.owner}/${repo.name}/issues/${i.number}`
  })

  const apply = (issue: FakeIssue, body: any) => {
    if (body.title !== undefined) issue.title = body.title
    if (body.body !== undefined) issue.body = body.body
    if (body.state !== undefined) {
      issue.state = body.state
      issue.state_reason = body.state === "closed" ? (body.state_reason ?? "completed") : "reopened"
    }
    if (body.labels !== undefined) issue.labels = body.labels.map((name: string) => ({ name, color: "ededed" }))
    if (body.assignees !== undefined) {
      issue.assignees = body.assignees.map((login: string) => ({ login, avatar_url: `https://avatars/${login}` }))
    }
    issue.updated_at = tick()
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url)
      const isForm = req.headers.get("content-type")?.includes("application/x-www-form-urlencoded")
      const body: any = req.method === "GET"
        ? undefined
        : isForm
        ? Object.fromEntries(new URLSearchParams(await req.text()))
        : await req.json()
      requests.push({ method: req.method, path: url.pathname, body })

      // github.com side of the device flow (form posts, JSON answers).
      if (url.pathname === "/login/device/code" && req.method === "POST") {
        if (!body.client_id) return Response.json({ error: "unauthorized_client" })
        device = { code: `dc-${++tokenCounter}`, userCode: "WDJB-MJHT", state: "pending", issuedAt: Date.now() }
        return Response.json({
          device_code: device.code,
          user_code: device.userCode,
          verification_uri: `http://127.0.0.1:${server.port}/login/device`,
          expires_in: 900,
          interval: 0.02
        })
      }
      if (url.pathname === "/login/oauth/access_token" && req.method === "POST") {
        if (!device || body.device_code !== device.code) return Response.json({ error: "expired_token" })
        if (
          device.state === "pending" && options.autoApproveDeviceAfterMs !== undefined &&
          Date.now() - device.issuedAt >= options.autoApproveDeviceAfterMs
        ) device.state = "approved"
        if (device.state === "pending") return Response.json({ error: "authorization_pending" })
        if (device.state === "denied") return Response.json({ error: "access_denied" })
        const token = `ghu_fake_${++tokenCounter}`
        appTokens.set(token, "octo")
        device = null
        return Response.json({
          access_token: token,
          token_type: "bearer",
          scope: "",
          ...(options.tokenExpiresIn ? { expires_in: options.tokenExpiresIn } : {})
        })
      }

      const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? null
      if (!token || revoked.has(token)) return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })

      if (req.method !== "GET" && failWrites > 0) {
        failWrites--
        return new Response("upstream error", { status: 502 })
      }
      if (url.pathname === "/user") return Response.json({ login: "octo", avatar_url: "https://avatars/octo" })
      if (url.pathname === "/user/installations") {
        // Only user tokens from the app can list its installations.
        if (!appTokens.has(token)) return new Response("forbidden", { status: 403 })
        return Response.json({ total_count: installed.length ? 1 : 0, installations: installed.length ? [{ id: 7 }] : [] })
      }
      if (url.pathname === "/user/installations/7/repositories") {
        return Response.json({
          total_count: installed.length,
          repositories: installed.map((r) => ({ name: r.name, private: r.private, owner: { login: r.owner } }))
        })
      }
      const base = `/repos/${repo.owner}/${repo.name}`
      if (url.pathname === base) return Response.json({ full_name: `${repo.owner}/${repo.name}` })
      if (url.pathname === `${base}/issues` && req.method === "GET") {
        const since = url.searchParams.get("since")
        const page = Number(url.searchParams.get("page") ?? 1)
        const list = issues
          .filter((i) => !since || i.updated_at >= since)
          .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
          .slice((page - 1) * 100, page * 100)
          .map(toJson)
        const text = JSON.stringify(list)
        const etag = `"${Bun.hash(text + page)}"`
        if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304 })
        return new Response(text, { headers: { "content-type": "application/json", etag } })
      }
      if (url.pathname === `${base}/issues` && req.method === "POST") {
        const issue: FakeIssue = {
          number: issues.length + 1,
          title: "",
          body: null,
          state: "open",
          state_reason: null,
          labels: [],
          assignees: [],
          user: { login: "octo", avatar_url: "https://avatars/octo" },
          updated_at: tick()
        }
        apply(issue, body)
        issues.push(issue)
        return Response.json(toJson(issue), { status: 201 })
      }
      const match = url.pathname.match(new RegExp(`^${base}/issues/(\\d+)$`))
      if (match && req.method === "PATCH") {
        const issue = issues.find((i) => i.number === Number(match[1]))
        if (!issue) return new Response("not found", { status: 404 })
        apply(issue, body)
        return Response.json(toJson(issue))
      }
      return new Response("not found", { status: 404 })
    }
  })

  return {
    url: `http://127.0.0.1:${server.port}`,
    issues,
    requests,
    /** Simulate someone editing on github.com. */
    seed(partial: Partial<FakeIssue> & { title: string }) {
      const issue: FakeIssue = {
        number: issues.length + 1,
        body: null,
        state: "open",
        state_reason: null,
        labels: [],
        assignees: [],
        user: { login: "someone", avatar_url: "https://avatars/someone" },
        ...partial,
        updated_at: tick()
      }
      issues.push(issue)
      return issue
    },
    edit(number: number, body: any) {
      apply(issues.find((i) => i.number === number)!, body)
    },
    writes: () => requests.filter((r) => r.method !== "GET"),
    /** The user approves the pending device-flow code on github.com. */
    approveDevice() {
      if (device) device.state = "approved"
    },
    denyDevice() {
      if (device) device.state = "denied"
    },
    /** Tokens handed out by the device flow. */
    appTokens: () => [...appTokens.keys()],
    /** The user revokes a token on github.com; GitHub answers 401 from then on. */
    revoke(token: string) {
      revoked.add(token)
    },
    /** The user installs the app on these repositories. */
    install(repos: Array<{ owner: string; name: string; private?: boolean }>) {
      installed = repos.map((r) => ({ ...r, private: r.private ?? false }))
    },
    /** Make the next `n` writes fail with a 502, like a GitHub outage. */
    failNextWrites(n: number) {
      failWrites = n
    },
    stop: () => server.stop(true)
  }
}
