import * as stylex from "@stylexjs/stylex"
import { color, font, radius } from "../theme/tokens.stylex.ts"

/** Layout shared by the people pages (teams, team settings, members, invites). */
export const page = stylex.create({
  scroll: { overflowY: "auto", flexGrow: 1 },
  column: { maxWidth: 760, marginInline: "auto", paddingInline: 32, paddingBlock: 32 },
  section: { marginBottom: 32 },
  h2: { display: "flex", alignItems: "center", gap: 8, margin: 0, marginBottom: 4, fontSize: font.lg, fontWeight: 600 },
  lede: { marginTop: 0, marginBottom: 12, color: color.fgMuted, fontSize: font.md },
  muted: { color: color.fgMuted, fontSize: font.md },
  subtle: { color: color.fgSubtle, fontSize: font.sm },
  error: { color: color.danger, fontSize: font.sm },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  grow: { flexGrow: 1, flexBasis: 0, minWidth: 180 },
  keyInput: { width: 90, flexShrink: 0, fontFamily: font.mono, letterSpacing: "0.06em", textTransform: "uppercase" },
  list: {
    display: "flex",
    flexDirection: "column",
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingBlock: 8,
    paddingInline: 12,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: color.border
  },
  itemText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flexGrow: 1 },
  itemTitle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: font.md,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: color.fg,
    textDecoration: "none"
  },
  empty: { paddingBlock: 10, paddingInline: 12, color: color.fgMuted, fontSize: font.md },
  badges: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" },
  actions: { display: "flex", alignItems: "center", gap: 4, flexShrink: 0 },
  menu: { minWidth: 200 }
})
