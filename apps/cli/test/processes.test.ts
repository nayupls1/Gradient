import { describe, expect, test } from "bun:test"
import { supervise, type Task } from "../src/processes.ts"

const bun = process.execPath
const sleeper = (name: string): Task => ({ name, cmd: [bun, "-e", "setInterval(() => {}, 1000)"], cwd: import.meta.dir })
const exits = (name: string, code: number): Task => ({
  name,
  cmd: [bun, "-e", `setTimeout(() => process.exit(${code}), 100)`],
  cwd: import.meta.dir
})

describe("supervise", () => {
  test("stops the others when one task exits, with its code", async () => {
    const started = Date.now()
    expect(await supervise([sleeper("server"), exits("web", 3)])).toBe(3)
    expect(Date.now() - started).toBeLessThan(4000)
  })

  test("Ctrl+C stops every task and exits cleanly", async () => {
    const done = supervise([sleeper("server"), sleeper("web")])
    await Bun.sleep(200)
    process.emit("SIGINT")
    expect(await done).toBe(0)
    expect(process.listenerCount("SIGINT")).toBe(0)
  })

  test("kills a task that ignores the stop signal after the grace period", async () => {
    const stubborn: Task = {
      name: "stubborn",
      cmd: [bun, "-e", `process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)`],
      cwd: import.meta.dir
    }
    const done = supervise([stubborn], { graceMs: 300 })
    await Bun.sleep(300)
    process.emit("SIGINT")
    expect(await done).toBe(0)
  })
})
