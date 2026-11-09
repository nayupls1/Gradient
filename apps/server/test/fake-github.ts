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

export const makeFakeGithub = (repo = { owner: "acme", name: "widgets" }) => {
  const issues: Array<FakeIssue> = []
  const requests: Array<{ method: string; path: string; body: any }> = []
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
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const body = req.method === "GET" ? undefined : await req.json()
      requests.push({ method: req.method, path: url.pathname, body })
      if (url.pathname === "/user") return Response.json({ login: "octo", avatar_url: "https://avatars/octo" })
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
    stop: () => server.stop(true)
  }
}
