import {
  applyIssueMutation,
  applyLabelMutation,
  type Delta,
  type GithubRepo,
  type Issue,
  type Label,
  type Mutation,
  type Snapshot,
  type Team,
  touchedIssueId,
  type User,
  type WorkflowState
} from "@gradient/domain"

/**
 * The client's copy of the data, without any UI or network.
 *
 * `base` is what the server confirmed. `pending` is local transactions the
 * server has not confirmed yet. `view` is base with pending applied on top, so
 * edits show at once and roll back cleanly when the server rejects them.
 * Every method returns the rows whose visible value may have changed.
 */

export interface Tables {
  teams: Team
  users: User
  workflowStates: WorkflowState
  labels: Label
  issues: Issue
  githubRepos: GithubRepo
}
export type TableName = keyof Tables
export type Changes = Map<TableName, Set<string>>

export interface PendingTx {
  readonly clientTxId: string
  readonly mutations: ReadonlyArray<Mutation>
  /** Set when the server accepted it; the tx drops once the log reaches this id. */
  confirmedAt: number | null
}

export const TABLES: ReadonlyArray<TableName> = ["teams", "users", "workflowStates", "labels", "issues", "githubRepos"]

const tableOf: Record<string, TableName> = {
  team: "teams",
  user: "users",
  workflowState: "workflowStates",
  label: "labels",
  issue: "issues",
  githubRepo: "githubRepos"
}

const emptyBase = () => Object.fromEntries(TABLES.map((t) => [t, new Map()])) as { [K in TableName]: Map<string, Tables[K]> }

export const createReplica = (options: { now?: () => number } = {}) => {
  const now = options.now ?? Date.now
  let base = emptyBase()
  let pending: Array<PendingTx> = []
  let lastSyncId = 0
  let viewerId = ""
  let ready = false

  const changes = (): Changes => new Map()
  const mark = (c: Changes, table: TableName, id: string) => {
    let set = c.get(table)
    if (!set) c.set(table, (set = new Set()))
    set.add(id)
  }
  const markTx = (c: Changes, txs: ReadonlyArray<PendingTx>) => {
    for (const tx of txs) {
      for (const m of tx.mutations) {
        const id = touchedIssueId(m)
        if (id) mark(c, "issues", id)
        if (m._tag === "LabelCreate") mark(c, "labels", m.id)
      }
    }
    return c
  }

  /** The visible value of one row, or undefined when it does not exist (or is deleted locally). */
  const view = <T extends TableName>(table: T, id: string): Tables[T] | undefined => {
    let value: any = base[table].get(id)
    if (table === "issues") {
      const ctx = { now: now(), actorId: viewerId }
      for (const tx of pending) {
        for (const m of tx.mutations) {
          if (touchedIssueId(m) === id) value = applyIssueMutation(value ?? undefined, m, ctx)
        }
      }
    } else if (table === "labels") {
      for (const tx of pending) {
        for (const m of tx.mutations) if (m._tag === "LabelCreate" && m.id === id) value ??= applyLabelMutation(m)
      }
    }
    return value ?? undefined
  }

  /** Replace everything with a fresh snapshot. Pending transactions survive and are reapplied. */
  const applySnapshot = (snap: Snapshot): Changes => {
    const c = changes()
    for (const t of TABLES) for (const id of base[t].keys()) mark(c, t, id)
    base = emptyBase()
    for (const t of snap.teams) base.teams.set(t.id, t)
    for (const u of snap.users) base.users.set(u.id, u)
    for (const w of snap.workflowStates) base.workflowStates.set(w.id, w)
    for (const l of snap.labels) base.labels.set(l.id, l)
    for (const i of snap.issues) base.issues.set(i.id, i)
    for (const r of snap.githubRepos) base.githubRepos.set(r.id, r)
    for (const t of TABLES) for (const id of base[t].keys()) mark(c, t, id)
    lastSyncId = snap.lastSyncId
    viewerId = snap.viewerId
    ready = true
    return markTx(c, pending)
  }

  /** Apply server deltas in order. Old or repeated deltas are skipped; confirmed transactions drop. */
  const applyDeltas = (deltas: ReadonlyArray<Delta>): Changes => {
    const c = changes()
    const seenTx = new Set<string>()
    for (const d of deltas) {
      if (d.syncId <= lastSyncId) continue
      lastSyncId = d.syncId
      if (d.clientTxId) seenTx.add(d.clientTxId)
      if (d._tag === "Upsert") {
        const table = tableOf[d.entity.model]!
        base[table].set(d.entity.value.id, d.entity.value as never)
        mark(c, table, d.entity.value.id)
      } else {
        const table = tableOf[d.model]!
        base[table].delete(d.id)
        mark(c, table, d.id)
      }
    }
    const done = pending.filter((tx) => seenTx.has(tx.clientTxId) || (tx.confirmedAt !== null && tx.confirmedAt <= lastSyncId))
    if (done.length) {
      pending = pending.filter((tx) => !done.includes(tx))
      markTx(c, done)
    }
    return c
  }

  const addPending = (clientTxId: string, mutations: ReadonlyArray<Mutation>) => {
    const tx: PendingTx = { clientTxId, mutations, confirmedAt: null }
    pending.push(tx)
    return { tx, changes: markTx(changes(), [tx]) }
  }

  /** The server accepted `tx` at `syncId`. It stays visible until our log catches up to that id. */
  const confirm = (tx: PendingTx, syncId: number): Changes => {
    tx.confirmedAt = syncId
    return applyDeltas([])
  }

  /** The server rejected `tx`: drop it, so its rows fall back to the confirmed values. */
  const reject = (tx: PendingTx): Changes => {
    pending = pending.filter((p) => p !== tx)
    return markTx(changes(), [tx])
  }

  return {
    view,
    applySnapshot,
    applyDeltas,
    addPending,
    confirm,
    reject,
    get lastSyncId() {
      return lastSyncId
    },
    get ready() {
      return ready
    },
    get viewerId() {
      return viewerId
    },
    get pendingCount() {
      return pending.length
    }
  }
}

export type Replica = ReturnType<typeof createReplica>
