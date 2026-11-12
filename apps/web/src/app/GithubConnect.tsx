import * as stylex from "@stylexjs/stylex"
import { createSignal, onSettled, Show, useContext } from "solid-js"
import { colors } from "../lib/tokens.stylex.ts"
import { font, radius } from "../theme/tokens.stylex.ts"
import { Button } from "../ui/button.tsx"
import { CheckIcon, CopyIcon, ExternalIcon, GithubIcon } from "../ui/icons.tsx"
import { Sync } from "./context.ts"
import { githubAccount } from "./githubAccount.ts"
import { UserAvatar } from "./UserAvatar.tsx"

/*
 * Connect your own GitHub account (device flow): a button, then the code to
 * enter on github.com while Gradient waits for the approval. Used on the
 * profile page and wherever a comment, review or merge needs an account.
 */

const s = stylex.create({
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  device: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingBlock: 12,
    paddingInline: 12,
    borderRadius: radius.md,
    backgroundColor: colors.muted
  },
  code: { fontFamily: font.mono, fontSize: 18, fontWeight: 600, letterSpacing: "0.12em", color: colors.foreground },
  subtle: { color: colors.mutedForeground, fontSize: "0.75rem" },
  grow: { flexGrow: 1 },
  error: { color: colors.destructive, fontSize: "0.75rem" },
  who: { fontSize: "0.8125rem", fontWeight: 500 }
})

const minutesLeft = (at: number) => Math.max(1, Math.round((at - Date.now()) / 60_000))

/** The connect button and the waiting code. `compact` hides the account line once connected. */
export const GithubConnect = (props: { label?: string; compact?: boolean }) => {
  const sync = useContext(Sync)
  const [copied, setCopied] = createSignal(false)
  const account = githubAccount.account
  onSettled(() => {
    void githubAccount.ensure(sync).then((a) => {
      // A sign-in started before a reload is still waiting: pick it up.
      if (a?.pending) void githubAccount.wait(sync)
    })
  })
  const copy = (code: string) => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <>
      <Show
        when={account()?.pending}
        fallback={
          <Show
            when={account()?.personal}
            fallback={
              <Show when={account()?.signInAvailable !== false} fallback={<span {...stylex.attrs(s.subtle)}>Sign-in with GitHub is not set up on this server (GITHUB_APP_CLIENT_ID).</span>}>
                <Button size="sm" onClick={() => void githubAccount.connect(sync)}>
                  <GithubIcon size={14} /> {props.label ?? "Connect GitHub"}
                </Button>
              </Show>
            }
          >
            {(personal) => (
              <Show when={!props.compact}>
                <div {...stylex.attrs(s.row)}>
                  <UserAvatar name={personal().login} src={personal().avatarUrl} size={24} />
                  <span {...stylex.attrs(s.who)}>@{personal().login}</span>
                  <span {...stylex.attrs(s.grow)} />
                  <Button size="xs" variant="ghost" onClick={() => void githubAccount.disconnect(sync)}>Disconnect</Button>
                </div>
              </Show>
            )}
          </Show>
        }
      >
        {(pending) => (
          <div {...stylex.attrs(s.device)}>
            <div {...stylex.attrs(s.subtle)}>Enter this code on GitHub to connect your account</div>
            <div {...stylex.attrs(s.row)}>
              <code {...stylex.attrs(s.code)}>{pending().userCode}</code>
              <Button size="icon-sm" variant="ghost" title="Copy code" onClick={() => copy(pending().userCode)}>
                <Show when={copied()} fallback={<CopyIcon size={14} />}><CheckIcon size={14} /></Show>
              </Button>
              <span {...stylex.attrs(s.grow)} />
              <Button
                size="sm"
                onClick={() => {
                  copy(pending().userCode)
                  window.open(pending().verificationUri, "_blank", "noopener")
                }}
              >
                Copy code and open GitHub <ExternalIcon size={14} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void githubAccount.cancel(sync)}>Cancel</Button>
            </div>
            <div {...stylex.attrs(s.subtle)}>Waiting for you to approve on GitHub. The code expires in {minutesLeft(pending().expiresAt)} min.</div>
          </div>
        )}
      </Show>
      <Show when={githubAccount.error()}>{(text) => <div {...stylex.attrs(s.error)}>{text()}</div>}</Show>
    </>
  )
}
