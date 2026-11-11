import type { GithubAvailableRepo } from "@gradient/domain"
import { onSettled, useContext } from "solid-js"
import { GithubIcon } from "../ui/icons.tsx"
import { Sync } from "./context.ts"
import { Picker, type PickerApi, type PickerTrigger } from "./Picker.tsx"
import { github } from "./github.ts"

const key = (r: { owner: string; name: string }) => `${r.owner}/${r.name}`.toLowerCase()

/**
 * A searchable dropdown of the connected account's GitHub repositories.
 * Repositories already linked to a project are left out.
 */
export const GithubRepoPicker = (props: {
  trigger: PickerTrigger
  onPick: (repo: GithubAvailableRepo) => void
  align?: "start" | "end"
  apiRef?: (api: PickerApi) => void
}) => {
  const sync = useContext(Sync)
  onSettled(() => void github.ensureRepos(sync))

  const available = () => {
    const linked = new Set(Object.values(sync.state.githubRepos).map(key))
    return (github.repos() ?? []).filter((r) => !linked.has(key(r)))
  }
  const emptyText = () => {
    if (!github.status()?.tokenSource) return "Connect GitHub in Settings first"
    if (github.reposError()) return github.reposError()!
    if (github.repos() === null) return "Loading repositories…"
    return github.repos()!.length === 0 ? "No repositories" : "No matching repository"
  }

  return (
    <Picker<string>
      {...(props.apiRef ? { apiRef: props.apiRef } : {})}
      align={props.align ?? "start"}
      placeholder="Search repositories…"
      emptyText={emptyText()}
      items={available().map((r) => ({
        value: key(r),
        label: `${r.owner}/${r.name}`,
        icon: () => <GithubIcon size={14} />,
        ...(r.private ? { hint: "private" } : {}),
        ...(r.description ? { keywords: r.description } : {})
      }))}
      selected={[]}
      onPick={(value) => {
        const repo = available().find((r) => key(r) === value)
        if (repo) props.onPick(repo)
      }}
      trigger={props.trigger}
    />
  )
}
