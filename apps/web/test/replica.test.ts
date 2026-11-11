import { describe, expect, test } from "bun:test"
import type { Delta, Issue, Snapshot } from "@gradient/domain"
import { createReplica } from "../src/sync/replica.ts"

const issue = (patch: Partial<Issue> = {}): Issue => ({
  id: "i1",
  teamId: "t1",
  projectId: null,
  number: 1,
  title: "Server title",
  description: "",
  stateId: "todo",
  priority: 0,
  assigneeId: null,
  creatorId: "me",
  labelIds: [],
  sortOrder: "a0",
  github: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  ...patch
})

const snapshot = (issues: Array<Issue>, lastSyncId = 10): Snapshot => ({
  lastSyncId,
  viewerId: "me",
  teams: [],
  users: [],
  workflowStates: [],
  labels: [],
  projects: [],
  issues,
  githubRepos: [],
  issueRelations: [],
  pullRequests: [],
  issueComments: []
})

const upsert = (syncId: number, value: Issue, clientTxId: string | null = null): Delta => ({
  _tag: "Upsert",
  syncId,
  clientTxId,
  entity: { model: "issue", value }
})

const setup = () => {
  const replica = createReplica({ now: () => 99 })
  replica.applySnapshot(snapshot([issue()]))
  return replica
}

describe("replica", () => {
  test("a local edit shows at once and drops when its own delta arrives", () => {
    const replica = setup()
    const { changes } = replica.addPending("tx1", [{ _tag: "IssueUpdate", id: "i1", patch: { title: "Local" } }])
    expect([...changes.get("issues")!]).toEqual(["i1"])
    expect(replica.view("issues", "i1")!.title).toBe("Local")

    replica.applyDeltas([upsert(11, issue({ title: "Local" }), "tx1")])
    expect(replica.pendingCount).toBe(0)
    expect(replica.view("issues", "i1")!.title).toBe("Local")
  })

  test("a rejected edit rolls back to the server value", () => {
    const replica = setup()
    const { tx } = replica.addPending("tx1", [{ _tag: "IssueUpdate", id: "i1", patch: { title: "" } }])
    replica.reject(tx)
    expect(replica.view("issues", "i1")!.title).toBe("Server title")
  })

  test("someone else's change to another field keeps the local edit on top", () => {
    const replica = setup()
    replica.addPending("tx1", [{ _tag: "IssueUpdate", id: "i1", patch: { title: "Local" } }])
    replica.applyDeltas([upsert(11, issue({ priority: 1 }))])
    expect(replica.view("issues", "i1")).toMatchObject({ title: "Local", priority: 1 })
  })

  test("an accepted edit stays visible until the log catches up to its syncId", () => {
    const replica = setup()
    const { tx } = replica.addPending("tx1", [{ _tag: "IssueUpdate", id: "i1", patch: { title: "Local" } }])
    replica.confirm(tx, 12)
    expect(replica.pendingCount).toBe(1)
    replica.applyDeltas([upsert(11, issue({ priority: 2 }))])
    expect(replica.view("issues", "i1")!.title).toBe("Local")
    // The delta for syncId 12 arrived without our clientTxId (e.g. after a reconnect replay).
    replica.applyDeltas([upsert(12, issue({ title: "Local", priority: 2 }))])
    expect(replica.pendingCount).toBe(0)
  })

  test("old or repeated deltas are ignored", () => {
    const replica = setup()
    replica.applyDeltas([upsert(11, issue({ title: "New" }))])
    replica.applyDeltas([upsert(11, issue({ title: "Replayed" })), upsert(5, issue({ title: "Ancient" }))])
    expect(replica.view("issues", "i1")!.title).toBe("New")
    expect(replica.lastSyncId).toBe(11)
  })

  test("a fresh snapshot keeps unconfirmed edits and reports removed rows", () => {
    const replica = setup()
    replica.addPending("tx1", [{ _tag: "IssueUpdate", id: "i1", patch: { title: "Local" } }])
    const changes = replica.applySnapshot(snapshot([issue({ id: "i2" }), issue({ title: "Reset" })], 20))
    expect(replica.view("issues", "i1")!.title).toBe("Local")
    expect(changes.get("issues")).toEqual(new Set(["i1", "i2"]))
    const gone = replica.applySnapshot(snapshot([issue()], 21))
    expect(gone.get("issues")!.has("i2")).toBe(true)
    expect(replica.view("issues", "i2")).toBeUndefined()
  })

  test("an optimistic create then delete leaves nothing behind", () => {
    const replica = setup()
    replica.addPending("tx1", [{
      _tag: "IssueCreate",
      id: "new",
      teamId: "t1",
      projectId: null,
      title: "Draft",
      description: "",
      stateId: "todo",
      priority: 0,
      assigneeId: null,
      labelIds: [],
      sortOrder: "a1"
    }])
    expect(replica.view("issues", "new")).toMatchObject({ title: "Draft", number: 0, creatorId: "me" })
    replica.addPending("tx2", [{ _tag: "IssueDelete", id: "new" }])
    expect(replica.view("issues", "new")).toBeUndefined()
  })

  test("projects: optimistic create, rename and delete, then confirmed by the server", () => {
    const replica = setup()
    replica.addPending("tx1", [{ _tag: "ProjectCreate", id: "p1", teamId: "t1", key: "WEB", name: "Website", color: "#0090ff" }])
    expect(replica.view("projects", "p1")).toMatchObject({ name: "Website", teamId: "t1" })
    replica.addPending("tx2", [{ _tag: "ProjectUpdate", id: "p1", patch: { name: "Site" } }])
    expect(replica.view("projects", "p1")?.name).toBe("Site")
    // The server confirms the create; the rename stays on top until its own delta.
    replica.applyDeltas([{
      _tag: "Upsert",
      syncId: 11,
      clientTxId: "tx1",
      entity: { model: "project", value: { id: "p1", teamId: "t1", key: "WEB", name: "Website", color: "#0090ff", createdAt: 5 } }
    }])
    expect(replica.view("projects", "p1")?.name).toBe("Site")
    replica.addPending("tx3", [{ _tag: "ProjectDelete", id: "p1" }])
    expect(replica.view("projects", "p1")).toBeUndefined()
  })

  test("relations: an optimistic link shows at once, a rejected one rolls back, a delete hides it", () => {
    const replica = setup()
    const link = { _tag: "RelationCreate", id: "r1", teamId: "t1", type: "blocks", issueId: "i1", relatedIssueId: "i2" } as const
    const { tx, changes } = replica.addPending("tx1", [link])
    expect([...changes.get("issueRelations")!]).toEqual(["r1"])
    expect(replica.view("issueRelations", "r1")).toMatchObject({ type: "blocks", issueId: "i1", relatedIssueId: "i2", createdAt: 99 })
    replica.reject(tx)
    expect(replica.view("issueRelations", "r1")).toBeUndefined()

    replica.applyDeltas([{
      _tag: "Upsert",
      syncId: 11,
      clientTxId: null,
      entity: { model: "issueRelation", value: { ...link, createdAt: 5 } }
    }])
    expect(replica.view("issueRelations", "r1")?.createdAt).toBe(5)
    replica.addPending("tx2", [{ _tag: "RelationDelete", id: "r1" }])
    expect(replica.view("issueRelations", "r1")).toBeUndefined()
  })
})
