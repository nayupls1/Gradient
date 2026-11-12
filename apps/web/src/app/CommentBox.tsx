import * as stylex from "@stylexjs/stylex"
import { createSignal, onSettled, Show, useContext } from "solid-js"
import { colors } from "../lib/tokens.stylex.ts"
import { Button } from "../ui/button.tsx"
import { Textarea } from "../ui/textarea.tsx"
import { Sync } from "./context.ts"
import { GithubConnect } from "./GithubConnect.tsx"
import { githubAccount } from "./githubAccount.ts"
import { UserAvatar } from "./UserAvatar.tsx"

/*
 * Write a comment that goes to GitHub as your own account: issue comments,
 * pull request comments, inline review comments. Without an account it offers
 * to connect one. ⌘/Ctrl+Enter sends.
 */

const s = stylex.create({
  box: { display: "flex", flexDirection: "column", gap: 8 },
  input: { minHeight: 72, fontSize: 14, lineHeight: 1.55, backgroundColor: colors.background },
  footer: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  as: { display: "inline-flex", alignItems: "center", gap: 6, color: colors.mutedForeground, fontSize: "0.75rem" },
  grow: { flexGrow: 1 },
  error: { color: colors.destructive, fontSize: "0.75rem" },
  connect: { display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start", color: colors.mutedForeground, fontSize: "0.8125rem" }
})

const messageOf = (e: unknown) => (e as { message?: string }).message ?? String(e)

export const CommentBox = (props: {
  placeholder?: string
  submitLabel?: string
  /** Another way to send the same text (inline comments: add to the review, or comment now). */
  secondary?: { label: string; run: (body: string) => Promise<void> | void }
  onSubmit: (body: string) => Promise<void> | void
  onCancel?: () => void
  autofocus?: boolean
  inputRef?: (el: HTMLTextAreaElement) => void
}) => {
  const sync = useContext(Sync)
  const [body, setBody] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const acting = () => githubAccount.account()?.actingAs ?? null
  onSettled(() => void githubAccount.ensure(sync))

  const send = async (run: (body: string) => Promise<void> | void) => {
    const text = body()
    if (text.trim() === "" || sending()) return
    setSending(true)
    setError(null)
    try {
      await run(text)
      setBody("")
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <Show
      when={acting()}
      fallback={
        <div {...stylex.attrs(s.connect)}>
          <span>Comments go to GitHub as you. Connect your GitHub account to write one here.</span>
          <GithubConnect label="Connect GitHub to comment" compact />
          <Show when={props.onCancel}>
            {(cancel) => <Button size="xs" variant="ghost" onClick={() => cancel()()}>Cancel</Button>}
          </Show>
        </div>
      }
    >
      {(who) => (
        <div {...stylex.attrs(s.box)}>
          <Textarea
            ref={(el: HTMLTextAreaElement) => {
              props.inputRef?.(el)
              if (props.autofocus) requestAnimationFrame(() => el.focus({ preventScroll: true }))
            }}
            aria-label={props.placeholder ?? "Comment"}
            placeholder={props.placeholder ?? "Leave a comment… (markdown)"}
            value={body()}
            disabled={sending()}
            onInput={(e) => setBody(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void send(props.onSubmit)
              } else if (e.key === "Escape" && props.onCancel) {
                e.preventDefault()
                props.onCancel()
              }
            }}
            xstyle={s.input}
          />
          <div {...stylex.attrs(s.footer)}>
            <span {...stylex.attrs(s.as)} title={who().via === "workspace" ? "Through the workspace's GitHub connection, which is yours" : undefined}>
              <UserAvatar name={who().login} src={who().avatarUrl} size={16} />
              as @{who().login}
            </span>
            <span {...stylex.attrs(s.grow)} />
            <Show when={props.onCancel}>
              {(cancel) => <Button size="sm" variant="ghost" onClick={() => cancel()()}>Cancel</Button>}
            </Show>
            <Show when={props.secondary}>
              {(secondary) => (
                <Button size="sm" variant="outline" disabled={sending() || body().trim() === ""} onClick={() => void send(secondary().run)}>
                  {secondary().label}
                </Button>
              )}
            </Show>
            <Button size="sm" disabled={sending() || body().trim() === ""} title="⌘↵" onClick={() => void send(props.onSubmit)}>
              {sending() ? "Sending…" : props.submitLabel ?? "Comment"}
            </Button>
          </div>
          <Show when={error()}>{(text) => <div {...stylex.attrs(s.error)}>{text()}</div>}</Show>
        </div>
      )}
    </Show>
  )
}
