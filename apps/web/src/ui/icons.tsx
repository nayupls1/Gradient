import type { Priority, PullRequestCheckStatus, PullRequestReviewState, PullRequestState, StateType } from "@gradient/domain"
import {
  Archive,
  ArchiveArrowUp,
  ArrowDownUp,
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CircleX,
  Command,
  Copy,
  Ellipsis,
  FileDiff,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type IconNode,
  Keyboard,
  KeyRound,
  Laptop,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  Mail,
  MessageSquare,
  Minus,
  Monitor,
  Moon,
  OctagonExclamationPoint,
  OctagonMinus,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Sun,
  Tag,
  Trash,
  Unlink,
  UserPlus,
  UserRound,
  Users,
  X
} from "lucide"
import { Icon } from "./icon.tsx"

/*
 * Icons are Lucide's icon data (the framework-agnostic `lucide` package),
 * drawn by shadcn's `Icon` like the components in this folder, at one stroke
 * weight and size scale. The only non-Lucide glyph is GitHub's own mark,
 * since Lucide ships no brand icons.
 */

type IconProps = { size?: number; color?: string }

const wrap = (icon: IconNode) => (p: IconProps) => (
  <Icon icon={icon} size={p.size ?? 16} stroke={p.color ?? "currentColor"} stroke-width={1.75} />
)

const stateIcons: Record<StateType, IconNode> = {
  backlog: CircleDashed,
  unstarted: Circle,
  started: CircleDot,
  completed: CircleCheck,
  canceled: CircleX
}

export const StateIcon = (props: { type: StateType; color: string; size?: number }) => (
  <Icon icon={stateIcons[props.type]} size={props.size ?? 15} stroke={props.color} stroke-width={2} />
)

const priorityIcons: Record<Priority, IconNode> = {
  0: Minus,
  1: OctagonExclamationPoint,
  2: SignalHigh,
  3: SignalMedium,
  4: SignalLow
}

export const PriorityIcon = (props: { priority: Priority; size?: number }) => (
  <Icon
    icon={priorityIcons[props.priority]}
    size={props.size ?? 15}
    stroke={props.priority === 1 ? "#e5602f" : "currentColor"}
    stroke-width={props.priority === 1 ? 2 : 1.9}
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
export const RestoreIcon = wrap(ArchiveArrowUp)
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
export const PencilIcon = wrap(Pencil)
export const RefreshIcon = wrap(RefreshCw)
export const UnlinkIcon = wrap(Unlink)
export const ProjectIcon = wrap(Box)
export const KeyIcon = wrap(KeyRound)
export const LockIcon = wrap(LockKeyhole)
export const SignOutIcon = wrap(LogOut)
export const DeviceIcon = wrap(Laptop)
export const UsersIcon = wrap(Users)
export const UserPlusIcon = wrap(UserPlus)
export const MailIcon = wrap(Mail)
export const SignInIcon = wrap(LogIn)
/** An issue waiting on another one. Takes the surrounding text color. */
export const BlockedIcon = wrap(OctagonMinus)

const pullRequestIcons: Record<PullRequestState, IconNode> = {
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed: GitPullRequestClosed
}
// GitHub's own state colors, readable on light and dark surfaces. Drafts take the text color.
const pullRequestColors: Record<PullRequestState, string> = {
  open: "#46a758",
  draft: "currentColor",
  merged: "#8e4ec6",
  closed: "#e5484d"
}

export const PullRequestIcon = (props: { state: PullRequestState; size?: number }) => (
  <Icon icon={pullRequestIcons[props.state]} size={props.size ?? 14} stroke={pullRequestColors[props.state]} stroke-width={1.9} />
)

export const ArrowLeftIcon = wrap(ArrowLeft)
export const SortIcon = wrap(ArrowDownUp)
export const FileDiffIcon = wrap(FileDiff)
export const CommitIcon = wrap(GitCommitHorizontal)
export const MessageIcon = wrap(MessageSquare)

// Check and review tones, like GitHub's: green passes, red fails, amber waits; the rest take the text color.
const checkIcons: Record<PullRequestCheckStatus, { icon: IconNode; color: string }> = {
  pending: { icon: LoaderCircle, color: "#e2a336" },
  success: { icon: CircleCheck, color: "#46a758" },
  failure: { icon: CircleX, color: "#e5484d" },
  cancelled: { icon: CircleSlash, color: "currentColor" },
  skipped: { icon: CircleSlash, color: "currentColor" },
  neutral: { icon: CircleDashed, color: "currentColor" }
}

export const CheckStatusIcon = (props: { status: PullRequestCheckStatus; size?: number }) => (
  <Icon icon={checkIcons[props.status].icon} size={props.size ?? 14} stroke={checkIcons[props.status].color} stroke-width={1.9} />
)

export const checkStatusLabel: Record<PullRequestCheckStatus, string> = {
  pending: "Running",
  success: "Passed",
  failure: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
  neutral: "Neutral"
}

const reviewIcons: Record<PullRequestReviewState, { icon: IconNode; color: string }> = {
  approved: { icon: CircleCheck, color: "#46a758" },
  changes_requested: { icon: CircleX, color: "#e5484d" },
  commented: { icon: MessageSquare, color: "currentColor" },
  dismissed: { icon: CircleSlash, color: "currentColor" },
  pending: { icon: CircleDashed, color: "currentColor" }
}

export const ReviewStateIcon = (props: { state: PullRequestReviewState; size?: number }) => (
  <Icon icon={reviewIcons[props.state].icon} size={props.size ?? 14} stroke={reviewIcons[props.state].color} stroke-width={1.9} />
)

export const reviewStateLabel: Record<PullRequestReviewState, string> = {
  approved: "approved",
  changes_requested: "requested changes",
  commented: "reviewed",
  dismissed: "review dismissed",
  pending: "review pending"
}

/** The color of a pull request state, for text beside its icon. */
export const pullRequestColor = (state: PullRequestState) => pullRequestColors[state]

export const pullRequestLabel: Record<PullRequestState, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed"
}

/** GitHub's mark (Primer Octicons, MIT). Brand icons are not part of Lucide. */
export const GithubIcon = (p: IconProps) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" fill={p.color ?? "currentColor"} aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
)
