import type { Issue } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { Dynamic, type JSX } from "@solidjs/web"
import { createMemo, For, Match, Show, Switch, useContext } from "solid-js"
import { isElement, isRef, type MdElement, type MdNode, type MdRef, parseMarkdown, type RefContext } from "../lib/markdown.ts"
import { findIssue, issueHref, issueKey, type IssuePullRequest, pullRequestHref, pullRequestHrefFromUrl, resolveGithubRef } from "../lib/select.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { color, font } from "../theme/tokens.stylex.ts"
import { GithubIcon, PullRequestIcon, pullRequestLabel, StateIcon } from "../ui/icons.tsx"
import { Sync } from "./context.ts"

/*
 * Renders markdown (see lib/markdown.ts) as Solid elements. StyleX has no
 * descendant selectors, so every tag gets its own style here. References
 * resolve live against the store: a Gradient issue links inside the app with
 * its state icon, a pull request links to GitHub with its state, and anything
 * else on GitHub links there.
 */

const block = { marginTop: { default: 10, ":first-child": 0 }, marginBottom: 0 }

const s = stylex.create({
  root: { overflowWrap: "anywhere", color: colors.foreground },
  p: { ...block },
  h1: { ...block, marginTop: { default: 22, ":first-child": 0 }, fontSize: "1.375em", fontWeight: 600, lineHeight: 1.3, letterSpacing: "-0.01em" },
  h2: { ...block, marginTop: { default: 20, ":first-child": 0 }, fontSize: "1.2em", fontWeight: 600, lineHeight: 1.35 },
  h3: { ...block, marginTop: { default: 18, ":first-child": 0 }, fontSize: "1.05em", fontWeight: 600 },
  h4: { ...block, marginTop: { default: 16, ":first-child": 0 }, fontWeight: 600 },
  h5: { ...block, fontWeight: 600, fontSize: "0.9em" },
  h6: { ...block, fontWeight: 600, fontSize: "0.85em", color: colors.mutedForeground },
  list: { ...block, paddingInlineStart: "1.5em" },
  nested: { marginTop: 2 },
  ul: { listStyleType: "disc" },
  ol: { listStyleType: "decimal" },
  li: { marginTop: 2, "::marker": { color: colors.mutedForeground } },
  // Like GitHub: the checkbox sits where the bullet would, so nested lists line up with the text.
  task: { listStyleType: "none" },
  checkbox: { marginInlineStart: "-1.4em", marginInlineEnd: "0.45em", verticalAlign: "-1px", accentColor: colors.primary },
  blockquote: {
    ...block,
    paddingInlineStart: 12,
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderLeftColor: colors.border,
    color: colors.mutedForeground
  },
  pre: {
    ...block,
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: 6,
    backgroundColor: colors.muted,
    fontFamily: font.mono,
    fontSize: "0.85em",
    lineHeight: 1.55,
    overflowX: "auto",
    whiteSpace: "pre",
    overflowWrap: "normal"
  },
  code: {
    paddingBlock: 1,
    paddingInline: 4,
    borderRadius: 4,
    backgroundColor: colors.muted,
    fontFamily: font.mono,
    fontSize: "0.85em"
  },
  kbd: {
    paddingBlock: 1,
    paddingInline: 5,
    borderRadius: 4,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderBottomWidth: 2,
    fontFamily: font.mono,
    fontSize: "0.8em"
  },
  hr: { ...block, marginTop: { default: 16, ":first-child": 0 }, borderWidth: 0, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: colors.border },
  // Links take the palette's link color so they stand apart from the text around them.
  a: {
    color: color.link,
    textDecorationLine: "underline",
    textDecorationColor: { default: "color-mix(in srgb, currentColor 35%, transparent)", ":hover": "currentColor" },
    textUnderlineOffset: 3
  },
  img: { maxWidth: "100%", height: "auto", borderRadius: 4, verticalAlign: "middle" },
  table: { ...block, borderCollapse: "collapse", display: "block", overflowX: "auto", maxWidth: "100%", fontSize: "0.925em" },
  cell: {
    paddingBlock: 5,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    textAlign: "start"
  },
  th: { fontWeight: 600, backgroundColor: colors.muted },
  details: { ...block },
  summary: { cursor: "pointer", fontWeight: 500 },
  ref: {
    color: color.link,
    fontWeight: 500,
    textDecorationLine: { default: "none", ":hover": "underline" },
    textUnderlineOffset: 3,
    whiteSpace: "nowrap"
  },
  refIcon: { display: "inline-block", verticalAlign: "-2px", marginInlineEnd: 3, lineHeight: 0 }
})

/** The style for an element, given its parent (code in a `pre` is not inline code). */
const styleFor = (el: MdElement, parent: string) => {
  switch (el.tag) {
    case "ul":
    case "ol":
      return [s.list, s[el.tag], parent === "li" && s.nested]
    case "li":
      return [s.li, el.attrs.task === true && s.task]
    case "input":
      return s.checkbox
    case "code":
      return parent === "pre" ? null : s.code
    case "td":
      return s.cell
    case "th":
      return [s.cell, s.th]
    case "p":
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
    case "blockquote":
    case "pre":
    case "kbd":
    case "hr":
    case "a":
    case "img":
    case "table":
    case "details":
    case "summary":
      return s[el.tag]
    default:
      return null
  }
}

const External = { target: "_blank", rel: "noreferrer noopener" } as const

const Element = (props: { el: MdElement; parent: string }) => {
  // `task` marks a list item for styling; it is not a DOM attribute.
  const attrs = () => {
    const { task: _, ...rest } = props.el.attrs
    if (props.el.tag !== "a") return rest
    // Links to a pull request open its page in Gradient; everything else opens in a new tab.
    const pull = typeof rest.href === "string" ? pullRequestHrefFromUrl(rest.href) : null
    return pull ? { ...rest, href: pull } : { ...rest, ...External }
  }
  const style = () => {
    const xstyle = styleFor(props.el, props.parent)
    return stylex.attrs(xstyle)
  }
  return (
    <Dynamic component={props.el.tag} {...attrs()} {...style()}>
      <Show when={props.el.children.length > 0}>
        <Nodes nodes={props.el.children} parent={props.el.tag} />
      </Show>
    </Dynamic>
  )
}

const RefIcon = (props: { children: JSX.Element }) => <span {...stylex.attrs(s.refIcon)}>{props.children}</span>

/** `#12`, `acme/web#12` or `TES-12`, linked with an icon for what it points at. */
const Reference = (props: { node: MdRef }) => {
  const sync = useContext(Sync)
  const target = createMemo((): { issue?: Issue; pullRequest?: IssuePullRequest; url?: string } | null => {
    const ref = props.node.ref
    if (ref.kind === "identifier") {
      const issue = findIssue(sync.state, `${ref.key}-${ref.number}`, sync.index.lookup())
      return issue ? { issue } : null
    }
    return resolveGithubRef(sync.state, ref, sync.index.lookup()) ??
      { url: `https://github.com/${ref.owner}/${ref.repo}/${ref.pull ? "pull" : "issues"}/${ref.number}` }
  })
  return (
    <Switch fallback={props.node.text}>
      <Match when={target()?.issue}>
        {(issue) => (
          <a href={issueHref(sync.state, issue())} title={`${issueKey(sync.state, issue())} ${issue().title}`} {...stylex.attrs(s.ref)}>
            <Show when={sync.state.workflowStates[issue().stateId]}>
              {(st) => (
                <RefIcon>
                  <StateIcon type={st().type} color={st().color} size={14} />
                </RefIcon>
              )}
            </Show>
            {props.node.text}
          </a>
        )}
      </Match>
      <Match when={target()?.pullRequest}>
        {(pr) => (
          <a href={pullRequestHref(pr())} title={`${pr().title} · ${pullRequestLabel[pr().state]}`} {...stylex.attrs(s.ref)}>
            <RefIcon>
              <PullRequestIcon state={pr().state} size={14} />
            </RefIcon>
            {props.node.text}
          </a>
        )}
      </Match>
      <Match when={target()?.url}>
        {(url) => (
          <a
            href={pullRequestHrefFromUrl(url()) ?? url()}
            title={pullRequestHrefFromUrl(url()) ? "Pull request" : "Open on GitHub"}
            {...(pullRequestHrefFromUrl(url()) ? {} : External)}
            {...stylex.attrs(s.ref)}
          >
            <RefIcon>
              <GithubIcon size={13} />
            </RefIcon>
            {props.node.text}
          </a>
        )}
      </Match>
    </Switch>
  )
}

const Nodes = (props: { nodes: ReadonlyArray<MdNode>; parent: string }) => (
  <For each={props.nodes}>
    {(node) =>
      typeof node === "string"
        ? node
        : isRef(node)
        ? <Reference node={node} />
        : isElement(node)
        ? <Element el={node} parent={props.parent} />
        : null}
  </For>
)

/** Markdown rendered as GitHub renders issue bodies. `repo` is where `#12` points. */
export const Markdown = (props: { source: string; repo: RefContext | null; xstyle?: stylex.StyleXStyles }) => {
  const tree = createMemo(() => parseMarkdown(props.source, props.repo))
  return (
    <div {...stylex.attrs(s.root, props.xstyle)}>
      <Nodes nodes={tree()} parent="root" />
    </div>
  )
}
