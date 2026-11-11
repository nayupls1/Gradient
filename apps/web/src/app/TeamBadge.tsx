import * as stylex from "@stylexjs/stylex"
import type { Team } from "@gradient/domain"
import { colors } from "../lib/tokens.stylex.ts"

const s = stylex.create({
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderRadius: 4,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    fontWeight: 700,
    color: colors.mutedForeground,
    lineHeight: 1
  }
})

/** A team's mark: the first letter of its key in a small tile. */
export const TeamBadge = (props: { team: Pick<Team, "key" | "name"> | undefined; size?: number }) => (
  <span
    {...stylex.attrs(s.badge)}
    style={{
      width: `${props.size ?? 16}px`,
      height: `${props.size ?? 16}px`,
      "font-size": `${Math.round((props.size ?? 16) * 0.56)}px`
    }}
    aria-hidden="true"
  >
    {props.team?.key.slice(0, 1) ?? "·"}
  </span>
)
