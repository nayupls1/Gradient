# Gradient: architecture

Status: pass 1 is built. This document describes what exists and what comes
next.

Gradient is a minimal, agent-first issue tracker. It syncs issues both ways
with GitHub, as close to realtime as GitHub allows, and exposes everything to
coding agents over MCP. It runs locally, for one user, for now.

## Principles

- **Few dependencies.** Use Bun's built-ins and Effect's single package first.
  Write small utilities ourselves (fractional indexing, UUIDv7, hotkeys, the
  GitHub client, webhook signature checks). Add a package
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
| Components | shadcn-solid's StyleX components (copied into `ui/`), on `base-ui-solidjs` |
| Icons | `lucide` icon data, drawn by shadcn-solid's `Icon` |
| Markdown | `marked`'s lexer only; our own tree builder and Solid renderer (no HTML strings) |
| Agents | MCP over Streamable HTTP with `effect/ai`'s `McpServer` (no extra package) |
| Font | Inter, bundled (`@fontsource-variable/inter`) |
| Build | Vite 8 with `vite-plugin-solid` |
| Tests | `bun test`, with a fake GitHub server |

Runtime dependencies: server 3 (`effect`, `@effect/platform-bun`,
`@effect/sql-sqlite-bun`); web 9 (`effect`, `solid-js`, `@solidjs/web`,
`@solidjs/router`, `@stylexjs/stylex`, `base-ui-solidjs`, `lucide`, `marked`,
the font).

The components come from shadcn-solid (a Solid 2 port of shadcn/ui) and run on
base-ui-solidjs (a Solid 2 port of Base UI). Like shadcn/ui, they are copied
into the app by the shadcn-solid CLI (`apps/web/components.json`) rather than
installed, so `ui/` and its helpers in `lib/` are app code.

## Layout

```
packages/domain/src
  models.ts            Team, User, WorkflowState, Label, Project, Issue, IssueRelation, PullRequest, GithubRepo, Entity
  mutations.ts         Mutation union + applyIssueMutation (shared optimistic logic)
  relations.ts         pull request refs ("Fixes #12", TES-12), blocking loops, blocked state
  sync.ts              Delta, SyncEvent, Snapshot
  rpc.ts               GradientRpcs: Bootstrap, Subscribe, Mutate, Github*
  fractional-index.ts  ordering keys
apps/server/src
  config.ts            env config; borrows `gh auth token` when GITHUB_TOKEN is unset
  db/                  migrations, typed queries (Db)
  sync/Mutations.ts    the single write path: validate, write, log, broadcast, queue outbox
  sync/Hub.ts          PubSub fan-out of committed deltas
  sync/Rpc.ts          RPC handlers; Subscribe = catch-up from log, then live
  github/              auth (device-flow sign-in), client, field mapping, GithubSync (import/poll/push), webhook route,
                       project icons (icons.ts picks a favicon; files.ts serves repo images)
  mcp/                 MCP tools (names in, names out), instructions, the gradient skill
  http/guard.ts        local-only guard: refuses foreign browser origins and rebound hosts
  seed.ts, app.ts, main.ts
apps/web/src
  sync/replica.ts      pure client copy: base + pending transactions, confirm/rollback (unit tested)
  sync/engine.ts       network loop around the replica, mirrored into a Solid store
  keys/                command registry: chords, sequences, scopes, remaps (core.ts), Solid hooks
  theme/               tokens (StyleX vars), palettes (also feed shadcn's tokens), mode + palette switching
  ui/                  shadcn-solid components (Button, Dialog, Popover, Command, Sidebar…), icons
  lib/                 shadcn-solid helpers and tokens, plus selectors (select.ts), list windowing (window.ts), markdown tree (markdown.ts)
  app/                 Shell (Sidebar), Composer, CommandMenu (⌘K and ?), Picker, issue commands, relations, Markdown, router
  pages/               IssuesPage (keyboard-driven, virtualized list), IssuePage, SettingsPage
```

## Data model

`team`, `user`, `workflow_state`, `label`, `project`, `issue` (label ids stored
as JSON, optional `project_id`), `issue_relation`, `pull_request`,
`sync_log`, plus `github_repo`, `github_issue_link` (with the shadows and the
issue's GitHub id), `github_outbox`, `github_delivery` and `github_blob`
(cached repository images, such as project icons). Timestamps are
epoch milliseconds.

**Relations** link two issues of a team: `blocks` (directed: the second is
"blocked by" the first) or `related`. Two issues have at most one relation, and
blocking loops are refused. An issue is *blocked* while a blocker is not
completed, canceled or archived; the list marks it, `list_issues` filters on it.

**Pull requests** are read-only copies of a linked repository's pull requests
(title, state: open, draft, merged or closed, author). An issue shows the ones
that close its GitHub copy ("Fixes #12", "closes acme/web#3", an issue URL) or
mention its identifier (TES-12, any key of the team). Refs are stored raw and
resolved when read, so an issue imported later, or a renamed project key,
still links.

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

**Identifiers** are `<key>-<number>`: the project's key (unique in the team,
derived from its name, `projectKeyFor`) or the team key without a project. The
number is team-wide (`team.issue_counter`), so lookups accept any key of the
team and moving an issue only changes the prefix.

**Projects carry the repository.** A project groups issues inside a team, and
links at most one repository (`github_repo.project_id`, unique). Imported
issues join the repo's project. An issue pushes to the repo it is already
linked to, else to its project's repo (`Db.repoForIssue`); issues without a
project stay local. Linking without a project creates one named after the repo
(or reuses an unlinked project of that name). A project with a repo must be
unlinked before it is deleted; deleting a project leaves its issues without one.
The repo picker lists `/user/repos` for a token, or the app's installations for
an app sign-in.

**Project icons come from the repository.** `iconMode` is `auto` (the
default), `repo` (a file the user picked) or `none` (the cube in the project's
color, also what a project without a repo shows). `icon` is the file shown, as
path and blob sha. `auto` takes the best match in the repo's tree
(`git/trees/HEAD?recursive=1`, one request): a favicon where web projects keep
one (`public/`, `app/`, a monorepo's `apps/web/public/`), else an app icon,
else a logo, never from `node_modules`, fixtures or examples
(`github/icons.ts`). Icons are looked up on link, on "Sync now" and hourly
while polling; `auto` follows the favicon, a picked file follows its path
(when it is deleted, the last version stays). Unlinking goes back to the cube.
The server serves the bytes at `/repo-files/<repo>/<sha>/<name>` with its own
token, so private repos work; it caches them in `github_blob` by sha, so the
URL is immutable. SVGs are drawn with `<img>` and served with a CSP sandbox.

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
| `blocks` relations | issue dependencies ("blocked by"), when both issues are on GitHub |
| `related` relations | Gradient only |
| pull requests | read from GitHub (the issues endpoint lists them), never written |

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
- **Dependencies** have their own shadow per linked issue: the GitHub
  blockers that map to Gradient issues. Inbound, blockers new since the shadow
  become relations and blockers that left it lose theirs; outbound, the issue's
  Gradient blockers are diffed against it (POST and DELETE by GitHub id).
  Blockers Gradient does not know stay out of the shadow, so a push never
  removes them. An issue is read only when GitHub's `issue_dependencies_summary`
  reports blockers or the shadow had some, and after the whole poll, so
  blockers resolve in any order. Pushing an issue without blockers makes no
  dependency call. GitHub does not bump `updated_at` for dependency changes:
  polling sees them with the issue's next update, the `issue_dependencies`
  webhook at once. A blocker created on GitHub queues what it blocks again.
- **Polling**: every 15s per repo, `since` the newest `updated_at` seen, with
  ETags (304s are free).
- **Webhooks**: `POST /webhooks/github`, HMAC-SHA256 verified, deduped by
  delivery id; handles `issues`, `pull_request` and `issue_dependencies`.
  Locally, forward with `gh webhook forward`.

Tested in `apps/server/test/github-sync.test.ts`: import, one-field PATCH with
no echo, inbound edits not bounced back, concurrent edits to different fields
both surviving, creating on GitHub, webhook signatures and dedupe, blockers
both ways (in any import order, without echo, never touching blockers Gradient
does not know) and pull request linking.

## Markdown

Descriptions render like GitHub renders issue bodies: GFM, single newlines as
line breaks, and the inline HTML issue templates use (`<details>`, `<kbd>`,
`<img>`, `<br>`…). `marked` tokenizes; `lib/markdown.ts` builds a plain tree of
allowlisted tags and attributes (http(s) and mailto URLs only, `<script>` and
friends dropped with their content, comments dropped), and `app/Markdown.tsx`
renders it as Solid elements, so nothing is ever set as HTML. HTML blocks share
one stack with the markdown, so a `<details>` opened in one block wraps the
markdown up to its `</details>`.

Text outside links and code is scanned for references, resolved live against
the store when rendered:

- `#12` (in the issue's repo, else its project's), `owner/repo#12`, and a bare
  GitHub issue or pull request URL: the Gradient issue synced with it (in-app
  link, state icon), else a synced pull request (GitHub link, state icon), else
  a plain GitHub link.
- `TES-12`, any key of a team: the Gradient issue, or plain text if none.

The issue page shows the rendered description; a click (not on a link, and not
ending a selection) or `d` turns it into the textarea, and blur saves.

## Agents (MCP)

`POST /mcp` speaks MCP over Streamable HTTP (protocol revisions 2025-03-26
through 2026-07-28). Tools: `describe_workspace`, `list_issues`, `get_issue`,
`create_issue`, `update_issue`, `link_issues`, `unlink_issues`, `create_project`,
`update_project` (name, key, color, icon: "auto", "none" or a repo path),
`github_status`, `github_sign_in`. Issues report `blocked`, and `get_issue`
lists blockers, blocked issues, related issues and pull requests. They take
and return names (states, labels, people, GRD-12), never ids, and a bad name
returns a tool error that lists the valid ones. Writes go through `Mutations.apply` with `origin: "mcp"`, so they
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
- Markdown preview while editing; toggling task list checkboxes in place.
- Offline cache of the store in IndexedDB.
- Multiple users with sessions, and a hosted relay for app webhooks and
  installation tokens (the private key cannot ship in a local app).
- Cycles; project descriptions, leads and target dates.
- Postgres if it outgrows SQLite (the SQL layer is Effect's, so the queries stay).
