import type { PullRequestDetail, PullRequestTimelineItem } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import type { JSX } from "@solidjs/web"
import { For, Match, Show, Switch } from "solid-js"
import { formatRelative, pullRequestHrefFromUrl } from "../lib/select.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { font } from "../theme/tokens.stylex.ts"
import {
  CommitIcon,
  GithubIcon,
  PencilIcon,
  PullRequestIcon,
  ReviewStateIcon,
  reviewStateLabel,
  TagIcon,
  TrashIcon,
  UserIcon,
  UsersIcon
} from "../ui/icons.tsx"
import { Markdown } from "./Markdown.tsx"
import { UserAvatar } from "./UserAvatar.tsx"

/*
 * A pull request's timeline, after t3code's: one rail, each row marked with
 * who did it (or an icon), in order. Commits, comments, reviews and inline
 * comments carry their text; what people did to it (labels, review requests,
 * force-pushes, renames, references, merges) is one line each. Rows skip
 * rendering while off screen (`content-visibility`), so long histories stay
 * cheap without a virtual list.
 */

const s = stylex.create({
  scroll: { position: "absolute", inset: 0, overflowY: "auto" },
  column: { position: "relative", maxWidth: 860, paddingInline: 24, paddingTop: 16, paddingBottom: 64 },
  rail: { position: "absolute", left: 39, top: 28, bottom: 76, width: 1, backgroundColor: colors.border },
  row: {
    position: "relative",
    paddingLeft: 48,
    marginBottom: 18,
    contentVisibility: "auto",
    containIntrinsicBlockSize: "auto 48px"
  },
  compact: { marginBottom: 12 },
  marker: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    color: colors.mutedForeground
  },
  smallMarker: { height: 22 },
  line: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    minHeight: 32,
    fontSize: "0.8125rem",
    color: colors.mutedForeground
  },
  smallLine: { minHeight: 22, fontSize: "0.75rem" },
  who: { color: colors.foreground, fontWeight: 600 },
  strong: { color: colors.foreground, fontWeight: 500 },
  time: { color: { default: colors.mutedForeground, ":hover": colors.foreground }, fontSize: "0.75rem" },
  card: {
    marginTop: 6,
    paddingBlock: 10,
    paddingInline: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    fontSize: 14,
    lineHeight: 1.6
  },
  quiet: { backgroundColor: colors.muted, fontSize: 13, borderColor: "transparent" },
  commit: { display: "flex", alignItems: "center", gap: 10, minHeight: 32, color: "inherit", minWidth: 0 },
  commitTitle: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "0.8125rem",
    fontWeight: 500,
    color: { default: colors.foreground, ":hover": colors.primary }
  },
  sha: { fontFamily: font.mono, fontSize: "0.6875rem", color: colors.mutedForeground, flexShrink: 0 },
  label: {
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
  dot: { width: 7, height: 7, borderRadius: 999 },
  struck: { textDecorationLine: "line-through" },
  ref: { color: { default: colors.foreground, ":hover": colors.primary }, fontWeight: 500 },
  empty: { color: colors.mutedForeground, fontSize: "0.8125rem", paddingTop: 24 }
})

const Time = (props: { at: number; url?: string | null }) => (
  <Show when={props.url} fallback={<span {...stylex.attrs(s.time)} title={new Date(props.at).toLocaleString()}>{formatRelative(props.at)}</span>}>
    {(url) => (
      <a href={url()} target="_blank" rel="noreferrer" {...stylex.attrs(s.time)} title={new Date(props.at).toLocaleString()}>
        {formatRelative(props.at)}
      </a>
    )}
  </Show>
)

const Avatar = (props: { item: PullRequestTimelineItem }) => (
  <UserAvatar name={props.item.actor ?? "ghost"} src={props.item.actorAvatarUrl} size={24} />
)

/** A row with a marker on the rail. `small` rows are the one-line events. */
const Row = (props: { marker: JSX.Element; small?: boolean; children: JSX.Element }) => (
  <div {...stylex.attrs(s.row, props.small ? s.compact : null)}>
    <span {...stylex.attrs(s.marker, props.small ? s.smallMarker : null)}>{props.marker}</span>
    {props.children}
  </div>
)

const Who = (props: { item: PullRequestTimelineItem }) => <span {...stylex.attrs(s.who)}>{props.item.actor ?? "ghost"}</span>

const LIFECYCLE: Partial<Record<PullRequestTimelineItem["kind"], { state: "open" | "draft" | "merged" | "closed"; text: string }>> = {
  opened: { state: "open", text: "opened this pull request" },
  merged: { state: "merged", text: "merged this pull request" },
  closed: { state: "closed", text: "closed this pull request" },
  reopened: { state: "open", text: "reopened this pull request" },
  ready: { state: "open", text: "marked this ready for review" },
  draft: { state: "draft", text: "marked this as a draft" }
}

const Item = (props: { item: PullRequestTimelineItem; pr: PullRequestDetail }) => {
  const repo = () => ({ owner: props.pr.owner, repo: props.pr.repo })
  const item = () => props.item
  return (
    <Switch>
      <Match when={item().kind === "commit"}>
        <Row marker={<CommitIcon size={14} />}>
          <a href={item().url ?? props.pr.url} target="_blank" rel="noreferrer" {...stylex.attrs(s.commit)} title={item().body ?? ""}>
            <span {...stylex.attrs(s.commitTitle)}>{item().body || "Untitled commit"}</span>
            <span {...stylex.attrs(s.sha)}>{item().sha?.slice(0, 7)}</span>
            <span {...stylex.attrs(s.time)}>{item().actor} · {formatRelative(item().at)}</span>
          </a>
        </Row>
      </Match>
      <Match when={item().kind === "comment"}>
        <Row marker={<Avatar item={item()} />}>
          <div {...stylex.attrs(s.line)}>
            <Who item={item()} /> commented <Time at={item().at} url={item().url} />
          </div>
          <Show when={(item().body ?? "").trim() !== ""}>
            <div {...stylex.attrs(s.card)}>
              <Markdown source={item().body ?? ""} repo={repo()} />
            </div>
          </Show>
        </Row>
      </Match>
      <Match when={item().kind === "review" && item().reviewState}>
        {(state) => (
          <Row marker={<Avatar item={item()} />}>
            <div {...stylex.attrs(s.line)}>
              <ReviewStateIcon state={state()} size={14} />
              <Who item={item()} /> {reviewStateLabel[state()]} <Time at={item().at} url={item().url} />
            </div>
            <Show when={(item().body ?? "").trim() !== ""}>
              <div {...stylex.attrs(s.card)}>
                <Markdown source={item().body ?? ""} repo={repo()} />
              </div>
            </Show>
          </Row>
        )}
      </Match>
      <Match when={item().kind === "inline"}>
        <Row marker={<Avatar item={item()} />}>
          <div {...stylex.attrs(s.line)}>
            <Who item={item()} /> commented on <code {...stylex.attrs(s.sha)}>{item().subject}</code>
            <Time at={item().at} url={item().url} />
          </div>
          <div {...stylex.attrs(s.card, s.quiet)}>
            <Markdown source={item().body ?? ""} repo={repo()} />
          </div>
        </Row>
      </Match>
      <Match when={LIFECYCLE[item().kind]}>
        {(life) => (
          <Row marker={<PullRequestIcon state={life().state} size={15} />}>
            <div {...stylex.attrs(s.line)}>
              <Who item={item()} /> <span {...stylex.attrs(s.strong)}>{life().text}</span>
              <Show when={item().kind === "merged" && item().sha}>
                {(sha) => <code {...stylex.attrs(s.sha)}>{sha().slice(0, 7)}</code>}
              </Show>
              <Time at={item().at} />
            </div>
          </Row>
        )}
      </Match>
      <Match when={(item().kind === "labeled" || item().kind === "unlabeled") && item().label}>
        {(label) => (
          <Row small marker={<TagIcon size={13} />}>
            <div {...stylex.attrs(s.line, s.smallLine)}>
              <Who item={item()} /> {item().kind === "labeled" ? "added" : "removed"}
              <span {...stylex.attrs(s.label, item().kind === "unlabeled" ? s.struck : null)}>
                <span {...stylex.attrs(s.dot)} style={{ "background-color": `#${label().color ?? "9b9b97"}` }} />
                {label().name}
              </span>
              <Time at={item().at} />
            </div>
          </Row>
        )}
      </Match>
      <Match when={item().kind === "review_requested" || item().kind === "review_request_removed"}>
        <Row small marker={<UsersIcon size={13} />}>
          <div {...stylex.attrs(s.line, s.smallLine)}>
            <Who item={item()} /> {item().kind === "review_requested" ? "requested a review from" : "removed the review request for"}
            <span {...stylex.attrs(s.strong)}>{item().subject ?? "someone"}</span>
            <Time at={item().at} />
          </div>
        </Row>
      </Match>
      <Match when={item().kind === "assigned" || item().kind === "unassigned"}>
        <Row small marker={<UserIcon size={13} />}>
          <div {...stylex.attrs(s.line, s.smallLine)}>
            <Who item={item()} /> {item().kind === "assigned" ? "assigned" : "unassigned"}
            <span {...stylex.attrs(s.strong)}>{item().subject ?? "someone"}</span>
            <Time at={item().at} />
          </div>
        </Row>
      </Match>
      <Match when={item().kind === "force_pushed"}>
        <Row small marker={<CommitIcon size={13} />}>
          <div {...stylex.attrs(s.line, s.smallLine)}>
            <Who item={item()} /> force-pushed <code {...stylex.attrs(s.sha)}>{props.pr.headBranch}</code>
            <Time at={item().at} />
          </div>
        </Row>
      </Match>
      <Match when={item().kind === "branch_deleted"}>
        <Row small marker={<TrashIcon size={13} />}>
          <div {...stylex.attrs(s.line, s.smallLine)}>
            <Who item={item()} /> deleted the <code {...stylex.attrs(s.sha)}>{props.pr.headBranch}</code> branch
            <Time at={item().at} />
          </div>
        </Row>
      </Match>
      <Match when={item().kind === "renamed"}>
        <Row small marker={<PencilIcon size={13} />}>
          <div {...stylex.attrs(s.line, s.smallLine)}>
            <Who item={item()} /> changed the title
            <span {...stylex.attrs(s.struck)}>{item().detail}</span>
            <span {...stylex.attrs(s.strong)}>{item().subject}</span>
            <Time at={item().at} />
          </div>
        </Row>
      </Match>
      <Match when={item().kind === "referenced"}>
        <Row small marker={<GithubIcon size={12} />}>
          <div {...stylex.attrs(s.line, s.smallLine)}>
            <Who item={item()} /> mentioned this in
            <a
              href={(item().url && pullRequestHrefFromUrl(item().url!)) || item().url || "#"}
              {...(item().url && pullRequestHrefFromUrl(item().url!) ? {} : { target: "_blank", rel: "noreferrer" })}
              {...stylex.attrs(s.ref)}
            >
              {item().detail} {item().subject}
            </a>
            <Time at={item().at} />
          </div>
        </Row>
      </Match>
    </Switch>
  )
}

export const PullRequestTimeline = (props: { pr: PullRequestDetail; order: "oldest" | "newest" }) => {
  const items = () => (props.order === "newest" ? [...props.pr.timeline].reverse() : props.pr.timeline)
  return (
    <div {...stylex.attrs(s.scroll)}>
      <div {...stylex.attrs(s.column)}>
        <Show when={items().length > 1}>
          <span {...stylex.attrs(s.rail)} aria-hidden="true" />
        </Show>
        <For each={items()} fallback={<div {...stylex.attrs(s.empty)}>No activity yet.</div>}>
          {(item) => <Item item={item} pr={props.pr} />}
        </For>
      </div>
    </div>
  )
}
