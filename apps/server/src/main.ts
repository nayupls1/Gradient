import { BunRuntime } from "@effect/platform-bun"
import { Layer } from "effect"
import { MainLive } from "./app.ts"

BunRuntime.runMain(Layer.launch(MainLive))
