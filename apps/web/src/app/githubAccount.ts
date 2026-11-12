import type { GithubAccount } from "@gradient/domain"
import { createSignal } from "solid-js"
import type { SyncEngine } from "../sync/engine.ts"

/*
 * The signed-in person's own GitHub account: who their comments, reviews and
 * merges go out as. Server state over plain RPC (not synced), shared by the
 * profile page and every comment box, so connecting in one place updates all.
 */

const [account, setAccount] = createSignal<GithubAccount | null>(null)
const [error, setError] = createSignal<string | null>(null)

const messageOf = (e: unknown) => (e as { message?: string }).message ?? String(e)
let loading: Promise<GithubAccount | null> | null = null
/** Only the newest wait may write its outcome. */
let waitGeneration = 0

const refresh = (sync: SyncEngine) =>
  (loading ??= sync.call((c) => c.GithubAccountStatus()).then(
    (next) => {
      setAccount(next)
      return next
    },
    () => null
  ).finally(() => {
    loading = null
  }))

/** Load once, for pages that open before anything else asked. */
const ensure = (sync: SyncEngine) => (account() ? Promise.resolve(account()) : refresh(sync))

const wait = async (sync: SyncEngine) => {
  const generation = ++waitGeneration
  try {
    const next = await sync.call((c) => c.GithubAccountSignInWait())
    if (generation !== waitGeneration) return
    setAccount(next)
    setError(null)
  } catch (e) {
    if (generation !== waitGeneration) return
    const message = messageOf(e)
    if (!/cancelled|No sign-in is in progress/.test(message)) setError(message)
    await refresh(sync)
  }
}

/** Start the device flow: shows a code to enter on github.com, then waits for the approval. */
const connect = async (sync: SyncEngine) => {
  setError(null)
  try {
    const code = await sync.call((c) => c.GithubAccountSignInStart())
    setAccount((a) => (a ? { ...a, pending: code } : a))
    await wait(sync)
  } catch (e) {
    setError(messageOf(e))
  }
}

const cancel = async (sync: SyncEngine) => {
  waitGeneration++
  await sync.call((c) => c.GithubAccountSignInCancel()).catch(() => {})
  await refresh(sync)
}

const disconnect = async (sync: SyncEngine) => {
  setAccount(await sync.call((c) => c.GithubAccountSignOut()))
}

export const githubAccount = { account, error, refresh, ensure, wait, connect, cancel, disconnect }
