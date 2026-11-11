import { isProjectIconPath } from "@gradient/domain"

/** A file in a repository's tree. */
export interface RepoFile {
  readonly path: string
  readonly sha: string
  readonly size: number
}

/** Larger files are not offered as icons, and not downloaded. */
export const MAX_ICON_BYTES = 1024 * 1024

/** Directories whose images belong to something else: dependencies, fixtures, sample apps, build output. */
const IGNORED_DIRS = new Set([
  "node_modules", "vendor", "third_party", "third-party", "bower_components",
  "fixtures", "__fixtures__", "__tests__", "test", "tests", "spec", "__snapshots__",
  "examples", "example", "samples", "templates", "dist", "build", "out", "coverage", ".next"
])

/** Where web projects keep their favicon and other public assets. */
const ASSET_DIRS = new Set([
  "public", "static", "assets", "app", "src", "images", "img", "icons", "media", "resources", "web", "www", "site",
  "docs", ".github"
])

const EXTENSION_SCORE: Record<string, number> = { svg: 20, png: 12, webp: 10, ico: 8, avif: 6, gif: 4, jpg: 2, jpeg: 2 }

const split = (path: string) => {
  const parts = path.split("/")
  const file = parts.pop()!.toLowerCase()
  const dot = file.lastIndexOf(".")
  return { dirs: parts.map((d) => d.toLowerCase()), base: file.slice(0, dot), ext: file.slice(dot + 1) }
}

/** What the file name says: favicons first, then app icons, then logos. 0: not an icon. */
const nameScore = (base: string) => {
  if (base === "favicon") return 300
  if (base === "icon" || base === "app-icon" || base === "apple-touch-icon" || base === "apple-icon") return 200
  if (/^logo(?:[-_.]?(?:mark|icon|square|symbol))?$/.test(base)) return 120
  if (/^logo[-_.]/.test(base)) return 100
  return 0
}

/** Image files a user can pick as the project icon, best guesses first. */
export const iconCandidates = (files: ReadonlyArray<RepoFile>): ReadonlyArray<RepoFile> =>
  files
    .filter((f) => f.size <= MAX_ICON_BYTES && isProjectIconPath(f.path) && !split(f.path).dirs.some((d) => IGNORED_DIRS.has(d)))
    .map((f) => ({ file: f, score: scoreOf(f.path) }))
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .map((x) => x.file)

const scoreOf = (path: string) => {
  const { dirs, base, ext } = split(path)
  const name = nameScore(base)
  if (name === 0) return 0
  const inAssets = dirs.length === 0 || ASSET_DIRS.has(dirs.at(-1)!)
  return name + (inAssets ? 30 : 0) - dirs.length * 5 + (EXTENSION_SCORE[ext] ?? 0)
}

/**
 * The icon Gradient picks for a repository on its own: a favicon where web
 * projects keep one (`public/favicon.svg`, `app/favicon.ico`, a monorepo's
 * `apps/web/public/favicon.svg`), else an app icon, else a logo. Null when the
 * repository has none, so the project keeps its cube.
 */
export const autoIcon = (files: ReadonlyArray<RepoFile>): RepoFile | null => {
  const best = iconCandidates(files)[0]
  return best && scoreOf(best.path) > 0 ? best : null
}

const CONTENT_TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  avif: "image/avif"
}

/** The image type of a path, or null when it is not an image Gradient serves. */
export const imageContentType = (path: string) => CONTENT_TYPES[split(path).ext] ?? null
