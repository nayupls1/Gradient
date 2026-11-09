/**
 * Runs the fake GitHub API on a fixed port with a few issues, for trying the
 * sync UI without a real repository:
 *   bun apps/server/test/dev-fake-github.ts
 *   GITHUB_API_URL=http://127.0.0.1:4300 GITHUB_TOKEN=fake bun run dev
 * then link "acme/widgets" in Settings.
 */
import { makeFakeGithub } from "./fake-github.ts"

const fake = makeFakeGithub({ owner: "acme", name: "widgets" }, Number(process.env.PORT ?? 4300))
fake.seed({ title: "Crash when saving a draft offline", labels: [{ name: "bug", color: "d73a4a" }] })
fake.seed({ title: "Support SSO for enterprise workspaces", labels: [{ name: "enhancement", color: "a2eeef" }] })
fake.seed({ title: "Docs: explain webhook forwarding", state: "closed", state_reason: "completed", labels: [{ name: "documentation", color: "0075ca" }] })
console.log(`Fake GitHub on ${fake.url} with ${fake.issues.length} issues in acme/widgets`)
