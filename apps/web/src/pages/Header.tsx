import * as stylex from "@stylexjs/stylex"
import type { JSX } from "@solidjs/web"
import { colors } from "../lib/tokens.stylex.ts"
import { Separator } from "../ui/separator.tsx"
import { SidebarTrigger } from "../ui/sidebar.tsx"

const s = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    flexShrink: 0,
    paddingLeft: 12,
    paddingRight: 20,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border
  },
  separator: { height: 16, alignSelf: "center" },
  title: { fontWeight: 600, display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  spacer: { flexGrow: 1 }
})

export const PageHeader = (props: { title: JSX.Element; actions?: JSX.Element }) => (
  <header {...stylex.attrs(s.header)}>
    <SidebarTrigger title="Toggle sidebar" />
    <Separator orientation="vertical" xstyle={s.separator} />
    <div {...stylex.attrs(s.title)}>{props.title}</div>
    <div {...stylex.attrs(s.spacer)} />
    {props.actions}
  </header>
)
