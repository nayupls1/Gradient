# Working on Gradient

Read `docs/PLAN.md` first for the architecture. This file covers conventions
and the traps we have already hit.

## Commands

- `bun run dev`: server (4100) and Vite (4200) together
- `bun run typecheck`: `tsc` in every package (TypeScript 7)
- `bun test`: all tests. Server tests start real servers on random ports and
  use `test/fake-github.ts` instead of GitHub.

Run both checks before you push.

## Rules of the codebase

- **One write path.** Every change clients should see goes through
  `Mutations.transact` (or `Mutations.apply` for the `Mutation` union). It
  logs to `sync_log`, broadcasts, and queues the GitHub outbox. Writing tables
  directly skips all three.
- **New synced field?** Add it to the schema in `packages/domain`, the
  migration (a new one, never edit a shipped one), `Db.ts` mappers, and
  `applyIssueMutation` so the optimistic client result matches the server.
- **GitHub writes from inbound sync use `origin: "github"`**, so they are not
  pushed back. Echo suppression relies on the shadow in `github_issue_link`:
  always update it from GitHub's response.
- **Few dependencies.** Prefer Bun and `effect` built-ins, then small
  hand-written helpers. Add a package only when it carries real weight (a
  router, a font); say why in the commit.

## Effect v4

v4 differs from v3 in many names. Check `node_modules/effect/ai-docs` and the
source before guessing.

- Modules: `effect/rpc`, `effect/sql`, `effect/http`, `effect/socket`.
- Services: `class X extends Context.Service<X, Shape>()("id")`, `X.of(...)`,
  `Effect.service(X)` to read one outside `Effect.gen`.
- `Config.String/Int/Boolean/Redacted` (capitalized), `Schema.Literals([...])`,
  `Schema.TaggedUnion({...})`, `Schema.optionalKey`, `Effect.catchDefect`.
- `Stream.paginate` returns `[items, Option<next>]`. `Stream.unwrap` gives
  the inner effect the stream's scope (use it for `PubSub.subscribe`).

## Solid 2

Read `node_modules/solid-js/CHEATSHEET.md`. The traps we hit:

- `createEffect(compute, apply)`: two functions, always.
- Pass values to props, never accessors, and do not destructure props.
- No store or signal writes from component bodies; start side effects in
  `onSettled`.
- A component that reads a signal while building JSX it hands to someone else
  rebuilds that JSX on every change. Pass getters (see `Popover`'s
  `aria-expanded`) instead of reading eagerly.
- JSX in data (picker items) must be a render function, so it is created
  inside its owner.
- `JSX` types come from `@solidjs/web`.

## StyleX

- Use `stylex.attrs(...)`, not `stylex.props(...)`: Solid needs `class`.
- Do not call local closures inside `stylex.attrs(...)` arguments
  (`stylex.attrs(cond() && s.x)` with a local `cond`): the compiler tries to
  evaluate them and fails with "Unsupported expression". Use props or plain
  values.
- Avoid dynamic style functions (`(c) => ({ color: c })`): `stylex.attrs`
  kebab-cases the generated variable and the color never applies. Use an
  inline `style` for runtime values.
- Colors live in `theme/tokens.stylex.ts`. Themes write those CSS variables at
  runtime (`theme/theme.ts`), so never hardcode a surface or text color.
