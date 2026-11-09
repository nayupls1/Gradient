import {
  applyIssueMutation,
  applyLabelMutation,
  type Delta,
  type GithubRepo,
  GradientRpcs,
  type Issue,
  type Label,
  type Mutation,
  type Snapshot,
  type Team,
  touchedIssueId,
  type User,
  uuidv7,
  type WorkflowState
} from "@gradient/domain"
import { Cause, Effect, Layer, ManagedRuntime, Queue, Schedule, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import { createStore, reconcile } from "solid-js"

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

interface PendingTx {
  readonly clientTxId: string
  readonly mutations: ReadonlyArray<Mutation>
  /** Set when the server accepted it; the tx drops once our log reaches this id. */
  confirmedAt: number | null
}

type Tables = Pick<SyncState, "teams" | "users" | "workflowStates" | "labels" | "issues" | "githubRepos">
type TableName = keyof Tables

const emptyTables = (): { [K in TableName]: Map<string, Tables[K][string]> } => ({
  teams: new Map(),
  users: new Map(),
  workflowStates: new Map(),
  labels: new Map(),
  issues: new Map(),
  githubRepos: new Map()
})

const tableOf = {
  team: "teams",
  user: "users",
  workflowState: "workflowStates",
  label: "labels",
  issue: "issues",
  githubRepo: "githubRepos"
} as const satisfies Record<Delta extends { model: infer M } ? M & string : never, TableName> & Record<string, TableName>

const rpcUrl = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rpc`

const ProtocolLive = RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
  Layer.provide(Socket.layerWebSocket(Effect.sync(rpcUrl))),
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provide(RpcSerialization.layerJson)
)

/**
 * The client half of the sync engine.
 *
 * `base` holds what the server has confirmed. `pending` holds local
 * transactions the server has not confirmed yet. The reactive `state` is
 * always base with pending applied on top, so the UI updates instantly and
 * rolls back cleanly when the server rejects a change.
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

  let base = emptyTables()
  let lastSyncId = 0
  // Plain copies of store fields the engine itself reads, so it never reads the store outside a tracking scope.
  let ready = false
  let viewerId = ""
  let pending: Array<PendingTx> = []

  const runtime = ManagedRuntime.make(ProtocolLive)
  const outbox = Effect.runSync(Queue.unbounded<PendingTx>())

  /** Recompute the visible value of the given rows from base + pending. */
  const recompute = (table: TableName, ids: Iterable<string>) => {
    const now = Date.now()
    const ctx = { now, actorId: viewerId }
    setState((s) => {
      for (const id of ids) {
        let value: any = base[table].get(id)
        if (table === "issues") {
          for (const tx of pending) {
            for (const m of tx.mutations) {
              if (touchedIssueId(m) === id) value = applyIssueMutation(value ?? undefined, m, ctx)
            }
          }
        } else if (table === "labels") {
          for (const tx of pending) for (const m of tx.mutations) if (m._tag === "LabelCreate" && m.id === id) value ??= applyLabelMutation(m)
        }
        const target = s[table] as Record<string, any>
        if (value === null || value === undefined) delete target[id]
        else if (target[id]) reconcile(value, "id")(target[id])
        else target[id] = value
      }
    })
  }

  const affected = (txs: ReadonlyArray<PendingTx>) => {
    const issues = new Set<string>()
    const labels = new Set<string>()
    for (const tx of txs) {
      for (const m of tx.mutations) {
        const id = touchedIssueId(m)
        if (id) issues.add(id)
        if (m._tag === "LabelCreate") labels.add(m.id)
      }
    }
    return { issues, labels }
  }

  const applySnapshot = (snap: Snapshot) => {
    base = emptyTables()
    for (const t of snap.teams) base.teams.set(t.id, t)
    for (const u of snap.users) base.users.set(u.id, u)
    for (const w of snap.workflowStates) base.workflowStates.set(w.id, w)
    for (const l of snap.labels) base.labels.set(l.id, l)
    for (const i of snap.issues) base.issues.set(i.id, i)
    for (const r of snap.githubRepos) base.githubRepos.set(r.id, r)
    lastSyncId = snap.lastSyncId
    viewerId = snap.viewerId
    ready = true
    setState((s) => {
      s.viewerId = snap.viewerId
      for (const table of Object.keys(base) as Array<TableName>) {
        ;(s as any)[table] = Object.fromEntries(base[table])
      }
    })
    const { issues, labels } = affected(pending)
    recompute("issues", issues)
    recompute("labels", labels)
    setState((s) => {
      s.ready = true
    })
  }

  const applyDeltas = (deltas: ReadonlyArray<Delta>) => {
    const touched = new Map<TableName, Set<string>>()
    const mark = (table: TableName, id: string) => {
      let set = touched.get(table)
      if (!set) touched.set(table, (set = new Set()))
      set.add(id)
    }
    const seenTx = new Set<string>()
    for (const d of deltas) {
      if (d.syncId <= lastSyncId) continue
      lastSyncId = d.syncId
      if (d.clientTxId) seenTx.add(d.clientTxId)
      if (d._tag === "Upsert") {
        const table = tableOf[d.entity.model]
        base[table].set(d.entity.value.id, d.entity.value as any)
        mark(table, d.entity.value.id)
      } else {
        const table = tableOf[d.model]
        base[table].delete(d.id)
        mark(table, d.id)
      }
    }
    const done = pending.filter((tx) => seenTx.has(tx.clientTxId) || (tx.confirmedAt !== null && tx.confirmedAt <= lastSyncId))
    if (done.length) {
      pending = pending.filter((tx) => !done.includes(tx))
      const { issues, labels } = affected(done)
      for (const id of issues) mark("issues", id)
      for (const id of labels) mark("labels", id)
    }
    for (const [table, ids] of touched) recompute(table, ids)
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
      if (!ready) applySnapshot(yield* client.Bootstrap())
      setConnection("online")
      yield* client.Subscribe({ since: lastSyncId }).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function*() {
            if (event._tag === "Deltas") applyDeltas(event.deltas)
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
        Effect.tap(({ syncId }) =>
          Effect.sync(() => {
            tx.confirmedAt = syncId
            applyDeltas([])
          })
        ),
        Effect.catchTag("MutationRejected", (e) =>
          Effect.sync(() => {
            pending = pending.filter((p) => p !== tx)
            const { issues, labels } = affected([tx])
            recompute("issues", issues)
            recompute("labels", labels)
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
    const tx: PendingTx = { clientTxId: uuidv7(), mutations, confirmedAt: null }
    pending.push(tx)
    const { issues, labels } = affected([tx])
    recompute("issues", issues)
    recompute("labels", labels)
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
