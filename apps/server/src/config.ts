import { Config, Context, Effect, Layer, Option, Redacted } from "effect"

export interface ServerConfigShape {
  readonly port: number
  readonly host: string
  readonly dbPath: string
  /** Built web app to serve, when it exists. In dev, Vite serves the UI instead. */
  readonly webDist: string
  readonly seedSampleData: boolean
  readonly github: {
    readonly enabled: boolean
    readonly token: Option.Option<string>
    readonly tokenSource: "env" | "gh-cli" | null
    readonly apiUrl: string
    readonly webhookSecret: Option.Option<string>
    readonly pollIntervalSeconds: number
  }
}

export class ServerConfig extends Context.Service<ServerConfig, ServerConfigShape>()("gradient/ServerConfig") {
  static readonly layer = Layer.effect(
    ServerConfig,
    Effect.gen(function*() {
      const port = yield* Config.Int("GRADIENT_PORT").pipe(Config.withDefault(4100))
      const host = yield* Config.String("GRADIENT_HOST").pipe(Config.withDefault("127.0.0.1"))
      const dbPath = yield* Config.String("GRADIENT_DB").pipe(Config.withDefault("./gradient.db"))
      const webDist = yield* Config.String("GRADIENT_WEB_DIST").pipe(
        Config.withDefault(new URL("../../web/dist", import.meta.url).pathname)
      )
      const seedSampleData = yield* Config.Boolean("GRADIENT_SEED_SAMPLE").pipe(Config.withDefault(true))
      const disabled = yield* Config.Boolean("GRADIENT_GITHUB_DISABLED").pipe(Config.withDefault(false))
      const envToken = yield* Config.option(Config.Redacted("GITHUB_TOKEN"))
      const apiUrl = yield* Config.String("GITHUB_API_URL").pipe(Config.withDefault("https://api.github.com"))
      const webhookSecret = yield* Config.option(Config.String("GITHUB_WEBHOOK_SECRET"))
      const pollIntervalSeconds = yield* Config.Number("GITHUB_POLL_INTERVAL").pipe(Config.withDefault(15))

      let token = Option.map(envToken, (r) => Redacted.value(r))
      let tokenSource: "env" | "gh-cli" | null = Option.isSome(token) ? "env" : null
      if (!disabled && Option.isNone(token)) {
        const fromCli = yield* Effect.sync(ghCliToken)
        if (fromCli) {
          token = Option.some(fromCli)
          tokenSource = "gh-cli"
        }
      }
      return ServerConfig.of({
        port,
        host,
        dbPath,
        webDist,
        seedSampleData,
        github: {
          enabled: !disabled && Option.isSome(token),
          token: disabled ? Option.none() : token,
          tokenSource: disabled ? null : tokenSource,
          apiUrl: apiUrl.replace(/\/$/, ""),
          webhookSecret,
          pollIntervalSeconds
        }
      })
    })
  )
}

/** Borrow the token of a logged-in GitHub CLI, so local setup needs no extra step. */
const ghCliToken = (): string | null => {
  try {
    const out = Bun.spawnSync(["gh", "auth", "token"], { stdout: "pipe", stderr: "ignore" })
    const text = out.stdout.toString().trim()
    return out.exitCode === 0 && text ? text : null
  } catch {
    return null
  }
}
