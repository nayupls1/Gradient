import { describe, expect, test } from "bun:test"
import { autoIcon, iconCandidates, imageContentType, MAX_ICON_BYTES, type RepoFile } from "../src/github/icons.ts"

const files = (...paths: Array<string>): Array<RepoFile> => paths.map((path, i) => ({ path, sha: `sha${i}`, size: 100 }))
const auto = (...paths: Array<string>) => autoIcon(files(...paths))?.path ?? null

describe("autoIcon", () => {
  test("prefers a favicon where web projects keep one", () => {
    expect(auto("README.md", "docs/logo.png", "public/favicon.ico", "src/index.ts")).toBe("public/favicon.ico")
    expect(auto("app/favicon.ico", "assets/logo.svg")).toBe("app/favicon.ico")
  })

  test("prefers SVG over other formats of the same icon", () => {
    expect(auto("public/favicon.ico", "public/favicon.png", "public/favicon.svg")).toBe("public/favicon.svg")
  })

  test("finds a monorepo app's favicon", () => {
    expect(auto("apps/web/public/favicon.svg", "apps/web/src/main.tsx", "packages/ui/logo.png")).toBe("apps/web/public/favicon.svg")
  })

  test("falls back to an app icon, then a logo", () => {
    expect(auto("src/app/icon.png", "logo.svg")).toBe("src/app/icon.png")
    expect(auto(".github/logo.svg", "docs/screenshot.png")).toBe(".github/logo.svg")
    expect(auto("assets/logo-dark.png", "assets/banner.png")).toBe("assets/logo-dark.png")
  })

  test("ignores dependencies, fixtures and sample apps", () => {
    expect(auto("node_modules/pkg/favicon.svg", "examples/blog/public/favicon.ico", "test/fixtures/favicon.png")).toBe(null)
    expect(auto("examples/blog/public/favicon.ico", "logo.png")).toBe("logo.png")
  })

  test("is null for a repository without an icon, so the project keeps its cube", () => {
    expect(auto("README.md", "docs/screenshot.png", "src/banner.svg")).toBe(null)
  })

  test("skips files that are too large", () => {
    expect(autoIcon([{ path: "favicon.png", sha: "a", size: MAX_ICON_BYTES + 1 }])).toBe(null)
  })
})

test("iconCandidates lists every image, best guesses first", () => {
  expect(iconCandidates(files("src/a.ts", "docs/shot.png", "public/favicon.svg", "assets/logo.png")).map((f) => f.path))
    .toEqual(["public/favicon.svg", "assets/logo.png", "docs/shot.png"])
})

test("imageContentType only knows images", () => {
  expect(imageContentType("favicon.svg")).toBe("image/svg+xml")
  expect(imageContentType("Logo.PNG")).toBe("image/png")
  expect(imageContentType("index.html")).toBe(null)
  expect(imageContentType("favicon")).toBe(null)
})
