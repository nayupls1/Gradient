import { createContext } from "solid-js"
import type { SyncEngine } from "../sync/engine.ts"

export const Sync = createContext<SyncEngine>()

export interface ComposerDefaults {
  /** The team of the new issue. Defaults to the team of the page (or the project's). */
  teamId?: string
  stateId?: string
  projectId?: string | null
}

export interface Composer {
  open(defaults?: ComposerDefaults): void
}

export const ComposerContext = createContext<Composer>()

export interface ProjectDialogs {
  /** Open "New project" in a team (the current page's by default). */
  create(teamId?: string): void
  /** Open "Edit project"; `focus: "icon"` opens its icon picker right away. */
  edit(projectId: string, focus?: "icon"): void
}

export const ProjectDialogsContext = createContext<ProjectDialogs>()

/** Workspace-wide dialogs: new team, invite people. */
export interface WorkspaceDialogs {
  createTeam(): void
  /** Invite someone; the teams start selected (the current team by default). Admins only. */
  invite(teamIds?: ReadonlyArray<string>): void
}

export const WorkspaceDialogsContext = createContext<WorkspaceDialogs>()
