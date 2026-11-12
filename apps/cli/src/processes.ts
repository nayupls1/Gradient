import type { Subprocess } from "bun"

/** A long-running process, such as the server or Vite. */
export interface Task {
  readonly name: string
  readonly cmd: ReadonlyArray<string>
  readonly cwd: string
}

const isWindows = process.platform === "win32"

const running = (proc: Subprocess) => proc.exitCode === null && proc.signalCode === null

/**
 * Ends a process and the processes it started. Windows has no SIGTERM:
 * `kill()` there is TerminateProcess, which leaves grandchildren running and
 * holding the console, so the whole tree goes through `taskkill /T`.
 */
export const killTree = (proc: Subprocess, force: boolean) => {
  if (!running(proc)) return
  if (isWindows) {
    Bun.spawnSync(["taskkill", "/pid", String(proc.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" })
  } else {
    proc.kill(force ? "SIGKILL" : "SIGTERM")
  }
}

const stopSignals: ReadonlyArray<NodeJS.Signals> = isWindows
  ? ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]
  : ["SIGINT", "SIGTERM", "SIGHUP"]

/**
 * Runs the tasks side by side until one of them exits or we are asked to
 * stop (Ctrl+C, closing the terminal), then stops the rest. A second Ctrl+C,
 * or `graceMs` without exiting, kills what is left. Resolves with the exit
 * code to use: 0 when stopped on purpose, else the code of the task that
 * ended first.
 *
 * This replaces `bun run --filter … start`, which on Windows does not stop
 * its children on Ctrl+C and so never returns.
 */
export const supervise = (
  tasks: ReadonlyArray<Task>,
  options: { readonly graceMs?: number } = {}
): Promise<number> =>
  new Promise((resolve) => {
    const graceMs = options.graceMs ?? 5000
    const procs = tasks.map((task) =>
      Bun.spawn([...task.cmd], {
        cwd: task.cwd,
        env: process.env,
        // The tasks share one terminal: none of them reads keys from it.
        stdio: ["ignore", "inherit", "inherit"]
      })
    )
    let stopping = false
    let exitCode = 0
    let forceTimer: ReturnType<typeof setTimeout> | undefined

    const stop = (code: number) => {
      if (stopping) {
        for (const proc of procs) killTree(proc, true)
        return
      }
      stopping = true
      exitCode = code
      for (const proc of procs) killTree(proc, false)
      forceTimer = setTimeout(() => {
        for (const proc of procs) killTree(proc, true)
      }, graceMs)
    }

    const onSignal = () => stop(0)
    for (const signal of stopSignals) process.on(signal, onSignal)

    procs.forEach((proc, i) => {
      void proc.exited.then((code) => {
        if (stopping) return
        const task = tasks[i]!
        console.error(`gradient: ${task.name} exited${code === 0 ? "" : ` with code ${code}`}, stopping`)
        stop(code === 0 ? 0 : code)
      })
    })

    void Promise.all(procs.map((proc) => proc.exited)).then(() => {
      clearTimeout(forceTimer)
      for (const signal of stopSignals) process.off(signal, onSignal)
      resolve(exitCode)
    })
  })
