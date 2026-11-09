# Gradient

A Linear-style issue tracker with live, two-way GitHub issue sync. Runs
locally. Built with Effect v4, Bun, SQLite, Solid 2 and StyleX.

## Run it

Needs [Bun](https://bun.sh) 1.4 or newer.

```bash
bun install
bun run dev
```

Open http://localhost:4200. The API server runs on 127.0.0.1:4100 and Vite
proxies to it. The database is `apps/server/gradient.db`, created and seeded
on first start.

For a single-process setup, build the web app once and start only the server,
which then serves the UI too:

```bash
bun run --filter '@gradient/web' build
bun run --filter '@gradient/server' start   # http://localhost:4100
```

## GitHub sync

1. Give the server a token: either be logged in with the GitHub CLI
   (`gh auth login`), or set `GITHUB_TOKEN` (a fine-grained token with
   read/write access to Issues on the repo).
2. In Settings → GitHub, link `owner/repo`. Existing issues are imported.
   Tick the box to also create the team's existing Gradient issues on GitHub.

From then on, title, description, open/closed (with reason), labels and the
first assignee sync both ways. Priority and order stay in Gradient.

Changes made on GitHub arrive by polling every 15 seconds (`GITHUB_POLL_INTERVAL`).
Polls use ETags, so unchanged polls do not count against the rate limit.
For instant updates, forward webhooks to your machine:

```bash
export GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 16)   # set before starting the server
gh webhook forward --repo=owner/repo --events=issues \
  --url=http://localhost:4100/webhooks/github --secret=$GITHUB_WEBHOOK_SECRET
```

To try the sync UI without a real repo, run the fake GitHub API used by the tests:

```bash
bun apps/server/test/dev-fake-github.ts
GITHUB_API_URL=http://127.0.0.1:4300 GITHUB_TOKEN=fake bun run dev   # then link acme/widgets
```

## Configuration

| Variable | Default | |
|---|---|---|
| `GRADIENT_PORT` | `4100` | API server port |
| `GRADIENT_HOST` | `127.0.0.1` | Bind address. Keep it local: there is no auth yet. |
| `GRADIENT_DB` | `./gradient.db` | SQLite file |
| `GRADIENT_SEED_SAMPLE` | `true` | Add sample issues to a new database |
| `GRADIENT_USER_NAME` | `Me` | Name of the local user on first start |
| `GITHUB_TOKEN` | from `gh auth token` | GitHub access |
| `GITHUB_WEBHOOK_SECRET` | none | Enables `/webhooks/github` |
| `GITHUB_POLL_INTERVAL` | `15` | Seconds between polls |
| `GRADIENT_GITHUB_DISABLED` | `false` | Turn GitHub sync off |

## Layout

```
packages/domain   Schemas, mutations, RPC contract, shared by both sides
apps/server       Bun + Effect: SQLite, sync engine, GitHub sync
apps/web          Solid 2 + StyleX: client sync store, UI kit, views
```

See [docs/PLAN.md](docs/PLAN.md) for the architecture and
[AGENTS.md](AGENTS.md) for conventions.

## Checks

```bash
bun run typecheck
bun test
```
