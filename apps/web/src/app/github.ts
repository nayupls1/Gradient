import type { GithubAvailableRepo, GithubStatus } from "@gradient/domain"
import { createSignal } from "solid-js"
import type { SyncEngine } from "../sync/engine.ts"

/*
 * GitHub connection state, shared by the Settings page and the "Sign in with
 * GitHub" command (which can run from anywhere). Not part of the synced model:
 * it is server state fetched over plain RPC calls.
 */

const [status, setStatus] = createSignal<GithubStatus | null>(null)
const [error, setError] = createSignal<string | null>(null)
const [repos, setRepos] = createSignal<ReadonlyArray<GithubAvailableRepo> | null>(null)
const [reposError, setReposError] = createSignal<string | null>(null)

const messageOf = (e: unknown) => (e as { message?: string }).message ?? String(e)
/** Only the newest wait may write its outcome; older ones end as "cancelled" when replaced. */
let waitGeneration = 0

/*
 * Solid batches signal writes, so `status()` can still hold the old value right
 * after `setStatus`. Code that acts on a fresh status takes it as a value.
 */
const refresh = (sync: SyncEngine) =>
  sync.call((c) => c.GithubStatus()).then(
    (next) => {
      setStatus(next)
      return next
    },
    () => null
  )

/** Wait for a pending sign-in to finish: started here, by an agent, or before a reload. */
const wait = async (sync: SyncEngine) => {
  const generation = ++waitGeneration
  try {
    const next = await sync.call((c) => c.GithubSignInWait())
    if (generation !== waitGeneration) return
    setStatus(next)
    setError(null)
    void loadRepos(sync, next)
  } catch (e) {
    if (generation !== waitGeneration) return
    const message = messageOf(e)
    if (!/cancelled|No sign-in is in progress/.test(message)) setError(message)
    await refresh(sync)
  }
}

const signIn = async (sync: SyncEngine) => {
  setError(null)
  try {
    const code = await sync.call((c) => c.GithubSignInStart())
    setStatus((s) => (s ? { ...s, signIn: { ...s.signIn, pending: code } } : s))
    await wait(sync)
  } catch (e) {
    setError(messageOf(e))
  }
}

const cancel = async (sync: SyncEngine) => {
  waitGeneration++
  await sync.call((c) => c.GithubSignInCancel()).catch(() => {})
  await refresh(sync)
}

const signOut = async (sync: SyncEngine) => {
  setStatus(await sync.call((c) => c.GithubSignOut()))
  setRepos(null)
}

/**
 * Repositories the connected account can link, for the repo dropdown: with an
 * app sign-in the ones it is installed on, with a token (gh CLI, GITHUB_TOKEN)
 * every repository the token sees.
 */
let reposLoading: Promise<void> | null = null
const loadRepos = (sync: SyncEngine, current: GithubStatus | null = status()): Promise<void> => {
  if (!current?.tokenSource) {
    setRepos(null)
    return Promise.resolve()
  }
  reposLoading ??= sync.call((c) => c.GithubRepos()).then(
    (list) => {
      setRepos(list)
      setReposError(null)
    },
    async (e) => {
      setReposError(messageOf(e))
      await refresh(sync) // a 401 signs out; show that
    }
  ).finally(() => {
    reposLoading = null
  })
  return reposLoading
}

/** Load the repo list once, for dropdowns that open before Settings did. */
const ensureRepos = async (sync: SyncEngine) => {
  if (repos() !== null) return
  const current = status() ?? (await refresh(sync))
  await loadRepos(sync, current)
}

/** Link a repository to a project, or to a new project named after it (projectId null). */
const linkRepo = (
  sync: SyncEngine,
  input: { teamId: string; projectId: string | null; projectName?: string; owner: string; name: string; pushExisting: boolean }
) => sync.call((c) => c.GithubLinkRepo(input))

export const github = {
  status,
  error,
  repos,
  reposError,
  refresh,
  wait,
  signIn,
  cancel,
  signOut,
  loadRepos,
  ensureRepos,
  linkRepo
}
