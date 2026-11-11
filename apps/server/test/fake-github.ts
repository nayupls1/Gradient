/** An in-memory stand-in for the slice of the GitHub REST API that Gradient uses. */
export interface FakeIssue {
  /** Global id, unique across repositories, like GitHub's. */
  id: number
  number: number
  title: string
  body: string | null
  state: "open" | "closed"
  state_reason: string | null
  labels: Array<{ name: string; color: string }>
  assignees: Array<{ login: string; avatar_url: string }>
  user: { login: string; avatar_url: string }
  updated_at: string
  pull_request?: { url?: string; merged_at?: string | null }
  draft?: boolean
  /** Global ids of the issues that block this one. */
  blocked_by?: Array<number>
}

export const makeFakeGithub = (
  repo = { owner: "acme", name: "widgets" },
  port = 0,
  options: { autoApproveDeviceAfterMs?: number; tokenExpiresIn?: number } = {}
) => {
  // Every repository the fake knows, by "owner/name" (lowercase). The first is the default one.
  const repos = new Map<string, {
    owner: string
    name: string
    private: boolean
    issues: Array<FakeIssue>
    /** Files on the default branch, by path. */
    files: Map<string, Uint8Array>
  }>()
  const addRepo = (owner: string, name: string, isPrivate = false) => {
    const entry = { owner, name, private: isPrivate, issues: [] as Array<FakeIssue>, files: new Map<string, Uint8Array>() }
    repos.set(`${owner}/${name}`.toLowerCase(), entry)
    return entry
  }
  const issues = addRepo(repo.owner, repo.name).issues
  const issuesOf = (r?: { owner: string; name: string }) =>
    r ? repos.get(`${r.owner}/${r.name}`.toLowerCase())!.issues : issues
  const repoOf = (r?: { owner: string; name: string }) =>
    repos.get(r ? `${r.owner}/${r.name}`.toLowerCase() : `${repo.owner}/${repo.name}`.toLowerCase())!
  /** Git's blob id: sha1 of "blob <size>\0<content>". */
  const blobSha = (content: Uint8Array) =>
    new Bun.CryptoHasher("sha1").update(`blob ${content.byteLength}\0`).update(content).digest("hex")
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
  let nextId = 9000
  const byId = (id: number) => {
    for (const r of repos.values()) {
      const issue = r.issues.find((i) => i.id === id)
      if (issue) return { repo: r, issue }
    }
    return undefined
  }
  const toJson = (r: { owner: string; name: string }, i: FakeIssue) => {
    const { blocked_by, ...rest } = i
    const open = (blocked_by ?? []).filter((id) => byId(id)?.issue.state === "open").length
    return {
      ...rest,
      html_url: `https://github.com/${r.owner}/${r.name}/${i.pull_request ? "pull" : "issues"}/${i.number}`,
      issue_dependencies_summary: {
        blocked_by: open,
        total_blocked_by: blocked_by?.length ?? 0,
        blocking: 0,
        total_blocking: 0
      }
    }
  }

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
      const text = req.method === "GET" ? "" : await req.text()
      const body: any = text === "" ? undefined : isForm ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text)
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
      if (url.pathname === "/user/repos") {
        const page = Number(url.searchParams.get("page") ?? 1)
        const list = [...repos.values()].slice((page - 1) * 100, page * 100)
        return Response.json(list.map((r) => ({
          name: r.name,
          private: r.private,
          description: `The ${r.name} repository`,
          owner: { login: r.owner }
        })))
      }
      const deps = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/dependencies\/blocked_by(?:\/(\d+))?$/)
      if (deps) {
        const r = repos.get(`${deps[1]}/${deps[2]}`.toLowerCase())
        const issue = r?.issues.find((i) => i.number === Number(deps[3]))
        if (!r || !issue) return new Response("not found", { status: 404 })
        issue.blocked_by ??= []
        if (req.method === "GET") {
          return Response.json(issue.blocked_by.flatMap((id) => {
            const found = byId(id)
            return found ? [toJson(found.repo, found.issue)] : []
          }))
        }
        if (req.method === "POST") {
          const found = byId(body.issue_id)
          if (!found) return new Response("not found", { status: 404 })
          if (issue.blocked_by.includes(body.issue_id)) return new Response("already exists", { status: 422 })
          issue.blocked_by.push(body.issue_id)
          return Response.json(toJson(found.repo, found.issue), { status: 201 })
        }
        if (req.method === "DELETE") {
          const id = Number(deps[4])
          if (!issue.blocked_by.includes(id)) return new Response("not found", { status: 404 })
          issue.blocked_by = issue.blocked_by.filter((x) => x !== id)
          return Response.json(toJson(byId(id)!.repo, byId(id)!.issue))
        }
      }
      const git = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/(trees|blobs)\/([^/]+)$/)
      if (git && req.method === "GET") {
        const r = repos.get(`${git[1]}/${git[2]}`.toLowerCase())
        if (!r) return new Response("not found", { status: 404 })
        if (git[3] === "trees") {
          if (r.files.size === 0) return Response.json({ message: "Git Repository is empty." }, { status: 409 })
          return Response.json({
            sha: "tree",
            truncated: false,
            tree: [...r.files].map(([path, content]) => ({ path, mode: "100644", type: "blob", sha: blobSha(content), size: content.byteLength }))
          })
        }
        const content = [...r.files.values()].find((c) => blobSha(c) === git[4])
        if (!content) return new Response("not found", { status: 404 })
        return Response.json({ sha: git[4], size: content.byteLength, encoding: "base64", content: Buffer.from(content).toString("base64") })
      }
      const route = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/issues(?:\/(\d+))?)?$/)
      const target = route ? repos.get(`${route[1]}/${route[2]}`.toLowerCase()) : undefined
      if (route && !target) return new Response("not found", { status: 404 })
      if (route && target && !route[3]) return Response.json({ full_name: `${target.owner}/${target.name}` })
      if (route && target && route[3] && !route[4] && req.method === "GET") {
        const since = url.searchParams.get("since")
        const page = Number(url.searchParams.get("page") ?? 1)
        const list = target.issues
          .filter((i) => !since || i.updated_at >= since)
          .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
          .slice((page - 1) * 100, page * 100)
          .map((i) => toJson(target, i))
        const text = JSON.stringify(list)
        const etag = `"${Bun.hash(text + page)}"`
        if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304 })
        return new Response(text, { headers: { "content-type": "application/json", etag } })
      }
      if (route && target && route[4] && req.method === "GET") {
        const issue = target.issues.find((i) => i.number === Number(route[4]))
        return issue ? Response.json(toJson(target, issue)) : new Response("not found", { status: 404 })
      }
      if (route && target && route[3] && !route[4] && req.method === "POST") {
        const issue: FakeIssue = {
          id: nextId++,
          number: target.issues.length + 1,
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
        target.issues.push(issue)
        return Response.json(toJson(target, issue), { status: 201 })
      }
      if (route && target && route[4] && req.method === "PATCH") {
        const issue = target.issues.find((i) => i.number === Number(route[4]))
        if (!issue) return new Response("not found", { status: 404 })
        apply(issue, body)
        return Response.json(toJson(target, issue))
      }
      return new Response("not found", { status: 404 })
    }
  })

  return {
    url: `http://127.0.0.1:${server.port}`,
    issues,
    requests,
    /** Another repository the token can see (and the app could be installed on). */
    addRepo(owner: string, name: string, options: { private?: boolean } = {}) {
      addRepo(owner, name, options.private ?? false)
    },
    /** Issues of one repository (the default one when omitted). */
    issuesOf,
    /** Commit a file to the default branch. Returns its blob sha. */
    putFile(path: string, content: string | Uint8Array, inRepo?: { owner: string; name: string }) {
      const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content
      repoOf(inRepo).files.set(path, bytes)
      return blobSha(bytes)
    },
    deleteFile(path: string, inRepo?: { owner: string; name: string }) {
      repoOf(inRepo).files.delete(path)
    },
    /** Simulate someone editing on github.com. */
    seed(partial: Partial<FakeIssue> & { title: string }, inRepo?: { owner: string; name: string }) {
      const list = issuesOf(inRepo)
      const issue: FakeIssue = {
        id: nextId++,
        number: list.length + 1,
        body: null,
        state: "open",
        state_reason: null,
        labels: [],
        assignees: [],
        user: { login: "someone", avatar_url: "https://avatars/someone" },
        ...partial,
        updated_at: tick()
      }
      list.push(issue)
      return issue
    },
    edit(number: number, body: any, inRepo?: { owner: string; name: string }) {
      apply(issuesOf(inRepo).find((i) => i.number === number)!, body)
    },
    /** Someone marks `number` as blocked by `blocker` on github.com. Like GitHub, it does not touch updated_at. */
    block(number: number, blocker: number, inRepo?: { owner: string; name: string }) {
      const issue = issuesOf(inRepo).find((i) => i.number === number)!
      const by = issuesOf(inRepo).find((i) => i.number === blocker)!
      issue.blocked_by = [...(issue.blocked_by ?? []), by.id]
    },
    unblock(number: number, blocker: number, inRepo?: { owner: string; name: string }) {
      const issue = issuesOf(inRepo).find((i) => i.number === number)!
      const by = issuesOf(inRepo).find((i) => i.number === blocker)!
      issue.blocked_by = (issue.blocked_by ?? []).filter((id) => id !== by.id)
    },
    /** Numbers of the issues blocking `number`, in the same repository. */
    blockersOf(number: number, inRepo?: { owner: string; name: string }) {
      const list = issuesOf(inRepo)
      return (list.find((i) => i.number === number)!.blocked_by ?? []).map((id) => list.find((i) => i.id === id)?.number)
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
