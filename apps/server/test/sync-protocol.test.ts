import { afterAll, beforeAll, expect, test } from "bun:test"
import { GradientRpcs, type SyncEvent } from "@gradient/domain"
import { Effect, Fiber, Layer, ManagedRuntime, Option, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import { AppServices, HttpLive } from "../src/app.ts"
import { ServerConfig } from "../src/config.ts"

const port = 20000 + Math.floor(Math.random() * 20000)
const server = ManagedRuntime.make(
  Layer.merge(AppServices, HttpLive.pipe(Layer.provide(AppServices))).pipe(
    Layer.provideMerge(Layer.succeed(ServerConfig, {
      port,
      host: "127.0.0.1",
      dbPath: ":memory:",
      webDist: "/nonexistent",
      seedSampleData: true,
      github: {
        enabled: false,
        token: Option.none(),
        tokenSource: null,
        apiUrl: "http://127.0.0.1:1",
        webhookSecret: Option.none(),
        pollIntervalSeconds: 3600
      }
    }))
  )
)

const client = RpcClient.layerProtocolSocket().pipe(
  Layer.provide(Socket.layerWebSocket(`ws://127.0.0.1:${port}/rpc`)),
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provide(RpcSerialization.layerJson)
)
const run = <A, E>(f: (c: RpcClient.FromGroup<typeof GradientRpcs>) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.gen(function*() {
    return yield* f((yield* RpcClient.make(GradientRpcs)) as any)
  }).pipe(Effect.scoped, Effect.provide(client)))

beforeAll(() => server.runPromise(Effect.void))
afterAll(() => server.dispose())

test("subscribe replays the log from a cursor, then streams live commits in order", async () => {
  await run((c) =>
    Effect.gen(function*() {
      const snap = yield* c.Bootstrap()
      const issue = snap.issues[0]!
      // Commit one change before subscribing: it must arrive through catch-up.
      yield* c.Mutate({ clientTxId: "before", mutations: [{ _tag: "IssueUpdate", id: issue.id, patch: { title: "One" } }] })

      const events = yield* c.Subscribe({ since: snap.lastSyncId }).pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild
      )
      yield* Effect.sleep("100 millis")
      yield* c.Mutate({ clientTxId: "after", mutations: [{ _tag: "IssueUpdate", id: issue.id, patch: { title: "Two" } }] })
      const received = (yield* Fiber.join(events)) as ReadonlyArray<SyncEvent>

      const deltas = received.flatMap((e) => (e._tag === "Deltas" ? e.deltas : []))
      expect(deltas.map((d) => d.clientTxId)).toEqual(["before", "after"])
      expect(deltas[0]!.syncId).toBeLessThan(deltas[1]!.syncId)
      const last = deltas[1]!
      expect(last._tag === "Upsert" && last.entity.model === "issue" && last.entity.value.title).toBe("Two")
    })
  )
})

test("a cursor ahead of the server (its database was reset) gets told to bootstrap again", async () => {
  await run((c) =>
    Effect.gen(function*() {
      const snap = yield* c.Bootstrap()
      const events = yield* c.Subscribe({ since: snap.lastSyncId + 1000 }).pipe(Stream.take(1), Stream.runCollect)
      expect((events as ReadonlyArray<SyncEvent>)[0]!._tag).toBe("ResetRequired")
    })
  )
})

test("mutate is idempotent per clientTxId and rejects invalid input", async () => {
  await run((c) =>
    Effect.gen(function*() {
      const snap = yield* c.Bootstrap()
      const id = snap.issues[0]!.id
      const m = { clientTxId: "retry-me", mutations: [{ _tag: "IssueUpdate" as const, id, patch: { priority: 1 as const } }] }
      const first = yield* c.Mutate(m)
      const second = yield* c.Mutate(m)
      expect(second.syncId).toBe(first.syncId)

      const rejected = yield* c.Mutate({ clientTxId: "bad", mutations: [{ _tag: "IssueUpdate", id, patch: { stateId: "nope" } }] }).pipe(Effect.flip)
      expect(rejected.message).toBe("Unknown workflow state")
    })
  )
})
