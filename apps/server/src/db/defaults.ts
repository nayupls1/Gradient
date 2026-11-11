import type { StateType } from "@gradient/domain"

/** The workflow every new team starts with. */
export const DEFAULT_STATES: ReadonlyArray<{ name: string; type: StateType; color: string }> = [
  { name: "Backlog", type: "backlog", color: "#8b8d98" },
  { name: "Todo", type: "unstarted", color: "#b9bbc6" },
  { name: "In Progress", type: "started", color: "#f5a524" },
  { name: "In Review", type: "started", color: "#3e9b4f" },
  { name: "Done", type: "completed", color: "#6e56cf" },
  { name: "Canceled", type: "canceled", color: "#8b8d98" }
]

/** The labels every new team starts with. */
export const DEFAULT_LABELS: ReadonlyArray<{ name: string; color: string }> = [
  { name: "Bug", color: "#e5484d" },
  { name: "Feature", color: "#8e4ec6" },
  { name: "Improvement", color: "#0090ff" },
  { name: "Chore", color: "#8b8d98" }
]
