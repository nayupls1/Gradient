import { createRouter } from "@solidjs/router"
import { lazy, Loading } from "solid-js"
import { InvitePage } from "../pages/InvitePage.tsx"
import { IssuePage } from "../pages/IssuePage.tsx"
import { IssuesPage } from "../pages/IssuesPage.tsx"
import { MembersPage } from "../pages/MembersPage.tsx"
import { ProfilePage } from "../pages/ProfilePage.tsx"
import { SettingsPage } from "../pages/SettingsPage.tsx"
import { TeamSettingsPage } from "../pages/TeamSettingsPage.tsx"
import { TeamsPage } from "../pages/TeamsPage.tsx"

/**
 * Pull request pages carry the diff viewer and its highlighter, much of the
 * app's code. They load on their own, so the rest of the app starts without
 * parsing them, and are fetched once the app is idle so the first one opens
 * without waiting.
 */
const loadPullRequestPage = () => import("../pages/PullRequestPage.tsx").then((m) => ({ default: m.PullRequestPage }))
const LazyPullRequestPage = lazy(loadPullRequestPage)
const PullRequestRoute = () => (
  <Loading fallback={null}>
    <LazyPullRequestPage />
  </Loading>
)
const idle = (run: () => void) =>
  "requestIdleCallback" in window ? requestIdleCallback(run, { timeout: 5000 }) : setTimeout(run, 2000)
idle(() => void loadPullRequestPage())

export const Router = createRouter({
  routes: [
    { path: "/", component: IssuesPage },
    { path: "/issue/:ref", component: IssuePage },
    { path: "/pr/:owner/:repo/:number", component: PullRequestRoute },
    { path: "/team/:key", component: IssuesPage },
    { path: "/team/:key/settings", component: TeamSettingsPage },
    { path: "/teams", component: TeamsPage },
    { path: "/members", component: MembersPage },
    { path: "/invite/:token", component: InvitePage },
    { path: "/project/:id", component: IssuesPage },
    { path: "/settings", component: SettingsPage },
    { path: "/profile", component: ProfilePage },
    { path: "*404", component: IssuesPage }
  ]
})
