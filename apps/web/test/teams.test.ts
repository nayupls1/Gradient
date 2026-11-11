import { describe, expect, test } from "bun:test"
import type { Issue, Snapshot, TeamMember, User } from "@gradient/domain"
import {
  currentTeam,
  defaultTeam,
  findTeam,
  keyOwner,
  myTeams,
  suggestProjectKey,
  suggestTeamKey,
  teamFromPath,
  workspaceMembers
} from "../src/lib/select.ts"
import type { SyncState } from "../src/sync/engine.ts"
import { createReplica } from "../src/sync/replica.ts"

const user = (id: string, name: string, role: User["role"]): User => ({ id, name, githubLogin: null, avatarUrl: null, role })
const member = (id: string, teamId: string, userId: string): TeamMember => ({ id, teamId, userId, createdAt: 1 })
const issue: Issue = {
  id: "i1", teamId: "t2", projectId: null, number: 3, title: "Offline", description: "", stateId: "s", priority: 0,
  assigneeId: null, creatorId: "me", labelIds: [], sortOrder: "a0", github: null, createdAt: 1, updatedAt: 1, archivedAt: null
}

const store = {
  viewerId: "me",
  teams: {
    t1: { id: "t1", key: "GRD", name: "Gradient", issueCounter: 0 },
    t2: { id: "t2", key: "MOB", name: "Mobile", issueCounter: 3 },
    t3: { id: "t3", key: "OPS", name: "Ops", issueCounter: 0 }
  },
  teamMembers: { m1: member("m1", "t2", "me"), m2: member("m2", "t3", "me"), m3: member("m3", "t1", "grace") },
  users: { me: user("me", "Ada", "admin"), grace: user("grace", "Grace", "member"), octo: user("octo", "octocat", null) },
  projects: { p1: { id: "p1", teamId: "t1", key: "APP", name: "App", color: "#000", iconMode: "auto", icon: null, createdAt: 1 } },
  issues: { i1: issue }
} as unknown as SyncState

describe("team selectors", () => {
  test("the sidebar lists the viewer's teams by name; the first is the default", () => {
    expect(myTeams(store).map((t) => t.key)).toEqual(["MOB", "OPS"])
    expect(defaultTeam(store)?.key).toBe("MOB")
    const outsider = { ...store, viewerId: "octo" } as SyncState
    expect(defaultTeam(outsider)?.key).toBe("GRD")
  })

  test("the page's team comes from the URL: a team key, a project, or an issue", () => {
    expect(teamFromPath(store, "/team/ops")?.id).toBe("t3")
    expect(teamFromPath(store, "/team/OPS/settings")?.id).toBe("t3")
    expect(teamFromPath(store, "/project/p1")?.id).toBe("t1")
    expect(teamFromPath(store, "/issue/MOB-3")?.id).toBe("t2")
    expect(teamFromPath(store, "/settings")).toBeUndefined()
    expect(currentTeam(store, "/settings")?.key).toBe("MOB")
    expect(findTeam(store, "t1")?.key).toBe("GRD")
  })

  test("keys are unique across teams and projects", () => {
    expect(keyOwner(store, "app")).toBe("the project App")
    expect(keyOwner(store, "MOB")).toBe("the team Mobile")
    expect(keyOwner(store, "MOB", { team: "t2" })).toBeNull()
    expect(suggestTeamKey(store, "Mobile web")).toBe("MO2")
    expect(suggestTeamKey(store, "Applications")).toBe("AP2")
    // A project in one team cannot take another team's key.
    expect(suggestProjectKey(store, "t1", "Ops tooling")).toBe("OP2")
  })

  test("members of the workspace are the people with an account", () => {
    expect(workspaceMembers(store).map((u) => u.name)).toEqual(["Ada", "Grace"])
  })
})

const snapshot = (): Snapshot => ({
  lastSyncId: 1,
  viewerId: "me",
  teams: [{ id: "t1", key: "GRD", name: "Gradient", issueCounter: 0 }],
  teamMembers: [member("m1", "t1", "me")],
  users: [],
  workflowStates: [],
  labels: [],
  projects: [],
  issues: [],
  githubRepos: [],
  issueRelations: [],
  pullRequests: [],
  issueComments: []
})

describe("team changes in the replica", () => {
  test("creating and renaming a team shows at once and rolls back on rejection", () => {
    const replica = createReplica({ now: () => 5 })
    replica.applySnapshot(snapshot())
    const { tx, changes } = replica.addPending("tx1", [{ _tag: "TeamCreate", id: "t2", key: "WEB", name: "Web" }])
    expect([...changes.get("teams")!]).toEqual(["t2"])
    expect(replica.view("teams", "t2")).toEqual({ id: "t2", key: "WEB", name: "Web", issueCounter: 0 })
    replica.reject(tx)
    expect(replica.view("teams", "t2")).toBeUndefined()

    replica.addPending("tx2", [{ _tag: "TeamUpdate", id: "t1", patch: { name: "Core" } }])
    expect(replica.view("teams", "t1")).toMatchObject({ key: "GRD", name: "Core" })
  })

  test("joining and leaving a team is optimistic", () => {
    const replica = createReplica({ now: () => 5 })
    replica.applySnapshot(snapshot())
    replica.addPending("tx1", [{ _tag: "TeamMemberRemove", id: "m1" }])
    expect(replica.view("teamMembers", "m1")).toBeUndefined()
    const { changes } = replica.addPending("tx2", [{ _tag: "TeamMemberAdd", id: "m2", teamId: "t1", userId: "grace" }])
    expect([...changes.get("teamMembers")!]).toEqual(["m2"])
    expect(replica.view("teamMembers", "m2")).toEqual({ id: "m2", teamId: "t1", userId: "grace", createdAt: 5 })
  })
})
