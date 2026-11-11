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
fake.seed({ title: "Keep drafts when offline", body: "Fixes #1", draft: false, pull_request: { url: "x", merged_at: null } })
fake.comment(1, "Reproduced on macOS too. The fix in #4 should cover it; acme/gadgets#1 has the same symptom.", { login: "dev" })
fake.comment(1, "Confirmed, see https://github.com/acme/widgets/issues/2 for the SSO side.")
const svg = (fill: string, shape: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${fill}"/>${shape}</svg>`
fake.putFile("README.md", "# widgets")
fake.putFile("web/public/favicon.svg", svg("#f76b15", `<circle cx="16" cy="16" r="7" fill="#fff"/>`))
fake.putFile("docs/logo.svg", svg("#0090ff", `<path d="M9 22 16 8l7 14z" fill="#fff"/>`))
fake.putFile("assets/logo.svg", svg("#8e4ec6", `<rect x="9" y="9" width="14" height="14" rx="2" fill="#fff"/>`), { owner: "acme", name: "gadgets" })
console.log(`Fake GitHub on ${fake.url} with ${fake.issues.length} issues and pull requests in acme/widgets`)
