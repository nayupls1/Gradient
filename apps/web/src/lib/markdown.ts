import { githubUrlReference, type RefContext, referenceKey, splitReferences, type TextRef } from "@gradient/domain"
import { Lexer, type Token, type Tokens } from "marked"

/*
 * Markdown for issue descriptions, read like GitHub reads issue bodies: GFM,
 * single newlines as line breaks, and a little inline HTML (`<details>`,
 * `<kbd>`, `<img>`…). `marked` only tokenizes; this file turns its tokens into
 * a plain tree of allowed tags and attributes, which `Markdown.tsx` renders as
 * Solid elements. Nothing is ever set as HTML, so the tree is safe by
 * construction: tags outside `TAGS` keep their text and lose the tag, and URLs
 * other than http(s) and mailto are dropped.
 *
 * Text outside links and code is scanned for references (`#12`,
 * `acme/web#12`, `TES-12`), and a GitHub issue or pull request URL written on
 * its own becomes one too. They are resolved against the store when rendered.
 */

export type { Reference, RefContext } from "@gradient/domain"
export { githubUrlReference, splitReferences } from "@gradient/domain"

export type MdElement = {
  readonly tag: string
  readonly attrs: Readonly<Record<string, string | boolean>>
  readonly children: Array<MdNode>
}
export type MdRef = TextRef
export type MdNode = string | MdElement | MdRef

export const isElement = (node: MdNode): node is MdElement => typeof node === "object" && "tag" in node
export const isRef = (node: MdNode): node is MdRef => typeof node === "object" && "ref" in node

/** Allowed tags and, for each, the attributes it keeps. */
const TAGS: Record<string, ReadonlyArray<string>> = {
  a: ["href", "title"],
  b: [],
  blockquote: [],
  br: [],
  code: [],
  del: [],
  details: ["open"],
  div: [],
  em: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  hr: [],
  i: [],
  img: ["src", "alt", "title", "width", "height"],
  input: ["type", "checked", "disabled"],
  kbd: [],
  li: [],
  mark: [],
  ol: ["start"],
  p: [],
  pre: [],
  s: [],
  span: [],
  strong: [],
  sub: [],
  summary: [],
  sup: [],
  table: [],
  tbody: [],
  td: ["align"],
  th: ["align"],
  thead: [],
  tr: [],
  u: [],
  ul: []
}
const VOID = new Set(["br", "hr", "img", "input", "wbr", "source", "col", "area", "base", "link", "meta", "param", "track", "embed"])
/** Tags dropped with everything inside them. */
const DROP = new Set(["script", "style", "textarea", "title", "iframe", "object", "noscript", "template", "select", "svg", "math"])
/** Containers of blocks, where whitespace between HTML tags means nothing. */
const BLOCKS = new Set(["root", "details", "blockquote", "div", "ul", "ol", "table", "thead", "tbody", "tr"])
/** Text inside these is shown as written: no references. */
const LITERAL = new Set(["a", "code", "pre", "kbd"])

/** http(s) and mailto only; anything else (javascript:, data:, relative paths) is dropped. */
export const safeUrl = (url: string): string | null => {
  const trimmed = url.trim()
  return /^(?:https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : null
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  times: "×",
  middot: "·",
  bull: "•",
  laquo: "«",
  raquo: "»",
  check: "✓"
}

export const decodeEntities = (text: string) =>
  text.includes("&")
    ? text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g, (whole, dec, hex, name) => {
      if (name) return ENTITIES[name] ?? whole
      const code = dec ? Number(dec) : parseInt(hex, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    })
    : text

// One HTML tag, comment or run of text. Anything else (a stray `<`) is text.
const HTML = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|[^<]+|</g
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const pickAttrs = (tag: string, source: string): Record<string, string | boolean> => {
  const allowed = TAGS[tag] ?? []
  const attrs: Record<string, string | boolean> = {}
  for (const m of source.matchAll(ATTR)) {
    const name = m[1]!.toLowerCase()
    if (!allowed.includes(name)) continue
    const raw = m[2] ?? m[3] ?? m[4]
    const value = raw === undefined ? true : decodeEntities(raw)
    if (name === "href" || name === "src") {
      const url = typeof value === "string" ? safeUrl(value) : null
      if (url) attrs[name] = url
    } else attrs[name] = value
  }
  return attrs
}

/**
 * Builds the tree. Elements open from markdown tokens or HTML tags go on one
 * stack, so an HTML block that opens `<details>` and a later one that closes
 * it wrap the markdown between them, like a browser would. Each markdown
 * container closes whatever HTML was left open inside it.
 */
class Builder {
  readonly root: MdElement = { tag: "root", attrs: {}, children: [] }
  private stack: Array<MdElement> = [this.root]
  /** Inside a dropped tag (`<script>`…): its name and the depth it opened at. */
  private dropping: { tag: string; depth: number } | null = null

  constructor(private readonly context: RefContext | null) {}

  private get top() {
    return this.stack[this.stack.length - 1]!
  }

  private literal() {
    return this.stack.some((e) => LITERAL.has(e.tag))
  }

  text(text: string) {
    if (text === "" || this.dropping) return
    if (BLOCKS.has(this.top.tag) && text.trim() === "") return
    const parts = this.literal() ? [text] : splitReferences(text, this.context)
    const children = this.top.children
    for (const part of parts) {
      const prev = children[children.length - 1]
      if (typeof part === "string" && typeof prev === "string") children[children.length - 1] = prev + part
      else children.push(part)
    }
  }

  node(node: MdNode) {
    if (!this.dropping) this.top.children.push(node)
  }

  /** Run `body` inside a new element, closing any HTML it leaves open. */
  within(tag: string, attrs: Record<string, string | boolean>, body: () => void) {
    if (this.dropping) return
    const el: MdElement = { tag, attrs, children: [] }
    this.top.children.push(el)
    const depth = this.stack.length
    this.stack.push(el)
    body()
    this.stack.length = depth
    // `body` may have opened a dropped tag (TypeScript cannot see that).
    const dropping = this.dropping as { depth: number } | null
    if (dropping && dropping.depth > depth) this.dropping = null
  }

  /** Feed raw HTML; `floor` is the stack depth its closing tags may not pop below. */
  html(source: string, floor: number) {
    for (const m of source.matchAll(HTML)) {
      const whole = m[0]
      if (whole.startsWith("<!--")) continue
      const name = m[2]?.toLowerCase()
      if (!name) {
        this.text(decodeEntities(whole))
        continue
      }
      const closing = m[1] === "/"
      if (this.dropping) {
        if (closing && name === this.dropping.tag) this.dropping = null
        continue
      }
      if (DROP.has(name)) {
        if (!closing && m[4] !== "/") this.dropping = { tag: name, depth: this.stack.length }
        continue
      }
      if (closing) {
        for (let i = this.stack.length - 1; i >= floor; i--) {
          if (this.stack[i]!.tag === name) {
            this.stack.length = i
            break
          }
        }
        continue
      }
      if (!(name in TAGS)) continue
      const attrs = pickAttrs(name, m[3] ?? "")
      if ((name === "img" && !attrs.src) || (name === "a" && !attrs.href)) continue
      if (name === "input" && attrs.type !== "checkbox") continue
      if (name === "input") attrs.disabled = true
      const el: MdElement = { tag: name, attrs, children: [] }
      this.top.children.push(el)
      if (!VOID.has(name) && m[4] !== "/") this.stack.push(el)
    }
  }

  get depth() {
    return this.stack.length
  }

  blocks(tokens: ReadonlyArray<Token>) {
    const floor = this.depth
    for (const token of tokens) this.block(token, floor)
  }

  private block(token: Token, floor: number) {
    switch (token.type) {
      case "space":
      case "def":
        return
      case "paragraph":
        return this.within("p", {}, () => this.inline((token as Tokens.Paragraph).tokens))
      case "heading": {
        const t = token as Tokens.Heading
        return this.within(`h${t.depth}`, {}, () => this.inline(t.tokens))
      }
      case "code":
        return this.within("pre", {}, () => this.node((token as Tokens.Code).text))
      case "blockquote":
        return this.within("blockquote", {}, () => this.blocks((token as Tokens.Blockquote).tokens))
      case "hr":
        return this.node({ tag: "hr", attrs: {}, children: [] })
      case "list": {
        const t = token as Tokens.List
        const attrs: Record<string, string> = t.ordered && t.start !== "" && t.start !== 1 ? { start: String(t.start) } : {}
        return this.within(t.ordered ? "ol" : "ul", attrs, () => {
          for (const item of t.items) this.within("li", item.task ? { task: true } : {}, () => this.blocks(item.tokens))
        })
      }
      case "checkbox":
        return this.node({ tag: "input", attrs: { type: "checkbox", checked: (token as Tokens.Checkbox).checked, disabled: true }, children: [] })
      case "table": {
        const t = token as Tokens.Table
        const cell = (tag: string, c: Tokens.TableCell) => this.within(tag, c.align ? { align: c.align } : {}, () => this.inline(c.tokens))
        return this.within("table", {}, () => {
          this.within("thead", {}, () => this.within("tr", {}, () => t.header.forEach((c) => cell("th", c))))
          if (t.rows.length) this.within("tbody", {}, () => t.rows.forEach((row) => this.within("tr", {}, () => row.forEach((c) => cell("td", c)))))
        })
      }
      case "html":
        return this.html((token as Tokens.HTML).text, floor)
      case "text": {
        // Tight list items hold their inline content in a block-level text token.
        const t = token as Tokens.Text
        return t.tokens ? this.inline(t.tokens) : this.text(decodeEntities(t.text))
      }
      default:
        if ("tokens" in token && Array.isArray(token.tokens)) return this.blocks(token.tokens)
        if ("text" in token && typeof token.text === "string") return this.text(token.text)
    }
  }

  inline(tokens: ReadonlyArray<Token> | undefined) {
    if (!tokens) return
    const floor = this.depth
    for (const token of tokens) this.span(token, floor)
    this.stack.length = floor
  }

  private span(token: Token, floor: number) {
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text
        return t.tokens ? this.inline(t.tokens) : this.text(decodeEntities(t.text))
      }
      case "escape":
        return this.text((token as Tokens.Escape).text)
      case "strong":
        return this.within("strong", {}, () => this.inline((token as Tokens.Strong).tokens))
      case "em":
        return this.within("em", {}, () => this.inline((token as Tokens.Em).tokens))
      case "del":
        return this.within("del", {}, () => this.inline((token as Tokens.Del).tokens))
      case "codespan":
        return this.within("code", {}, () => this.node((token as Tokens.Codespan).text))
      case "br":
        return this.node({ tag: "br", attrs: {}, children: [] })
      case "link": {
        const t = token as Tokens.Link
        const href = safeUrl(t.href)
        if (href && this.isBare(t)) {
          const ref = githubUrlReference(href, this.context)
          if (ref && !this.literal()) return this.node(ref)
        }
        if (!href || this.dropping) return this.inline(t.tokens)
        return this.within("a", t.title ? { href, title: t.title } : { href }, () => this.inline(t.tokens))
      }
      case "image": {
        const t = token as Tokens.Image
        const src = safeUrl(t.href)
        if (!src) return this.text(t.text)
        return this.node({ tag: "img", attrs: { src, alt: t.text, ...(t.title ? { title: t.title } : {}) }, children: [] })
      }
      case "html":
        return this.html((token as Tokens.Tag).text, floor)
      default:
        if ("tokens" in token && Array.isArray(token.tokens)) return this.inline(token.tokens)
        if ("text" in token && typeof token.text === "string") return this.text(token.text)
    }
  }

  /** A link written as its own URL (autolink, or `[url](url)`). */
  private isBare(t: Tokens.Link) {
    return t.text === t.href || t.text === t.href.replace(/^mailto:/, "")
  }
}

/** Parse a description into a render tree. Pure; cheap enough to rerun on every edit. */
export const parseMarkdown = (source: string, context: RefContext | null = null): Array<MdNode> => {
  const builder = new Builder(context)
  builder.blocks(Lexer.lex(source, { gfm: true, breaks: true }))
  return builder.root.children
}

/** The references in a render tree, in order, each once (`#12` and its URL count as one). */
export const collectReferences = (nodes: ReadonlyArray<MdNode>, into: Array<MdRef> = [], seen = new Set<string>()) => {
  for (const node of nodes) {
    if (typeof node === "string") continue
    if (isRef(node)) {
      const key = referenceKey(node.ref)
      if (!seen.has(key)) {
        seen.add(key)
        into.push(node)
      }
    } else collectReferences(node.children, into, seen)
  }
  return into
}
