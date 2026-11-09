# Gradient: architecture

Status: pass 1 is built. This document describes what exists and what comes
next.

Gradient is a minimal, agent-first issue tracker. It syncs issues both ways
with GitHub, as close to realtime as GitHub allows, and exposes everything to
coding agents over MCP. It runs locally, for one user, for now.

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
| Icons | `@lucide/solid` (per-icon imports) |
| Agents | MCP over Streamable HTTP with `effect/ai`'s `McpServer` (no extra package) |
| Font | Inter, bundled (`@fontsource-variable/inter`) |
| Build | Vite 8 with `vite-plugin-solid` |
| Tests | `bun test`, with a fake GitHub server |

Runtime dependencies: server 3 (`effect`, `@effect/platform-bun`,
`@effect/sql-sqlite-bun`); web 7 (`effect`, `solid-js`, `@solidjs/web`,
`@solidjs/router`, `@stylexjs/stylex`, `@lucide/solid`, the font).

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
  github/              auth (device-flow sign-in), client, field mapping, GithubSync (import/poll/push), webhook route
  mcp/                 MCP tools (names in, names out), instructions, the gradient skill
  http/guard.ts        local-only guard: refuses foreign browser origins and rebound hosts
  seed.ts, app.ts, main.ts
apps/web/src
  sync/replica.ts      pure client copy: base + pending transactions, confirm/rollback (unit tested)
  sync/engine.ts       network loop around the replica, mirrored into a Solid store
  keys/                command registry: chords, sequences, scopes, remaps (core.ts), Solid hooks
  theme/               tokens (StyleX vars), palettes, mode + palette switching
  ui/                  kit (Button, Input, Dialog, Popover, Picker, Avatar, Toaster), icons
  app/                 Shell, Composer, CommandMenu (⌘K and ?), issue commands, pickers, router
  pages/               IssuesPage (keyboard-driven list), IssuePage, SettingsPage
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

**Auth** (`github/GithubAuth.ts`): "Sign in with GitHub" runs the device flow
of the Gradient GitHub App, which needs only its public client id. The server
polls github.com for the token, stores it in `github_auth`, and links the local
user to the GitHub login. The token acts as the user, limited to repositories
the app is installed on (listed via `/user/installations`). It wins over
`GITHUB_TOKEN` and the gh CLI token, which remain as fallbacks. `GithubClient`
reads the token per request, so sign-in and sign-out apply without a restart;
a 401 drops an expired or revoked sign-in. Webhooks to the app would need a
public URL, so a local install keeps polling.

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

## Agents (MCP)

`POST /mcp` speaks MCP over Streamable HTTP (protocol revisions 2025-03-26
through 2026-07-28). Tools: `describe_workspace`, `list_issues`, `get_issue`,
`create_issue`, `update_issue`. They take and return names (states, labels,
people, GRD-12), never ids, and a bad name returns a tool error that lists the
valid ones. Writes go through `Mutations.apply` with `origin: "mcp"`, so they
appear live in the app and sync to GitHub. The server sends usage instructions
on initialize and publishes a `gradient` skill (MCP skills extension).

Install: `claude mcp add --transport http --scope user gradient http://127.0.0.1:4100/mcp`
or `codex mcp add gradient --url http://127.0.0.1:4100/mcp`.

There is no auth yet, so the server binds to loopback and `http/guard.ts`
refuses requests whose `Origin` or `Host` is not local. CLI clients send no
`Origin` and pass.

## Keyboard

Every action is a command: id, title, group, scope, optional bindings. The
same registry drives key handling, ⌘K (commands available here), `?` (all
shortcuts), remaps (`gradient.keymap` in localStorage) and `run(id)` for any
future caller. Scopes stack (`global`, `issues.list`, `issue.detail`, and a
blocking scope per open dialog); the highest eligible scope wins. Chords use
the physical key under modifiers, so they work on any layout; sequences time
out after a second; IME composition and held-key repeat are handled.

## Theming

Color tokens are StyleX variables. Two independent settings: mode (system,
light, dark) and palette (Neutral, Slate, Stone, Moss, Iris), each palette
defining both schemes. Custom colors override the palette per scheme.
`theme.ts` writes the variables on `<html>` at runtime and saves the choice in
localStorage.

## Next

- Comments, synced with GitHub (`issue_comment` webhook + list/create/edit).
- Board view, drag to reorder (the fractional `sortOrder` is already there).
- Issue search in ⌘K, filters, more views (deliberately left to the user's design).
- Markdown rendering for descriptions.
- Offline cache of the store in IndexedDB.
- Multiple users with sessions, and a hosted relay for app webhooks and
  installation tokens (the private key cannot ship in a local app).
- Projects and cycles.
- Postgres if it outgrows SQLite (the SQL layer is Effect's, so the queries stay).
