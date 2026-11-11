import type { GithubIssueCoords, Issue, IssueRelation, Project, PullRequest, Team } from "./models.ts"
import { parseIdentifier } from "./models.ts"

const KEYWORD = String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+`
const SHORT_REF = new RegExp(KEYWORD + String.raw`(?:([\w.-]+)\/([\w.-]+))?#(\d+)\b`, "gi")
const URL_REF = new RegExp(KEYWORD + String.raw`https?:\/\/[^/\s]+\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\b`, "gi")
const MENTION = /(?<![\w-])([A-Z][A-Z0-9]{1,9})-(\d+)(?![\w-])/g

/** The issues a pull request links to, read from its title and body like GitHub does. */
export const parsePullRequestRefs = (
  repo: { readonly owner: string; readonly name: string },
  title: string,
  body: string | null
): { closes: Array<GithubIssueCoords>; mentions: Array<string> } => {
  const text = `${title}\n${body ?? ""}`
  const closes: Array<GithubIssueCoords> = []
  const seen = new Set<string>()
  const add = (owner: string, name: string, n: string) => {
    const key = `${owner}/${name}#${n}`.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    closes.push({ owner, repo: name, number: Number(n) })
  }
  for (const m of text.matchAll(SHORT_REF)) add(m[1] ?? repo.owner, m[2] ?? repo.name, m[3]!)
  for (const m of text.matchAll(URL_REF)) add(m[1]!, m[2]!, m[3]!)
  const mentions = [...new Set([...text.matchAll(MENTION)].map((m) => `${m[1]}-${Number(m[2])}`))]
  return { closes, mentions }
}

/**
 * Whether a pull request refers to an issue: it closes the issue's GitHub copy,
 * or mentions it by any key of its team (team or project key) and its number.
 */
export const pullRequestRefersTo = (
  pr: Pick<PullRequest, "teamId" | "closes" | "mentions">,
  issue: Pick<Issue, "teamId" | "number" | "github">,
  teamKeys: ReadonlySet<string>
) => {
  const gh = issue.github
  if (
    gh && pr.closes.some((c) =>
      c.number === gh.number && c.owner.toLowerCase() === gh.owner.toLowerCase() &&
      c.repo.toLowerCase() === gh.repo.toLowerCase()
    )
  ) return true
  if (pr.teamId !== issue.teamId || issue.number <= 0) return false
  return pr.mentions.some((ref) => {
    const parsed = parseIdentifier(ref)
    return parsed !== null && parsed.number === issue.number && teamKeys.has(parsed.key)
  })
}

/** Every key that prefixes a team's identifiers: its own and its projects'. */
export const teamKeys = (team: Pick<Team, "key">, projects: ReadonlyArray<Pick<Project, "key">>) =>
  new Set([team.key.toUpperCase(), ...projects.map((p) => p.key.toUpperCase())])

/** A blocker still holds an issue up until it is completed, canceled or archived. */
export const isOpenBlocker = (blocker: Pick<Issue, "archivedAt">, stateType: string | undefined) =>
  blocker.archivedAt === null && stateType !== "completed" && stateType !== "canceled"

/**
 * Would `blocker` blocking `blocked` close a loop? True when `blocked` already
 * blocks `blocker`, directly or through other issues.
 */
export const wouldCycle = (
  relations: ReadonlyArray<Pick<IssueRelation, "type" | "issueId" | "relatedIssueId">>,
  blocker: string,
  blocked: string
) => {
  if (blocker === blocked) return true
  const next = new Map<string, Array<string>>()
  for (const r of relations) {
    if (r.type !== "blocks") continue
    const list = next.get(r.issueId) ?? []
    list.push(r.relatedIssueId)
    next.set(r.issueId, list)
  }
  const stack = [blocked]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === blocker) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(next.get(id) ?? []))
  }
  return false
}
