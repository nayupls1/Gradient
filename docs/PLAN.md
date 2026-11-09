# Gradient: architecture plan (draft)

Status: draft for review. Nothing here is built yet.

Gradient is a Linear-style issue tracker. It syncs issues both ways with GitHub,
as close to realtime as GitHub allows. It is written in Effect v4.

## Principles

- **Few dependencies.** Use Bun's built-ins (HTTP, WebSocket, SQLite, bundler,
  test runner, `randomUUIDv7`) and Effect's single package (HTTP, RPC, SQL,
  Schema, Socket, crypto) before anything else. Write small utilities ourselves
  (fractional indexing, routing, keyboard shortcuts, HMAC checks, GitHub client).
- **One sync engine for everything.** The browser and GitHub are both clients
  of the same mutation pipeline. No special-case write paths.
- **Server is the source of truth.** Clients are optimistic, but every change is
  ordered by one monotonic `sync_id` on the server.

## Stack

| Concern | Choice | Dependency |
|---|---|---|
| Runtime | Bun | none (the runtime) |
| Core | Effect 4.x (`effect`: Schema, http, rpc, sql, socket) | `effect` |
| Bun adapter | HTTP server, WebSocket, runtime | `@effect/platform-bun` |
| Database | SQLite through `bun:sqlite` (see open questions) | `@effect/sql-sqlite-bun` |
| UI | React 19, plain CSS with custom properties | `react`, `react-dom` |
| Frontend build | Bun HTML imports and bundler (no Vite) | none |
| Tests | `bun test`, plus a small `it.effect` helper | none |
| Dev only | `typescript`, `@types/bun`, `@types/react`, `@types/react-dom` | dev |

That is 5 runtime packages. No Tailwind, router library, state library, ORM,
Zod, or date library.

## Layout

One package, split by folders. A workspace monorepo adds config without adding
value at this size.

```
src/
  domain/        shared by server and client: pure, no IO
    schema/      Issue, Team, WorkflowState, Label, User (Effect Schema)
    rpc.ts       RPC group: Bootstrap, Subscribe, Mutate
    mutation.ts  Mutation union (IssueCreate, IssueUpdate, IssueArchive, ...)
    sync.ts      Delta and SyncPacket types
    lib/         fractional-index.ts, ids.ts
  server/
    main.ts      Bun.serve plus Effect layers
    db/          migrations, repos per model
    sync/        MutationService, SyncLog, Hub (PubSub to WebSocket fan-out)
    github/      App auth (JWT), client, webhooks, outbox worker, reconciler, mapper
    http/        routes: /rpc (WebSocket), /webhooks/github, static
  client/
    index.html   Bun HTML entry
    sync/        Store, TransactionQueue, connection, IndexedDB cache (later)
    ui/          components, views (issue list, board, issue detail)
    lib/         router.ts, hotkeys.ts, useStore.ts
```

## Data model (first pass)

- `team`: id, key (`GRD`), name, issue_counter
- `user`: id, name, avatar_url, github_id, github_login
- `workflow_state`: id, team_id, name, type
  (`backlog | unstarted | started | completed | canceled`), position, color
- `label`: id, team_id, name, color, github_label_id
- `issue`: id (UUIDv7), team_id, number, title, description (markdown),
  state_id, priority (0 to 4), assignee_id, creator_id, sort_order (fractional
  index), created_at, updated_at, archived_at
- `issue_label`: issue_id, label_id
- `sync_log`: sync_id (autoincrement), model, model_id, action
  (`insert | update | delete`), data (JSON), actor_id, origin
  (`client | github | system`), client_tx_id, created_at

GitHub tables (schema lands in pass 1, behavior in pass 2):

- `github_installation`: installation_id, account_login
- `github_repo_link`: team_id, repo_id, owner, name, installation_id
- `github_issue_link`: issue_id, repo_id, gh_number, gh_node_id, shadow (JSON:
  the last known GitHub version of each mapped field), gh_updated_at
- `github_outbox`: id, issue_id, status, attempts, next_attempt_at, last_error
- `github_delivery`: delivery_id (unique), received_at. This makes webhook
  handling idempotent.

## Sync engine

This copies the shape of Linear's engine: bootstrap once, then stream ordered
deltas.

1. **Bootstrap.** The client calls `Bootstrap` and gets a snapshot of the models
   it can see, plus `lastSyncId`.
2. **Subscribe.** The client opens `Subscribe({ since: lastSyncId })` over one
   WebSocket (Effect RPC streaming). The server replays `sync_log` rows after
   `since`, then streams live deltas. If the gap is too large, the server tells
   the client to bootstrap again.
3. **Mutate.** The client applies the change to its local store at once, tags
   it with a `clientTxId`, and queues it. The queue sends batches through the
   `Mutate` RPC.
4. **Server apply.** In one SQL transaction, `MutationService` validates the
   change, writes rows, appends `sync_log` rows, and, if the team is linked to a
   repo and origin is not `github`, adds a `github_outbox` row. After commit it
   publishes to an in-process `PubSub`.
5. **Fan-out.** The hub pushes deltas to every subscriber that can see the
   model.
6. **Confirm.** When a client sees a delta carrying its own `clientTxId`, it
   drops that optimistic change. If the server rejects a transaction, the
   client rolls it back and shows an error.

The client store keeps confirmed state and the pending transactions separately.
The UI reads confirmed state with pending transactions applied on top. React
reads it with `useSyncExternalStore`, so no state library is needed.

Conflicts: the server applies changes in arrival order, field by field. The
last write wins per field. That matches Linear and is enough for issues.

## GitHub two-way sync

Use a **GitHub App**, not an OAuth app or a personal token. An App gets
webhooks (realtime), installation tokens with fine-grained repo access, and
higher rate limits. Its user auth can later be our login.

Mapping, one linked repo per team for now:

| Gradient | GitHub |
|---|---|
| title, description | title, body |
| state of type `completed` | closed, `state_reason: completed` |
| state of type `canceled` | closed, `state_reason: not_planned` |
| any other state | open. Reopening maps to the team's default `unstarted` state, and staying open keeps the Gradient state. |
| labels | labels, created on demand |
| assignee | assignees[0], matched by GitHub login |
| priority, sort order | Gradient only for now |

**Shadow copies stop echo loops.** Each linked issue stores `shadow`, the last
version of its mapped fields that we know GitHub has.

- **Inbound** (webhook `issues`, `label`): verify the HMAC signature, skip
  delivery IDs we have seen, and diff the payload against the shadow. Apply only
  the fields that changed as an `origin: github` mutation, then update the
  shadow. The webhook that echoes our own push matches the shadow, so it does
  nothing.
- **Outbound** (outbox worker): diff the current Gradient issue against the
  shadow, PATCH only the changed fields, then write GitHub's response into the
  shadow. Several edits to one issue in the queue become one PATCH. Retries use
  an Effect `Schedule` with backoff, and the worker respects rate-limit headers.
- **Reconciler**: a periodic job lists issues with `since=<last run>` and runs
  them through the inbound path. It catches missed webhooks, and in local dev it
  can stand in for webhooks.
- **Linking a repo** pages through its issues (skipping PRs, which the issues
  API also returns) and imports them.

Local dev needs a public webhook URL. Use `gh webhook forward` or smee.io, or
run on the reconciler alone.

## Phases

**Pass 1: architecture and issues (this pass)**

1. Scaffold: Bun, strict `tsconfig`, Effect, scripts (`dev`, `typecheck`,
   `test`), CI workflow, and an `AGENTS.md` with Effect v4 conventions. Models
   know v3 APIs better than v4, so this file matters.
2. Domain schemas, RPC group, mutation union.
3. SQLite migrations, repos, `MutationService`, `SyncLog`, hub.
4. Client store, transaction queue, WebSocket connection, reconnect and catch-up.
5. Issue UI: list grouped by state, create (`c`), detail view with editable
   title and description, and pickers for state, priority, assignee, and
   labels. Changes show live across tabs.
6. Seed data and a dev user. No real auth yet.

**Pass 2: GitHub sync.** App setup docs, JWT and installation tokens, repo link
and import, webhooks, outbox worker, reconciler, and an end-to-end test against
a scratch repo.

**Later:** GitHub login, comments (synced), board view, command palette,
projects and cycles, offline cache in IndexedDB, Postgres if we outgrow SQLite.

## Open questions

1. SQLite (no infra, built into Bun) or Postgres (multi-instance, LISTEN/NOTIFY)?
   The draft says SQLite.
2. Should pass 1 already include GitHub sync, or only leave room for it? The
   draft leaves room.
3. Auth in pass 1: a stub dev user (draft) or GitHub login now?
4. React (draft) or Solid/Preact for fewer, smaller deps?
5. Where will it be hosted? SQLite needs a persistent volume.
