import { CurrentViewer, type Delta, GithubError, GradientRpcs, MutationRejected, type SyncEvent } from "@gradient/domain"
import { Effect, Layer, Option, PubSub, Stream } from "effect"
import { Members } from "../auth/Members.ts"
import { Db, type LogRow } from "../db/Db.ts"
import { ServerConfig } from "../config.ts"
import { GithubAuth } from "../github/GithubAuth.ts"
import { GithubClient } from "../github/GithubClient.ts"
import { GithubSync } from "../github/GithubSync.ts"
import { mcpUrl } from "../mcp/server.ts"
import { Hub } from "./Hub.ts"
import { Mutations } from "./Mutations.ts"

const CATCH_UP_PAGE = 500

const toDelta = (row: LogRow): Delta =>
  row.op === "upsert" && row.data
    ? { _tag: "Upsert", syncId: row.syncId, clientTxId: row.clientTxId, entity: row.data }
    : { _tag: "Delete", syncId: row.syncId, clientTxId: row.clientTxId, model: row.model, id: row.modelId }

export const RpcHandlers = GradientRpcs.toLayer(
  Effect.gen(function*() {
    const db = yield* Db
    const hub = yield* Hub
    const mutations = yield* Mutations
    const github = yield* GithubSync
    const auth = yield* GithubAuth
    const githubClient = yield* GithubClient
    const config = yield* ServerConfig
    const members = yield* Members

    /** The Gradient user of the calling session (see AuthMiddleware). */
    const viewerId = () => Effect.map(Effect.service(CurrentViewer), (v) => v.userId)

    return GradientRpcs.of({
      Bootstrap: () =>
        Effect.gen(function*() {
          // Read everything in one transaction so the snapshot matches lastSyncId.
          return yield* db.sql.withTransaction(
            Effect.all({
              lastSyncId: db.lastSyncId,
              viewerId: viewerId(),
              teams: db.teams,
              teamMembers: db.teamMembers,
              users: db.users,
              workflowStates: db.workflowStates,
              labels: db.labels,
              projects: db.projects,
              issues: db.issues,
              githubRepos: db.githubRepos,
              issueRelations: db.relations,
              pullRequests: db.pullRequests,
              issueComments: db.comments,
              linkedPullRequests: db.linkedPullRequests
            })
          )
        }).pipe(Effect.orDie),

      ServerInfo: () => Effect.succeed({ version: "0.1.0", mcpUrl: mcpUrl(config) }),

      Subscribe: ({ since }) =>
        Stream.unwrap(
          Effect.gen(function*() {
            // Subscribe before reading the log, so no commit can fall in the gap.
            const live = yield* PubSub.subscribe(hub.pubsub)
            const head = yield* db.lastSyncId.pipe(Effect.orDie)
            if (since > head) return Stream.succeed<SyncEvent>({ _tag: "ResetRequired" })

            let cursor = since
            const catchUp = Stream.paginate(since, (from) =>
              db.logSince(from, CATCH_UP_PAGE).pipe(
                Effect.orDie,
                Effect.map((rows) => {
                  const last = rows.at(-1)
                  if (last) cursor = last.syncId
                  const events: ReadonlyArray<SyncEvent> = rows.length
                    ? [{ _tag: "Deltas", deltas: rows.map(toDelta) }]
                    : []
                  const next = rows.length === CATCH_UP_PAGE && last ? Option.some(last.syncId) : Option.none()
                  return [events, next] as const
                })
              )
            )

            const liveEvents = Stream.fromSubscription(live).pipe(
              Stream.map((deltas) => deltas.filter((d) => d.syncId > cursor)),
              Stream.filter((deltas) => deltas.length > 0),
              Stream.map((deltas): SyncEvent => {
                cursor = deltas.at(-1)!.syncId
                return { _tag: "Deltas", deltas }
              })
            )
            return Stream.concat(catchUp, liveEvents)
          })
        ),

      Mutate: ({ clientTxId, mutations: list }) =>
        Effect.gen(function*() {
          const actorId = yield* viewerId()
          return yield* mutations.apply({ origin: "client", actorId, clientTxId }, list)
        }).pipe(
          Effect.catchDefect((defect) =>
            Effect.fail(new MutationRejected({ message: `Server error: ${String(defect)}` }))
          )
        ),

      InviteCreate: (input) => Effect.flatMap(viewerId(), (id) => members.createInvite(id, input)),
      InviteList: () => Effect.flatMap(viewerId(), members.listInvites),
      InviteRevoke: ({ id }) => Effect.flatMap(viewerId(), (actor) => members.revokeInvite(actor, id)),
      InviteAccept: ({ token }) => Effect.flatMap(Effect.service(CurrentViewer), (viewer) => members.acceptAsViewer(token, viewer)),
      MemberSetRole: ({ userId, role }) => Effect.flatMap(viewerId(), (actor) => members.setRole(actor, userId, role)),
      MemberRemove: ({ userId }) => Effect.flatMap(viewerId(), (actor) => members.removeMember(actor, userId)),
      MemberEmails: () => Effect.flatMap(viewerId(), members.emails),

      GithubStatus: () => github.status,
      GithubLinkRepo: (input) => github.linkRepo(input),
      GithubUnlinkRepo: ({ repoId }) => github.unlinkRepo(repoId),
      GithubSyncNow: ({ repoId }) => github.syncNow(repoId),
      GithubSignInStart: () => auth.startSignIn,
      GithubSignInWait: () => auth.awaitSignIn.pipe(Effect.andThen(github.status)),
      GithubSignInCancel: () => auth.cancelSignIn,
      GithubSignOut: () => auth.signOut.pipe(Effect.andThen(github.status)),
      GithubRepos: () => github.availableRepos,
      GithubPullRequest: ({ owner, repo, number }) => githubClient.getPullRequest(owner, repo, number),
      GithubProjectIcons: ({ projectId }) => github.projectIcons(projectId),
      GithubSetProjectIcon: ({ projectId, mode, path }) =>
        Effect.gen(function*() {
          if (mode === "repo" && !path) return yield* new GithubError({ message: "Pick a file for the project icon." })
          yield* github.setProjectIcon(projectId, mode === "repo" ? { mode, path: path! } : { mode }, { origin: "client", actorId: yield* viewerId() })
        })
    })
  })
)

export const RpcHandlersLive = RpcHandlers.pipe(Layer.provide([Hub.layer]))
