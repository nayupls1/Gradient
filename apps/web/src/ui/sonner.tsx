import { createSignal, For, omit, onSettled, Show, untrack, type Accessor } from "solid-js"
import type { JSX } from "@solidjs/web"
import { Toast as ToastPrimitive } from "base-ui-solidjs/toast"
import { CircleCheck, Info, Loader2, OctagonX, TriangleAlert, X } from "lucide"
import { Icon } from "./icon"
import * as stylex from "@stylexjs/stylex"
import { colors, radius } from "../lib/tokens.stylex"
import { animate } from "../lib/animate"
import { sonnerToastMarker } from "../lib/markers/sonner.stylex"
import { cx } from "../lib/utils"

// Port of shadcn/ui's base-vega `sonner` (see the Tailwind variant). shadcn's `sonner` wraps the React-only `sonner` package. This is sonner's API (`toast()`,
// `<Toaster />`) and look, built on base-ui-solidjs's toast manager, with shadcn's overrides
// (popover colors, `--radius`, lucide icons). Base UI provides the stacking data (`--toast-index`,
// `--toast-offset-y`, `--toast-frontmost-height`, `data-expanded`, `data-limited`) and swipe-to-dismiss.

// ---------------------------------------------------------------------------------------------
// toast()

type ToastTypes = "normal" | "action" | "success" | "info" | "warning" | "error" | "loading" | "default"

type Action = {
  label: JSX.Element
  onClick: (event: MouseEvent) => void
  actionButtonStyle?: JSX.CSSProperties
}

type ToastClassnames = {
  toast?: string
  title?: string
  description?: string
  loader?: string
  closeButton?: string
  cancelButton?: string
  actionButton?: string
  success?: string
  error?: string
  info?: string
  warning?: string
  loading?: string
  default?: string
  content?: string
  icon?: string
}

type ExternalToast = {
  id?: string | number
  description?: JSX.Element | (() => JSX.Element)
  duration?: number | undefined
  icon?: JSX.Element
  action?: Action | JSX.Element
  cancel?: Action | JSX.Element
  closeButton?: boolean
  richColors?: boolean
  invert?: boolean
  dismissible?: boolean
  important?: boolean
  unstyled?: boolean
  onDismiss?: (toast: ToastT) => void
  onAutoClose?: (toast: ToastT) => void
  class?: string
  xstyle?: stylex.StyleXStyles
  classNames?: ToastClassnames
  descriptionClassName?: string
  style?: JSX.CSSProperties
  actionButtonStyle?: JSX.CSSProperties
  cancelButtonStyle?: JSX.CSSProperties
  testId?: string
}

type ToastT = ExternalToast & {
  id: string
  title?: JSX.Element | (() => JSX.Element)
  type: ToastTypes
  jsx?: JSX.Element
  promise?: boolean
}

type SonnerData = { toast: ToastT; dismissedByUser?: boolean }

type PromiseState<Value> = JSX.Element | ((value: Value) => JSX.Element | Promise<JSX.Element>)

type PromiseData<Value> = ExternalToast & {
  loading?: JSX.Element
  success?: PromiseState<Value> | ((value: Value) => ExternalToast & { message?: JSX.Element })
  error?: PromiseState<unknown>
  description?: PromiseState<unknown>
  finally?: () => void | Promise<void>
}

const manager = ToastPrimitive.createToastManager<SonnerData>()
let counter = 0

const resolve = (value: JSX.Element | (() => JSX.Element)) => (typeof value === "function" ? (value as () => JSX.Element)() : value)

function create(type: ToastTypes, title: JSX.Element | (() => JSX.Element) | undefined, data?: ExternalToast): string {
  const id = data?.id != null ? String(data.id) : `sonner-${++counter}`
  const t: ToastT = { ...data, id, title, type }
  const options = {
    id,
    type,
    title: resolve(title),
    description: data?.description != null ? resolve(data.description) : undefined,
    timeout: type === "loading" ? 0 : data?.duration,
    priority: data?.important ? ("high" as const) : ("low" as const),
    data: { toast: t },
    onClose: () => {
      if (closedByUser.delete(id)) t.onDismiss?.(t)
      else t.onAutoClose?.(t)
    },
    onRemove: () => {
      liveIds.delete(id)
    },
  }
  if (liveIds.has(id)) {
    manager.update(id, options)
  } else {
    liveIds.add(id)
    manager.add(options)
  }
  return id
}

/** Ids of toasts that haven't been removed yet (re-using one updates that toast, like sonner). */
const liveIds = new Set<string>()
/** Ids closed by the user (close/action/cancel button, `toast.dismiss`) → `onDismiss`, else `onAutoClose`. */
const closedByUser = new Set<string>()

function dismissByUser(id: string) {
  closedByUser.add(id)
  manager.close(id)
}

function toastFunction(message: JSX.Element | (() => JSX.Element), data?: ExternalToast) {
  return create("default", message, data)
}

/**
 * sonner's `toast()`: `toast("Saved")`, `toast.success(...)`, `toast.promise(...)`, `toast.dismiss(id)`.
 * Each package has its own toast manager: render this package's `<Toaster />` once.
 */
const toast = Object.assign(toastFunction, {
  success: (message: JSX.Element | (() => JSX.Element), data?: ExternalToast) => create("success", message, data),
  info: (message: JSX.Element | (() => JSX.Element), data?: ExternalToast) => create("info", message, data),
  warning: (message: JSX.Element | (() => JSX.Element), data?: ExternalToast) => create("warning", message, data),
  error: (message: JSX.Element | (() => JSX.Element), data?: ExternalToast) => create("error", message, data),
  message: (message: JSX.Element | (() => JSX.Element), data?: ExternalToast) => create("default", message, data),
  loading: (message: JSX.Element | (() => JSX.Element), data?: ExternalToast) => create("loading", message, data),
  custom: (jsx: (id: string) => JSX.Element, data?: ExternalToast) => {
    const id = data?.id != null ? String(data.id) : `sonner-${++counter}`
    return create("default", () => jsx(id), { ...data, id, unstyled: data?.unstyled ?? true })
  },
  dismiss: (id?: string | number) => {
    if (id == null) {
      for (const live of [...liveIds]) dismissByUser(live)
    } else {
      dismissByUser(String(id))
    }
    return id
  },
  promise: <Value,>(promise: Promise<Value> | (() => Promise<Value>), data?: PromiseData<Value>) => {
    const p = typeof promise === "function" ? promise() : promise
    if (!data) return { unwrap: () => p }
    const id = create("loading", data.loading, { ...data, description: undefined, duration: undefined })
    const settle = async (type: "success" | "error", state: unknown, value: unknown) => {
      const resolved = typeof state === "function" ? await (state as (v: unknown) => unknown)(value) : state
      if (resolved == null) {
        manager.close(id)
        return
      }
      const isOptions = typeof resolved === "object" && !(resolved instanceof Node) && "message" in (resolved as object)
      const options = isOptions ? (resolved as ExternalToast & { message?: JSX.Element }) : undefined
      const description = typeof data.description === "function" ? await data.description(value) : data.description
      create(type, options ? options.message : (resolved as JSX.Element), {
        ...data,
        ...options,
        id,
        description: options?.description ?? description,
        duration: options?.duration ?? data.duration,
      })
    }
    p.then(
      (value) => settle("success", data.success, value),
      (error) => settle("error", data.error, error),
    ).finally(() => data.finally?.())
    return Object.assign(id, { unwrap: () => p })
  },
  getToasts: () => [...liveIds],
})

// ---------------------------------------------------------------------------------------------
// <Toaster />

type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top-center" | "bottom-center"
type Offset = string | number | { top?: string | number; right?: string | number; bottom?: string | number; left?: string | number }

type ToastIcons = {
  success?: JSX.Element
  info?: JSX.Element
  warning?: JSX.Element
  error?: JSX.Element
  loading?: JSX.Element
  close?: JSX.Element
}

type ToasterProps = {
  id?: string
  invert?: boolean
  theme?: "light" | "dark" | "system"
  position?: Position
  hotkey?: string[]
  richColors?: boolean
  expand?: boolean
  duration?: number
  gap?: number
  visibleToasts?: number
  closeButton?: boolean
  toastOptions?: {
    class?: string
    xstyle?: stylex.StyleXStyles
    closeButton?: boolean
    descriptionClassName?: string
    style?: JSX.CSSProperties
    cancelButtonStyle?: JSX.CSSProperties
    actionButtonStyle?: JSX.CSSProperties
    duration?: number
    unstyled?: boolean
    classNames?: ToastClassnames
    closeButtonAriaLabel?: string
  }
  class?: string
  xstyle?: stylex.StyleXStyles
  style?: JSX.CSSProperties
  offset?: Offset
  mobileOffset?: Offset
  dir?: "rtl" | "ltr" | "auto"
  icons?: ToastIcons
  containerAriaLabel?: string
}

const VIEWPORT_OFFSET = "24px"
const MOBILE_VIEWPORT_OFFSET = "16px"

function offsetVars(offset: Offset | undefined, fallback: string, prefix: string): JSX.CSSProperties {
  const px = (v: string | number) => (typeof v === "number" ? `${v}px` : v)
  const sides = ["top", "right", "bottom", "left"] as const
  const vars: Record<string, string> = {}
  for (const side of sides) {
    const value = offset == null ? fallback : typeof offset === "object" ? (offset[side] ?? fallback) : offset
    vars[`--${prefix}-${side}`] = px(value)
  }
  return vars as JSX.CSSProperties
}

/** Tracks the page's theme: the `dark` class on <html> (shadcn's convention), else the OS preference. */
function useSystemTheme(): Accessor<"light" | "dark"> {
  const read = (): "light" | "dark" => {
    if (typeof document === "undefined") return "light"
    const root = document.documentElement
    if (root.classList.contains("dark")) return "dark"
    if (root.classList.contains("light") || root.style.colorScheme === "light") return "light"
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  }
  const [theme, setTheme] = createSignal<"light" | "dark">(read())
  onSettled(() => {
    const observer = new MutationObserver(() => setTheme(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] })
    return () => observer.disconnect()
  })
  return theme
}

const MOBILE = "@media (max-width: 600px)"
const COLLAPSED_TRANSFORM =
  "translateX(var(--toast-swipe-movement-x)) translateY(calc(var(--toast-swipe-movement-y) + var(--lift-amount) * var(--toast-index))) scale(calc(1 - var(--toast-index) * 0.05))"
const EXPANDED_TRANSFORM =
  "translateX(var(--toast-swipe-movement-x)) translateY(calc(var(--toast-swipe-movement-y) + var(--lift) * (var(--toast-offset-y) + var(--toast-index) * var(--gap))))"
const HIDDEN_TRANSFORM = "translateY(calc(var(--lift) * -100%))"
const SHADOW = "0px 4px 12px rgba(0, 0, 0, 0.1)"

const styles = stylex.create({
  viewport: {
    position: "fixed",
    zIndex: 999999999,
    margin: 0,
    boxSizing: "border-box",
    width: { default: "var(--width)", [MOBILE]: "auto" },
    listStyleType: "none",
    padding: 0,
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji",
    outlineStyle: "none",
    // shadcn's overrides of sonner's `--normal-*` colors.
    "--normal-bg": colors.popover,
    "--normal-text": colors.popoverForeground,
    "--normal-border": colors.border,
    "--border-radius": radius.lg,
    "--gray2": "hsl(0, 0%, 97.3%)",
    "--gray5": "hsl(0, 0%, 90.9%)",
  },
  viewportRight: {
    right: { default: "var(--offset-right)", [MOBILE]: "var(--mobile-offset-right)" },
    left: { default: null, [MOBILE]: "var(--mobile-offset-left)" },
  },
  viewportLeft: {
    left: { default: "var(--offset-left)", [MOBILE]: "var(--mobile-offset-left)" },
    right: { default: null, [MOBILE]: "var(--mobile-offset-right)" },
  },
  viewportCenter: {
    left: { default: "50%", [MOBILE]: "var(--mobile-offset-left)" },
    right: { default: null, [MOBILE]: "var(--mobile-offset-right)" },
    translate: { default: "-50% 0", [MOBILE]: "none" },
  },
  viewportTop: {
    top: { default: "var(--offset-top)", [MOBILE]: "var(--mobile-offset-top)" },
  },
  viewportBottom: {
    bottom: { default: "var(--offset-bottom)", [MOBILE]: "var(--mobile-offset-bottom)" },
  },
  themeLight: {
    "--success-bg": "hsl(143, 85%, 96%)",
    "--success-border": "hsl(145, 92%, 87%)",
    "--success-text": "hsl(140, 100%, 27%)",
    "--info-bg": "hsl(208, 100%, 97%)",
    "--info-border": "hsl(221, 91%, 93%)",
    "--info-text": "hsl(210, 92%, 45%)",
    "--warning-bg": "hsl(49, 100%, 97%)",
    "--warning-border": "hsl(49, 91%, 84%)",
    "--warning-text": "hsl(31, 92%, 45%)",
    "--error-bg": "hsl(359, 100%, 97%)",
    "--error-border": "hsl(359, 100%, 94%)",
    "--error-text": "hsl(360, 100%, 45%)",
  },
  themeDark: {
    "--normal-bg-hover": "hsl(0, 0%, 12%)",
    "--normal-border-hover": "hsl(0, 0%, 25%)",
    "--success-bg": "hsl(150, 100%, 6%)",
    "--success-border": "hsl(147, 100%, 12%)",
    "--success-text": "hsl(150, 86%, 65%)",
    "--info-bg": "hsl(215, 100%, 6%)",
    "--info-border": "hsl(223, 43%, 17%)",
    "--info-text": "hsl(216, 87%, 65%)",
    "--warning-bg": "hsl(64, 100%, 6%)",
    "--warning-border": "hsl(60, 100%, 9%)",
    "--warning-text": "hsl(46, 87%, 65%)",
    "--error-bg": "hsl(358, 76%, 10%)",
    "--error-border": "hsl(357, 89%, 16%)",
    "--error-text": "hsl(358, 100%, 81%)",
  },
  toast: {
    pointerEvents: { default: "auto", ":is([data-limited])": "none" },
    position: "absolute",
    zIndex: "calc(1000 - var(--toast-index))",
    boxSizing: "border-box",
    outlineStyle: "none",
    overflowWrap: "anywhere",
    userSelect: "none",
    "--lift-amount": "calc(var(--lift) * var(--gap))",
    transitionProperty: "transform, opacity, height, box-shadow",
    transitionDuration: "400ms, 400ms, 400ms, 200ms",
    height: {
      default: "var(--toast-frontmost-height, var(--toast-height))",
      ":is([data-expanded])": "var(--toast-height)",
    },
    transform: {
      default: COLLAPSED_TRANSFORM,
      ":is([data-expanded]:not([data-starting-style]):not([data-ending-style]))": EXPANDED_TRANSFORM,
      ":is([data-starting-style])": HIDDEN_TRANSFORM,
      ":is([data-ending-style]:not([data-swipe-direction]))": HIDDEN_TRANSFORM,
      ":is([data-ending-style][data-swipe-direction=right])": "translateX(calc(var(--toast-swipe-movement-x) + 100%))",
      ":is([data-ending-style][data-swipe-direction=left])": "translateX(calc(var(--toast-swipe-movement-x) - 100%))",
      ":is([data-ending-style][data-swipe-direction=down])": "translateY(calc(var(--toast-swipe-movement-y) + 100%))",
      ":is([data-ending-style][data-swipe-direction=up])": "translateY(calc(var(--toast-swipe-movement-y) - 100%))",
    },
    opacity: {
      default: null,
      ":is([data-starting-style])": 0,
      ":is([data-ending-style])": 0,
      ":is([data-limited])": 0,
    },
    "::after": {
      content: '""',
      position: "absolute",
      left: 0,
      width: "100%",
      height: "calc(var(--gap) + 1px)",
    },
  },
  // `expand`: always laid out like the hovered stack.
  toastExpandAlways: {
    height: "var(--toast-height)",
    transform: {
      default: EXPANDED_TRANSFORM,
      ":is([data-starting-style])": HIDDEN_TRANSFORM,
      ":is([data-ending-style]:not([data-swipe-direction]))": HIDDEN_TRANSFORM,
      ":is([data-ending-style][data-swipe-direction=right])": "translateX(calc(var(--toast-swipe-movement-x) + 100%))",
      ":is([data-ending-style][data-swipe-direction=left])": "translateX(calc(var(--toast-swipe-movement-x) - 100%))",
      ":is([data-ending-style][data-swipe-direction=down])": "translateY(calc(var(--toast-swipe-movement-y) + 100%))",
      ":is([data-ending-style][data-swipe-direction=up])": "translateY(calc(var(--toast-swipe-movement-y) - 100%))",
    },
  },
  toastBottom: { bottom: 0, "--lift": "-1", "::after": { bottom: "100%" } },
  toastTop: { top: 0, "--lift": "1", "::after": { top: "100%" } },
  toastRight: { right: { default: 0, [MOBILE]: 0 }, left: { default: null, [MOBILE]: 0 } },
  toastLeft: { left: { default: 0, [MOBILE]: 0 }, right: { default: null, [MOBILE]: 0 } },
  toastCenter: { left: 0, right: 0, marginInline: "auto" },
  styled: {
    display: "flex",
    width: { default: "var(--width)", [MOBILE]: "100%" },
    alignItems: "center",
    gap: "6px",
    borderRadius: "var(--border-radius)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--normal-border)",
    backgroundColor: "var(--normal-bg)",
    padding: "16px",
    fontSize: "13px",
    color: "var(--normal-text)",
    boxShadow: { default: SHADOW, ":focus-visible": `${SHADOW}, 0 0 0 2px rgba(0, 0, 0, 0.2)` },
  },
  invertLight: { "--normal-bg": "#000", "--normal-border": "hsl(0, 0%, 20%)", "--normal-text": "hsl(0, 0%, 99%)" },
  invertDark: { "--normal-bg": "#fff", "--normal-border": "hsl(0, 0%, 95.1%)", "--normal-text": "hsl(0, 0%, 9%)" },
  richSuccess: { backgroundColor: "var(--success-bg)", borderColor: "var(--success-border)", color: "var(--success-text)" },
  richInfo: { backgroundColor: "var(--info-bg)", borderColor: "var(--info-border)", color: "var(--info-text)" },
  richWarning: { backgroundColor: "var(--warning-bg)", borderColor: "var(--warning-border)", color: "var(--warning-text)" },
  richError: { backgroundColor: "var(--error-bg)", borderColor: "var(--error-border)", color: "var(--error-text)" },
  // Children fade while collapsed behind the front toast (sonner's `[data-front=false] > * { opacity: 0 }`).
  child: {
    transitionProperty: "opacity",
    transitionDuration: "400ms",
    opacity: {
      default: null,
      [stylex.when.ancestor(":is([data-behind]:not([data-expanded]))", sonnerToastMarker)]: 0,
    },
  },
  closeButton: {
    position: "absolute",
    insetInlineStart: 0,
    top: 0,
    zIndex: 1,
    display: "flex",
    width: "20px",
    height: "20px",
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: "var(--normal-border)", ":hover": "var(--gray5)" },
    backgroundColor: { default: "var(--normal-bg)", ":hover": "var(--gray2)" },
    padding: 0,
    color: "var(--normal-text)",
    transform: "translate(-35%, -35%)",
    transitionProperty: "opacity, background, border-color",
    transitionDuration: "100ms, 200ms, 200ms",
    boxShadow: { default: null, ":focus-visible": `${SHADOW}, 0 0 0 2px rgba(0, 0, 0, 0.2)` },
  },
  closeButtonDark: {
    borderColor: { default: "var(--normal-border)", ":hover": "var(--normal-border-hover)" },
    backgroundColor: { default: "var(--normal-bg)", ":hover": "var(--normal-bg-hover)" },
  },
  closeButtonRtl: { transform: "translate(35%, -35%)" },
  icon: {
    position: "relative",
    display: "flex",
    width: "16px",
    height: "16px",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "flex-start",
    marginInlineStart: "-3px",
    marginInlineEnd: "4px",
  },
  svg: { flexShrink: 0, marginInlineStart: "-1px" },
  content: {
    display: "flex",
    minWidth: 0,
    flex: "1 1 0%",
    flexDirection: "column",
    gap: "2px",
  },
  title: {
    lineHeight: 1.5,
    fontWeight: 500,
    color: "inherit",
  },
  description: {
    lineHeight: 1.4,
    fontWeight: 400,
    color: "#3f3f3f",
  },
  descriptionDark: { color: "hsl(0, 0%, 91%)" },
  descriptionRich: { color: "inherit" },
  button: {
    marginInlineStart: "auto",
    display: "flex",
    height: "24px",
    flexShrink: 0,
    cursor: "pointer",
    alignItems: "center",
    borderRadius: "4px",
    borderWidth: 0,
    paddingInline: "8px",
    fontSize: "12px",
    fontWeight: 500,
    outlineStyle: "none",
    transitionProperty: "opacity, box-shadow",
    transitionDuration: "400ms, 200ms",
    boxShadow: { default: null, ":focus-visible": "0 0 0 2px rgba(0, 0, 0, 0.4)" },
  },
  action: {
    backgroundColor: "var(--normal-text)",
    color: "var(--normal-bg)",
  },
  actionAfterCancel: { marginInlineStart: 0 },
  cancel: {
    backgroundColor: "rgba(0, 0, 0, 0.08)",
    color: "var(--normal-text)",
  },
  cancelDark: { backgroundColor: "rgba(255, 255, 255, 0.3)" },
})

const defaultIcons = {
  success: () => <Icon icon={CircleCheck} {...stylex.attrs(styles.svg)} />,
  info: () => <Icon icon={Info} {...stylex.attrs(styles.svg)} />,
  warning: () => <Icon icon={TriangleAlert} {...stylex.attrs(styles.svg)} />,
  error: () => <Icon icon={OctagonX} {...stylex.attrs(styles.svg)} />,
  loading: () => <Icon icon={Loader2} {...stylex.attrs(styles.svg, animate.spin)} />,
}

const richStyles = {
  success: styles.richSuccess,
  info: styles.richInfo,
  warning: styles.richWarning,
  error: styles.richError,
}

function Toaster(props: ToasterProps) {
  const systemTheme = useSystemTheme()
  const theme = () => (props.theme === "light" || props.theme === "dark" ? props.theme : systemTheme())
  const position = () => props.position ?? "bottom-right"
  const yPosition = () => position().split("-")[0] as "top" | "bottom"
  const xPosition = () => position().split("-")[1] as "left" | "right" | "center"
  const swipeDirection = (): Array<"up" | "down" | "left" | "right"> => {
    const directions: Array<"up" | "down" | "left" | "right"> = [yPosition() === "top" ? "up" : "down"]
    if (xPosition() !== "center") directions.push(xPosition() as "left" | "right")
    return directions
  }
  const viewportStyles = () => [
    styles.viewport,
    xPosition() === "right" ? styles.viewportRight : xPosition() === "left" ? styles.viewportLeft : styles.viewportCenter,
    yPosition() === "top" ? styles.viewportTop : styles.viewportBottom,
    theme() === "dark" ? styles.themeDark : styles.themeLight,
    props.xstyle,
  ]

  onSettled(() => {
    const hotkey = props.hotkey ?? ["altKey", "KeyT"]
    const onKeyDown = (event: KeyboardEvent) => {
      const pressed = hotkey.every((key) => (event as unknown as Record<string, unknown>)[key] || event.code === key)
      if (pressed) document.querySelector<HTMLElement>(`[data-sonner-toaster][data-y-position]`)?.focus()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  })

  return (
    <ToastPrimitive.Provider
      toastManager={manager}
      limit={props.visibleToasts ?? 3}
      timeout={props.toastOptions?.duration ?? props.duration ?? 4000}
    >
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport
          aria-label={props.containerAriaLabel ?? `Notifications ${(props.hotkey ?? ["altKey", "KeyT"]).join("+").replace(/Key/g, "").replace(/Digit/g, "")}`}
          data-sonner-toaster=""
          data-sonner-theme={theme()}
          data-y-position={yPosition()}
          data-x-position={xPosition()}
          dir={props.dir === "auto" ? undefined : (props.dir ?? "ltr")}
          id={props.id}
          class={cx("toaster", stylex.attrs(viewportStyles()).class, props.class)}
          style={{
            "--width": "356px",
            "--gap": `${props.gap ?? 14}px`,
            ...offsetVars(props.offset, VIEWPORT_OFFSET, "offset"),
            ...offsetVars(props.mobileOffset, MOBILE_VIEWPORT_OFFSET, "mobile-offset"),
            ...props.style,
          }}
        >
          <ToastList toaster={props} theme={theme()} yPosition={yPosition()} xPosition={xPosition()} swipeDirection={swipeDirection()} />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  )
}

function isAction(value: unknown): value is Action {
  return typeof value === "object" && value !== null && "label" in value && "onClick" in value
}

type ToastListProps = {
  toaster: ToasterProps
  theme: "light" | "dark"
  yPosition: "top" | "bottom"
  xPosition: "left" | "right" | "center"
  swipeDirection: Array<"up" | "down" | "left" | "right">
}

function ToastList(props: ToastListProps) {
  const toastManager = ToastPrimitive.useToastManager<SonnerData>()
  return (
    <For each={toastManager.toasts} keyed={(item) => item.id}>
      {(item) => <SonnerToast item={item()} {...props} />}
    </For>
  )
}

function SonnerToast(props: ToastListProps & { item: ToastPrimitive.Root.Props["toast"] }) {
  const t = () => (props.item.data as SonnerData | undefined)?.toast
  const type = () => (props.item.type ?? "default") as ToastTypes
  const options = () => props.toaster.toastOptions
  const unstyled = () => t()?.unstyled ?? options()?.unstyled ?? false
  const richColors = () => t()?.richColors ?? props.toaster.richColors ?? false
  const inverted = () => t()?.invert ?? props.toaster.invert ?? false
  const closeButton = () => t()?.closeButton ?? options()?.closeButton ?? props.toaster.closeButton ?? false
  const dark = () => props.theme === "dark"
  const rich = () => (richColors() ? richStyles[type() as keyof typeof richStyles] : null)
  const icon = () => {
    if (t()?.icon !== undefined) return t()?.icon
    const kind = type()
    if (kind === "default" || kind === "normal" || kind === "action") return undefined
    return props.toaster.icons?.[kind] ?? defaultIcons[kind as keyof typeof defaultIcons]?.()
  }
  const action = () => t()?.action
  const cancel = () => t()?.cancel
  const toastStyles = () => [
    sonnerToastMarker,
    styles.toast,
    props.toaster.expand ? styles.toastExpandAlways : null,
    props.yPosition === "top" ? styles.toastTop : styles.toastBottom,
    props.xPosition === "right" ? styles.toastRight : props.xPosition === "left" ? styles.toastLeft : styles.toastCenter,
    unstyled() ? null : styles.styled,
    inverted() ? (dark() ? styles.invertDark : styles.invertLight) : null,
    unstyled() ? null : rich(),
    options()?.xstyle,
    t()?.xstyle,
  ]
  const childStyles = () => (props.toaster.expand ? [] : [styles.child])

  return (
    <ToastPrimitive.Root
      toast={props.item}
      swipeDirection={props.swipeDirection}
      data-sonner-toast=""
      data-styled={unstyled() ? "false" : "true"}
      data-type={type()}
      data-rich-colors={richColors() ? "true" : "false"}
      data-invert={inverted() ? "true" : "false"}
      data-y-position={props.yPosition}
      data-x-position={props.xPosition}
      data-testid={t()?.testId}
      class={cx(stylex.attrs(toastStyles()).class, options()?.class, t()?.class)}
      style={{ ...options()?.style, ...t()?.style }}
    >
      <Show when={closeButton() && !t()?.jsx}>
        <ToastPrimitive.Close
          aria-label={options()?.closeButtonAriaLabel ?? "Close toast"}
          data-close-button=""
          onClick={(event: MouseEvent) => {
            event.preventDefault()
            dismissByUser(props.item.id)
          }}
          class={
            stylex.attrs([
              styles.closeButton,
              dark() ? styles.closeButtonDark : null,
              props.toaster.dir === "rtl" ? styles.closeButtonRtl : null,
              rich(),
              childStyles(),
            ]).class
          }
        >
          {props.toaster.icons?.close ?? <Icon icon={X} size={12} />}
        </ToastPrimitive.Close>
      </Show>
      <Show when={icon()}>
        <div data-icon="" {...stylex.attrs([styles.icon, childStyles()])}>
          {icon()}
        </div>
      </Show>
      <div data-content="" {...stylex.attrs([styles.content, childStyles()])}>
        <ToastPrimitive.Title data-title="" class={stylex.attrs(styles.title).class} />
        <ToastPrimitive.Description
          data-description=""
          class={
            stylex.attrs([
              styles.description,
              dark() ? styles.descriptionDark : null,
              richColors() ? styles.descriptionRich : null,
            ]).class
          }
        />
      </div>
      <Show when={cancel()}>
        {(c) => (
          <Show when={isAction(c())} fallback={c() as JSX.Element}>
            <button
              type="button"
              data-button=""
              data-cancel=""
              style={{ ...options()?.cancelButtonStyle, ...t()?.cancelButtonStyle }}
              onClick={(event) => {
                const value = untrack(c) as Action
                if (t()?.dismissible === false) return
                value.onClick(event)
                dismissByUser(props.item.id)
              }}
              {...stylex.attrs([styles.button, styles.cancel, dark() ? styles.cancelDark : null, childStyles()])}
            >
              {(c() as Action).label}
            </button>
          </Show>
        )}
      </Show>
      <Show when={action()}>
        {(a) => (
          <Show when={isAction(a())} fallback={a() as JSX.Element}>
            <button
              type="button"
              data-button=""
              data-action=""
              style={{ ...options()?.actionButtonStyle, ...t()?.actionButtonStyle }}
              onClick={(event) => {
                const value = untrack(a) as Action
                value.onClick(event)
                if (event.defaultPrevented) return
                dismissByUser(props.item.id)
              }}
              {...stylex.attrs([styles.button, styles.action, cancel() ? styles.actionAfterCancel : null, childStyles()])}
            >
              {(a() as Action).label}
            </button>
          </Show>
        )}
      </Show>
    </ToastPrimitive.Root>
  )
}

export { Toaster, toast, type ToasterProps, type ExternalToast, type ToastT }
