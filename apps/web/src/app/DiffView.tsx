import type { PullRequestFile } from "@gradient/domain"
import {
  CodeView,
  type CodeViewDiffItem,
  type CodeViewOptions,
  type DiffLineAnnotation,
  processFile,
  type SelectedLineRange
} from "@pierre/diffs"
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker"
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker"
import * as stylex from "@stylexjs/stylex"
import { type JSX, Portal } from "@solidjs/web"
import { createEffect, createMemo, For, onCleanup, untrack } from "solid-js"
import { colors } from "../lib/tokens.stylex.ts"
import { font } from "../theme/tokens.stylex.ts"
import { activeScheme } from "../theme/theme.ts"

/*
 * A pull request's changed files, drawn by Pierre's diffs (`@pierre/diffs`,
 * the viewer t3code uses): syntax highlighted in a worker pool, virtualized
 * across files and lines, with sticky collapsible file headers. This wraps its
 * framework-free `CodeView`; the page around it stays Solid.
 *
 * Inline comments are Pierre annotations: one element per line that has a
 * thread (existing comments, pending drafts, an open comment form). Their
 * contents are ordinary Solid, portalled into the element Pierre places, so
 * they keep the page's contexts and stay reactive.
 */

const THEMES = { light: "pierre-light", dark: "pierre-dark" } as const

/** One pool for the whole app: highlighting runs off the main thread. */
const workerPool = () =>
  getOrCreateWorkerPoolSingleton({
    poolOptions: { workerFactory: () => new DiffsWorker(), poolSize: Math.min(4, navigator.hardwareConcurrency || 2) },
    highlighterOptions: { theme: THEMES }
  })

// The diff draws inside a shadow root; custom properties still inherit, so the
// container hands our surface and fonts in under names Pierre's CSS reads.
const UNSAFE_CSS = `
[data-diffs-header], [data-diff], [data-file], [data-error-wrapper], [data-virtualizer-buffer] {
  --diffs-light-bg: var(--gd-diff-bg) !important;
  --diffs-dark-bg: var(--gd-diff-bg) !important;
  --diffs-font-family: var(--gd-diff-mono) !important;
  --diffs-header-font-family: var(--gd-diff-sans) !important;
  --diffs-font-size: 12px;
}
[data-diffs-header] {
  font-size: 12px !important;
  border-bottom-color: var(--gd-diff-border) !important;
}
`

const s = stylex.create({
  root: { height: "100%", overflowY: "auto", scrollbarGutter: "stable" }
})

/** GitHub sends hunks only; Pierre parses a git patch, so give each file the headers git would. */
const toGitPatch = (file: PullRequestFile) => {
  const oldPath = file.previousPath ?? file.path
  const header = [`diff --git a/${oldPath} b/${file.path}`]
  if (file.status === "renamed" && file.previousPath) header.push(`rename from ${file.previousPath}`, `rename to ${file.path}`)
  header.push(file.status === "added" ? "--- /dev/null" : `--- a/${oldPath}`)
  header.push(file.status === "removed" ? "+++ /dev/null" : `+++ b/${file.path}`)
  return `${header.join("\n")}\n${file.patch ?? ""}\n`
}

type Meta = { key: string }
type Item = CodeViewDiffItem<Meta>

const toItems = (files: ReadonlyArray<PullRequestFile>, cacheKey: string): Array<Item> =>
  files.flatMap((file, index) => {
    if (!file.patch) return []
    const fileDiff = processFile(toGitPatch(file), { isGitDiff: true, cacheKey: `${cacheKey}:${index}` })
    return fileDiff ? [{ id: file.path, type: "diff" as const, fileDiff }] : []
  })

/** A line with something under it: GitHub's LEFT (old file) or RIGHT (new file), and a stable key. */
export interface DiffThreadAnchor {
  readonly side: "LEFT" | "RIGHT"
  readonly line: number
  readonly key: string
}

/** Lines picked in the gutter (the + button, or dragged), as GitHub positions them. */
export interface DiffLineRange {
  readonly side: "LEFT" | "RIGHT"
  readonly line: number
  /** The first line of a multi-line range on the same side, else null. */
  readonly startLine: number | null
}

const toGithubRange = (range: SelectedLineRange): DiffLineRange => {
  const endSide = range.endSide ?? range.side
  const side = endSide === "deletions" ? "LEFT" : "RIGHT"
  const [start, end] = range.start <= range.end ? [range.start, range.end] : [range.end, range.start]
  const sameSide = (range.side ?? endSide) === endSide
  return { side, line: end, startLine: sameSide && start !== end ? start : null }
}

export interface DiffViewApi {
  /** Scroll a file's header to the top. */
  scrollToFile(path: string): void
}

export const DiffView = (props: {
  files: ReadonlyArray<PullRequestFile>
  /** Changes when the files do (the pull request and its head), for the highlight cache. */
  cacheKey: string
  layout: "unified" | "split"
  apiRef?: (api: DiffViewApi) => void
  /** The lines of a file that have a thread under them. */
  threads?: (path: string) => ReadonlyArray<DiffThreadAnchor>
  /** What goes under a line, by its key. */
  renderThread?: (key: string) => JSX.Element
  /** Lines picked in a file's gutter; turns on the + button. */
  onPickLines?: ((path: string, range: DiffLineRange) => void) | undefined
}) => {
  let view: CodeView<Meta> | undefined
  /** One element per thread, created on demand and reused while it exists. */
  const elements = new Map<string, HTMLElement>()
  const elementFor = (key: string) => {
    let el = elements.get(key)
    if (!el) {
      el = document.createElement("div")
      el.dataset.gradientThread = key
      elements.set(key, el)
    }
    return el
  }

  const options = (scheme: "light" | "dark", layout: "unified" | "split", commentable: boolean): CodeViewOptions<Meta, undefined> =>
    // CodeView types its callbacks as overloads (file or diff items); ours only ever sees diffs.
    ({
    theme: THEMES,
    themeType: scheme,
    diffStyle: layout,
    overflow: "scroll",
    stickyHeaders: true,
    hunkSeparators: "line-info",
    lineDiffType: "word",
    unsafeCSS: UNSAFE_CSS,
    layout: { paddingTop: 12, paddingBottom: 48, gap: 12 },
    enableGutterUtility: commentable,
    enableLineSelection: commentable,
    renderAnnotation: (annotation: DiffLineAnnotation<Meta>) => elementFor(annotation.metadata.key),
    ...(commentable
      ? {
        onGutterUtilityClick: (range: SelectedLineRange, context: { item: Item }) =>
          props.onPickLines?.(context.item.id, toGithubRange(range))
      }
      : {})
  }) as unknown as CodeViewOptions<Meta, undefined>

  const commentable = () => props.onPickLines !== undefined
  const mount = (el: HTMLDivElement) => {
    view = new CodeView<Meta>(options(activeScheme(), props.layout, untrack(commentable)), workerPool())
    view.setup(el)
    props.apiRef?.({ scrollToFile: (path) => view?.scrollTo({ type: "item", id: path, behavior: "smooth" }) })
  }

  const base = createMemo(() => toItems(props.files, props.cacheKey))
  /** Annotations per file, with a signature to tell when a file's threads changed. */
  const annotated = createMemo(() =>
    base().map((item) => {
      const anchors = props.threads?.(item.id) ?? []
      const annotations: Array<DiffLineAnnotation<Meta>> = anchors.map((a) => ({
        side: a.side === "LEFT" ? "deletions" : "additions",
        lineNumber: a.line,
        metadata: { key: a.key }
      }))
      return { item, annotations, signature: anchors.map((a) => a.key).join("|") }
    })
  )
  let shown: { base: ReadonlyArray<Item>; signatures: Map<string, string> } | null = null
  let version = 0
  createEffect(
    () => ({ items: base(), annotated: annotated() }),
    ({ items, annotated }) => {
      if (!view) return
      const withAnnotations = annotated.map(({ item, annotations }) => ({ ...item, annotations, version: ++version }))
      if (!shown || shown.base !== items) {
        // New files: replace everything.
        view.setItems(withAnnotations)
      } else {
        // Same files, new threads: update only the files whose threads changed.
        for (const [i, entry] of annotated.entries()) {
          if (shown.signatures.get(entry.item.id) !== entry.signature) view.updateItem(withAnnotations[i]!)
        }
      }
      shown = { base: items, signatures: new Map(annotated.map((a) => [a.item.id, a.signature])) }
      view.render(true)
    }
  )
  /** Every thread key on screen, so each gets its portal. */
  const keys = createMemo(() => annotated().flatMap((a) => a.annotations.map((x) => x.metadata.key)))
  createEffect(keys, (current) => {
    const live = new Set(current)
    for (const key of elements.keys()) if (!live.has(key)) elements.delete(key)
  })
  createEffect(
    () => options(activeScheme(), props.layout, commentable()),
    (next) => {
      view?.setOptions(next)
      view?.onThemeChange()
      view?.render(true)
    }
  )
  onCleanup(() => view?.cleanUp())

  return (
    <>
      <div
        ref={mount}
        {...stylex.attrs(s.root)}
        style={{
          "--gd-diff-bg": colors.background,
          "--gd-diff-border": colors.border,
          "--gd-diff-mono": font.mono,
          "--gd-diff-sans": font.sans
        }}
      />
      <For each={keys()}>
        {(key) => <Portal mount={elementFor(key)}>{props.renderThread?.(key)}</Portal>}
      </For>
    </>
  )
}
