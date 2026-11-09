import type { Priority, StateType } from "@gradient/domain"
import type { LucideProps } from "@lucide/solid"
import { Dynamic, type JSX } from "@solidjs/web"
import Archive from "@lucide/solid/icons/archive"
import ArchiveRestore from "@lucide/solid/icons/archive-arrow-up"
import ArrowUpRight from "@lucide/solid/icons/arrow-up-right"
import Bot from "@lucide/solid/icons/bot"
import Check from "@lucide/solid/icons/check"
import ChevronDown from "@lucide/solid/icons/chevron-down"
import ChevronRight from "@lucide/solid/icons/chevron-right"
import Circle from "@lucide/solid/icons/circle"
import CircleCheck from "@lucide/solid/icons/circle-check"
import CircleDashed from "@lucide/solid/icons/circle-dashed"
import CircleDot from "@lucide/solid/icons/circle-dot"
import CircleX from "@lucide/solid/icons/circle-x"
import Command from "@lucide/solid/icons/command"
import Copy from "@lucide/solid/icons/copy"
import Ellipsis from "@lucide/solid/icons/ellipsis"
import Keyboard from "@lucide/solid/icons/keyboard"
import Minus from "@lucide/solid/icons/minus"
import Monitor from "@lucide/solid/icons/monitor"
import Moon from "@lucide/solid/icons/moon"
import OctagonAlert from "@lucide/solid/icons/octagon-exclamation-point"
import Palette from "@lucide/solid/icons/palette"
import Plus from "@lucide/solid/icons/plus"
import Search from "@lucide/solid/icons/search"
import Settings from "@lucide/solid/icons/settings"
import SignalHigh from "@lucide/solid/icons/signal-high"
import SignalLow from "@lucide/solid/icons/signal-low"
import SignalMedium from "@lucide/solid/icons/signal-medium"
import Sun from "@lucide/solid/icons/sun"
import Tag from "@lucide/solid/icons/tag"
import Trash from "@lucide/solid/icons/trash"
import UserRound from "@lucide/solid/icons/user-round"
import X from "@lucide/solid/icons/x"

/*
 * Icons come from Lucide, at one stroke weight and size scale. Import one file
 * per icon so dev loads stay small. The only non-Lucide glyph is GitHub's own
 * mark, since Lucide ships no brand icons.
 */

type IconProps = { size?: number; color?: string }
type Lucide = (props: LucideProps) => JSX.Element

const wrap = (Icon: Lucide) => (p: IconProps) => (
  <Icon size={p.size ?? 16} color={p.color ?? "currentColor"} stroke-width={1.75} aria-hidden="true" />
)

const stateIcons: Record<StateType, Lucide> = {
  backlog: CircleDashed,
  unstarted: Circle,
  started: CircleDot,
  completed: CircleCheck,
  canceled: CircleX
}

export const StateIcon = (props: { type: StateType; color: string; size?: number }) => (
  <Dynamic component={stateIcons[props.type]} size={props.size ?? 15} color={props.color} stroke-width={2} aria-hidden="true" />
)

const priorityIcons: Record<Priority, Lucide> = {
  0: Minus,
  1: OctagonAlert,
  2: SignalHigh,
  3: SignalMedium,
  4: SignalLow
}

export const PriorityIcon = (props: { priority: Priority; size?: number }) => (
  <Dynamic
    component={priorityIcons[props.priority]}
    size={props.size ?? 15}
    color={props.priority === 1 ? "#e5602f" : "currentColor"}
    stroke-width={props.priority === 1 ? 2 : 1.9}
    aria-hidden="true"
  />
)

export const priorityLabel: Record<Priority, string> = { 0: "No priority", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" }

export const PlusIcon = wrap(Plus)
export const CheckIcon = wrap(Check)
export const XIcon = wrap(X)
export const ChevronRightIcon = wrap(ChevronRight)
export const ChevronDownIcon = wrap(ChevronDown)
export const MoreIcon = wrap(Ellipsis)
export const SettingsIcon = wrap(Settings)
export const UserIcon = wrap(UserRound)
export const TagIcon = wrap(Tag)
export const ArchiveIcon = wrap(Archive)
export const RestoreIcon = wrap(ArchiveRestore)
export const TrashIcon = wrap(Trash)
export const SearchIcon = wrap(Search)
export const PaletteIcon = wrap(Palette)
export const CommandIcon = wrap(Command)
export const KeyboardIcon = wrap(Keyboard)
export const BotIcon = wrap(Bot)
export const CopyIcon = wrap(Copy)
export const SunIcon = wrap(Sun)
export const MoonIcon = wrap(Moon)
export const MonitorIcon = wrap(Monitor)
export const ExternalIcon = wrap(ArrowUpRight)

/** GitHub's mark (Primer Octicons, MIT). Brand icons are not part of Lucide. */
export const GithubIcon = (p: IconProps) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" fill={p.color ?? "currentColor"} aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
)
