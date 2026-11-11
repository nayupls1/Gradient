# Gradient

A minimal, agent-first issue tracker with live, two-way GitHub issue sync.
Runs locally. Built with Effect v4, Bun, SQLite, Solid 2 and StyleX.

## Connect your agent

Gradient is an MCP server. Agents authenticate with an **agent key**: create
one on your profile (sidebar → your name, or `g p`), which also shows these
commands with the key filled in:

```bash
# Claude Code
claude mcp add --transport http --scope user gradient http://127.0.0.1:4100/mcp \
  --header "Authorization: Bearer grd_..."
# Codex
export GRADIENT_API_KEY=grd_...
codex mcp add gradient --url http://127.0.0.1:4100/mcp --bearer-token-env-var GRADIENT_API_KEY
```

The agent acts as the key's owner ("me" is you). Make one key per agent or
machine; deleting a key locks that agent out at once.

Agents get `describe_workspace`, `list_issues`, `get_issue`, `create_issue`,
`update_issue`, `create_project` (optionally from a GitHub repo), `github_status` and `github_sign_in` (which hands the user a
code to approve on github.com). They take human names ("In Progress", "me", "Bug", GRD-12),
and every write goes through the same sync engine as the app, so it shows up
live and syncs to GitHub. The server also publishes a `gradient` skill with
the conventions agents should follow.

## Run it

Needs [Bun](https://bun.sh) 1.4 or newer.

```bash
bun install
bun run dev
```

Open http://localhost:4200. The API server runs on 127.0.0.1:4100 and Vite
proxies to it. The database is `apps/server/gradient.db`, created and seeded
on first start.

The first visit asks you to create an account (email and password). The first
account owns the workspace: it takes over the seeded user, its issues and the
GitHub connection, and is its admin. After that, sign-up is closed: invite
people from Members (`/members`), or start the server with
`GRADIENT_ALLOW_SIGNUP=true` to let anyone create an account.

## Accounts

Accounts use [Better Auth](https://www.better-auth.com) with email and
password, stored in the same SQLite database. Your profile (`/profile`) edits
your name, changes your password, lists where you are signed in (sign out any
session), and manages agent keys. Sessions live in an HttpOnly cookie for 7
days and renew while you use the app. Sign-in and sign-up are rate limited per
address. There is no password reset by email yet.

## Teams and people

Each team has its own issues, workflow, labels and projects. Every team is
visible to everyone in the workspace; the teams you are in show in the
sidebar, and Teams (`/teams`, `g t`) lists them all to join or leave. Create a
team from the `+` next to "Your teams"; its settings page renames it, changes
its key and manages its members.

Admins invite people from Members (`/members`, `g m`) or a team's settings: an
invite is a link that works once, for 7 days, optionally only for one email
address, with a role (member or admin) and the teams to join. Gradient sends
no email; copy the link and pass it on. Opening it lets the person create an
account even while sign-up is closed. Admins also change roles and remove
people (their account, sessions and agent keys are deleted; their issues stay).
Agents can do the same over MCP (`create_team`, `add_team_member`,
`invite_person`, …).

To run the compiled versions, build both once, then start both:

```bash
bun run build   # web app to apps/web/dist, server bundle to apps/server/dist
bun run start   # http://localhost:4200, like dev
```

`start` runs the server bundle and `vite preview` of the built app, which
proxies to the server just as dev does. The server also serves the built UI
itself on http://localhost:4100, so `bun run --filter '@gradient/server' start`
alone is enough for a single process.

## GitHub sync

1. Connect GitHub, one of:
   - **Sign in with GitHub** in Settings → GitHub (or ⌘K → "Sign in with
     GitHub"). Gradient shows a short code; enter it on github.com and approve.
     Then install the Gradient GitHub App on the repositories you want.
     Gradient only sees repositories you install it on.
   - Be logged in with the GitHub CLI (`gh auth login`), or set `GITHUB_TOKEN`
     (a fine-grained token with read/write access to Issues on the repo).

   A sign-in through the app takes precedence over the other two; signing out
   falls back to them.
2. Link a repository to a project. Issues are grouped into projects (sidebar);
   each project can sync with one repository, so several repos sync side by side.
   - **New project from a repo**: the **+** next to Projects (or Shift+C), then
     pick the repository from the dropdown. It lists every repository the
     connected account can see. The repo's issues are imported into the project.
   - **Existing project**: "Link GitHub repo" in the project's header. Gradient
     offers to create the project's existing issues on GitHub too.
   - Settings → GitHub lists linked repositories and links new ones.

   New issues go to the repository of their project; issues without a project
   stay local. Moving an issue into a linked project creates it there.

Issue identifiers carry their project's key: the first three letters of its
name ("test" → TES-12, "Issue project" → ISS-12), editable in the project's
settings. Issues without a project use the team key (GRD-12). Numbers are
shared across the team, so an identifier still resolves after the issue moves
to another project or a key changes: TES-12 and GRD-12 open the same issue.

From then on, title, description, open/closed (with reason), labels and the
first assignee sync both ways. Priority and order stay in Gradient.

Changes made on GitHub arrive by polling every 15 seconds (`GITHUB_POLL_INTERVAL`).
Polls use ETags, so unchanged polls do not count against the rate limit.
For instant updates, forward webhooks to your machine:

```bash
export GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 16)   # set before starting the server
gh webhook forward --repo=owner/repo --events=issues,issue_comment,pull_request,issue_dependencies \
  --url=http://localhost:4100/webhooks/github --secret=$GITHUB_WEBHOOK_SECRET
```

To try the sync UI without a real repo, run the fake GitHub API used by the tests:

```bash
bun apps/server/test/dev-fake-github.ts
GITHUB_API_URL=http://127.0.0.1:4300 GITHUB_TOKEN=fake bun run dev   # then make projects from acme/*
# or, to try "Sign in with GitHub" (the fake approves the code after 3 seconds):
GITHUB_API_URL=http://127.0.0.1:4300 GITHUB_WEB_URL=http://127.0.0.1:4300 \
  GITHUB_APP_CLIENT_ID=fake GITHUB_APP_SLUG=gradient bun run dev
```

### The Gradient GitHub App

Sign-in uses the [device flow](https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-cli-with-a-github-app)
of a GitHub App. It needs only the app's client id, which is public, so a
local install carries no secret. To register the app (once, by the
maintainer) at github.com/settings/apps/new:

- **Callback URL**: none needed. **Enable Device Flow**: on. **Webhook**: off
  (GitHub cannot reach a local machine; Gradient polls).
- **Repository permissions**: Issues read & write, Metadata read-only.
- **Optional features**: opt out of user-to-server token expiration. Refreshing
  an expiring token needs the client secret, which a local app cannot ship;
  with expiry on, users sign in again every 8 hours.
- **Where can this app be installed**: any account.

Put the client id and the app's URL slug in `GITHUB_APP` in
`apps/server/src/config.ts`, or set `GITHUB_APP_CLIENT_ID` and
`GITHUB_APP_SLUG`. The token is stored in the local database
(`github_auth`); signing out deletes it. To revoke it on GitHub, use
Settings → Applications → Authorized GitHub Apps.

## Keyboard

Everything is a command with an id. `?` lists every shortcut, `⌘K` / `Ctrl+K`
runs any command available where you are. On the issue list: `j`/`k` move,
`Enter` opens, `s` status, `p` priority, `a` assignee, `l` labels, `i` assign
to me, `c` new issue. Sequences work too (`g i`, `g s`).

Remap any command in localStorage under `gradient.keymap`, for example
`{"issue.status": ["shift+s"], "nav.settings": null}`.

## Configuration

| Variable | Default | |
|---|---|---|
| `GRADIENT_PORT` | `4100` | API server port |
| `GRADIENT_HOST` | `127.0.0.1` | Bind address. Requests from browser origins other than loopback and `GRADIENT_URL` are refused. |
| `GRADIENT_URL` | none | Public URL when Gradient is reached through a domain (e.g. behind a TLS proxy). Its origin is trusted, and cookies are `Secure` when it is https. |
| `GRADIENT_AUTH_SECRET` | generated | Signs session cookies (`BETTER_AUTH_SECRET` works too). Without one, a random secret is created once and kept in the database. |
| `GRADIENT_ALLOW_SIGNUP` | `false` | Let anyone who can reach the server create an account. The first account can always be created. |
| `GRADIENT_DB` | `./gradient.db` | SQLite file |
| `GRADIENT_SEED_SAMPLE` | `true` | Add sample issues to a new database |
| `GRADIENT_USER_NAME` | `Me` | Name of the workspace's user until the first account takes it over |
| `GITHUB_TOKEN` | from `gh auth token` | GitHub access |
| `GITHUB_WEBHOOK_SECRET` | none | Enables `/webhooks/github` |
| `GITHUB_POLL_INTERVAL` | `15` | Seconds between polls |
| `GRADIENT_GITHUB_DISABLED` | `false` | Turn GitHub sync off |

## Layout

```
packages/domain   Schemas, mutations, RPC contract, shared by both sides
apps/server       Bun + Effect: SQLite, sync engine, GitHub sync, accounts (Better Auth)
apps/web          Solid 2 + StyleX: client sync store, shadcn-solid components, views
```

See [docs/PLAN.md](docs/PLAN.md) for the architecture,
[CONTRIBUTING.md](CONTRIBUTING.md) to make a change, and
[AGENTS.md](AGENTS.md) for conventions.

## Checks

```bash
bun run typecheck
bun test
```
