import * as stylex from "@stylexjs/stylex"

/**
 * tw-animate-css for StyleX.
 *
 * tw-animate-css drives every enter/exit animation from two keyframes, `enter` and `exit`, whose
 * start/end frame reads CSS variables (`--tw-enter-opacity`, `--tw-enter-scale`,
 * `--tw-enter-translate-x`...). Utilities like `fade-in-0`, `zoom-in-95` or `slide-in-from-top-2`
 * only set those variables, and `animate-in`/`animate-out` pick the keyframes. The same split
 * works in StyleX: compose `animate.in`/`animate.out` (or the `data-open`/`data-closed` shortcut
 * `animate.openClosed`) with the variable styles below, and set `animationDuration` to match the
 * component's `duration-*` (tw-animate's default is 150ms).
 *
 *   stylex.attrs(animate.openClosed, animate.fadeIn0, animate.fadeOut0, animate.zoomIn95, animate.zoomOut95, styles.popup)
 */
const enter = stylex.keyframes({
  from: {
    opacity: "var(--tw-enter-opacity, 1)",
    transform:
      "translate3d(var(--tw-enter-translate-x, 0), var(--tw-enter-translate-y, 0), 0) scale3d(var(--tw-enter-scale, 1), var(--tw-enter-scale, 1), var(--tw-enter-scale, 1)) rotate(var(--tw-enter-rotate, 0))",
    filter: "blur(var(--tw-enter-blur, 0))",
  },
})

const exit = stylex.keyframes({
  to: {
    opacity: "var(--tw-exit-opacity, 1)",
    transform:
      "translate3d(var(--tw-exit-translate-x, 0), var(--tw-exit-translate-y, 0), 0) scale3d(var(--tw-exit-scale, 1), var(--tw-exit-scale, 1), var(--tw-exit-scale, 1)) rotate(var(--tw-exit-rotate, 0))",
    filter: "blur(var(--tw-exit-blur, 0))",
  },
})

const spin = stylex.keyframes({
  to: { transform: "rotate(360deg)" },
})

const pulse = stylex.keyframes({
  "50%": { opacity: 0.5 },
})

export const animate = stylex.create({
  /** `animate-in` */
  in: {
    animationName: enter,
    animationDuration: "150ms",
    animationTimingFunction: "ease",
  },
  /** `animate-out` */
  out: {
    animationName: exit,
    animationDuration: "150ms",
    animationTimingFunction: "ease",
  },
  /** `data-open:animate-in data-closed:animate-out` (Base UI's `data-open`/`data-closed`). */
  openClosed: {
    animationName: {
      default: null,
      ":is([data-open])": enter,
      ":is([data-closed])": exit,
    },
    animationDuration: "150ms",
    animationTimingFunction: "ease",
  },
  /** `fade-in-0` */
  fadeIn0: { "--tw-enter-opacity": "0" },
  /** `fade-out-0` */
  fadeOut0: { "--tw-exit-opacity": "0" },
  /** `zoom-in-95` */
  zoomIn95: { "--tw-enter-scale": "0.95" },
  /** `zoom-out-95` */
  zoomOut95: { "--tw-exit-scale": "0.95" },
  /**
   * The popup slide shadcn puts on every positioned popup:
   * `data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2
   *  data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2
   *  data-[side=inline-start]:slide-in-from-right-2 data-[side=inline-end]:slide-in-from-left-2`
   */
  slideInFromSide2: {
    "--tw-enter-translate-y": {
      default: null,
      ":is([data-side=bottom])": "-0.5rem",
      ":is([data-side=top])": "0.5rem",
    },
    "--tw-enter-translate-x": {
      default: null,
      ":is([data-side=left])": "0.5rem",
      ":is([data-side=right])": "-0.5rem",
      ":is([data-side=inline-start])": "0.5rem",
      ":is([data-side=inline-end])": "-0.5rem",
    },
  },
  /** `animate-spin` */
  spin: {
    animationName: spin,
    animationDuration: "1s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  /** `animate-pulse` */
  pulse: {
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite",
  },
})
