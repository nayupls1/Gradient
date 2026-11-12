/**
 * Runs the fake GitHub API on a fixed port with a few issues, for trying the
 * sync UI without a real repository:
 *   bun apps/server/test/dev-fake-github.ts
 *   GITHUB_API_URL=http://127.0.0.1:4300 GITHUB_TOKEN=fake bun run dev
 * then create a project from a repository (acme/widgets, acme/gadgets, acme/docs).
 * widgets has a favicon and gadgets a logo, which become the projects' icons;
 * docs has no image, so its project keeps the cube.
 *
 * To try "Sign in with GitHub" instead of a token (the fake approves the code
 * after 3 seconds, and the app is "installed" on acme/widgets):
 *   GITHUB_API_URL=http://127.0.0.1:4300 GITHUB_WEB_URL=http://127.0.0.1:4300 \
 *   GITHUB_APP_CLIENT_ID=fake GITHUB_APP_SLUG=gradient bun run dev
 */
import { makeFakeGithub } from "./fake-github.ts"

const fake = makeFakeGithub({ owner: "acme", name: "widgets" }, Number(process.env.PORT ?? 4300), {
  autoApproveDeviceAfterMs: 3000
})
fake.addRepo("acme", "gadgets", { private: true })
fake.addRepo("acme", "docs")
fake.install([{ owner: "acme", name: "widgets" }, { owner: "acme", name: "gadgets", private: true }])
fake.seed({ title: "Gadget pairing fails on Linux", labels: [{ name: "bug", color: "d73a4a" }] }, { owner: "acme", name: "gadgets" })
fake.seed({ title: "Battery widget for the gadget", labels: [{ name: "enhancement", color: "a2eeef" }] }, { owner: "acme", name: "gadgets" })
fake.seed({ title: "Crash when saving a draft offline", labels: [{ name: "bug", color: "d73a4a" }] })
fake.seed({ title: "Support SSO for enterprise workspaces", labels: [{ name: "enhancement", color: "a2eeef" }] })
fake.seed({ title: "Docs: explain webhook forwarding", state: "closed", state_reason: "completed", labels: [{ name: "documentation", color: "0075ca" }] })
fake.block(2, 1) // SSO waits on the crash fix
const patch = (lines: Array<string>) => lines.join("\n")
fake.seed({
  title: "Keep drafts when offline",
  body: "Fixes #1\n\nDrafts were written straight to the server, so going offline mid-edit lost them. They now land in IndexedDB first and sync when the connection comes back.\n\n- [x] Queue writes while offline\n- [x] Replay in order on reconnect\n- [ ] Show a badge on unsynced drafts",
  draft: false,
  labels: [{ name: "bug", color: "d73a4a" }],
  pull_request: { url: "x", merged_at: null },
  user: { login: "dev", avatar_url: "https://avatars/dev" },
  pr: {
    head: "fix/offline-drafts",
    commits: 4,
    requested_reviewers: ["octo"],
    files: [
      {
        filename: "src/drafts/store.ts",
        status: "modified",
        additions: 17,
        deletions: 4,
        patch: patch([
          "@@ -1,11 +1,24 @@",
          " import { openDB } from \"./db\"",
          "+import { onReconnect } from \"../net/status\"",
          " ",
          " export interface Draft {",
          "   id: string",
          "   body: string",
          "+  syncedAt: number | null",
          " }",
          " ",
          "-export async function saveDraft(draft: Draft) {",
          "-  await fetch(`/api/drafts/${draft.id}`, { method: \"PUT\", body: JSON.stringify(draft) })",
          "-  return draft",
          "-}",
          "+export async function saveDraft(draft: Draft) {",
          "+  const db = await openDB()",
          "+  await db.put(\"drafts\", { ...draft, syncedAt: null })",
          "+  if (navigator.onLine) await flush()",
          "+  return draft",
          "+}",
          "+",
          "+export async function flush() {",
          "+  const db = await openDB()",
          "+  for (const draft of await db.getAll(\"drafts\")) {",
          "+    if (draft.syncedAt === null) await push(draft)",
          "+  }",
          "+}",
          "+",
          "+onReconnect(flush)"
        ])
      },
      {
        filename: "src/net/status.ts",
        status: "added",
        additions: 9,
        deletions: 0,
        patch: patch([
          "@@ -0,0 +1,9 @@",
          "+type Listener = () => void",
          "+const listeners = new Set<Listener>()",
          "+",
          "+window.addEventListener(\"online\", () => listeners.forEach((l) => l()))",
          "+",
          "+export function onReconnect(listener: Listener) {",
          "+  listeners.add(listener)",
          "+  return () => listeners.delete(listener)",
          "+}"
        ])
      },
      {
        filename: "src/drafts/store.test.ts",
        status: "modified",
        additions: 6,
        deletions: 1,
        patch: patch([
          "@@ -20,5 +20,10 @@ describe(\"drafts\", () => {",
          "   it(\"saves a draft\", async () => {",
          "     expect(await saveDraft(draft)).toEqual(draft)",
          "   })",
          "+",
          "+  it(\"keeps a draft while offline\", async () => {",
          "+    goOffline()",
          "+    await saveDraft(draft)",
          "+    expect(await pending()).toHaveLength(1)",
          "+  })",
          "-  it.todo(\"offline\")",
          " })"
        ])
      }
    ],
    reviews: [{ login: "lead", state: "APPROVED", body: "Nice, the replay order is exactly what we need." }],
    timeline: [
      { event: "committed", sha: "3f9c2a1b7e", message: "Write drafts to IndexedDB first", author: { name: "dev", date: "2025-12-31T21:10:00Z" } },
      { event: "committed", sha: "a41d8e09c2", message: "Replay queued drafts on reconnect", author: { name: "dev", date: "2025-12-31T22:40:00Z" } },
      { event: "committed", sha: "c07be5513f", message: "Add onReconnect helper", author: { name: "dev", date: "2025-12-31T23:05:00Z" } },
      { event: "labeled", actor: { login: "dev", avatar_url: "https://avatars/dev" }, label: { name: "bug", color: "d73a4a" }, created_at: "2026-01-01T00:00:01Z" },
      { event: "review_requested", actor: { login: "dev", avatar_url: "https://avatars/dev" }, requested_reviewer: { login: "lead" }, created_at: "2026-01-01T00:00:02Z" },
      { event: "renamed", actor: { login: "dev", avatar_url: "https://avatars/dev" }, rename: { from: "Offline drafts", to: "Keep drafts when offline" }, created_at: "2026-01-01T00:00:03Z" },
      { event: "head_ref_force_pushed", actor: { login: "dev", avatar_url: "https://avatars/dev" }, created_at: "2026-01-01T00:00:04Z" },
      { event: "committed", sha: "e2f6aa0d41", message: "Test that a draft survives going offline", author: { name: "dev", date: "2026-01-01T00:00:05Z" } },
      {
        event: "cross-referenced",
        actor: { login: "someone", avatar_url: "https://avatars/someone" },
        created_at: "2026-01-01T00:00:06Z",
        source: { issue: { number: 1, title: "Gadget pairing fails on Linux", html_url: "https://github.com/acme/gadgets/issues/1", repository: { full_name: "acme/gadgets" } } }
      }
    ],
    review_comments: [
      { id: 7001, path: "src/drafts/store.ts", line: 13, side: "RIGHT", login: "lead", body: "Should this also flush when the tab regains focus?" },
      { id: 7002, path: "src/drafts/store.ts", line: 13, side: "RIGHT", login: "dev", body: "Good call, I'll do that in a follow-up.", in_reply_to_id: 7001 }
    ],
    checks: [
      { name: "test", status: "completed", conclusion: "success" },
      { name: "typecheck", status: "completed", conclusion: "success" },
      { name: "e2e (chromium)", status: "in_progress", conclusion: null }
    ]
  }
})
fake.comment(1, "Reproduced on macOS too. The fix in #4 should cover it; acme/gadgets#1 has the same symptom.", { login: "dev" })
fake.comment(1, "Confirmed, see https://github.com/acme/widgets/issues/2 for the SSO side.")
const svg = (fill: string, shape: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${fill}"/>${shape}</svg>`
fake.putFile("README.md", "# widgets")
fake.putFile("web/public/favicon.svg", svg("#f76b15", `<circle cx="16" cy="16" r="7" fill="#fff"/>`))
fake.putFile("docs/logo.svg", svg("#0090ff", `<path d="M9 22 16 8l7 14z" fill="#fff"/>`))
fake.putFile("assets/logo.svg", svg("#8e4ec6", `<rect x="9" y="9" width="14" height="14" rx="2" fill="#fff"/>`), { owner: "acme", name: "gadgets" })
console.log(`Fake GitHub on ${fake.url} with ${fake.issues.length} issues and pull requests in acme/widgets`)
fake.comment(4, "Tried it on a train with spotty Wi-Fi: drafts survived every tunnel.", { login: "octo" })
