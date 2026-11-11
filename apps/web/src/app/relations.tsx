import { type Issue, uuidv7, wouldCycle } from "@gradient/domain"
import * as stylex from "@stylexjs/stylex"
import { createMemo, For, Match, Show, Switch, untrack, useContext } from "solid-js"
import {
  commentsFor,
  issueHref,
  issueKey,
  issueReferences,
  issueRepo,
  openBlockers,
  pullRequestsFor,
  relationsOf,
  type RelatedIssue,
  resolveMentions
} from "../lib/select.ts"
import { colors } from "../lib/tokens.stylex.ts"
import { Button, type ButtonProps } from "../ui/button.tsx"
import { BlockedIcon, GithubIcon, PlusIcon, PullRequestIcon, pullRequestLabel, StateIcon, XIcon } from "../ui/icons.tsx"
import { Sync } from "./context.ts"
import { Picker, type PickerApi } from "./Picker.tsx"

/*
 * The issue sidebar's relations (blocked by, blocking, related), the pull
 * requests that refer to the issue, and what the issue itself mentions. Relations are edited here and through the
 * issue.blockedBy / issue.blocks / issue.related commands.
 */

const s = stylex.create({
  section: { display: "flex", flexDirection: "column", gap: 1, marginTop: 6 },
  header: { display: "flex", alignItems: "center", gap: 6, minHeight: 26 },
  heading: { color: colors.mutedForeground, fontSize: "0.75rem", flexGrow: 1 },
  blocked: { color: colors.destructive, display: "inline-flex", alignItems: "center", gap: 6 },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 28,
    paddingInline: 6,
    marginInline: -6,
    borderRadius: 6,
    fontSize: "0.8125rem",
    color: colors.foreground,
    backgroundColor: { default: "transparent", ":hover": colors.accent }
  },
  link: { display: "flex", alignItems: "center", gap: 8, flexGrow: 1, minWidth: 0, minHeight: 28, color: "inherit" },
  key: { color: colors.mutedForeground, fontSize: "0.75rem", fontVariantNumeric: "tabular-nums", flexShrink: 0 },
  title: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { color: colors.mutedForeground },
  glyph: { display: "inline-flex", width: 14, justifyContent: "center", flexShrink: 0 },
  remove: { opacity: { default: 0.5, ":hover": 1 } }
})

export type RelationKind = "blockedBy" | "blocks" | "related"

export type RelationApis = Partial<Record<RelationKind, PickerApi>>

const TITLES: Record<RelationKind, { heading: string; placeholder: string }> = {
  blockedBy: { heading: "Blocked by", placeholder: "Blocked by which issue…" },
  blocks: { heading: "Blocking", placeholder: "Blocking which issue…" },
  related: { heading: "Related", placeholder: "Related to which issue…" }
}

const Section = (props: {
  issue: Issue
  kind: RelationKind
  items: ReadonlyArray<RelatedIssue>
  apiRef: (api: PickerApi) => void
}) => {
  const sync = useContext(Sync)
  const title = untrack(() => TITLES[props.kind])
  const holding = () => props.kind === "blockedBy" && openBlockers(sync.state, props.issue.id).length > 0

  /** Issues this one can relate to: same team, not itself, not related yet, and no blocking loop. */
  const candidates = () => {
    const self = props.issue
    const relations = Object.values(sync.state.issueRelations)
    const taken = new Set(relations.flatMap((r) =>
      r.issueId === self.id ? [r.relatedIssueId] : r.relatedIssueId === self.id ? [r.issueId] : []
    ))
    return Object.values(sync.state.issues)
      .filter((i) => i.teamId === self.teamId && i.id !== self.id && i.archivedAt === null && !taken.has(i.id))
      .filter((i) =>
        props.kind === "blockedBy"
          ? !wouldCycle(relations, i.id, self.id)
          : props.kind === "blocks"
          ? !wouldCycle(relations, self.id, i.id)
          : true
      )
      .sort((a, b) => b.number - a.number)
  }

  const add = (otherId: string) => {
    const self = props.issue
    const [issueId, relatedIssueId] = props.kind === "blockedBy" ? [otherId, self.id] : [self.id, otherId]
    sync.mutate({
      _tag: "RelationCreate",
      id: uuidv7(),
      teamId: self.teamId,
      type: props.kind === "related" ? "related" : "blocks",
      issueId,
      relatedIssueId
    })
  }

  return (
    <div {...stylex.attrs(s.section)}>
      <div {...stylex.attrs(s.header)}>
        <span {...stylex.attrs(s.heading)}>
          <Show when={holding()} fallback={title.heading}>
            <span {...stylex.attrs(s.blocked)}>
              <BlockedIcon size={13} />
              {title.heading}
            </span>
          </Show>
        </span>
        <Picker
          apiRef={props.apiRef}
          align="end"
          placeholder={title.placeholder}
          emptyText="No other issues"
          items={candidates().map((i) => ({
            value: i.id,
            label: i.title,
            hint: issueKey(sync.state, i),
            keywords: issueKey(sync.state, i),
            icon: () => (
              <Show when={sync.state.workflowStates[i.stateId]}>
                {(st) => <StateIcon type={st().type} color={st().color} />}
              </Show>
            )
          }))}
          selected={[]}
          onPick={add}
          trigger={(p) => (
            <Button {...(p as ButtonProps)} variant="ghost" size="icon-xs" title={`Add: ${title.heading.toLowerCase()}`}>
              <PlusIcon size={13} />
            </Button>
          )}
        />
      </div>
      <For each={props.items}>
        {(entry) => (
          <div {...stylex.attrs(s.item)}>
            <a href={issueHref(sync.state, entry.issue)} {...stylex.attrs(s.link)} title={entry.issue.title}>
              <Show when={sync.state.workflowStates[entry.issue.stateId]}>
                {(st) => <StateIcon type={st().type} color={st().color} size={14} />}
              </Show>
              <span {...stylex.attrs(s.key)}>{issueKey(sync.state, entry.issue)}</span>
              <span {...stylex.attrs(s.title)}>{entry.issue.title}</span>
            </a>
            <Button
              variant="ghost"
              size="icon-xs"
              xstyle={s.remove}
              title="Remove relation"
              onClick={() => sync.mutate({ _tag: "RelationDelete", id: entry.relation.id })}
            >
              <XIcon size={12} />
            </Button>
          </div>
        )}
      </For>
    </div>
  )
}

/** Blocked by, blocking and related issues, each with a picker to add one. */
export const IssueRelations = (props: { issue: Issue; apis: RelationApis }) => {
  const sync = useContext(Sync)
  const relations = () => relationsOf(sync.state, props.issue.id)
  return (
    <>
      <Section issue={props.issue} kind="blockedBy" items={relations().blockedBy} apiRef={(a) => (props.apis.blockedBy = a)} />
      <Section issue={props.issue} kind="blocks" items={relations().blocks} apiRef={(a) => (props.apis.blocks = a)} />
      <Section issue={props.issue} kind="related" items={relations().related} apiRef={(a) => (props.apis.related = a)} />
    </>
  )
}

/** Pull requests that close this issue on GitHub or mention its identifier. Hidden when there are none. */
export const IssuePullRequests = (props: { issue: Issue }) => {
  const sync = useContext(Sync)
  const pullRequests = () => pullRequestsFor(sync.state, props.issue)
  const repoName = (repoId: string) => {
    const repo = sync.state.githubRepos[repoId]
    return repo ? `${repo.owner}/${repo.name}` : ""
  }
  return (
    <Show when={pullRequests().length > 0}>
      <div {...stylex.attrs(s.section)}>
        <div {...stylex.attrs(s.header)}>
          <span {...stylex.attrs(s.heading)}>Pull requests</span>
        </div>
        <For each={pullRequests()}>
          {(pr) => (
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              {...stylex.attrs(s.item)}
              title={`${pullRequestLabel[pr.state]} · ${repoName(pr.repoId)}#${pr.number}${pr.author ? ` by @${pr.author}` : ""}`}
            >
              <PullRequestIcon state={pr.state} />
              <span {...stylex.attrs(s.key)}>#{pr.number}</span>
              <span {...stylex.attrs(s.title)}>{pr.title}</span>
            </a>
          )}
        </For>
      </div>
    </Show>
  )
}

/**
 * Issues and pull requests mentioned in the description or the comments
 * (`#12`, `acme/web#3`, `TES-12`, a GitHub link), in reading order. Hidden
 * when there are none.
 */
export const IssueMentions = (props: { issue: Issue }) => {
  const sync = useContext(Sync)
  // Parse only when the text changes; resolve against the store on every change.
  const refs = createMemo(() =>
    issueReferences(props.issue.description, commentsFor(sync.state, props.issue.id), issueRepo(sync.state, props.issue))
  )
  const mentions = () => resolveMentions(sync.state, props.issue, refs())
  return (
    <Show when={mentions().length > 0}>
      <div {...stylex.attrs(s.section)}>
        <div {...stylex.attrs(s.header)}>
          <span {...stylex.attrs(s.heading)}>Mentions</span>
        </div>
        <For each={mentions()}>
          {(m) => (
            <Switch>
              <Match when={m.kind === "issue" && m}>
                {(entry) => (
                  <a href={issueHref(sync.state, entry().issue)} {...stylex.attrs(s.item)} title={entry().issue.title}>
                    <Show when={sync.state.workflowStates[entry().issue.stateId]}>
                      {(st) => <StateIcon type={st().type} color={st().color} size={14} />}
                    </Show>
                    <span {...stylex.attrs(s.key)}>{issueKey(sync.state, entry().issue)}</span>
                    <span {...stylex.attrs(s.title)}>{entry().issue.title}</span>
                  </a>
                )}
              </Match>
              <Match when={m.kind === "pullRequest" && m}>
                {(entry) => (
                  <a
                    href={entry().pullRequest.url}
                    target="_blank"
                    rel="noreferrer"
                    {...stylex.attrs(s.item)}
                    title={`${pullRequestLabel[entry().pullRequest.state]} pull request${entry().pullRequest.author ? ` by @${entry().pullRequest.author}` : ""}`}
                  >
                    <PullRequestIcon state={entry().pullRequest.state} />
                    <span {...stylex.attrs(s.key)}>{entry().label}</span>
                    <span {...stylex.attrs(s.title)}>{entry().pullRequest.title}</span>
                  </a>
                )}
              </Match>
              <Match when={m.kind === "github" && m}>
                {(entry) => (
                  <a href={entry().url} target="_blank" rel="noreferrer" {...stylex.attrs(s.item)} title="Open on GitHub">
                    <span {...stylex.attrs(s.glyph)}>
                      <GithubIcon size={13} />
                    </span>
                    <span {...stylex.attrs(s.key)}>{entry().label}</span>
                    <span {...stylex.attrs(s.title, s.muted)}>on GitHub</span>
                  </a>
                )}
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </Show>
  )
}
