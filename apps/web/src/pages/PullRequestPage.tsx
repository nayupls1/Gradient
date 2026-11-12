import type { PullRequestActivity, PullRequestCheck, PullRequestCheckStatus, PullRequestDetail, PullRequestReviewState } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import type { JSX } from "@solidjs/web"
import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, Match, Show, Switch, untrack, useContext } from "solid-js"
import { Sync } from "../app/context.ts"
import { DiffView, type DiffViewApi } from "../app/DiffView.tsx"
import { Markdown } from "../app/Markdown.tsx"
import { UserAvatar } from "../app/UserAvatar.tsx"
import { useCommands, useScope } from "../keys/solid.tsx"
import { formatRelative } from "../lib/select.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { font } from "../theme/tokens.stylex.ts"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../ui/breadcrumb.tsx"
import { Button } from "../ui/button.tsx"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx"
import {
  ArrowLeftIcon,
  CheckStatusIcon,
  checkStatusLabel,
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
  ReviewStateIcon,
  reviewStateLabel,
  TagIcon,
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

type Tab = "summary" | "files"

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
  skeletons: { display: "flex", flexDirection: "column", gap: 10, padding: 24 }
})

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "summary", label: "Summary" },
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

const Summary = (props: { pr: PullRequestDetail }) => {
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
        </Section>
      </div>
    </div>
  )
}

const Files = (props: { pr: PullRequestDetail; layout: "unified" | "split" }) => {
  let api: DiffViewApi | undefined
  const binary = () => props.pr.files.filter((f) => f.patch === null)
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
          cacheKey={`${props.pr.owner}/${props.pr.repo}#${props.pr.number}@${props.pr.updatedAt}`}
          layout={props.layout}
          apiRef={(a) => (api = a)}
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
  const [copied, setCopied] = createSignal(false)
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

  // A new pull request starts on its summary, without the previous one's data.
  createEffect(coords, (c) => {
    setDetail(null)
    setTab("summary")
    load(c)
  })

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
    { id: "pr.files", title: "Show changed files", group: "Pull request", keys: ["2"], scope: "pr.detail", run: () => setTab("files") },
    {
      id: "pr.layout",
      title: "Toggle split diff",
      group: "Pull request",
      keys: ["v"],
      scope: "pr.detail",
      when: () => tab() === "files",
      run: () => setLayout((l) => (l === "split" ? "unified" : "split"))
    },
    { id: "pr.refresh", title: "Refresh pull request", group: "Pull request", keys: ["r"], scope: "pr.detail", run: () => load(coords()) }
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
                  <Show
                    when={tab() === "summary"}
                    fallback={
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
                    }
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
                <Show when={tab() === "summary"} fallback={<Files pr={pr()} layout={layout()} />}>
                  <Summary pr={pr()} />
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
