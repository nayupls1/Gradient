#!/usr/bin/env bun
/**
 * The `gradient` command. `bun link` in the repository root puts it on your
 * PATH; it always works on the checkout it lives in, wherever you run it.
 */
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"
import { supervise, type Task } from "./processes.ts"

const root = join(import.meta.dir, "..", "..", "..")
const serverDir = join(root, "apps", "server")
const webDir = join(root, "apps", "web")
const bun = process.execPath
const branch = "master"

const help = `gradient: run Gradient from this checkout (${root})

Usage:
  gradient run [--web] [--no-pull]   pull the latest ${branch}, install, build and start
  gradient start [--web]             start the last build
  gradient dev                       server and Vite with live reload
  gradient help

Options:
  --web       also start the web app (vite preview) next to the server
  --no-pull   skip updating ${branch}, build and start what is checked out

The server serves the built web app itself on its own port, so the server
alone is a full Gradient. --web adds the web app on GRADIENT_WEB_PORT, which
proxies to the server, like \`bun run start\`.

Ctrl+C stops everything.`

const fail = (message: string): never => {
  console.error(`gradient: ${message}`)
  process.exit(1)
}

/** Runs one step to completion with the terminal attached, and stops on failure. */
const step = (title: string, cmd: ReadonlyArray<string>, cwd = root) => {
  console.log(`\n» ${title}`)
  const result = Bun.spawnSync([...cmd], { cwd, stdio: ["inherit", "inherit", "inherit"] })
  if (!result.success) fail(`${title.toLowerCase()} failed (${cmd.join(" ")})`)
}

const git = (...args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stderr: "pipe" })
  if (!result.success) fail(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`)
  return result.stdout.toString().trim()
}

const pull = () => {
  const current = git("rev-parse", "--abbrev-ref", "HEAD")
  if (current !== branch) {
    fail(`${root} is on ${current}, not ${branch}. Switch to it (git switch ${branch}) or pass --no-pull.`)
  }
  step(`Pulling the latest ${branch}`, ["git", "pull", "--ff-only", "origin", branch])
}

const build = () => {
  step("Installing dependencies", [bun, "install"])
  step("Building the web app", [bun, "run", "build"], webDir)
  step("Building the server", [bun, "run", "build"], serverDir)
}

/** Vite's own script, run with Bun, so stopping it needs no `bun run` or Node in between. */
const vite = () => {
  try {
    return join(dirname(Bun.resolveSync("vite/package.json", webDir)), "bin", "vite.js")
  } catch {
    return fail("Vite is not installed. Run `bun install` (or `gradient run`) first.")
  }
}

const serverPort = process.env["GRADIENT_PORT"] ?? "4100"
const webPort = process.env["GRADIENT_WEB_PORT"] ?? "4200"

const start = async (web: boolean) => {
  if (!existsSync(join(serverDir, "dist", "main.js"))) fail("Nothing is built yet. Run `gradient run` first.")
  if (web && !existsSync(join(webDir, "dist", "index.html"))) fail("The web app is not built. Run `gradient run` first.")
  const tasks: Array<Task> = [{ name: "server", cmd: [bun, "dist/main.js"], cwd: serverDir }]
  if (web) tasks.push({ name: "web", cmd: [bun, vite(), "preview"], cwd: webDir })
  console.log(`\nGradient on http://localhost:${web ? webPort : serverPort}. Ctrl+C stops it.\n`)
  process.exit(await supervise(tasks))
}

const dev = async () => {
  console.log(`\nGradient (dev) on http://localhost:${webPort}. Ctrl+C stops it.\n`)
  process.exit(
    await supervise([
      { name: "server", cmd: [bun, "--watch", "src/main.ts"], cwd: serverDir },
      { name: "web", cmd: [bun, vite()], cwd: webDir }
    ])
  )
}

const parse = (args: ReadonlyArray<string>) => {
  try {
    return parseArgs({
      args: [...args],
      allowPositionals: true,
      options: {
        web: { type: "boolean", default: false },
        "no-pull": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false }
      }
    })
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : String(error)}\n\n${help}`)
  }
}

const { values, positionals } = parse(Bun.argv.slice(2))
const [command, ...extra] = positionals
if (extra.length > 0) fail(`unexpected argument: ${extra.join(" ")}\n\n${help}`)

switch (values.help ? "help" : command) {
  case "run":
    if (!values["no-pull"]) pull()
    build()
    await start(values.web)
    break
  case "start":
    await start(values.web)
    break
  case "dev":
    await dev()
    break
  case undefined:
  case "help":
    console.log(help)
    break
  default:
    fail(`unknown command: ${command}\n\n${help}`)
}
