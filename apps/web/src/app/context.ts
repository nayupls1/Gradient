import { createContext } from "solid-js"
import type { SyncEngine } from "../sync/engine.ts"

export const Sync = createContext<SyncEngine>()

export interface ComposerDefaults {
  stateId?: string
  projectId?: string | null
}

export interface Composer {
  open(defaults?: ComposerDefaults): void
}

export const ComposerContext = createContext<Composer>()

export interface ProjectDialogs {
  /** Open "New project", optionally with a GitHub repository already picked. */
  create(): void
  /** Open "Edit project"; `focus: "icon"` opens its icon picker right away. */
  edit(projectId: string, focus?: "icon"): void
}

export const ProjectDialogsContext = createContext<ProjectDialogs>()
