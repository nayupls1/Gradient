import type { Issue } from "@gradient/domain"
import { useContext } from "solid-js"
import { useCommands } from "../keys/solid.tsx"
import { issueKey } from "../lib/select.ts"
import type { PopoverApi } from "../ui/kit.tsx"
import { Sync } from "./context.ts"

export interface PickerApis {
  status?: PopoverApi
  priority?: PopoverApi
  assignee?: PopoverApi
  labels?: PopoverApi
  project?: PopoverApi
}

/**
 * Commands that act on one issue: the focused row in a list, or the open issue.
 * The same ids are used everywhere, so a remap of "issue.status" applies in
 * both places.
 */
export const useIssueCommands = (opts: { scope: string; issue: () => Issue | undefined; apis: () => PickerApis | undefined }) => {
  const sync = useContext(Sync)
  const has = () => opts.issue() !== undefined
  const group = "Issue"
  useCommands([
    { id: "issue.status", title: "Change status", group, keys: ["s"], scope: opts.scope, when: has, run: () => opts.apis()?.status?.open() },
    { id: "issue.priority", title: "Set priority", group, keys: ["p"], scope: opts.scope, when: has, run: () => opts.apis()?.priority?.open() },
    { id: "issue.assignee", title: "Assign", group, keys: ["a"], scope: opts.scope, when: has, run: () => opts.apis()?.assignee?.open() },
    { id: "issue.labels", title: "Edit labels", group, keys: ["l"], scope: opts.scope, when: has, run: () => opts.apis()?.labels?.open() },
    { id: "issue.project", title: "Move to project", group, keys: ["shift+p"], scope: opts.scope, when: has, run: () => opts.apis()?.project?.open() },
    {
      id: "issue.assignToMe",
      title: "Assign to me",
      group,
      keys: ["i"],
      scope: opts.scope,
      when: has,
      run: () => {
        const issue = opts.issue()!
        const me = sync.state.viewerId
        sync.mutate({ _tag: "IssueUpdate", id: issue.id, patch: { assigneeId: issue.assigneeId === me ? null : me } })
      }
    },
    {
      id: "issue.copyId",
      title: "Copy issue ID",
      group,
      keys: ["mod+."],
      scope: opts.scope,
      when: has,
      run: () => void navigator.clipboard?.writeText(issueKey(sync.state, opts.issue()!))
    },
    {
      id: "issue.archive",
      title: "Archive issue",
      group,
      scope: opts.scope,
      when: () => opts.issue()?.archivedAt === null,
      run: () => sync.mutate({ _tag: "IssueArchive", id: opts.issue()!.id })
    }
  ])
}
