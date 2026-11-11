import type { Project, ProjectIconFile } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { createSignal, Show, useContext } from "solid-js"
import { projectRepo } from "../lib/select.ts"
import { ProjectIcon } from "../ui/icons.tsx"
import { Sync } from "./context.ts"

/*
 * A project's icon: the image from its repository (a favicon, a logo, or the
 * file the user picked), else the cube in the project's color. A broken image
 * falls back to the cube too.
 */

const s = stylex.create({
  img: { flexShrink: 0, objectFit: "contain", borderRadius: 3, display: "block" }
})

/** Where the server serves a file of a linked repository. The sha makes the URL immutable. */
export const repoFileUrl = (repoId: string, file: ProjectIconFile) =>
  `/repo-files/${repoId}/${file.sha}/${encodeURIComponent(file.path.split("/").pop()!)}`

export const ProjectGlyph = (props: { project: Project | undefined; size?: number }) => {
  const sync = useContext(Sync)
  const [broken, setBroken] = createSignal<string | null>(null)
  const size = () => props.size ?? 14
  const src = () => {
    const icon = props.project?.icon
    const repo = icon ? projectRepo(sync.state, props.project!.id) : undefined
    const url = icon && repo ? repoFileUrl(repo.id, icon) : null
    return url === broken() ? null : url
  }
  return (
    <Show when={src()} fallback={<ProjectIcon size={size()} color={props.project?.color ?? "currentColor"} />}>
      {(url) => (
        <img
          src={url()}
          alt=""
          width={size()}
          height={size()}
          draggable={false}
          onError={() => setBroken(url())}
          {...stylex.attrs(s.img)}
        />
      )}
    </Show>
  )
}
