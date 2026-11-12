import type {
  DraftReviewComment,
  MergeMethod,
  PullRequestActivity,
  PullRequestCheck,
  PullRequestCheckStatus,
  PullRequestDetail,
  PullRequestReviewComment,
  PullRequestReviewState,
  ReviewEvent
} from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import type { JSX } from "@solidjs/web"
import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, Match, Show, Switch, untrack, useContext } from "solid-js"
import { Sync } from "../app/context.ts"
import { CommentBox } from "../app/CommentBox.tsx"
import { type DiffLineRange, type DiffThreadAnchor, DiffView, type DiffViewApi } from "../app/DiffView.tsx"
import { GithubConnect } from "../app/GithubConnect.tsx"
import { githubAccount } from "../app/githubAccount.ts"
import { Markdown } from "../app/Markdown.tsx"
import { PullRequestTimeline } from "../app/PullRequestTimeline.tsx"
import { UserAvatar } from "../app/UserAvatar.tsx"
import { KeyScope, useCommands, useScope } from "../keys/solid.tsx"
import { formatRelative } from "../lib/select.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { font } from "../theme/tokens.stylex.ts"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../ui/breadcrumb.tsx"
import { Button, type ButtonProps } from "../ui/button.tsx"
import { ButtonGroup } from "../ui/button-group.tsx"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu.tsx"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx"
import { toast } from "../ui/sonner.tsx"
import { Textarea } from "../ui/textarea.tsx"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx"
import {
  ArrowLeftIcon,
  CheckStatusIcon,
  checkStatusLabel,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CommitIcon,
  ExternalIcon,
  FileDiffIcon,
  GithubIcon,
  MessageIcon,
  PullRequestIcon,
  pullRequestColor,
  pullRequestLabel,
  RefreshIcon,
  SortIcon,
  ReviewStateIcon,
  reviewStateLabel,
  TagIcon,
  TrashIcon,
  UsersIcon
} from "../ui/icons.tsx"
import { Skeleton } from "../ui/skeleton.tsx"
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx"
import { PageHeader } from "./Header.tsx"

/*
 * One pull request, opened from an issue (its pull requests, mentions, links
 * in the text) instead of jumping to GitHub. Not a list and not in the
 * sidebar: it is reached only from what refers to it. Read from GitHub when
 * opened (`GithubPullRequest`), so it works for any repository the connection
 * can see. Laid out after t3code's pull request panel: the repository and
 * number, the title, who and when, base ← head with the size of the change,
 * then Summary (reviewers, labels, description, checks, conversation) and
 * Files (Pierre's diff viewer).
 */

type Tab = "summary" | "timeline" | "files"

const ADD = "#46a758"
const DEL = "#e5484d"

const s = stylex.create({
  page: { display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 },
  head: { paddingInline: 24, paddingTop: 18, paddingBottom: 14, display: "flex", flexDirection: "column", gap: 10 },
  title: { fontSize: 20, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.3, margin: 0 },
  number: { color: colors.mutedForeground, fontWeight: 400 },
  line: { display: "flex", alignItems: "center", gap: 8, minWidth: 0, fontSize: "0.75rem", color: colors.mutedForeground },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    height: 22,
    paddingInline: 8,
    borderRadius: 999,
    fontSize: "0.75rem",
    fontWeight: 500,
    flexShrink: 0
  },
  who: { color: colors.foreground, fontWeight: 500 },
  dot: { width: 1, height: 12, backgroundColor: colors.border, flexShrink: 0 },
  branches: { display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexGrow: 1, fontFamily: font.mono, fontSize: "0.75rem" },
  branch: {
    paddingInline: 6,
    paddingBlock: 1,
    borderRadius: 4,
    backgroundColor: colors.muted,
    color: colors.foreground,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
    cursor: "copy",
    borderWidth: 0,
    fontFamily: font.mono,
    fontSize: "0.75rem"
  },
  stats: { display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0, fontVariantNumeric: "tabular-nums" },
  stat: { display: "inline-flex", alignItems: "center", gap: 4 },
  conflict: { color: colors.destructive },
  tabs: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    paddingInline: 24,
    paddingBlock: 8,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border
  },
  tabsEnd: { marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: colors.mutedForeground },
  body: { flexGrow: 1, minHeight: 0, position: "relative" },
  scroll: { position: "absolute", inset: 0, overflowY: "auto" },
  column: { maxWidth: 860, paddingInline: 24, paddingTop: 8, paddingBottom: 64 },
  metaRow: { display: "grid", gridTemplateColumns: "96px minmax(0, 1fr)", alignItems: "center", minHeight: 30, fontSize: "0.75rem" },
  metaLabel: { display: "inline-flex", alignItems: "center", gap: 6, color: colors.mutedForeground },
  metaValue: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, minWidth: 0 },
  none: { color: colors.mutedForeground },
  reviewer: { display: "inline-flex", alignItems: "center", gap: 4, color: colors.foreground },
  labelChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    height: 20,
    paddingInline: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    color: colors.foreground
  },
  labelDot: { width: 7, height: 7, borderRadius: 999 },
  section: { borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: colors.border, marginTop: 12 },
  sectionTrigger: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    paddingBlock: 12,
    paddingInline: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    cursor: "pointer",
    fontSize: "0.75rem",
    fontWeight: 500,
    color: { default: colors.mutedForeground, ":hover": colors.foreground }
  },
  chevron: { display: "inline-flex", transitionProperty: "transform", transitionDuration: "150ms" },
  chevronOpen: { transform: "rotate(90deg)" },
  sectionBody: { paddingBottom: 12 },
  description: { fontSize: 14, lineHeight: 1.65 },
  check: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 30,
    paddingInline: 8,
    marginInline: -8,
    borderRadius: 6,
    fontSize: "0.8125rem",
    color: colors.foreground,
    backgroundColor: { default: "transparent", ":hover": colors.accent }
  },
  checkName: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  checkState: { color: colors.mutedForeground, fontSize: "0.75rem", flexShrink: 0 },
  card: {
    paddingBlock: 12,
    paddingInline: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    marginBottom: 8
  },
  cardMeta: { display: "flex", alignItems: "center", gap: 8, fontSize: "0.75rem", color: colors.mutedForeground },
  cardBody: { fontSize: 14, lineHeight: 1.6, marginTop: 8 },
  cardTime: { color: { default: colors.mutedForeground, ":hover": colors.foreground }, marginInlineStart: "auto" },
  files: { position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)" },
  fileList: {
    overflowY: "auto",
    paddingBlock: 10,
    paddingInline: 8,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.border,
    display: "flex",
    flexDirection: "column",
    gap: 1
  },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minHeight: 26,
    paddingInline: 8,
    borderRadius: 6,
    borderWidth: 0,
    textAlign: "start",
    fontSize: "0.75rem",
    color: colors.foreground,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": colors.accent }
  },
  fileName: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" },
  fileStat: { fontFamily: font.mono, fontSize: "0.6875rem", flexShrink: 0, fontVariantNumeric: "tabular-nums" },
  binary: { color: colors.mutedForeground, fontSize: "0.75rem", paddingInline: 8, paddingTop: 10 },
  diff: { minWidth: 0, minHeight: 0, height: "100%" },
  center: { display: "grid", placeItems: "center", height: "60%", color: colors.mutedForeground, textAlign: "center", gap: 12 },
  composer: { marginTop: 4 },
  thread: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBlock: 6,
    marginInline: 12,
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.background,
    fontFamily: font.sans,
    maxWidth: 760
  },
  threadComment: { display: "flex", flexDirection: "column", gap: 4 },
  threadBody: { fontSize: 13, lineHeight: 1.55 },
  pending: {
    fontSize: "0.6875rem",
    fontWeight: 500,
    paddingInline: 6,
    borderRadius: 999,
    color: "#b07d1a",
    backgroundColor: "color-mix(in srgb, #e2a336 18%, transparent)"
  },
  reviewPopover: { width: 400 },
  review: { display: "flex", flexDirection: "column", gap: 10 },
  reviewTitle: { fontSize: "0.8125rem", fontWeight: 600 },
  reviewNote: { color: colors.mutedForeground, fontSize: "0.75rem" },
  reviewInput: { minHeight: 90, fontSize: 13 },
  reviewEvents: { display: "flex", flexDirection: "column", gap: 2 },
  reviewEvent: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    paddingBlock: 6,
    paddingInline: 8,
    borderRadius: 6,
    cursor: "pointer",
    fontSize: "0.8125rem",
    backgroundColor: { default: "transparent", ":hover": colors.accent }
  },
  reviewEventHint: { display: "block", color: colors.mutedForeground, fontSize: "0.75rem" },
  reviewActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  count: {
    minWidth: 18,
    height: 18,
    paddingInline: 5,
    borderRadius: 999,
    fontSize: "0.6875rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    color: colors.primaryForeground
  },
  mergeHint: { fontSize: "0.75rem", color: colors.mutedForeground, maxWidth: 260 },
  skeletons: { display: "flex", flexDirection: "column", gap: 10, padding: 24 }
})

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "timeline", label: "Timeline" },
  { value: "files", label: "Files" }
]

/** The checks in one line, like GitHub's merge box. */
const checksSummary = (checks: ReadonlyArray<PullRequestCheck>): { status: PullRequestCheckStatus; text: string } | null => {
  if (checks.length === 0) return null
  const count = (st: PullRequestCheckStatus) => checks.filter((c) => c.status === st).length
  const failed = count("failure")
  const pending = count("pending")
  if (failed > 0) return { status: "failure", text: `${failed} of ${checks.length} checks failed` }
  if (pending > 0) return { status: "pending", text: `${pending} of ${checks.length} checks running` }
  return { status: "success", text: checks.length === 1 ? "1 check passed" : `All ${checks.length} checks passed` }
}

/** Each reviewer once: their latest verdict, else that they were asked. */
const reviewersOf = (pr: PullRequestDetail) => {
  const latest = new Map<string, PullRequestReviewState>()
  const avatars = new Map<string, string | null>()
  for (const a of pr.activity) {
    if (a.kind !== "review" || !a.author || !a.reviewState) continue
    if (a.reviewState === "commented" && latest.has(a.author)) continue
    latest.set(a.author, a.reviewState)
    avatars.set(a.author, a.authorAvatarUrl)
  }
  return [
    ...[...latest].map(([login, state]) => ({ login, state: state as PullRequestReviewState | null, avatar: avatars.get(login) ?? null })),
    ...pr.requestedReviewers.filter((r) => !latest.has(r)).map((login) => ({ login, state: null, avatar: null }))
  ]
}

const fileStatusLetter: Record<string, string> = { added: "A", removed: "D", renamed: "R", copied: "C" }

const Section = (props: { title: string; defaultOpen: boolean; children: JSX.Element }) => {
  const [open, setOpen] = createSignal(untrack(() => props.defaultOpen))
  return (
    <Collapsible open={open()} onOpenChange={(next: boolean) => setOpen(next)} render={(p) => <section {...p} {...stylex.attrs(s.section)} />}>
      <CollapsibleTrigger xstyle={s.sectionTrigger}>
        {props.title}
        <span {...stylex.attrs(s.chevron, open() ? s.chevronOpen : null)}>
          <ChevronRightIcon size={13} />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div {...stylex.attrs(s.sectionBody)}>{props.children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

const ActivityCard = (props: { item: PullRequestActivity; repo: { owner: string; repo: string } }) => (
  <article {...stylex.attrs(s.card)}>
    <div {...stylex.attrs(s.cardMeta)}>
      <UserAvatar name={props.item.author ?? "ghost"} src={props.item.authorAvatarUrl} size={18} />
      <span {...stylex.attrs(s.who)}>{props.item.author ?? "ghost"}</span>
      <Show when={props.item.reviewState}>
        {(state) => (
          <>
            <ReviewStateIcon state={state()} size={13} />
            {reviewStateLabel[state()]}
          </>
        )}
      </Show>
      <a href={props.item.url} target="_blank" rel="noreferrer" title={new Date(props.item.createdAt).toLocaleString()} {...stylex.attrs(s.cardTime)}>
        {formatRelative(props.item.createdAt)}
      </a>
    </div>
    <Show when={props.item.body.trim() !== ""}>
      <Markdown source={props.item.body} repo={props.repo} xstyle={s.cardBody} />
    </Show>
  </article>
)

const Summary = (props: {
  pr: PullRequestDetail
  onComment: (body: string) => Promise<void>
  commentRef: (el: HTMLTextAreaElement) => void
}) => {
  const repo = () => ({ owner: props.pr.owner, repo: props.pr.repo })
  const reviewers = () => reviewersOf(props.pr)
  const conversation = () => props.pr.activity.filter((a) => a.kind === "comment" || a.body.trim() !== "" || a.reviewState !== "commented")
  return (
    <div {...stylex.attrs(s.scroll)}>
      <div {...stylex.attrs(s.column)}>
        <div {...stylex.attrs(s.metaRow)}>
          <span {...stylex.attrs(s.metaLabel)}><UsersIcon size={13} /> Reviewers</span>
          <span {...stylex.attrs(s.metaValue)}>
            <For each={reviewers()} fallback={<span {...stylex.attrs(s.none)}>None</span>}>
              {(r) => (
                <span {...stylex.attrs(s.reviewer)} title={r.state ? `${r.login}: ${reviewStateLabel[r.state]}` : `${r.login}: review requested`}>
                  <UserAvatar name={r.login} src={r.avatar} size={18} />
                  {r.login}
                  <Show when={r.state}>{(state) => <ReviewStateIcon state={state()} size={12} />}</Show>
                </span>
              )}
            </For>
          </span>
        </div>
        <div {...stylex.attrs(s.metaRow)}>
          <span {...stylex.attrs(s.metaLabel)}><TagIcon size={13} /> Labels</span>
          <span {...stylex.attrs(s.metaValue)}>
            <For each={props.pr.labels} fallback={<span {...stylex.attrs(s.none)}>None</span>}>
              {(label) => (
                <span {...stylex.attrs(s.labelChip)}>
                  <span {...stylex.attrs(s.labelDot)} style={{ "background-color": `#${label.color ?? "9b9b97"}` }} />
                  {label.name}
                </span>
              )}
            </For>
          </span>
        </div>

        <Section title="Description" defaultOpen>
          <Show when={props.pr.body.trim() !== ""} fallback={<span {...stylex.attrs(s.none)}>No description provided.</span>}>
            <Markdown source={props.pr.body} repo={repo()} xstyle={s.description} />
          </Show>
        </Section>

        <Section title={`Checks (${props.pr.checks.length})`} defaultOpen={props.pr.checks.some((c) => c.status === "failure")}>
          <For each={props.pr.checks} fallback={<span {...stylex.attrs(s.none)}>No checks reported.</span>}>
            {(check) => (
              <a href={check.url ?? props.pr.url} target="_blank" rel="noreferrer" {...stylex.attrs(s.check)}>
                <CheckStatusIcon status={check.status} />
                <span {...stylex.attrs(s.checkName)}>{check.name}</span>
                <span {...stylex.attrs(s.checkState)}>{checkStatusLabel[check.status]}</span>
              </a>
            )}
          </For>
        </Section>

        <Section title={`Conversation (${conversation().length})`} defaultOpen>
          <For each={conversation()} fallback={<span {...stylex.attrs(s.none)}>No comments yet.</span>}>
            {(item) => <ActivityCard item={item} repo={repo()} />}
          </For>
          <div {...stylex.attrs(s.composer)}>
            <CommentBox onSubmit={props.onComment} inputRef={props.commentRef} />
          </div>
        </Section>
      </div>
    </div>
  )
}

/** A pending inline comment, sent with the review. */
type Draft = DraftReviewComment & { readonly id: string }
/** Where a new inline comment is being written. */
type Composing = { readonly path: string } & DiffLineRange

const threadKey = (path: string, side: "LEFT" | "RIGHT", line: number) => `${path}\u0000${side}\u0000${line}`

const InlineThread = (props: {
  comments: ReadonlyArray<PullRequestReviewComment>
  drafts: ReadonlyArray<Draft>
  composing: Composing | null
  repo: { owner: string; repo: string }
  onAdd: (body: string) => void
  onCommentNow: (body: string) => Promise<void>
  onCancel: () => void
  onDiscard: (id: string) => void
}) => (
  <div {...stylex.attrs(s.thread)}>
    <For each={props.comments}>
      {(c) => (
        <div {...stylex.attrs(s.threadComment)}>
          <div {...stylex.attrs(s.cardMeta)}>
            <UserAvatar name={c.author ?? "ghost"} src={c.authorAvatarUrl} size={16} />
            <span {...stylex.attrs(s.who)}>{c.author ?? "ghost"}</span>
            <a href={c.url} target="_blank" rel="noreferrer" {...stylex.attrs(s.cardTime)}>{formatRelative(c.createdAt)}</a>
          </div>
          <Markdown source={c.body} repo={props.repo} xstyle={s.threadBody} />
        </div>
      )}
    </For>
    <For each={props.drafts}>
      {(d) => (
        <div {...stylex.attrs(s.threadComment)}>
          <div {...stylex.attrs(s.cardMeta)}>
            <span {...stylex.attrs(s.pending)}>Pending</span>
            <Show when={d.startLine !== null}>lines {d.startLine}–{d.line}</Show>
            <Button size="icon-xs" variant="ghost" title="Discard" onClick={() => props.onDiscard(d.id)} xstyle={s.cardTime}>
              <TrashIcon size={12} />
            </Button>
          </div>
          <Markdown source={d.body} repo={props.repo} xstyle={s.threadBody} />
        </div>
      )}
    </For>
    <Show when={props.composing}>
      <CommentBox
        autofocus
        placeholder="Comment on this line… (markdown)"
        submitLabel="Add to review"
        secondary={{ label: "Comment now", run: props.onCommentNow }}
        onSubmit={props.onAdd}
        onCancel={props.onCancel}
      />
    </Show>
  </div>
)

const Files = (props: {
  pr: PullRequestDetail
  layout: "unified" | "split"
  drafts: ReadonlyArray<Draft>
  composing: Composing | null
  onPickLines: (path: string, range: DiffLineRange) => void
  onAdd: (body: string) => void
  onCommentNow: (body: string) => Promise<void>
  onCancel: () => void
  onDiscard: (id: string) => void
}) => {
  let api: DiffViewApi | undefined
  const binary = () => props.pr.files.filter((f) => f.patch === null)
  /** Inline comments on lines still in the diff, by thread; replies sit under their first comment. */
  const byKey = createMemo(() => {
    const roots = new Map(props.pr.reviewComments.map((c) => [c.id, c]))
    const map = new Map<string, Array<PullRequestReviewComment>>()
    for (const c of props.pr.reviewComments) {
      const root = c.inReplyTo !== null ? roots.get(c.inReplyTo) ?? c : c
      if (root.line === null) continue
      const key = threadKey(root.path, root.side, root.line)
      map.set(key, [...(map.get(key) ?? []), c])
    }
    return map
  })
  const commentsAt = (key: string) => byKey().get(key) ?? []
  const threadsOf = (path: string): ReadonlyArray<DiffThreadAnchor> => {
    const anchors = new Map<string, DiffThreadAnchor>()
    const add = (side: "LEFT" | "RIGHT", line: number) => anchors.set(threadKey(path, side, line), { side, line, key: threadKey(path, side, line) })
    for (const key of byKey().keys()) {
      const [p, side, line] = key.split("\u0000")
      if (p === path) add(side as "LEFT" | "RIGHT", Number(line))
    }
    for (const d of props.drafts) if (d.path === path) add(d.side, d.line)
    if (props.composing?.path === path) add(props.composing.side, props.composing.line)
    return [...anchors.values()]
  }
  return (
    <div {...stylex.attrs(s.files)}>
      <nav {...stylex.attrs(s.fileList)} aria-label="Changed files">
        <For each={props.pr.files}>
          {(file) => (
            <button
              type="button"
              {...stylex.attrs(s.fileRow)}
              title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
              onClick={() => (file.patch ? api?.scrollToFile(file.path) : window.open(`${props.pr.url}/files`, "_blank", "noopener"))}
            >
              <span {...stylex.attrs(s.fileStat)} style={{ color: file.status === "added" ? ADD : file.status === "removed" ? DEL : undefined }}>
                {fileStatusLetter[file.status] ?? "M"}
              </span>
              <span {...stylex.attrs(s.fileName)}>{file.path}</span>
              <span {...stylex.attrs(s.fileStat)} style={{ color: ADD }}>+{file.additions}</span>
              <span {...stylex.attrs(s.fileStat)} style={{ color: DEL }}>−{file.deletions}</span>
            </button>
          )}
        </For>
        <Show when={props.pr.files.length < props.pr.changedFiles}>
          <div {...stylex.attrs(s.binary)}>
            Showing {props.pr.files.length} of {props.pr.changedFiles} files.{" "}
            <a href={`${props.pr.url}/files`} target="_blank" rel="noreferrer">See all on GitHub</a>
          </div>
        </Show>
        <Show when={binary().length > 0}>
          <div {...stylex.attrs(s.binary)}>
            {binary().length === 1 ? "1 file has" : `${binary().length} files have`} no text diff (binary or too large).
          </div>
        </Show>
      </nav>
      <div {...stylex.attrs(s.diff)}>
        <DiffView
          files={props.pr.files}
          cacheKey={`${props.pr.owner}/${props.pr.repo}#${props.pr.number}@${props.pr.headSha}`}
          layout={props.layout}
          apiRef={(a) => (api = a)}
          threads={threadsOf}
          renderThread={(key) => (
            <InlineThread
              comments={commentsAt(key)}
              drafts={props.drafts.filter((d) => threadKey(d.path, d.side, d.line) === key)}
              composing={props.composing && threadKey(props.composing.path, props.composing.side, props.composing.line) === key ? props.composing : null}
              repo={{ owner: props.pr.owner, repo: props.pr.repo }}
              onAdd={props.onAdd}
              onCommentNow={props.onCommentNow}
              onCancel={props.onCancel}
              onDiscard={props.onDiscard}
            />
          )}
          onPickLines={props.pr.state === "open" || props.pr.state === "draft" ? props.onPickLines : undefined}
        />
      </div>
    </div>
  )
}

const errorText = (e: unknown) => (e as { message?: string }).message ?? String(e)

export const PullRequestPage = () => {
  const sync = useContext(Sync)
  const params = useParams()
  const navigate = useNavigate()
  const coords = createMemo(() => ({ owner: params.owner ?? "", repo: params.repo ?? "", number: Number(params.number) }))
  const [detail, setDetail] = createSignal<PullRequestDetail | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [tab, setTab] = createSignal<Tab>("summary")
  const [layout, setLayout] = createSignal<"unified" | "split">("unified")
  const [order, setOrder] = createSignal<"oldest" | "newest">("oldest")
  const [copied, setCopied] = createSignal(false)
  const [drafts, setDrafts] = createSignal<ReadonlyArray<Draft>>([])
  const [composing, setComposing] = createSignal<Composing | null>(null)
  const [reviewOpen, setReviewOpen] = createSignal(false)
  const [reviewEvent, setReviewEvent] = createSignal<ReviewEvent>("comment")
  const [reviewBody, setReviewBody] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)
  const [mergeMethod, setMergeMethod] = createSignal<MergeMethod | null>(null)
  const [merging, setMerging] = createSignal(false)
  let commentEl: HTMLTextAreaElement | undefined
  let generation = 0

  const load = (c: { owner: string; repo: string; number: number }) => {
    const mine = ++generation
    setLoading(true)
    setError(null)
    sync.call((client) => client.GithubPullRequest(c)).then(
      (pr) => {
        if (mine !== generation) return
        setDetail(pr)
        setLoading(false)
      },
      (e) => {
        if (mine !== generation) return
        setError(errorText(e))
        setLoading(false)
      }
    )
  }

  // A new pull request starts on its summary, without the previous one's data or drafts.
  createEffect(coords, (c) => {
    setDetail(null)
    setTab("summary")
    setDrafts([])
    setComposing(null)
    load(c)
  })

  const acting = () => githubAccount.account()?.actingAs ?? null
  const ref = () => coords()
  const live = () => detail()?.state === "open" || detail()?.state === "draft"

  const comment = async (body: string) => {
    const added = await sync.call((c) => c.GithubPullRequestComment({ ...ref(), body }))
    setDetail((d) => (d ? { ...d, activity: [...d.activity, added] } : d))
  }

  /** A review with what is pending; "Comment now" on a line sends just that one. */
  const submitReview = async (event: ReviewEvent, body: string, comments: ReadonlyArray<DraftReviewComment>) => {
    const pr = detail()
    if (!pr) return
    await sync.call((c) => c.GithubPullRequestReview({ ...ref(), event, body, commitSha: pr.headSha, comments: comments.map(({ path, line, side, startLine, body }) => ({ path, line, side, startLine, body })) }))
  }
  const sendReview = async () => {
    setSubmitting(true)
    try {
      await submitReview(reviewEvent(), reviewBody(), drafts())
      setDrafts([])
      setReviewBody("")
      setReviewOpen(false)
      toast.success(reviewEvent() === "approve" ? "Approved" : reviewEvent() === "request_changes" ? "Changes requested" : "Review sent")
      load(ref())
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setSubmitting(false)
    }
  }
  const addDraft = (body: string) => {
    const at = composing()
    if (!at) return
    setDrafts((list) => [...list, { id: crypto.randomUUID(), path: at.path, line: at.line, side: at.side, startLine: at.startLine, body }])
    setComposing(null)
  }
  const commentNow = async (body: string) => {
    const at = composing()
    if (!at) return
    await submitReview("comment", "", [{ path: at.path, line: at.line, side: at.side, startLine: at.startLine, body }])
    setComposing(null)
    load(ref())
  }

  const methodLabel: Record<MergeMethod, string> = { merge: "Create a merge commit", squash: "Squash and merge", rebase: "Rebase and merge" }
  const chosenMethod = (): MergeMethod => {
    const allowed = detail()?.mergeMethods ?? []
    const picked = mergeMethod()
    return picked && allowed.includes(picked) ? picked : allowed[0] ?? "merge"
  }
  /** Why merging is off, or null when GitHub may accept it (protection is still GitHub's call). */
  const mergeBlocked = (): string | null => {
    const pr = detail()
    if (!pr) return "Loading"
    if (pr.state === "draft") return "Draft pull requests cannot be merged. Mark it ready on GitHub first."
    if (pr.mergeable === false || pr.mergeableState === "dirty") return `Conflicts with ${pr.baseBranch}: resolve them first.`
    if (pr.mergeMethods.length === 0) return "The repository allows no merge method."
    return null
  }
  const mergeNote = () => {
    const state = detail()?.mergeableState
    return state === "blocked"
      ? "Branch protection may block this: required reviews or checks."
      : state === "unstable"
      ? "Some checks are failing."
      : state === "behind"
      ? "The branch is behind its base."
      : null
  }
  const merge = async () => {
    const pr = detail()
    if (!pr || mergeBlocked() || merging()) return
    const method = chosenMethod()
    if (!confirm(`${methodLabel[method]}: ${pr.owner}/${pr.repo}#${pr.number} into ${pr.baseBranch}?`)) return
    setMerging(true)
    try {
      await sync.call((c) => c.GithubPullRequestMerge({ ...ref(), method, sha: pr.headSha }))
      toast.success(`Merged #${pr.number} into ${pr.baseBranch}`)
      load(ref())
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setMerging(false)
    }
  }

  const openOnGithub = () => {
    const url = detail()?.url ?? `https://github.com/${coords().owner}/${coords().repo}/pull/${coords().number}`
    window.open(url, "_blank", "noopener,noreferrer")
  }
  // Back to where it was opened from (an issue); a link opened on its own goes to the issues.
  const back = () => (window.history.length > 1 ? window.history.back() : navigate("/"))

  useScope("pr.detail")
  useCommands([
    { id: "pr.back", title: "Back", group: "Navigation", keys: ["escape", "u"], scope: "pr.detail", run: back },
    { id: "pr.openGithub", title: "Open pull request on GitHub", group: "Pull request", keys: ["o"], scope: "pr.detail", run: openOnGithub },
    { id: "pr.summary", title: "Show summary", group: "Pull request", keys: ["1"], scope: "pr.detail", run: () => setTab("summary") },
    { id: "pr.timeline", title: "Show timeline", group: "Pull request", keys: ["2"], scope: "pr.detail", run: () => setTab("timeline") },
    { id: "pr.files", title: "Show changed files", group: "Pull request", keys: ["3"], scope: "pr.detail", run: () => setTab("files") },
    {
      id: "pr.timelineOrder",
      title: "Flip timeline order",
      group: "Pull request",
      scope: "pr.detail",
      when: () => tab() === "timeline",
      run: () => setOrder((o) => (o === "oldest" ? "newest" : "oldest"))
    },
    {
      id: "pr.layout",
      title: "Toggle split diff",
      group: "Pull request",
      keys: ["v"],
      scope: "pr.detail",
      when: () => tab() === "files",
      run: () => setLayout((l) => (l === "split" ? "unified" : "split"))
    },
    { id: "pr.refresh", title: "Refresh pull request", group: "Pull request", keys: ["r"], scope: "pr.detail", run: () => load(coords()) },
    {
      id: "pr.comment",
      title: "Comment on pull request",
      group: "Pull request",
      keys: ["m"],
      scope: "pr.detail",
      run: () => {
        setTab("summary")
        requestAnimationFrame(() => commentEl?.focus())
      }
    },
    { id: "pr.review", title: "Review pull request…", group: "Pull request", keys: ["shift+r"], scope: "pr.detail", when: live, run: () => setReviewOpen(true) },
    { id: "pr.merge", title: "Merge pull request", group: "Pull request", keys: ["shift+m"], scope: "pr.detail", when: live, run: () => void merge() }
  ])

  const copyHead = (branch: string) => {
    void navigator.clipboard?.writeText(branch).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div {...stylex.attrs(s.page)}>
      <PageHeader
        title={
          <>
            <Button variant="ghost" size="icon-xs" title="Back (Esc)" onClick={back}>
              <ArrowLeftIcon size={14} />
            </Button>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>{coords().owner}/{coords().repo}</BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>
                    <span style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}>
                      <Show when={detail()}>{(pr) => <PullRequestIcon state={pr().state} />}</Show>
                      #{coords().number}
                    </span>
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="icon-sm" title="Refresh (R)" disabled={loading()} onClick={() => load(coords())}>
              <RefreshIcon size={14} />
            </Button>
            <Button variant="outline" size="sm" title="Open on GitHub (O)" onClick={openOnGithub}>
              <GithubIcon size={14} /> Open on GitHub <ExternalIcon size={12} />
            </Button>
            <Show when={live()}>
              <Popover open={reviewOpen()} onOpenChange={(next: boolean) => setReviewOpen(next)}>
                <PopoverTrigger
                  render={(p) => (
                    <Button {...(p as ButtonProps)} variant="outline" size="sm" title="Review (⇧R)">
                      Review
                      <Show when={drafts().length > 0}><span {...stylex.attrs(s.count)}>{drafts().length}</span></Show>
                      <ChevronDownIcon size={12} />
                    </Button>
                  )}
                />
                <PopoverContent align="end" xstyle={s.reviewPopover} onClick={(e: MouseEvent) => e.stopPropagation()}>
                  <KeyScope name="review" blocking>
                    <div {...stylex.attrs(s.review)}>
                      <div {...stylex.attrs(s.reviewTitle)}>Finish your review</div>
                      <Show when={acting()} fallback={<GithubConnect label="Connect GitHub to review" compact />}>
                        <Textarea
                          aria-label="Review summary"
                          placeholder="Leave a summary… (markdown)"
                          value={reviewBody()}
                          onInput={(e) => setReviewBody(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault()
                              void sendReview()
                            }
                          }}
                          xstyle={s.reviewInput}
                        />
                        <div {...stylex.attrs(s.reviewEvents)} role="radiogroup" aria-label="Review outcome">
                          <For each={[
                            { value: "comment" as const, label: "Comment", hint: "General feedback, no verdict." },
                            { value: "approve" as const, label: "Approve", hint: "Ready to merge." },
                            { value: "request_changes" as const, label: "Request changes", hint: "Must be addressed before merging." }
                          ]}>
                            {(option) => (
                              <label {...stylex.attrs(s.reviewEvent)}>
                                <input
                                  type="radio"
                                  name="review-event"
                                  checked={reviewEvent() === option.value}
                                  onChange={() => setReviewEvent(option.value)}
                                />
                                <span>
                                  {option.label}
                                  <span {...stylex.attrs(s.reviewEventHint)}>{option.hint}</span>
                                </span>
                              </label>
                            )}
                          </For>
                        </div>
                        <div {...stylex.attrs(s.reviewNote)}>
                          {drafts().length === 0
                            ? "Add inline comments from the + beside a line in Files."
                            : `${drafts().length} pending inline ${drafts().length === 1 ? "comment" : "comments"} will be sent.`}
                        </div>
                        <div {...stylex.attrs(s.reviewActions)}>
                          <Button size="sm" variant="ghost" onClick={() => setReviewOpen(false)}>Cancel</Button>
                          <Button size="sm" disabled={submitting()} onClick={() => void sendReview()}>
                            {submitting() ? "Sending…" : "Submit review"}
                          </Button>
                        </div>
                      </Show>
                    </div>
                  </KeyScope>
                </PopoverContent>
              </Popover>
              <Show
                when={acting()}
                fallback={
                  <Button size="sm" title={mergeBlocked() ?? "Connect your GitHub account to merge (Profile → GitHub)"} onClick={() => navigate("/profile")}>
                    <PullRequestIcon state="merged" size={13} /> Merge
                  </Button>
                }
              >
                <ButtonGroup>
                  <Button
                    size="sm"
                    disabled={mergeBlocked() !== null || merging()}
                    title={mergeBlocked() ?? mergeNote() ?? `${methodLabel[chosenMethod()]} (⇧M)`}
                    onClick={() => void merge()}
                  >
                    <PullRequestIcon state="merged" size={13} />
                    {merging() ? "Merging…" : methodLabel[chosenMethod()]}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={(p) => (
                        <Button {...(p as ButtonProps)} size="icon-sm" disabled={mergeBlocked() !== null || merging()} title="Merge method">
                          <ChevronDownIcon size={13} />
                        </Button>
                      )}
                    />
                    <DropdownMenuContent align="end">
                      <KeyScope name="menu" blocking>
                        <For each={detail()?.mergeMethods ?? []}>
                          {(method) => (
                            <DropdownMenuItem onClick={() => setMergeMethod(method)}>
                              <span style={{ width: "14px", display: "inline-flex" }}>
                                <Show when={chosenMethod() === method}><CheckIcon size={13} /></Show>
                              </span>
                              {methodLabel[method]}
                            </DropdownMenuItem>
                          )}
                        </For>
                        <Show when={mergeNote()}>{(note) => <div {...stylex.attrs(s.mergeHint)} style={{ padding: "6px 8px" }}>{note()}</div>}</Show>
                      </KeyScope>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ButtonGroup>
              </Show>
            </Show>
          </>
        }
      />
      <Switch>
        <Match when={detail()}>
          {(pr) => (
            <>
              <div {...stylex.attrs(s.head)}>
                <h1 {...stylex.attrs(s.title)}>
                  {pr().title} <span {...stylex.attrs(s.number)}>#{pr().number}</span>
                </h1>
                <div {...stylex.attrs(s.line)}>
                  <span
                    {...stylex.attrs(s.pill)}
                    style={{
                      color: pullRequestColor(pr().state),
                      "background-color": `color-mix(in srgb, ${pr().state === "draft" ? "currentColor" : pullRequestColor(pr().state)} 14%, transparent)`
                    }}
                  >
                    <PullRequestIcon state={pr().state} size={13} />
                    {pullRequestLabel[pr().state]}
                  </span>
                  <UserAvatar name={pr().author ?? "ghost"} src={pr().authorAvatarUrl} size={18} />
                  <span {...stylex.attrs(s.who)}>{pr().author ?? "ghost"}</span>
                  <span title={new Date(pr().mergedAt ?? pr().closedAt ?? pr().createdAt).toLocaleString()}>
                    {pr().mergedAt
                      ? `merged ${formatRelative(pr().mergedAt!)}`
                      : pr().closedAt
                      ? `closed ${formatRelative(pr().closedAt!)}`
                      : `opened ${formatRelative(pr().createdAt)}`}
                  </span>
                  <span {...stylex.attrs(s.dot)} />
                  <span>updated {formatRelative(pr().updatedAt)}</span>
                  <Show when={pr().mergeable === false && (pr().state === "open" || pr().state === "draft")}>
                    <span {...stylex.attrs(s.dot)} />
                    <span {...stylex.attrs(s.conflict)}>Conflicts with {pr().baseBranch}</span>
                  </Show>
                </div>
                <div {...stylex.attrs(s.line)}>
                  <span {...stylex.attrs(s.branches)}>
                    <span {...stylex.attrs(s.branch)} title={pr().baseBranch}>{pr().baseBranch}</span>
                    <ArrowLeftIcon size={12} />
                    <button type="button" {...stylex.attrs(s.branch)} title="Copy branch name" onClick={() => copyHead(pr().headBranch)}>
                      {copied() ? "Copied" : pr().headBranch}
                    </button>
                  </span>
                  <span {...stylex.attrs(s.stats)}>
                    <span {...stylex.attrs(s.stat)} title="Commits"><CommitIcon size={13} /> {pr().commits}</span>
                    <span {...stylex.attrs(s.stat)} title="Comments">
                      <MessageIcon size={13} /> {pr().activity.filter((a) => a.kind === "comment").length}
                    </span>
                    <span {...stylex.attrs(s.stat)} title="Files changed"><FileDiffIcon size={13} /> {pr().changedFiles}</span>
                    <span style={{ color: ADD, "font-family": font.mono }}>+{pr().additions.toLocaleString()}</span>
                    <span style={{ color: DEL, "font-family": font.mono }}>−{pr().deletions.toLocaleString()}</span>
                  </span>
                </div>
              </div>
              <nav {...stylex.attrs(s.tabs)} aria-label="Pull request tabs">
                <ToggleGroup
                  variant="outline"
                  size="sm"
                  spacing={0}
                  value={[tab()]}
                  onValueChange={(value: ReadonlyArray<string>) => {
                    const next = value[0] as Tab | undefined
                    if (next) setTab(next)
                  }}
                >
                  <For each={TABS}>
                    {(t) => (
                      <ToggleGroupItem value={t.value}>{t.label}</ToggleGroupItem>
                    )}
                  </For>
                </ToggleGroup>
                <div {...stylex.attrs(s.tabsEnd)}>
                  <Show when={tab() === "timeline"}>
                    <span {...stylex.attrs(s.stat)} title="Comments">
                      <MessageIcon size={13} /> {pr().timeline.filter((i) => i.kind === "comment" || i.kind === "inline").length}
                    </span>
                    <span {...stylex.attrs(s.stat)} title="Commits">
                      <CommitIcon size={13} /> {pr().timeline.filter((i) => i.kind === "commit").length}
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      title={order() === "oldest" ? "Show newest first" : "Show oldest first"}
                      onClick={() => setOrder((o) => (o === "oldest" ? "newest" : "oldest"))}
                    >
                      <SortIcon size={12} /> {order() === "oldest" ? "Oldest first" : "Newest first"}
                    </Button>
                  </Show>
                  <Show
                    when={tab() === "summary"}
                    fallback={tab() === "timeline" ? null : (
                      <ToggleGroup
                        variant="outline"
                        size="sm"
                        spacing={0}
                        value={[layout()]}
                        onValueChange={(value: ReadonlyArray<string>) => {
                          const next = value[0] as "unified" | "split" | undefined
                          if (next) setLayout(next)
                        }}
                      >
                        <ToggleGroupItem value="unified">Unified</ToggleGroupItem>
                        <ToggleGroupItem value="split">Split</ToggleGroupItem>
                      </ToggleGroup>
                    )}
                  >
                    <Show when={checksSummary(pr().checks)} fallback={<span>No checks</span>}>
                      {(summary) => (
                        <>
                          <CheckStatusIcon status={summary().status} />
                          {summary().text}
                        </>
                      )}
                    </Show>
                  </Show>
                </div>
              </nav>
              <div {...stylex.attrs(s.body)}>
                <Show when={tab() === "timeline"}>
                  <PullRequestTimeline pr={pr()} order={order()} />
                </Show>
                <Show
                  when={tab() === "summary"}
                  fallback={tab() === "timeline" ? null : (
                    <Files
                      pr={pr()}
                      layout={layout()}
                      drafts={drafts()}
                      composing={composing()}
                      onPickLines={(path, range) => setComposing({ path, ...range })}
                      onAdd={addDraft}
                      onCommentNow={commentNow}
                      onCancel={() => setComposing(null)}
                      onDiscard={(id) => setDrafts((list) => list.filter((d) => d.id !== id))}
                    />
                  )}
                >
                  <Summary pr={pr()} onComment={comment} commentRef={(el) => (commentEl = el)} />
                </Show>
              </div>
            </>
          )}
        </Match>
        <Match when={error()}>
          {(message) => (
            <div {...stylex.attrs(s.center)}>
              <div>
                <p>{message()}</p>
                <Button variant="outline" size="sm" onClick={openOnGithub}>
                  <GithubIcon size={14} /> Open on GitHub
                </Button>
              </div>
            </div>
          )}
        </Match>
        <Match when={true}>
          <div {...stylex.attrs(s.skeletons)}>
            <Skeleton style={{ height: "24px", width: "60%" }} />
            <Skeleton style={{ height: "14px", width: "40%" }} />
            <Skeleton style={{ height: "14px", width: "50%" }} />
            <Skeleton style={{ height: "160px", width: "100%" }} />
          </div>
        </Match>
      </Switch>
    </div>
  )
}
