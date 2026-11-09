import type { Issue, Label, StateType, User, WorkflowState } from "@gradient/domain"
import { type GhIssue, labelName } from "./GithubClient.ts"

/**
 * The fields Gradient and GitHub share, in a neutral shape. Each linked issue
 * stores the last version GitHub is known to have (its "shadow"). Comparing
 * against the shadow tells us which side changed which field, and makes the
 * echo of our own write a no-op.
 */
export interface Shadow {
  readonly title: string
  readonly body: string
  readonly state: "open" | "closed"
  readonly stateReason: "completed" | "not_planned" | null
  /** Sorted, so order never counts as a change. */
  readonly labels: ReadonlyArray<string>
  readonly assignee: string | null
}

export type ShadowField = "title" | "body" | "state" | "labels" | "assignee"

const sortNames = (names: ReadonlyArray<string>) =>
  [...new Set(names)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))

export const fromGithub = (gh: GhIssue): Shadow => ({
  title: gh.title,
  body: gh.body ?? "",
  state: gh.state,
  stateReason: gh.state === "closed" ? (gh.state_reason === "not_planned" ? "not_planned" : "completed") : null,
  labels: sortNames(gh.labels.map(labelName)),
  assignee: gh.assignees?.[0]?.login ?? null
})

export const fromIssue = (
  issue: Issue,
  ctx: { readonly state: WorkflowState; readonly labels: ReadonlyArray<Label>; readonly assignee: User | undefined }
): Shadow => ({
  title: issue.title,
  body: issue.description,
  state: ctx.state.type === "completed" || ctx.state.type === "canceled" ? "closed" : "open",
  stateReason: ctx.state.type === "completed" ? "completed" : ctx.state.type === "canceled" ? "not_planned" : null,
  labels: sortNames(issue.labelIds.flatMap((id) => ctx.labels.find((l) => l.id === id)?.name ?? [])),
  assignee: ctx.assignee?.githubLogin ?? null
})

const sameList = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i]!.toLowerCase())

export const diff = (from: Shadow, to: Shadow): Array<ShadowField> => {
  const out: Array<ShadowField> = []
  if (from.title !== to.title) out.push("title")
  if (from.body !== to.body) out.push("body")
  if (from.state !== to.state || from.stateReason !== to.stateReason) out.push("state")
  if (!sameList(from.labels, to.labels)) out.push("labels")
  if ((from.assignee ?? "").toLowerCase() !== (to.assignee ?? "").toLowerCase()) out.push("assignee")
  return out
}

/** Pick the Gradient state an incoming GitHub state maps to, keeping the current one when it still fits. */
export const resolveState = (
  states: ReadonlyArray<WorkflowState>,
  current: WorkflowState | undefined,
  incoming: Pick<Shadow, "state" | "stateReason">
): WorkflowState => {
  const wanted: ReadonlyArray<StateType> = incoming.state === "open"
    ? ["unstarted", "started", "backlog"]
    : incoming.stateReason === "not_planned"
    ? ["canceled", "completed"]
    : ["completed"]
  if (current && wanted.includes(current.type)) return current
  for (const type of wanted) {
    const match = states.find((s) => s.type === type)
    if (match) return match
  }
  return states[0]!
}
