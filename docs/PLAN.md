# Gradient: architecture

Status: pass 1 is built. This document describes what exists and what comes
next.

Gradient is a Linear-style issue tracker. It syncs issues both ways with GitHub,
as close to realtime as GitHub allows. It runs locally, for one user, for now.

## Principles

- **Few dependencies.** Use Bun's built-ins and Effect's single package first.
  Write small utilities ourselves (fractional indexing, UUIDv7, hotkeys, the
  GitHub client, webhook signature checks, the component kit). Add a package
  when it carries real weight.
- **One sync engine for everything.** The browser and GitHub are both clients
  of the same mutation pipeline. No special-case write paths.
- **Server is the source of truth.** Clients are optimistic, but every change is
  ordered by one monotonic `sync_id` on the server.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Bun 1.4 |
| Server core | `effect` 4.x: Schema, `effect/rpc`, `effect/sql`, `effect/http`, `effect/socket` |
| Bun adapter | `@effect/platform-bun` |
| Database | SQLite through `@effect/sql-sqlite-bun` |
| Validation | Effect Schema (shared by client and server; no Zod, Valibot or TypeBox needed) |
| UI | Solid 2 (RC) with `@solidjs/router` 2 |
| Styles | StyleX, compiled by `@stylexjs/unplugin` |
| Components | Hand-written kit with shadcn's API shape, on native `<dialog>` and the Popover API |
| Font | Inter, bundled (`@fontsource-variable/inter`) |
| Build | Vite 8 with `vite-plugin-solid` |
| Tests | `bun test`, with a fake GitHub server |

Runtime dependencies: server 3 (`effect`, `@effect/platform-bun`,
`@effect/sql-sqlite-bun`); web 6 (`effect`, `solid-js`, `@solidjs/web`,
`@solidjs/router`, `@stylexjs/stylex`, the font).

Kobalte, which shadcn-solid builds on, only has an alpha for Solid 2 pinned to
an older RC. The kit is ours instead: `apps/web/src/ui/kit.tsx`.

## Layout

```
packages/domain/src
  models.ts            Team, User, WorkflowState, Label, Issue, GithubRepo, Entity
  mutations.ts         Mutation union + applyIssueMutation (shared optimistic logic)
  sync.ts              Delta, SyncEvent, Snapshot
  rpc.ts               GradientRpcs: Bootstrap, Subscribe, Mutate, Github*
  fractional-index.ts  ordering keys
apps/server/src
  config.ts            env config; borrows `gh auth token` when GITHUB_TOKEN is unset
  db/                  migrations, typed queries (Db)
  sync/Mutations.ts    the single write path: validate, write, log, broadcast, queue outbox
  sync/Hub.ts          PubSub fan-out of committed deltas
  sync/Rpc.ts          RPC handlers; Subscribe = catch-up from log, then live
  github/              client, field mapping, GithubSync (import/poll/push), webhook route
  seed.ts, app.ts, main.ts
apps/web/src
  sync/engine.ts       client store: base + pending transactions, reconnect, resend
  theme/               tokens (StyleX vars), presets, runtime theme switching
  ui/                  kit (Button, Input, Dialog, Popover, Picker, Avatar, Toaster), icons
  app/                 Shell (sidebar), Composer (new issue), property pickers, router
  pages/               IssuesPage (list grouped by state), IssuePage, SettingsPage
```

## Data model

`team`, `user`, `workflow_state`, `label`, `issue` (label ids stored as JSON),
`sync_log`, plus `github_repo`, `github_issue_link` (with the shadow),
`github_outbox` and `github_delivery`. Timestamps are epoch milliseconds.

## Sync engine

1. **Bootstrap.** The client gets a snapshot of every model plus `lastSyncId`,
   read in one transaction.
2. **Subscribe.** One WebSocket stream (Effect RPC). The server subscribes to
   the hub first, replays `sync_log` after the cursor in pages, then streams
   live deltas, skipping any it already replayed. A cursor ahead of the server
   gets `ResetRequired`.
3. **Mutate.** The client applies the change locally at once, tags it with a
   `clientTxId`, and sends it. Network failures retry. The server dedupes on
   `clientTxId`, so retries are safe.
4. **Server apply.** `Mutations.transact` runs one SQL transaction behind a
   semaphore (so syncIds publish in commit order): write rows, read back each
   touched row, append it to `sync_log`, queue the GitHub outbox when the team
   has a repo and origin is not `github`. After commit it publishes to the hub.
5. **Confirm or roll back.** The client keeps confirmed state and pending
   transactions apart, and shows confirmed + pending. A pending transaction
   drops when its delta arrives. A rejected one is removed and the error shows
   as a toast.

Conflicts: last write wins per field, in server arrival order.

## GitHub two-way sync

Token auth for now: `GITHUB_TOKEN`, or the GitHub CLI's token. The client is
behind one service, so GitHub App auth can replace it later.

| Gradient | GitHub |
|---|---|
| title, description | title, body |
| state of type `completed` | closed, `state_reason: completed` |
| state of type `canceled` | closed, `state_reason: not_planned` |
| any other state | open; reopening picks the first `unstarted` state, staying open keeps the current state |
| labels | labels, created on demand on both sides |
| assignee | first assignee, matched by GitHub login; unknown logins become users |
| priority, sort order | Gradient only |

**Shadows stop echo loops.** Each linked issue stores the last version of its
mapped fields that GitHub is known to have.

- **Inbound** (poll, webhook, import): skip pull requests and events older than
  the stored `updated_at`; diff the payload against the shadow; apply only the
  changed fields as an `origin: github` write; store the new shadow. The echo
  of our own push matches the shadow, so it does nothing.
- **Outbound** (outbox worker): diff the issue against the shadow and send one
  PATCH with only the changed fields, or create the issue when it has no link.
  Store GitHub's response as the new shadow. Rapid edits coalesce; failures
  back off up to 5 minutes; one flush runs at a time.
- **Polling**: every 15s per repo, `since` the newest `updated_at` seen, with
  ETags (304s are free).
- **Webhooks**: `POST /webhooks/github`, HMAC-SHA256 verified, deduped by
  delivery id. Locally, forward with `gh webhook forward`.

Tested in `apps/server/test/github-sync.test.ts`: import, one-field PATCH with
no echo, inbound edits not bounced back, concurrent edits to different fields
both surviving, creating on GitHub, webhook signatures and dedupe.

## Theming

Color tokens are StyleX variables. A theme is a preset, "system" (Paper or
Graphite, following the OS), or custom colors on top of a preset. `theme.ts`
writes the variables on `<html>` at runtime and saves the choice in
localStorage. Presets: Paper, Graphite, Slate, Sand, Midnight, Moss.

## Next

- Comments, synced with GitHub (`issue_comment` webhook + list/create/edit).
- Board view, drag to reorder (the fractional `sortOrder` is already there).
- Command palette, more shortcuts, search and filters.
- Markdown rendering for descriptions.
- Offline cache of the store in IndexedDB.
- Real auth (GitHub login), then multiple users; GitHub App instead of a token.
- Projects and cycles.
- Postgres if it outgrows SQLite (the SQL layer is Effect's, so the queries stay).
