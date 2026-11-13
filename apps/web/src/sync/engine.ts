import {
  type GithubRepo,
  GradientRpcs,
  type Issue,
  type IssueRelation,
  type Label,
  type Mutation,
  type Project,
  type IssueComment,
  type LinkedPullRequest,
  type PullRequest,
  type Snapshot,
  type Team,
  type TeamMember,
  type User,
  uuidv7,
  type WorkflowState
} from "@gradient/domain"
import { Cause, Effect, Layer, ManagedRuntime, Queue, Schedule, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import { createMemo, createSignal, createStore, reconcile } from "solid-js"
import { blockerIndex, commentIndex, type IssueKeys, issueKeysOf, issueLookup, pullRequestIndex, sameIssueKeys } from "../lib/indexes.ts"
import { type Changes, createReplica, type PendingTx, TABLES, type TableName, type Tables } from "./replica.ts"

export type ConnectionState = "connecting" | "online" | "offline"

export interface SyncState {
  ready: boolean
  connection: ConnectionState
  viewerId: string
  teams: Record<string, Team>
  teamMembers: Record<string, TeamMember>
  users: Record<string, User>
  workflowStates: Record<string, WorkflowState>
  labels: Record<string, Label>
  projects: Record<string, Project>
  issues: Record<string, Issue>
  githubRepos: Record<string, GithubRepo>
  issueRelations: Record<string, IssueRelation>
  pullRequests: Record<string, PullRequest>
  issueComments: Record<string, IssueComment>
  linkedPullRequests: Record<string, LinkedPullRequest>
  errors: Array<{ id: string; message: string }>
}

const isUnauthorized = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { _tag?: unknown })._tag === "Unauthorized"

const rpcUrl = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rpc`

const ProtocolLive = RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
  Layer.provide(Socket.layerWebSocket(Effect.sync(rpcUrl))),
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provide(RpcSerialization.layerJson)
)

export interface SyncEngineOptions {
  /** The server refused the session (signed out, revoked, expired). The engine stops. */
  onUnauthorized?: () => void
  /** The connection failed; the socket refuses to open without a session, so it may be that. */
  onDisconnected?: () => void
}

/**
 * The client half of the sync engine: the network loop around a `Replica`
 * (see replica.ts), mirrored into a Solid store for the UI.
 */
export const createSyncEngine = (options: SyncEngineOptions = {}) => {
  const [state, setState] = createStore<SyncState>({
    ready: false,
    connection: "connecting",
    viewerId: "",
    teams: {},
    teamMembers: {},
    users: {},
    workflowStates: {},
    labels: {},
    projects: {},
    issues: {},
    githubRepos: {},
    issueRelations: {},
    pullRequests: {},
    issueComments: {},
    linkedPullRequests: {},
    errors: []
  })

  const replica = createReplica()

  /**
   * The same rows as the store, as plain objects, with one version signal per
   * table. Derived data over a whole table (which pull requests mention which
   * issue, what blocks what) reads these: no proxy per field read, and it is
   * rebuilt once per change to its tables rather than per row that shows it.
   */
  const plain = Object.fromEntries(TABLES.map((t) => [t, new Map()])) as { [K in TableName]: Map<string, Tables[K]> }
  const versions = Object.fromEntries(TABLES.map((t) => [t, createSignal(0)])) as unknown as Record<
    TableName,
    ReturnType<typeof createSignal<number>>
  >
  /** Every visible row of a table, untracked per row: reading it subscribes to the whole table. */
  const rows = <T extends TableName>(table: T): ReadonlyMap<string, Tables[T]> => {
    versions[table][0]()
    return plain[table]
  }

  const issueKeys = createMemo(
    () => {
      const out = new Map<string, IssueKeys>()
      for (const issue of rows("issues").values()) out.set(issue.id, issueKeysOf(issue))
      return out
    },
    { lazy: true, equals: sameIssueKeys }
  )

  /** Whole-table lookups for lists (see lib/indexes.ts). Built when first read, again after a change. */
  const index = {
    pullRequests: createMemo(
      () =>
        pullRequestIndex({
          teams: rows("teams"),
          projects: rows("projects"),
          issues: issueKeys(),
          githubRepos: rows("githubRepos"),
          pullRequests: rows("pullRequests"),
          linkedPullRequests: rows("linkedPullRequests")
        }),
      { lazy: true, equals: false }
    ),
    lookup: createMemo(
      () =>
        issueLookup({
          teams: rows("teams"),
          projects: rows("projects"),
          issues: issueKeys(),
          githubRepos: rows("githubRepos"),
          pullRequests: rows("pullRequests"),
          linkedPullRequests: rows("linkedPullRequests")
        }),
      { lazy: true, equals: false }
    ),
    comments: createMemo(() => commentIndex(rows("issueComments")), { lazy: true, equals: false }),
    blockers: createMemo(
      () => blockerIndex({ issues: rows("issues"), workflowStates: rows("workflowStates"), issueRelations: rows("issueRelations") }),
      { lazy: true, equals: false }
    )
  }
  const runtime = ManagedRuntime.make(ProtocolLive)
  const outbox = Effect.runSync(Queue.unbounded<PendingTx>())

  /** Copy the replica's visible value of each changed row into the reactive store. */
  const write = (changes: Changes) => {
    if (changes.size === 0) return
    setState((s) => {
      for (const [table, ids] of changes) {
        const target = s[table] as Record<string, any>
        const mirror = plain[table] as Map<string, unknown>
        for (const id of ids) {
          const value = replica.view(table, id)
          if (value === undefined) {
            delete target[id]
            mirror.delete(id)
          } else {
            if (target[id]) reconcile(value, "id")(target[id])
            else target[id] = value
            mirror.set(id, value)
          }
        }
      }
    })
    for (const table of changes.keys()) versions[table][1]((v) => v + 1)
  }

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
      Effect.tapCause(() =>
        Effect.sync(() => {
          setConnection("offline")
          options.onDisconnected?.()
        })
      ),
      Effect.retry({ schedule: Schedule.spaced("1 second"), while: (e) => !isUnauthorized(e) }),
      Effect.forever,
      Effect.catchIf(isUnauthorized, () => Effect.sync(() => options.onUnauthorized?.()))
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
        Effect.retry({ schedule: Schedule.spaced("1 second"), while: (e) => !isUnauthorized(e) })
      )
    }).pipe(
      Effect.forever,
      Effect.catchIf(isUnauthorized, () => Effect.sync(() => options.onUnauthorized?.()))
    )

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

  return { state, rows, index, start, mutate, call, dismissError, dispose: () => runtime.dispose() }
}

export type SyncEngine = ReturnType<typeof createSyncEngine>
