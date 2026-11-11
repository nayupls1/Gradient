import { createRouter } from "@solidjs/router"
import { IssuePage } from "../pages/IssuePage.tsx"
import { IssuesPage } from "../pages/IssuesPage.tsx"
import { ProfilePage } from "../pages/ProfilePage.tsx"
import { SettingsPage } from "../pages/SettingsPage.tsx"

export const Router = createRouter({
  routes: [
    { path: "/", component: IssuesPage },
    { path: "/issue/:ref", component: IssuePage },
    { path: "/project/:id", component: IssuesPage },
    { path: "/settings", component: SettingsPage },
    { path: "/profile", component: ProfilePage },
    { path: "*404", component: IssuesPage }
  ]
})
