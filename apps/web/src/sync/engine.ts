import {
  type GithubRepo,
  GradientRpcs,
  type Issue,
  type Label,
  type Mutation,
  type Snapshot,
  type Team,
  type User,
  uuidv7,
  type WorkflowState
} from "@gradient/domain"
import { Cause, Effect, Layer, ManagedRuntime, Queue, Schedule, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import { createStore, reconcile } from "solid-js"
import { type Changes, createReplica, type PendingTx } from "./replica.ts"

export type ConnectionState = "connecting" | "online" | "offline"

export interface SyncState {
  ready: boolean
  connection: ConnectionState
  viewerId: string
  teams: Record<string, Team>
  users: Record<string, User>
  workflowStates: Record<string, WorkflowState>
  labels: Record<string, Label>
  issues: Record<string, Issue>
  githubRepos: Record<string, GithubRepo>
  errors: Array<{ id: string; message: string }>
}

const rpcUrl = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rpc`

const ProtocolLive = RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
  Layer.provide(Socket.layerWebSocket(Effect.sync(rpcUrl))),
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provide(RpcSerialization.layerJson)
)

/**
 * The client half of the sync engine: the network loop around a `Replica`
 * (see replica.ts), mirrored into a Solid store for the UI.
 */
export const createSyncEngine = () => {
  const [state, setState] = createStore<SyncState>({
    ready: false,
    connection: "connecting",
    viewerId: "",
    teams: {},
    users: {},
    workflowStates: {},
    labels: {},
    issues: {},
    githubRepos: {},
    errors: []
  })

  const replica = createReplica()
  const runtime = ManagedRuntime.make(ProtocolLive)
  const outbox = Effect.runSync(Queue.unbounded<PendingTx>())

  /** Copy the replica's visible value of each changed row into the reactive store. */
  const write = (changes: Changes) =>
    setState((s) => {
      for (const [table, ids] of changes) {
        const target = s[table] as Record<string, any>
        for (const id of ids) {
          const value = replica.view(table, id)
          if (value === undefined) delete target[id]
          else if (target[id]) reconcile(value, "id")(target[id])
          else target[id] = value
        }
      }
    })

  const applySnapshot = (snap: Snapshot) => {
    const changes = replica.applySnapshot(snap)
    setState((s) => {
      s.viewerId = snap.viewerId
    })
    write(changes)
    setState((s) => {
      s.ready = true
    })
  }

  const reportError = (message: string) => {
    const id = uuidv7()
    setState((s) => {
      s.errors.push({ id, message })
    })
    setTimeout(() => dismissError(id), 6000)
  }
  const dismissError = (id: string) =>
    setState((s) => {
      const i = s.errors.findIndex((e) => e.id === id)
      if (i >= 0) s.errors.splice(i, 1)
    })

  const setConnection = (connection: ConnectionState) =>
    setState((s) => {
      s.connection = connection
    })

  const program = Effect.gen(function*() {
    const client = yield* RpcClient.make(GradientRpcs)

    // Keep one subscription alive; on failure, back off and resume from lastSyncId.
    const subscribe = Effect.gen(function*() {
      if (!replica.ready) applySnapshot(yield* client.Bootstrap())
      setConnection("online")
      yield* client.Subscribe({ since: replica.lastSyncId }).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function*() {
            if (event._tag === "Deltas") write(replica.applyDeltas(event.deltas))
            else applySnapshot(yield* client.Bootstrap())
          })
        )
      )
    }).pipe(
      Effect.tapCause(() => Effect.sync(() => setConnection("offline"))),
      Effect.retry(Schedule.spaced("1 second")),
      Effect.forever
    )

    // Send queued transactions in order. Network errors retry (Mutate is idempotent); rejections roll back.
    const send = Effect.gen(function*() {
      const tx = yield* Queue.take(outbox)
      yield* client.Mutate({ clientTxId: tx.clientTxId, mutations: tx.mutations }).pipe(
        Effect.tap(({ syncId }) => Effect.sync(() => write(replica.confirm(tx, syncId)))),
        Effect.catchTag("MutationRejected", (e) =>
          Effect.sync(() => {
            write(replica.reject(tx))
            reportError(e.message)
          })
        ),
        Effect.retry(Schedule.spaced("1 second"))
      )
    }).pipe(Effect.forever)

    yield* Effect.all([subscribe, send], { concurrency: "unbounded", discard: true })
  }).pipe(Effect.scoped)

  const start = () =>
    runtime.runFork(program.pipe(Effect.catchCause((cause) => Effect.sync(() => console.error(Cause.pretty(cause))))))

  /** Apply mutations locally right away, then send them to the server. */
  const mutate = (...mutations: ReadonlyArray<Mutation>) => {
    const { tx, changes } = replica.addPending(uuidv7(), mutations)
    write(changes)
    Queue.offerUnsafe(outbox, tx)
    return tx.clientTxId
  }

  /** Plain request/response calls that are not part of the synced model. */
  const call = <A, E>(f: (client: RpcClient.FromGroup<typeof GradientRpcs>) => Effect.Effect<A, E>) =>
    runtime.runPromise(
      Effect.gen(function*() {
        const client = yield* RpcClient.make(GradientRpcs)
        return yield* f(client as any)
      }).pipe(Effect.scoped)
    )

  return { state, start, mutate, call, dismissError, dispose: () => runtime.dispose() }
}

export type SyncEngine = ReturnType<typeof createSyncEngine>
