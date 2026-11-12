# Gradient: architecture

Status: pass 1 is built. This document describes what exists and what comes
next.

Gradient is a minimal, agent-first issue tracker. It syncs issues both ways
with GitHub, as close to realtime as GitHub allows, and exposes everything to
coding agents over MCP. It runs locally; people sign in with accounts (email
and password), join with invite links, work in teams, and agents use agent
keys.

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
| Accounts | Better Auth (email and password, sessions) and its API key plugin (agent keys), on our SQLite connection |
| Font | Inter, bundled (`@fontsource-variable/inter`) |
| Build | Vite 8 with `vite-plugin-solid` |
| Tests | `bun test`, with a fake GitHub server |

Runtime dependencies: server 5 (`effect`, `@effect/platform-bun`,
`@effect/sql-sqlite-bun`, `better-auth`, `@better-auth/api-key`); web 11
(`effect`, `solid-js`, `@solidjs/web`, `@solidjs/router`, `@stylexjs/stylex`,
`base-ui-solidjs`, `lucide`, `marked`, the font, and Better Auth's client with
its API key plugin).

The components come from shadcn-solid (a Solid 2 port of shadcn/ui) and run on
base-ui-solidjs (a Solid 2 port of Base UI). Like shadcn/ui, they are copied
into the app by the shadcn-solid CLI (`apps/web/components.json`) rather than
installed, so `ui/` and its helpers in `lib/` are app code.

## Layout

```
packages/domain/src
  models.ts            Team, TeamMember, User (with Role), WorkflowState, Label, Project, Issue, IssueRelation, PullRequest,
                       IssueComment, GithubRepo, Entity
  mutations.ts         Mutation union + applyIssueMutation (shared optimistic logic)
  references.ts        refs in issue text (#12, acme/web#12, TES-12, GitHub URLs)
  relations.ts         pull request refs ("Fixes #12", TES-12), blocking loops, blocked state
  sync.ts              Delta, SyncEvent, Snapshot
  rpc.ts               GradientRpcs: Bootstrap, Subscribe, Mutate, Invite*, Member*, Github*
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
  auth/                Better Auth: Auth.ts (instance, sign-up policy, account ↔ user), adapter.ts (its
                       database adapter over Effect SQL), http.ts (auth and invite routes, session and agent-key
                       guards, the RPC AuthMiddleware), Members.ts (invites, roles, removing people)
  db/defaults.ts       the workflow states and labels every new team starts with
  http/guard.ts        origin guard: refuses foreign browser origins and rebound hosts
  seed.ts, app.ts, main.ts
apps/web/src
  sync/replica.ts      pure client copy: base + pending transactions, confirm/rollback (unit tested)
  sync/engine.ts       network loop around the replica, mirrored into a Solid store
  keys/                command registry: chords, sequences, scopes, remaps (core.ts), Solid hooks
  theme/               tokens (StyleX vars), palettes (also feed shadcn's tokens), mode + palette switching
  ui/                  shadcn-solid components (Button, Dialog, Popover, Command, Sidebar…), icons
  lib/                 shadcn-solid helpers and tokens, plus selectors (select.ts), list windowing (window.ts), markdown tree (markdown.ts)
  app/                 Shell (Sidebar), Composer, CommandMenu (⌘K and ?), Picker, issue commands, relations, Markdown, router,
                       TeamDialog, InviteDialog, TeamBadge
  app/auth.ts          Better Auth client and the session signal (main.tsx shows AuthPage without one)
  pages/               IssuesPage (keyboard-driven, virtualized list), IssuePage, SettingsPage,
                       AuthPage (sign in / create account / accept an invite), ProfilePage (name, password, sessions,
                       agent keys), TeamsPage, TeamSettingsPage, MembersPage, InvitePage
```

## Data model

`team`, `team_member`, `user` (with its workspace `role`), `workflow_state`,
`label`, `project`, `issue` (label ids stored as JSON, optional `project_id`),
`issue_relation`, `pull_request`, `issue_comment`, `sync_log`, `invite` (not
synced; see Teams and invites), the accounts tables (`auth_user`, `auth_session`, `auth_account`,
`auth_verification`, `auth_api_key`; see Accounts), plus `github_repo`, `github_issue_link` (with the shadows and the
issue's GitHub id), `github_outbox`, `github_delivery` and `github_blob`
(cached repository images, such as project icons). Timestamps are
epoch milliseconds.

**Teams** each have their own workflow states, labels, projects and issue
numbers. `team_member` links people to teams; it is synced like any model.

**Keys are unique across the workspace.** A team's key and every project's key
prefix identifiers, so no two teams, no two projects, and no team and project
share one; a lookup by any key finds exactly one team.

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

**Linked pull requests** are GitHub's "Development" list of an issue's GitHub
copy: pull requests that close it or were linked by hand, in any repository
the token can see, linked to Gradient or not (`linked_pull_request`, one row
per issue and pull request: repo, number, title, state, author). The issue
shows them with the pull requests above, each once (a linked repository's copy
wins, being fresher). Only GraphQL has this list
(`closedByPullRequestsReferences`), read 50 issues per request.

**Comments** are read-only copies of the comments on an issue's GitHub copy
(author login and avatar, markdown body, link). The issue page shows them under
the description, with a "Comment on GitHub" link (`o` opens the issue there).

**Mentions** are the other way round: the issues and pull requests an issue's
description and comments refer to (see Markdown below), in reading order, each
target once and never the issue itself. References into any repository count,
and so does a link to a GitHub issue or pull request whatever its text. The
sidebar lists them under the pull requests that refer to the issue, leaving out
what it already shows above (relations, pull requests); `get_issue` returns
them all.

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
the app is installed on (listed via `/user/installations`). If issues were
imported before the sign-in, their GitHub-only user for that login (an
assignee or author) is the same person: it is merged into the local user (its
issues move over, the duplicate is deleted), so the viewer appears once, as
their GitHub identity. A login that belongs to another account stays apart. It wins over
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
| comments | read from GitHub, never written |
| linked pull requests ("Development") | read from GitHub (GraphQL), never written |

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
  ETags (304s are free). Comments are polled the same way, repository-wide
  (`/issues/comments`), after the issues, so the issues they are on exist.
  Comments on pull requests are skipped. Polling cannot see deleted comments;
  the webhook removes them.
- **Linked pull requests**: after each poll, the Development lists of the
  issues it saw (linking a pull request touches the issue), and of every
  linked issue on import or the first poll after an upgrade
  (`development_synced_at`); an `issues` webhook re-reads its issue's. The
  stored list is replaced by GitHub's. A failure (no GraphQL) is logged and
  never fails the poll. A pull request in another repository that changes
  without touching the issue shows its new state with the issue's next update.
- **Webhooks**: `POST /webhooks/github`, HMAC-SHA256 verified, deduped by
  delivery id; handles `issues`, `issue_comment`, `pull_request` and
  `issue_dependencies`.
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

- `#12` (in the issue's repo, else its project's), `owner/repo#12`, a bare
  GitHub issue or pull request URL, and a link to one whose text is its
  reference (`[acme/api#7](…/acme/api/pull/7)`): the Gradient issue synced with
  it (in-app link, state icon), else a pull request Gradient knows (from a
  linked repository or a Development list; GitHub link, state icon), else a
  plain GitHub link. Other links to an issue or pull request stay links but
  count as mentions.
- `TES-12`, any key of a team: the Gradient issue, or plain text if none.

The issue page shows the rendered description; a click (not on a link, and not
ending a selection) or `d` turns it into the textarea, and blur saves.

## Teams and invites

**Teams are open.** Every team is visible to the whole workspace (the sync
model is not filtered per viewer); membership decides whose sidebar a team is
in and who manages it. Anyone with an account can create a team (the default
workflow and labels, from `db/defaults.ts`, with its creator in it) and join or
leave any team. Renaming a team, changing its key, and adding or removing
other people take membership of the team or the admin role. Only admins delete
teams, and only empty ones (no issues, no linked repository), never the last.
These checks run in `Mutations` for `client` and `mcp` writes; the server's own
writes (`system`, `github`) skip them.

**Roles.** People with an account are `admin` or `member` (`user.role`);
people known only from GitHub have none and cannot be in a team. The first
account is the admin. Admins invite people, change roles (the last admin
cannot step down) and remove people: removing deletes the account, its
sessions and agent keys through Better Auth, then drops the role and team
memberships. The user stays, so issues keep their creator and assignee.

**Invites** are links (`/invite/<token>`) an admin makes for a role and a set
of teams, optionally bound to one email address. They work once and for 7
days; only the SHA-256 of the token is stored, so the link is shown once.
Gradient sends no email: the admin passes the link on.

- Signed out, the link opens the sign-in page in invite mode.
  `POST /api/invites/<token>/accept` claims the invite (atomically, so it works
  once), then runs Better Auth's own sign-up, let through while sign-up is
  closed; `ensureMember` gives the new account the invite's role and teams. A
  failed sign-up (a short password, a taken email) gives the invite back.
- Signed in, the link opens `InvitePage`; `InviteAccept` adds the invite's
  teams to the account (and the admin role, if the invite has it).
- `GET /api/invites/<token>` previews an invite (teams, role, who invited)
  before anyone signs in. Invites are managed over RPC (`InviteCreate`,
  `InviteList`, `InviteRevoke`), admins only.

Accounts made without an invite (the first one, or with
`GRADIENT_ALLOW_SIGNUP`) join every team.

## Agents (MCP)

`POST /mcp` speaks MCP over Streamable HTTP (protocol revisions 2025-03-26
through 2026-07-28). Tools: `describe_workspace`, `list_issues`, `get_issue`,
`create_issue`, `update_issue`, `link_issues`, `unlink_issues`, `create_project`,
`update_project` (name, key, color, icon: "auto", "none" or a repo path),
`create_team`, `update_team`, `add_team_member`, `remove_team_member`,
`invite_person` (admins; returns the link), `github_status`, `github_sign_in`.
Tools work in the caller's first team unless given `team` (a name or key); tools
that take an identifier find its team from the key. Issues report `blocked`, and `get_issue`
lists blockers, blocked issues, related issues, pull requests, comments and
mentions. They take
and return names (states, labels, people, GRD-12), never ids, and a bad name
returns a tool error that lists the valid ones. Writes go through `Mutations.apply` with `origin: "mcp"`, so they
appear live in the app and sync to GitHub. The server sends usage instructions
on initialize and publishes a `gradient` skill (MCP skills extension).

Install: `claude mcp add --transport http --scope user gradient http://127.0.0.1:4100/mcp`
or `codex mcp add gradient --url http://127.0.0.1:4100/mcp`.

`/mcp` needs an agent key (`Authorization: Bearer grd_…`, or `x-api-key`):
without one it answers 401 with `WWW-Authenticate: Bearer`. The key's owner is
the actor of every write, and "me" in the tools. The server binds to loopback
by default, and `http/guard.ts` refuses requests whose `Origin` is not local
(or `GRADIENT_URL`'s), or whose `Host` is not local on a loopback bind. CLI
clients send no `Origin` and pass.

## Accounts

Better Auth (`auth/Auth.ts`) serves `/api/auth/*`: email and password
sign-up and sign-in, sessions, profile updates, password changes, session
lists and revocation, and agent keys (its API key plugin, stored hashed,
prefixed `grd_`). It runs on Gradient's own SQLite connection through
`auth/adapter.ts`, a Better Auth adapter over Effect SQL: its tables
(`auth_*`, snake_case, dates as ISO strings) come from our migrations, share
the write lock, and work in an in-memory test database. Better Auth's
transactions run inside `sql.withTransaction`.

- **Accounts and users.** A Gradient `user` (assignees, authors, the sync
  log's actor) acts for at most one account (`user.account_id`); users without
  one are people known from GitHub. The first account takes over the
  workspace's original user (`meta.viewer_id`, seeded as "Me"), with its issues
  and GitHub connection. Later accounts get a user of their own. Linking runs
  through `Mutations.transact`, and so does renaming (the account's name is
  copied to the user), so clients see both live.
- **Sign-up** is open until the first account exists, then only with an invite
  link (see Teams and invites) or `GRADIENT_ALLOW_SIGNUP=true` (checked before
  Better Auth's transaction).
  `/api/auth-config` tells the sign-in page which form to show.
- **The sync socket** only opens with a session cookie (`RequireSession`),
  and `AuthMiddleware` resolves the session again on every RPC call and
  provides `CurrentViewer`; the handlers act as that user. A subscription
  rechecks its session every 30 seconds, so signing out elsewhere or revoking
  the session ends it with `Unauthorized`; the client then shows the sign-in
  page. Repository images (`/repo-files`) need a session too.
- **Base URL.** Without `GRADIENT_URL`, Better Auth answers whichever loopback
  host and port the browser used (Vite on 4200, the server on 4100); with it,
  that URL is the one origin and cookies are `Secure` when it is https.
- **Secret.** `GRADIENT_AUTH_SECRET`, else a random one made once and kept in
  `meta.auth_secret`.
- **Rate limits.** Sign-in (10/min), sign-up (5/min) and password changes
  (5/min) per client address, read from the socket (the server sets the header
  Better Auth reads and drops any copy the client sent). Agent keys are not
  rate limited.
- **GitHub stays one connection per workspace**, owned by the first account.

## Keyboard

Every action is a command: id, title, group, scope, optional bindings. The
same registry drives key handling, ⌘K (commands available here), `?` (all
shortcuts), remaps (`gradient.keymap` in localStorage) and `run(id)` for any
future caller. Scopes stack (`global`, `issues.list`, `issue.detail`, and a
blocking scope per open dialog); the highest eligible scope wins. Chords use
the physical key under modifiers, so they work on any layout; sequences time
out after a second; IME composition and held-key repeat are handled.

## Search and filters

The issue list has a search box (`/`) and filters: assignee (`f a`, with
"me" following the viewer and "No assignee"), label (`f l`), priority (`f p`)
and blocked (`f b`); `f m` shows my issues and `f x` clears. Search matches
every word, in any order, in the identifier, title, description, labels,
assignee (name or `@login`) and GitHub reference (`#42`, `acme/web`). Values in
one filter are ORed, filters ANDed (`lib/filter.ts`, unit tested). Each list
(a team's, a project's) keeps its own filter for the session; collapsed status
groups stay collapsed, their headers counting the matches. Agents have the same filters in
`list_issues`.

## Theming

Color tokens are StyleX variables. Two independent settings: mode (system,
light, dark) and palette (Neutral, Slate, Stone, Moss, Iris), each palette
defining both schemes. Custom colors override the palette per scheme.
`theme.ts` writes the variables on `<html>` at runtime and saves the choice in
localStorage.

## Next

- Writing comments from Gradient (create/edit on GitHub, an MCP tool).
- Board view, drag to reorder (the fractional `sortOrder` is already there).
- Issue search in ⌘K, saved views, more views (deliberately left to the user's design).
- Markdown preview while editing; toggling task list checkboxes in place.
- Offline cache of the store in IndexedDB.
- More sign-in methods (GitHub OAuth, passkeys), password reset by email, and
  sending invite links by email.
- Private teams (needs the sync log filtered per viewer), and moving issues
  between teams.
- A hosted relay for app webhooks and installation tokens (the private key
  cannot ship in a local app).
- Cycles; project descriptions, leads and target dates.
- Postgres if it outgrows SQLite (the SQL layer is Effect's, so the queries stay).
