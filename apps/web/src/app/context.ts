import { createContext } from "solid-js"
import type { SyncEngine } from "../sync/engine.ts"

export const Sync = createContext<SyncEngine>()

export interface ComposerDefaults {
  stateId?: string
}

export interface Composer {
  open(defaults?: ComposerDefaults): void
}

export const ComposerContext = createContext<Composer>()
