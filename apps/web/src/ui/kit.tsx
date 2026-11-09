import * as stylex from "@stylexjs/stylex"
import type { StyleXStyles } from "@stylexjs/stylex"
import { createEffect, createSignal, createUniqueId, For, merge, omit, Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { color, font, radius } from "../theme/tokens.stylex.ts"
import { CheckIcon, SearchIcon } from "./icons.tsx"

/*
 * A small component kit with shadcn's API shape, restyled to stay out of the
 * way. Every component takes an `sx` prop for StyleX overrides.
 */

const focusRing = `0 0 0 2px ${color.ring}`

const s = stylex.create({
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 28,
    paddingInline: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: { default: color.panel, ":hover": color.hover },
    color: color.fg,
    fontFamily: "inherit",
    fontSize: font.md,
    fontWeight: 500,
    lineHeight: 1,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": focusRing },
    transitionProperty: "background-color, border-color, color",
    transitionDuration: "80ms",
    opacity: { default: 1, ":disabled": 0.5 },
    pointerEvents: { default: "auto", ":disabled": "none" }
  },
  primary: {
    backgroundColor: { default: color.accent, ":hover": color.accent },
    borderColor: color.accent,
    color: color.accentFg,
    filter: { default: "none", ":hover": "brightness(1.08)" }
  },
  ghost: {
    backgroundColor: { default: "transparent", ":hover": color.hover },
    borderColor: "transparent",
    color: { default: color.fgMuted, ":hover": color.fg }
  },
  danger: { color: color.danger },
  sm: { height: 24, paddingInline: 8, fontSize: font.sm, gap: 4 },
  icon: { width: 28, paddingInline: 0 },
  iconSm: { width: 24, height: 24, paddingInline: 0 },

  input: {
    height: 30,
    width: "100%",
    paddingInline: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: color.border, ":focus": color.borderStrong },
    backgroundColor: color.panel,
    color: color.fg,
    fontFamily: "inherit",
    fontSize: font.md,
    outline: "none",
    boxShadow: { default: "none", ":focus": focusRing },
    "::placeholder": { color: color.fgSubtle }
  },
  bare: {
    width: "100%",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: color.fg,
    fontFamily: "inherit",
    outline: "none",
    resize: "none",
    "::placeholder": { color: color.fgSubtle }
  },

  kbd: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 16,
    height: 16,
    paddingInline: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.subtle,
    color: color.fgMuted,
    fontFamily: font.sans,
    fontSize: 10,
    fontWeight: 500,
    lineHeight: 1
  },

  avatar: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderRadius: "50%",
    overflow: "hidden",
    color: "#fff",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    userSelect: "none"
  },
  avatarEmpty: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.fgSubtle,
    backgroundColor: "transparent"
  },
  avatarImg: { width: "100%", height: "100%", objectFit: "cover" },

  dialog: {
    marginTop: "12vh",
    marginInline: "auto",
    padding: 0,
    width: "min(640px, calc(100vw - 32px))",
    maxHeight: "76vh",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.panel,
    color: color.fg,
    boxShadow: `0 16px 48px ${color.shadow}, 0 2px 6px ${color.shadow}`,
    outline: "none",
    "::backdrop": { backgroundColor: color.overlay }
  },

  popover: {
    position: "fixed",
    inset: "auto",
    margin: 0,
    padding: 4,
    minWidth: 200,
    maxWidth: 320,
    maxHeight: 340,
    overflowY: "auto",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.panel,
    color: color.fg,
    boxShadow: `0 8px 28px ${color.shadow}, 0 1px 3px ${color.shadow}`,
    fontSize: font.md
  },
  pickerSearch: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingInline: 8,
    paddingBottom: 4,
    marginBottom: 4,
    height: 32,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
    color: color.fgSubtle
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    height: 30,
    paddingInline: 8,
    borderRadius: radius.md,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: color.fg,
    fontFamily: "inherit",
    fontSize: font.md,
    textAlign: "left",
    cursor: "pointer"
  },
  optionActive: { backgroundColor: color.hover },
  optionLabel: { flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  optionHint: { color: color.fgSubtle, fontSize: font.sm },
  empty: { paddingBlock: 10, paddingInline: 8, color: color.fgSubtle, fontSize: font.sm },
  check: { color: color.fgMuted, display: "inline-flex" },
  checkbox: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.borderStrong,
    color: color.accentFg
  },
  checkboxOn: { backgroundColor: color.accent, borderColor: color.accent },

  toaster: {
    position: "fixed",
    right: 16,
    bottom: 16,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    zIndex: 1000
  },
  toast: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    maxWidth: 360,
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.panel,
    color: color.fg,
    boxShadow: `0 8px 28px ${color.shadow}`,
    fontSize: font.md
  },
  toastDot: { width: 8, height: 8, borderRadius: "50%", backgroundColor: color.danger, flexShrink: 0 }
})

type Sx = StyleXStyles | false | undefined | null

// ---------------------------------------------------------------- Button

export type ButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "style"> & {
  variant?: "default" | "primary" | "ghost" | "danger"
  size?: "md" | "sm" | "icon" | "icon-sm"
  sx?: Sx
}

export const Button = (props: ButtonProps) => {
  const rest = omit(props, "variant", "size", "sx")
  return (
    <button
      type="button"
      {...rest}
      {...stylex.attrs(
        s.button,
        props.variant === "primary" && s.primary,
        props.variant === "ghost" && s.ghost,
        props.variant === "danger" && [s.ghost, s.danger],
        props.size === "sm" && s.sm,
        props.size === "icon" && s.icon,
        props.size === "icon-sm" && [s.sm, s.iconSm],
        props.sx
      )}
    />
  )
}

// ---------------------------------------------------------------- Inputs

export const Input = (props: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "class" | "style"> & { sx?: Sx }) => {
  const rest = omit(props, "sx")
  return <input {...rest} {...stylex.attrs(s.input, props.sx)} />
}

/** Borderless text field that grows with its content, for titles and descriptions. */
export const AutoTextarea = (
  props: Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "class" | "style" | "ref"> & {
    sx?: Sx
    ref?: (el: HTMLTextAreaElement) => void
  }
) => {
  const rest = omit(props, "sx", "ref", "onInput")
  const fit = (el: HTMLTextAreaElement) => {
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }
  return (
    <textarea
      rows={1}
      {...rest}
      ref={(el) => {
        props.ref?.(el)
        requestAnimationFrame(() => fit(el))
      }}
      onInput={(e) => {
        fit(e.currentTarget)
        const handler = props.onInput
        if (typeof handler === "function") handler(e)
      }}
      {...stylex.attrs(s.bare, props.sx)}
    />
  )
}

export const Kbd = (props: { children: JSX.Element; sx?: Sx }) => (
  <kbd {...stylex.attrs(s.kbd, props.sx)}>{props.children}</kbd>
)

// ---------------------------------------------------------------- Avatar

const avatarColors = ["#7c6f64", "#5b7083", "#6d7a5b", "#8a6a7d", "#5f7a78", "#7a6a55", "#6b6b8a"]
const hashHue = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

export const Avatar = (props: { name?: string | null; src?: string | null; size?: number; sx?: Sx }) => {
  const size = () => props.size ?? 18
  // Fall back to initials when the image fails (offline, or a stale URL).
  const [failed, setFailed] = createSignal<string | null>(null)
  const initials = () =>
    (props.name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("")
  return (
    <Show
      when={props.name}
      fallback={
        <span
          {...stylex.attrs(s.avatar, s.avatarEmpty, props.sx)}
          style={{ width: `${size()}px`, height: `${size()}px` }}
        />
      }
    >
      <span
        {...stylex.attrs(s.avatar, props.sx)}
        style={{
          width: `${size()}px`,
          height: `${size()}px`,
          "font-size": `${Math.round(size() * 0.42)}px`,
          "background-color": avatarColors[hashHue(props.name ?? "") % avatarColors.length]
        }}
        title={props.name ?? ""}
      >
        <Show when={props.src && props.src !== failed() ? props.src : null} fallback={initials()}>
          {(src) => <img src={src()} alt="" onError={() => setFailed(src())} {...stylex.attrs(s.avatarImg)} />}
        </Show>
      </span>
    </Show>
  )
}

// ---------------------------------------------------------------- Dialog

/** A modal built on `<dialog>`: focus trapping, Escape and the backdrop come from the browser. */
export const Dialog = (props: { open: boolean; onClose: () => void; children: JSX.Element; sx?: Sx; label: string }) => {
  let el: HTMLDialogElement | undefined
  createEffect(
    () => props.open,
    (open) => {
      if (!el) return
      if (open && !el.open) el.showModal()
      if (!open && el.open) el.close()
    }
  )
  return (
    <dialog
      ref={el}
      aria-label={props.label}
      closedby="any"
      onClose={() => props.onClose()}
      {...stylex.attrs(s.dialog, props.sx)}
    >
      <Show when={props.open}>{props.children}</Show>
    </dialog>
  )
}

// ---------------------------------------------------------------- Popover

export type TriggerAttrs = { popovertarget: string; ref: (el: HTMLElement) => void; "aria-expanded": "true" | "false" }

export interface PopoverApi {
  close(): void
}

/**
 * Anchored popover on the native Popover API: light dismiss, Escape and top
 * layer stacking (it works inside modals) come for free.
 */
export const Popover = (props: {
  trigger: (attrs: TriggerAttrs) => JSX.Element
  children: (api: PopoverApi) => JSX.Element
  onOpen?: (el: HTMLElement) => void
  align?: "start" | "end"
  sx?: Sx
}) => {
  const id = createUniqueId()
  const [open, setOpen] = createSignal(false)
  let anchor: HTMLElement | undefined
  let pop: HTMLElement | undefined

  const place = () => {
    if (!anchor || !pop) return
    const a = anchor.getBoundingClientRect()
    const p = pop.getBoundingClientRect()
    const gap = 4
    let top = a.bottom + gap
    if (top + p.height > window.innerHeight - 8) top = Math.max(8, a.top - gap - p.height)
    let left = props.align === "end" ? a.right - p.width : a.left
    left = Math.min(Math.max(8, left), window.innerWidth - p.width - 8)
    pop.style.top = `${top}px`
    pop.style.left = `${left}px`
  }

  const api: PopoverApi = { close: () => pop?.hidePopover() }

  return (
    <>
      {props.trigger({
        popovertarget: id,
        ref: (el) => (anchor = el),
        // A getter, so only the attribute updates; reading it eagerly would rebuild the trigger.
        get "aria-expanded"() {
          return open() ? "true" : "false"
        }
      })}
      <div
        id={id}
        popover="auto"
        ref={(el) => (pop = el)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onToggle={(e) => {
          const isOpen = e.newState === "open"
          setOpen(isOpen)
          if (isOpen) {
            place()
            props.onOpen?.(e.currentTarget)
          } else {
            // The content unmounts on close, which would drop focus to <body>. Hand it back to the trigger.
            const active = document.activeElement
            if (!active || active === document.body || pop?.contains(active)) anchor?.focus()
          }
        }}
        {...stylex.attrs(s.popover, props.sx)}
      >
        <Show when={open()}>{props.children(api)}</Show>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Picker

export interface PickerItem<V> {
  value: V
  label: string
  /** A render function, so the icon is created inside the list that shows it. */
  icon?: () => JSX.Element
  hint?: string
}

/**
 * The command-menu style list used for every property: type to filter, arrow
 * keys to move, Enter to pick. Single select closes on pick; multi select stays open.
 */
export const PickerList = <V,>(props: {
  items: ReadonlyArray<PickerItem<V>>
  selected: ReadonlyArray<V>
  multiple?: boolean
  placeholder: string
  onPick: (value: V) => void
  onCreate?: (query: string) => void
  close: () => void
}) => {
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(0)
  const filtered = () => {
    const q = query().trim().toLowerCase()
    return q ? props.items.filter((i) => i.label.toLowerCase().includes(q)) : props.items
  }
  const canCreate = () => !!props.onCreate && query().trim() !== "" &&
    !props.items.some((i) => i.label.toLowerCase() === query().trim().toLowerCase())
  const pick = (item: PickerItem<V>) => {
    props.onPick(item.value)
    if (!props.multiple) props.close()
  }
  return (
    <div
      onKeyDown={(e) => {
        const count = filtered().length
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setActive((i) => (count ? (i + 1) % count : 0))
        } else if (e.key === "ArrowUp") {
          e.preventDefault()
          setActive((i) => (count ? (i - 1 + count) % count : 0))
        } else if (e.key === "Enter") {
          e.preventDefault()
          const item = filtered()[active()]
          if (item) pick(item)
          else if (canCreate()) props.onCreate!(query().trim())
        }
      }}
    >
      <div {...stylex.attrs(s.pickerSearch)}>
        <SearchIcon size={14} />
        <input
          ref={(el) => requestAnimationFrame(() => el.focus())}
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value)
            setActive(0)
          }}
          placeholder={props.placeholder}
          {...stylex.attrs(s.bare)}
        />
      </div>
      <For each={filtered()}>
        {(item, index) => {
          const isSelected = () => props.selected.includes(item.value)
          return (
            <button
              type="button"
              onClick={() => pick(item)}
              onMouseMove={() => setActive(index())}
              {...stylex.attrs(s.option, active() === index() && s.optionActive)}
            >
              <Show when={props.multiple}>
                <span {...stylex.attrs(s.checkbox, isSelected() && s.checkboxOn)}>
                  <Show when={isSelected()}>
                    <CheckIcon size={10} />
                  </Show>
                </span>
              </Show>
              {item.icon?.()}
              <span {...stylex.attrs(s.optionLabel)}>{item.label}</span>
              <Show when={item.hint}>
                <span {...stylex.attrs(s.optionHint)}>{item.hint}</span>
              </Show>
              <Show when={!props.multiple && isSelected()}>
                <span {...stylex.attrs(s.check)}>
                  <CheckIcon size={14} />
                </span>
              </Show>
            </button>
          )
        }}
      </For>
      <Show when={canCreate()}>
        <button type="button" onClick={() => props.onCreate!(query().trim())} {...stylex.attrs(s.option)}>
          <span {...stylex.attrs(s.optionLabel)}>Create “{query().trim()}”</span>
        </button>
      </Show>
      <Show when={filtered().length === 0 && !canCreate()}>
        <div {...stylex.attrs(s.empty)}>No results</div>
      </Show>
    </div>
  )
}

/** A trigger plus a PickerList in a popover: the building block for property pickers. */
export const Picker = <V,>(props: {
  trigger: (attrs: TriggerAttrs) => JSX.Element
  items: ReadonlyArray<PickerItem<V>>
  selected: ReadonlyArray<V>
  multiple?: boolean
  placeholder: string
  onPick: (value: V) => void
  onCreate?: (query: string) => void
  align?: "start" | "end"
}) => {
  const listProps = omit(props, "trigger", "align")
  return (
    <Popover trigger={props.trigger} align={props.align ?? "start"}>
      {(api) => <PickerList {...merge(listProps, { close: api.close })} />}
    </Popover>
  )
}

// ---------------------------------------------------------------- Toasts

export const Toaster = (props: { errors: ReadonlyArray<{ id: string; message: string }>; onDismiss: (id: string) => void }) => (
  <div {...stylex.attrs(s.toaster)} role="status">
    <For each={props.errors}>
      {(error) => (
        <div {...stylex.attrs(s.toast)} onClick={() => props.onDismiss(error.id)}>
          <span {...stylex.attrs(s.toastDot)} />
          {error.message}
        </div>
      )}
    </For>
  </div>
)
