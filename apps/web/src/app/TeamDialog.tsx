import { isValidTeamKey, uuidv7 } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { useNavigate } from "@solidjs/router"
import { createEffect, createSignal, createUniqueId, Show, useContext } from "solid-js"
import { KeyScope, useCommands } from "../keys/solid.tsx"
import { keyOwner, suggestTeamKey, teamHref } from "../lib/select.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { font } from "../theme/tokens.stylex.ts"
import { Button } from "../ui/button.tsx"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog.tsx"
import { UsersIcon } from "../ui/icons.tsx"
import { Input } from "../ui/input.tsx"
import { Label } from "../ui/label.tsx"
import { Sync } from "./context.ts"

const s = stylex.create({
  dialog: { gap: 16 },
  form: { display: "flex", flexDirection: "column", gap: 16 },
  title: { display: "flex", alignItems: "center", gap: 8 },
  field: { display: "flex", flexDirection: "column", gap: 8 },
  hint: { color: colors.mutedForeground, fontSize: "0.75rem" },
  error: { color: colors.destructive, fontSize: "0.75rem" },
  keyRow: { display: "flex", alignItems: "center", gap: 10 },
  keyInput: { width: 90, flexShrink: 0, fontFamily: font.mono, letterSpacing: "0.06em", textTransform: "uppercase" }
})

/**
 * "New team": a name and the key its issues use (WEB-12). The team starts
 * with the default workflow and labels, and its creator in it.
 */
export const TeamDialog = (props: { open: boolean; onClose: () => void }) => {
  const sync = useContext(Sync)
  const navigate = useNavigate()
  const [name, setName] = createSignal("")
  const [key, setKey] = createSignal("")
  /** The key follows the name until the user edits it. */
  const [keyEdited, setKeyEdited] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  createEffect(
    () => props.open,
    (open) => {
      if (!open) return
      setName("")
      setKey("")
      setKeyEdited(false)
      setError(null)
    }
  )

  const effectiveKey = () =>
    keyEdited() ? key().trim().toUpperCase() : name().trim() ? suggestTeamKey(sync.state, name()) : ""
  const keyProblem = () => {
    const k = effectiveKey()
    if (!k) return null
    if (!isValidTeamKey(k)) return "2–5 capital letters or digits, starting with a letter."
    const owner = keyOwner(sync.state, k)
    return owner ? `${k} is used by ${owner}.` : null
  }

  const submit = () => {
    const trimmed = name().trim()
    if (!trimmed) return setError("A team needs a name.")
    if (keyProblem()) return setError(`Key: ${keyProblem()}`)
    const clash = Object.values(sync.state.teams).find((t) => t.name.toLowerCase() === trimmed.toLowerCase())
    if (clash) return setError(`${clash.name} already exists.`)
    const id = uuidv7()
    const teamKey = effectiveKey()
    sync.mutate({ _tag: "TeamCreate", id, key: teamKey, name: trimmed })
    props.onClose()
    navigate(teamHref({ key: teamKey }))
  }

  useCommands([
    { id: "team.dialog.submit", title: "Create team", group: "Team", keys: ["mod+enter"], scope: "team-dialog", run: submit }
  ])

  const ids = { name: createUniqueId(), key: createUniqueId() }

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent xstyle={s.dialog}>
        <KeyScope name="team-dialog" blocking>
          <DialogHeader>
            <DialogTitle xstyle={s.title}>
              <UsersIcon size={16} /> New team
            </DialogTitle>
            <DialogDescription>A team has its own workflow, labels and projects. You join it; anyone can join later.</DialogDescription>
          </DialogHeader>
          <form
            {...stylex.attrs(s.form)}
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <div {...stylex.attrs(s.field)}>
              <Label for={ids.name}>Name</Label>
              <div {...stylex.attrs(s.keyRow)}>
                <Input
                  id={ids.name}
                  ref={(el: HTMLInputElement | null) => el && requestAnimationFrame(() => el.focus())}
                  placeholder="e.g. Mobile"
                  maxlength={60}
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                />
                <Input
                  id={ids.key}
                  aria-label="Key"
                  placeholder="KEY"
                  maxlength={5}
                  value={effectiveKey()}
                  onInput={(e) => {
                    setKeyEdited(true)
                    setKey(e.currentTarget.value.toUpperCase())
                  }}
                  xstyle={s.keyInput}
                />
              </div>
              <Show when={keyProblem()} fallback={<span {...stylex.attrs(s.hint)}>Issues without a project are numbered {effectiveKey() || "KEY"}-1, {effectiveKey() || "KEY"}-2…</span>}>
                {(problem) => <span {...stylex.attrs(s.error)}>{problem()}</span>}
              </Show>
            </div>
            <Show when={error()}>{(e) => <div role="alert" {...stylex.attrs(s.error)}>{e()}</div>}</Show>
            <DialogFooter>
              <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
              <Button type="submit" disabled={!name().trim() || keyProblem() !== null}>Create team</Button>
            </DialogFooter>
          </form>
        </KeyScope>
      </DialogContent>
    </Dialog>
  )
}
