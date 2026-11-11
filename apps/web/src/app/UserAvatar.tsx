import * as stylex from "@stylexjs/stylex"
import { Show } from "solid-js"
import { colors } from "../lib/tokens.stylex.ts"
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar.tsx"

/*
 * A person's avatar: shadcn's Avatar at the small sizes this app uses, with
 * initials on a color picked from the name while the image loads or when it
 * fails. Without a name it is an empty dashed circle ("no assignee").
 */

const s = stylex.create({
  size16: { width: 16, height: 16 },
  size18: { width: 18, height: 18 },
  size24: { width: 24, height: 24 },
  initials: { color: "#fff", fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1 },
  empty: { borderWidth: 1, borderStyle: "dashed", borderColor: colors.mutedForeground, backgroundColor: "transparent" }
})

type Size = 16 | 18 | 24
const sizes = { 16: s.size16, 18: s.size18, 24: s.size24 }

const avatarColors = ["#7c6f64", "#5b7083", "#6d7a5b", "#8a6a7d", "#5f7a78", "#7a6a55", "#6b6b8a"]
const hashHue = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("")

export const UserAvatar = (props: { name?: string | null; src?: string | null; size?: Size }) => {
  const size = () => props.size ?? 18
  return (
    <Show
      when={props.name}
      fallback={
        <Avatar size="sm" xstyle={sizes[size()]}>
          <AvatarFallback xstyle={s.empty} />
        </Avatar>
      }
    >
      {(name) => (
        <Avatar size="sm" xstyle={sizes[size()]} title={name()}>
          <Show when={props.src}>{(src) => <AvatarImage src={src()} alt="" />}</Show>
          <AvatarFallback
            xstyle={s.initials}
            style={{
              "font-size": `${Math.round(size() * 0.42)}px`,
              "background-color": avatarColors[hashHue(name()) % avatarColors.length]
            }}
          >
            {initials(name())}
          </AvatarFallback>
        </Avatar>
      )}
    </Show>
  )
}
