import {
  applyIssueMutation,
  applyLabelMutation,
  type Delta,
  type ModelName,
  type Mutation,
  MutationRejected
} from "@gradient/domain"
import { Context, Effect, Layer, Queue, Semaphore } from "effect"
import type { SqlError } from "effect/sql"
import { Db } from "../db/Db.ts"
import { Hub } from "./Hub.ts"

/**
 * Who made a change: the app (`client`), an agent over MCP (`mcp`), the GitHub
 * sync, or the server itself. `github` writes never go back out to GitHub;
 * every other origin queues an outbound sync when the team has a linked repo.
 */
export type Origin = "client" | "mcp" | "github" | "system"

export interface TxContext {
  readonly now: number
  readonly origin: Origin
  readonly actorId: string | null
  /** Record that a row changed, so it is logged and broadcast after commit. */
  touch(model: ModelName, id: string, op?: "upsert" | "delete"): void
}

export interface TxOptions {
  readonly origin: Origin
  readonly actorId: string | null
  readonly clientTxId?: string | null
}

const reject = (message: string) => Effect.fail(new MutationRejected({ message }))

export class Mutations extends Context.Service<Mutations, {
  /**
   * Run `body` in one SQL transaction. Every row it `touch`es is read back,
   * appended to the sync log and broadcast once the transaction commits.
   * Writes are serialized, so syncIds are published in commit order.
   */
  transact<A, E>(
    options: TxOptions,
    body: (tx: TxContext) => Effect.Effect<A, E | SqlError.SqlError, Db>
  ): Effect.Effect<{ readonly value: A; readonly syncId: number }, E>
  /** Validate and apply client-shaped mutations. Idempotent per clientTxId. */
  apply(
    options: TxOptions,
    mutations: ReadonlyArray<Mutation>
  ): Effect.Effect<{ readonly syncId: number }, MutationRejected>
  /** Issue ids whose GitHub copy needs an update. The outbox worker reads this. */
  readonly outboxSignal: Queue.Queue<void>
}>()("gradient/Mutations") {
  static readonly layer = Layer.effect(
    Mutations,
    Effect.gen(function*() {
      const db = yield* Db
      const hub = yield* Hub
      const lock = yield* Semaphore.make(1)
      const outboxSignal = yield* Queue.sliding<void>(1)

      const transact = <A, E>(
        options: TxOptions,
        body: (tx: TxContext) => Effect.Effect<A, E | SqlError.SqlError, Db>
      ) =>
        Effect.gen(function*() {
          const touched = new Map<string, { model: ModelName; id: string; op: "upsert" | "delete" }>()
          const tx: TxContext = {
            now: Date.now(),
            origin: options.origin,
            actorId: options.actorId,
            touch: (model, id, op = "upsert") => touched.set(`${model}:${id}`, { model, id, op })
          }
          const clientTxId = options.clientTxId ?? null
          const { value, deltas, queuedOutbound } = yield* db.sql.withTransaction(
            Effect.gen(function*() {
              const value = yield* body(tx)
              const deltas: Array<Delta> = []
              let queuedOutbound = false
              for (const { model, id, op } of touched.values()) {
                const entity = op === "delete" ? undefined : yield* db.loadEntity(model, id)
                if (op === "delete" || !entity) {
                  const syncId = yield* db.appendLog({
                    model, modelId: id, op: "delete", data: null, clientTxId,
                    origin: options.origin, actorId: options.actorId, now: tx.now
                  })
                  deltas.push({ _tag: "Delete", syncId, clientTxId, model, id })
                } else {
                  const syncId = yield* db.appendLog({
                    model, modelId: id, op: "upsert", data: entity, clientTxId,
                    origin: options.origin, actorId: options.actorId, now: tx.now
                  })
                  deltas.push({ _tag: "Upsert", syncId, clientTxId, entity })
                }
                if (model === "issue" && options.origin !== "github" && entity?.model === "issue") {
                  const repo = yield* db.repoForTeam(entity.value.teamId)
                  if (repo) {
                    yield* db.sql`INSERT INTO github_outbox (issue_id, enqueued_at, next_attempt_at)
                                  VALUES (${id}, ${tx.now}, ${tx.now})
                                  ON CONFLICT (issue_id) DO UPDATE SET next_attempt_at = excluded.next_attempt_at,
                                                                       attempts = 0`
                    queuedOutbound = true
                  }
                }
              }
              return { value, deltas, queuedOutbound }
            }).pipe(Effect.provideService(Db, db))
          )
          yield* hub.publish(deltas)
          if (queuedOutbound) yield* Queue.offer(outboxSignal, undefined)
          const syncId = deltas.at(-1)?.syncId ?? (yield* db.lastSyncId)
          return { value, syncId }
        }).pipe(
          lock.withPermits(1),
          Effect.catchTag("SqlError", Effect.die)
        ) as Effect.Effect<{ value: A; syncId: number }, E>

      const applyOne = (tx: TxContext, m: Mutation) =>
        Effect.gen(function*() {
          // System writes (seed, GitHub import) have no actor; credit the local user.
          const actorId = tx.actorId ?? (yield* db.getMeta("viewer_id")) ?? "unknown"
          const checkRefs = Effect.fnUntraced(function*(teamId: string, fields: {
            stateId?: string | undefined
            labelIds?: ReadonlyArray<string> | undefined
            assigneeId?: string | null | undefined
            title?: string | undefined
          }) {
            if (fields.title !== undefined && fields.title.trim() === "") return yield* reject("Title is required")
            if (fields.stateId !== undefined) {
              const state = yield* db.getState(fields.stateId)
              if (!state || state.teamId !== teamId) return yield* reject("Unknown workflow state")
            }
            for (const labelId of fields.labelIds ?? []) {
              const label = yield* db.getLabel(labelId)
              if (!label || label.teamId !== teamId) return yield* reject("Unknown label")
            }
            if (fields.assigneeId) {
              if (!(yield* db.getUser(fields.assigneeId))) return yield* reject("Unknown assignee")
            }
          })

          switch (m._tag) {
            case "IssueCreate": {
              if (!(yield* db.getTeam(m.teamId))) return yield* reject("Unknown team")
              if (yield* db.getIssue(m.id)) return yield* reject("Issue already exists")
              yield* checkRefs(m.teamId, m)
              const number = (yield* db.nextIssueNumber(m.teamId))!
              const issue = applyIssueMutation(undefined, m, { now: tx.now, actorId, number })!
              yield* db.putIssue({ ...issue, title: issue.title.trim() })
              tx.touch("team", m.teamId)
              tx.touch("issue", m.id)
              return
            }
            case "IssueUpdate":
            case "IssueArchive":
            case "IssueUnarchive": {
              const current = yield* db.getIssue(m.id)
              if (!current) return yield* reject("Issue not found")
              if (m._tag === "IssueUpdate") yield* checkRefs(current.teamId, m.patch)
              const next = applyIssueMutation(current, m, { now: tx.now, actorId })!
              yield* db.putIssue({ ...next, title: next.title.trim() })
              tx.touch("issue", m.id)
              return
            }
            case "IssueDelete": {
              if (!(yield* db.getIssue(m.id))) return
              yield* db.deleteIssue(m.id)
              tx.touch("issue", m.id, "delete")
              return
            }
            case "LabelCreate": {
              if (!(yield* db.getTeam(m.teamId))) return yield* reject("Unknown team")
              const existing = (yield* db.labelsForTeam(m.teamId)).find(
                (l) => l.name.toLowerCase() === m.name.trim().toLowerCase()
              )
              if (existing) return yield* reject(`Label "${existing.name}" already exists`)
              yield* db.putLabel({ ...applyLabelMutation(m)!, name: m.name.trim() })
              tx.touch("label", m.id)
              return
            }
          }
        })

      const apply = (options: TxOptions, mutations: ReadonlyArray<Mutation>) =>
        Effect.gen(function*() {
          if (options.clientTxId) {
            const seen = yield* db.syncIdForClientTx(options.clientTxId).pipe(Effect.orDie)
            if (seen !== null) return { syncId: seen }
          }
          const { syncId } = yield* transact(options, (tx) =>
            Effect.forEach(mutations, (m) => applyOne(tx, m), { discard: true }))
          return { syncId }
        })

      return Mutations.of({ transact, apply, outboxSignal })
    })
  )
}
