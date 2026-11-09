import * as stylex from "@stylexjs/stylex"
import type { JSX } from "@solidjs/web"
import { color, font } from "../theme/tokens.stylex.ts"

const s = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    flexShrink: 0,
    paddingInline: 20,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
    fontSize: font.md
  },
  title: { fontWeight: 600, display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  spacer: { flexGrow: 1 }
})

export const PageHeader = (props: { title: JSX.Element; actions?: JSX.Element }) => (
  <header {...stylex.attrs(s.header)}>
    <div {...stylex.attrs(s.title)}>{props.title}</div>
    <div {...stylex.attrs(s.spacer)} />
    {props.actions}
  </header>
)
