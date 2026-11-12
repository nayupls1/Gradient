/*
 * References written in issue text, read like GitHub reads them: `#12` (in the
 * issue's repository), `acme/web#12`, a bare GitHub issue or pull request URL,
 * and Gradient identifiers (`TES-12`). The web app finds them in its markdown
 * tree (outside links and code) and resolves them against the store; agents
 * get them from `textReferences`.
 */

/** A reference written in text. */
export type Reference =
  | {
    readonly kind: "github"
    readonly owner: string
    readonly repo: string
    readonly number: number
    /** Written as a pull request URL (`/pull/12`), so it is known to be one. */
    readonly pull?: true
  }
  | { readonly kind: "identifier"; readonly key: string; readonly number: number }

/** A reference and the text it was written as. */
export type TextRef = { readonly ref: Reference; readonly text: string }

/** The repository `#12` points into: the issue's own, or its project's. */
export interface RefContext {
  readonly owner: string
  readonly repo: string
}

const REF = /(?<![\w/#-])(?:([A-Za-z0-9][\w.-]*)\/([\w.-]+))?#(\d+)\b|(?<![\w-])([A-Z][A-Z0-9]{1,9})-(\d+)(?![\w-])/g

/** Split text into plain strings and references. `#12` needs a repository to point into. */
export const splitReferences = (text: string, context: RefContext | null): Array<string | TextRef> => {
  const out: Array<string | TextRef> = []
  let last = 0
  for (const m of text.matchAll(REF)) {
    let ref: Reference | null = null
    if (m[3] !== undefined) {
      const owner = m[1] ?? context?.owner
      const repo = m[2] ?? context?.repo
      if (owner && repo) ref = { kind: "github", owner, repo, number: Number(m[3]) }
    } else {
      ref = { kind: "identifier", key: m[4]!, number: Number(m[5]) }
    }
    if (!ref) continue
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push({ ref, text: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const GITHUB_URL = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)\/?$/i

/** A bare GitHub issue or pull request URL, shown the way GitHub shows it. */
export const githubUrlReference = (url: string, context: RefContext | null): TextRef | null => {
  const m = url.match(GITHUB_URL)
  if (!m) return null
  const [, owner, repo, kind, n] = m
  const same = context && context.owner.toLowerCase() === owner!.toLowerCase() &&
    context.repo.toLowerCase() === repo!.toLowerCase()
  return {
    ref: { kind: "github", owner: owner!, repo: repo!, number: Number(n), ...(kind!.toLowerCase() === "pull" ? { pull: true } as const : {}) },
    text: same ? `#${n}` : `${owner}/${repo}#${n}`
  }
}

/** Identifies a reference regardless of how it was written (`#12` and its URL are the same). */
export const referenceKey = (ref: Reference) =>
  ref.kind === "github"
    ? `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase()
    : `${ref.key.toUpperCase()}-${ref.number}`

const CODE = /^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[^\S\n]*$|(?![\s\S]))|`[^`\n]+`/gm
const LINK_URL = /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+\/?(?=$|[\s)>\],.!?;:])/gi

/**
 * The references in plain markdown text, in order, each once. Code is skipped;
 * unlike the rendered markdown, link text still counts. For agents, who read
 * the source rather than the rendered page.
 */
export const textReferences = (text: string, context: RefContext | null): Array<TextRef> => {
  const found: Array<{ at: number; ref: TextRef }> = []
  // Blank out code and URLs (keeping offsets), so `#12` inside them is not read twice.
  let rest = text.replace(CODE, (m) => " ".repeat(m.length))
  rest = rest.replace(LINK_URL, (url, at: number) => {
    const ref = githubUrlReference(url, context)
    if (ref) found.push({ at, ref })
    return " ".repeat(url.length)
  })
  let at = 0
  for (const part of splitReferences(rest, context)) {
    if (typeof part === "string") at += part.length
    else {
      found.push({ at, ref: part })
      at += part.text.length
    }
  }
  const seen = new Set<string>()
  return found
    .sort((a, b) => a.at - b.at)
    .flatMap(({ ref }) => {
      const key = referenceKey(ref.ref)
      if (seen.has(key)) return []
      seen.add(key)
      return [ref]
    })
}
