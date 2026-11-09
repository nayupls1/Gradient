import { createRouter } from "@solidjs/router"
import { IssuePage } from "../pages/IssuePage.tsx"
import { IssuesPage } from "../pages/IssuesPage.tsx"
import { SettingsPage } from "../pages/SettingsPage.tsx"

export const Router = createRouter({
  routes: [
    { path: "/", component: () => <IssuesPage view="all" /> },
    { path: "/active", component: () => <IssuesPage view="active" /> },
    { path: "/backlog", component: () => <IssuesPage view="backlog" /> },
    { path: "/my-issues", component: () => <IssuesPage view="mine" /> },
    { path: "/issue/:ref", component: IssuePage },
    { path: "/settings", component: SettingsPage },
    { path: "*404", component: () => <IssuesPage view="all" /> }
  ]
})
