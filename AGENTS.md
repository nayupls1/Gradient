# Working on Gradient

Read `docs/PLAN.md` first for the architecture. This file covers conventions
and the traps we have already hit.

The philosophy is minimal and agent-first: every capability should be
reachable by an agent (MCP tool) and by the keyboard (command), and the UI
stays out of the way.

## Commands

- `bun run dev`: server (4100) and Vite (4200) together
- `bun run build` / `bun run start`: build both, then run both compiled
  (server bundle on 4100, `vite preview` on 4200)
- `gradient run [--web]` (`apps/cli`, on PATH after `bun run register`): pull master,
  build, start. `dev` and `start` go through its supervisor too, because
  `bun run --filter` does not stop on Ctrl+C on Windows; long-running
  processes belong there, not in `--filter` scripts.
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
- **Agents use the same path.** MCP tools live in `apps/server/src/mcp/` and
  call `Mutations.apply` with `origin: "mcp"`. Tools take and return human
  names, never internal ids, and errors list the valid values. A new feature
  that users can do in the UI should get a tool too.
- **Auth on every data route.** Browser routes that read or write workspace
  data need a session (`RequireSession`, and RPCs get `CurrentViewer` from
  `AuthMiddleware`); MCP needs an agent key (`RequireApiKey`). Act as the
  viewer (`CurrentViewer.userId`), never as `meta.viewer_id`, which is only the
  workspace's original user. Accounts are Better Auth's: change them through
  `/api/auth/*` or `auth.api`, not its tables, and add its new tables in a
  migration (`auth_*`, snake_case; `auth/adapter.ts` maps the names).
- **Teams and roles.** Permission checks for people's writes (team
  membership, the admin role) live in `Mutations.applyOne` and run for the
  `client` and `mcp` origins only. Keys (team and project) are unique across
  the workspace. Invites are not synced: their tokens are secrets, stored
  hashed (`auth/Members.ts`).
- **Keyboard first.** New actions are commands registered with `useCommands`
  (stable id, title, group, scope, optional default keys), never ad-hoc
  `keydown` listeners. The command then shows up in ⌘K, in `?`, and can be
  remapped. Pick the narrowest scope. Anything that floats above the page
  (dialog, popover, menu) wraps its content in `<KeyScope name=… blocking>`,
  so Escape and shortcuts behind it stay quiet.
- **Components** are shadcn-solid's StyleX components, copied into `ui/` by
  its CLI (`components.json`; `shadcn-solid add <name>`), on base-ui-solidjs.
  Compose them in `app/` (`Picker` is Popover + Command, `UserAvatar` is
  Avatar) instead of writing new primitives. The copies are ours to edit, but
  keep edits small and marked, so a fresh copy stays easy to diff. If a part is
  missing, use base-ui-solidjs (`base-ui-solidjs/<part>`) directly.
- **Icons** are `lucide` icon data drawn by `ui/icon.tsx` (the same `Icon` the
  components use), exported through `ui/icons.tsx`.
- **Themes**: mode (system/light/dark) and palette are separate. Every palette
  defines both a light and a dark set; never add a palette that only works in
  one mode.
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

## Performance

The app has to stay smooth on slow machines (check with Chrome's 4× CPU
throttling) and with hundreds of issues. What we learned:

- **No whole-table scans per row.** `Object.values(sync.state.x)` reads every
  row through a store proxy and subscribes to all of them. In anything
  rendered per item, use `sync.index` (built once per change from the plain
  `sync.rows`, see `lib/indexes.ts`) or add an index there, with a test that
  it agrees with the scanning selector.
- **Memoize derived values that are read more than once** (`createMemo`): a
  plain function re-runs its scan on every read.
- **List rows stay light.** The issue list recycles row elements while
  scrolling (`assignSlots`), so a row must follow `props.issue` changing
  under it. Pickers mount their popover on first open; row triggers are
  native buttons with the Button's styles. Prefer plain elements with a
  component's styles (`buttonStyles`, `badgeStyles`) over base-ui components
  inside rows.
- **Scrollbars are native** (thin, themed in `theme.ts`), not a JS scroll
  area, which moves its thumb on the main thread.

## Keymap

`apps/web/src/keys/core.ts` is framework free and unit tested
(`apps/web/test/keys.test.ts`); `keys/solid.tsx` binds it to components.
Bindings are strings: `"c"`, `"mod+k"` (⌘ on macOS, Ctrl elsewhere),
`"shift+enter"`, sequences `"g i"`, symbols as typed (`"?"`). Commands that
share a key on purpose need a `when` guard. Text fields only receive ⌘/Ctrl
chords and commands with `allowInInput`.

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
  runtime (`theme/theme.ts`), so never hardcode a surface or text color. The
  shadcn components read shadcn's tokens (`lib/tokens.stylex.ts`), which
  `theme.ts` derives from ours (`uiTokensFrom` in `theme/presets.ts`); use
  either set, never literals. `theme.ts` also puts `lightMode`/`darkMode` on
  `<html>`, which the components' `light-dark()` colors need.
- StyleX emits layered CSS, and unlayered CSS beats every layer. `global.css`
  is therefore all inside `@layer reset` (declared first in `index.html`):
  keep new global rules in it.
- Override a component's spacing with longhands (`paddingInline`, not
  `padding`): StyleX lets longhands win over shorthands whatever the order.
