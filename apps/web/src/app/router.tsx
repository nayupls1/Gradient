import { createRouter } from "@solidjs/router"
import { InvitePage } from "../pages/InvitePage.tsx"
import { IssuePage } from "../pages/IssuePage.tsx"
import { IssuesPage } from "../pages/IssuesPage.tsx"
import { MembersPage } from "../pages/MembersPage.tsx"
import { ProfilePage } from "../pages/ProfilePage.tsx"
import { SettingsPage } from "../pages/SettingsPage.tsx"
import { TeamSettingsPage } from "../pages/TeamSettingsPage.tsx"
import { TeamsPage } from "../pages/TeamsPage.tsx"

export const Router = createRouter({
  routes: [
    { path: "/", component: IssuesPage },
    { path: "/issue/:ref", component: IssuePage },
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
