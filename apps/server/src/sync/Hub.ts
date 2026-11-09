import type { Delta } from "@gradient/domain"
import { Context, Effect, Layer, PubSub } from "effect"

/** In-process fan-out of committed deltas to every live subscription. */
export class Hub extends Context.Service<Hub, {
  readonly pubsub: PubSub.PubSub<ReadonlyArray<Delta>>
  publish(deltas: ReadonlyArray<Delta>): Effect.Effect<void>
}>()("gradient/Hub") {
  static readonly layer = Layer.effect(
    Hub,
    Effect.gen(function*() {
      const pubsub = yield* PubSub.unbounded<ReadonlyArray<Delta>>()
      yield* Effect.addFinalizer(() => PubSub.shutdown(pubsub))
      return Hub.of({
        pubsub,
        publish: (deltas) => (deltas.length === 0 ? Effect.void : Effect.asVoid(PubSub.publish(pubsub, deltas)))
      })
    })
  )
}
