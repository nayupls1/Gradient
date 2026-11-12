import type { PullRequestFile } from "@gradient/domain"
import { CodeView, type CodeViewDiffItem, type CodeViewOptions, processFile } from "@pierre/diffs"
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker"
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker"
import * as stylex from "@stylexjs/stylex"
import { createEffect, onCleanup } from "solid-js"
import { colors } from "../lib/tokens.stylex.ts"
import { font } from "../theme/tokens.stylex.ts"
import { activeScheme } from "../theme/theme.ts"

/*
 * A pull request's changed files, drawn by Pierre's diffs (`@pierre/diffs`,
 * the viewer t3code uses): syntax highlighted in a worker pool, virtualized
 * across files and lines, with sticky collapsible file headers. This wraps its
 * framework-free `CodeView`; the page around it stays Solid.
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

const toItems = (files: ReadonlyArray<PullRequestFile>, cacheKey: string): Array<CodeViewDiffItem> =>
  files.flatMap((file, index) => {
    if (!file.patch) return []
    const fileDiff = processFile(toGitPatch(file), { isGitDiff: true, cacheKey: `${cacheKey}:${index}` })
    return fileDiff ? [{ id: file.path, type: "diff" as const, fileDiff }] : []
  })

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
}) => {
  let view: CodeView | undefined

  const options = (scheme: "light" | "dark", layout: "unified" | "split"): CodeViewOptions<undefined, undefined> => ({
    theme: THEMES,
    themeType: scheme,
    diffStyle: layout,
    overflow: "scroll",
    stickyHeaders: true,
    hunkSeparators: "line-info",
    lineDiffType: "word",
    unsafeCSS: UNSAFE_CSS,
    layout: { paddingTop: 12, paddingBottom: 48, gap: 12 }
  })

  const mount = (el: HTMLDivElement) => {
    view = new CodeView(options(activeScheme(), props.layout), workerPool())
    view.setup(el)
    props.apiRef?.({ scrollToFile: (path) => view?.scrollTo({ type: "item", id: path, behavior: "smooth" }) })
  }

  createEffect(
    () => toItems(props.files, props.cacheKey),
    (items) => {
      view?.setItems(items)
      view?.render(true)
    }
  )
  createEffect(
    () => options(activeScheme(), props.layout),
    (next) => {
      view?.setOptions(next)
      view?.onThemeChange()
      view?.render(true)
    }
  )
  onCleanup(() => view?.cleanUp())

  return (
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
  )
}
