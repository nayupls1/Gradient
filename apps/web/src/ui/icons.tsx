import type { Priority, StateType } from "@gradient/domain"
import type { JSX } from "@solidjs/web"

type IconProps = { size?: number; color?: string }

const Svg = (props: IconProps & { children: JSX.Element; fill?: boolean }) => (
  <svg
    width={props.size ?? 16}
    height={props.size ?? 16}
    viewBox="0 0 16 16"
    fill="none"
    stroke={props.color ?? "currentColor"}
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {props.children}
  </svg>
)

/** Workflow state glyphs, in the spirit of Linear's: empty, dashed, partial, check, cross. */
export const StateIcon = (props: { type: StateType; color: string; size?: number }) => {
  const size = () => props.size ?? 14
  return (
    <svg width={size()} height={size()} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      {props.type === "backlog" && (
        <circle cx="7" cy="7" r="5.5" stroke={props.color} stroke-width="1.5" stroke-dasharray="2.2 1.8" />
      )}
      {props.type === "unstarted" && <circle cx="7" cy="7" r="5.5" stroke={props.color} stroke-width="1.5" />}
      {props.type === "started" && (
        <>
          <circle cx="7" cy="7" r="5.5" stroke={props.color} stroke-width="1.5" />
          <path d="M7 3.5 A3.5 3.5 0 0 1 7 10.5 Z" fill={props.color} />
        </>
      )}
      {props.type === "completed" && (
        <>
          <circle cx="7" cy="7" r="6.25" fill={props.color} />
          <path d="M4.4 7.2 6.2 9 9.7 5.3" stroke="var(--state-icon-fg, #fff)" stroke-width="1.5" fill="none" />
        </>
      )}
      {props.type === "canceled" && (
        <>
          <circle cx="7" cy="7" r="6.25" fill={props.color} />
          <path d="M5 5 9 9M9 5 5 9" stroke="var(--state-icon-fg, #fff)" stroke-width="1.5" />
        </>
      )}
    </svg>
  )
}

/** Signal bars for low/medium/high, an exclamation box for urgent, dashes for none. */
export const PriorityIcon = (props: { priority: Priority; size?: number }) => {
  const size = () => props.size ?? 14
  const bar = (x: number, h: number, on: boolean) => (
    <rect x={x} y={12 - h} width="2.5" height={h} rx="0.75" fill="currentColor" opacity={on ? 1 : 0.28} />
  )
  return (
    <svg width={size()} height={size()} viewBox="0 0 14 14" aria-hidden="true">
      {props.priority === 0 && (
        <g fill="currentColor" opacity="0.55">
          <rect x="2" y="6.25" width="2.2" height="1.5" rx="0.6" />
          <rect x="5.9" y="6.25" width="2.2" height="1.5" rx="0.6" />
          <rect x="9.8" y="6.25" width="2.2" height="1.5" rx="0.6" />
        </g>
      )}
      {props.priority === 1 && (
        <>
          <rect x="1" y="1" width="12" height="12" rx="3" fill="#f2683c" />
          <rect x="6.25" y="3.5" width="1.5" height="4.6" rx="0.75" fill="#fff" />
          <rect x="6.25" y="9.2" width="1.5" height="1.5" rx="0.75" fill="#fff" />
        </>
      )}
      {props.priority >= 2 && (
        <>
          {bar(1.5, 4, true)}
          {bar(5.75, 7, props.priority <= 3)}
          {bar(10, 10, props.priority === 2)}
        </>
      )}
    </svg>
  )
}

export const priorityLabel: Record<Priority, string> = { 0: "No priority", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" }

export const PlusIcon = (p: IconProps) => <Svg {...p}><path d="M8 3.5v9M3.5 8h9" /></Svg>
export const CheckIcon = (p: IconProps) => <Svg {...p}><path d="m3.5 8.5 3 3 6-7" /></Svg>
export const XIcon = (p: IconProps) => <Svg {...p}><path d="m4.5 4.5 7 7m0-7-7 7" /></Svg>
export const ChevronRightIcon = (p: IconProps) => <Svg {...p}><path d="m6.5 4 4 4-4 4" /></Svg>
export const ChevronDownIcon = (p: IconProps) => <Svg {...p}><path d="m4 6.5 4 4 4-4" /></Svg>
export const MoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="3.5" cy="8" r="0.6" fill="currentColor" />
    <circle cx="8" cy="8" r="0.6" fill="currentColor" />
    <circle cx="12.5" cy="8" r="0.6" fill="currentColor" />
  </Svg>
)
export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.4 3.6l-1.06 1.06M4.66 11.34 3.6 12.4M12.4 12.4l-1.06-1.06M4.66 4.66 3.6 3.6" />
  </Svg>
)
export const InboxIcon = (p: IconProps) => (
  <Svg {...p}><path d="M2 9.5 3.6 3.8A1 1 0 0 1 4.56 3h6.88a1 1 0 0 1 .96.8L14 9.5V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9.5Zm0 0h3.5l1 1.5h3l1-1.5H14" /></Svg>
)
export const LayersIcon = (p: IconProps) => (
  <Svg {...p}><path d="m8 2 6 3.25L8 8.5 2 5.25 8 2Zm-6 6 6 3.25L14 8M2 10.75 8 14l6-3.25" /></Svg>
)
export const UserIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="5.5" r="2.75" /><path d="M2.75 13.5c.7-2.3 2.8-3.5 5.25-3.5s4.55 1.2 5.25 3.5" /></Svg>
)
export const TagIcon = (p: IconProps) => (
  <Svg {...p}><path d="M2.5 2.5h5l6 6-5 5-6-6v-5Z" /><circle cx="5.5" cy="5.5" r="0.75" fill="currentColor" /></Svg>
)
export const ArchiveIcon = (p: IconProps) => (
  <Svg {...p}><rect x="2" y="2.75" width="12" height="3" rx="0.75" /><path d="M3 5.75v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-6.5M6.5 8.5h3" /></Svg>
)
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}><path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6" /></Svg>
)
export const SearchIcon = (p: IconProps) => <Svg {...p}><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3 3" /></Svg>
export const PaletteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2a6 6 0 1 0 0 12c.8 0 1.25-.6 1.25-1.25 0-.9-.75-1.15-.75-2 0-.7.55-1.25 1.25-1.25h1.5A2.75 2.75 0 0 0 14 6.75C14 4.1 11.3 2 8 2Z" />
    <circle cx="5" cy="7.5" r="0.75" fill="currentColor" />
    <circle cx="7.25" cy="4.75" r="0.75" fill="currentColor" />
    <circle cx="10.5" cy="5.25" r="0.75" fill="currentColor" />
  </Svg>
)
export const GithubIcon = (p: IconProps) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" fill={p.color ?? "currentColor"} aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
)
