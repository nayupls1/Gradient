# Contributing

Gradient is minimal and agent-first. Every capability should be reachable from
the keyboard (a command) and by an agent (an MCP tool), and the UI stays out of
the way. Read [docs/PLAN.md](docs/PLAN.md) for the architecture and
[AGENTS.md](AGENTS.md) for conventions and known traps before a larger change.
AI agents working in this repo should read AGENTS.md too (CLAUDE.md points
there).

## Setup

Needs [Bun](https://bun.sh) 1.4 or newer, on Linux or macOS.

```bash
bun install
bun run dev          # server on 127.0.0.1:4100, web on http://localhost:4200
```

A fresh database is created and seeded at `apps/server/gradient.db`. Delete it
to start over. To work on GitHub sync without a real repo:

```bash
bun apps/server/test/dev-fake-github.ts
GITHUB_API_URL=http://127.0.0.1:4300 GITHUB_TOKEN=fake bun run dev   # link acme/widgets in Settings
```

## Checks

CI runs these on every pull request. Run them before you push:

```bash
bun run typecheck    # tsc in every package
bun test             # domain, server (real servers on random ports), client replica, keymap
bun run --filter '@gradient/web' build
```

Server tests never touch GitHub: they use `apps/server/test/fake-github.ts`.

## Making a change

| You are adding | Touch |
|---|---|
| A synced field | Schema in `packages/domain`, a new migration (never edit a shipped one), `Db.ts` mappers, `applyIssueMutation` |
| A write | Go through `Mutations.apply` / `Mutations.transact`. Direct table writes skip the sync log, live updates and GitHub. |
| A user action | A command via `useCommands` (id, title, group, scope, optional keys). It then shows in ⌘K and `?` and can be remapped. No ad-hoc `keydown` listeners. |
| An agent capability | A tool in `apps/server/src/mcp/tools.ts` + handler in `server.ts`. Names in, names out, errors that list valid values. |
| An icon | Import it per file from `@lucide/solid/icons/<name>` in `ui/icons.tsx` |
| A color | A token in `theme/tokens.stylex.ts`, set in every palette for both light and dark |
| A dependency | Only when it carries real weight. Say why in the commit. |

Add a test with behavior changes, aimed at what would break silently: the
sync protocol, the client replica (`apps/web/src/sync/replica.ts`), GitHub sync,
MCP tools and the keymap all have suites to extend. Skip tests that only
restate the code. For UI changes, include a screenshot
(light and dark) in the pull request.

## Commits and pull requests

- Small, focused pull requests. Lead the description with the problem, then
  the fix.
- Commit messages: a short summary line, then why. Mention new dependencies.
- Keep the server bound to loopback by default. There is no auth yet.

## License

By contributing you agree that your contributions are licensed under the
[GPL-3.0](LICENSE), the license of this project.
