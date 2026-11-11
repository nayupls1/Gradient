import * as stylex from "@stylexjs/stylex"

const s = stylex.create({
  // Longhands: StyleX lets the Textarea's own `paddingInline`/`paddingBlock` beat a `padding` shorthand.
  bareTextarea: {
    minHeight: 0,
    paddingInline: 0,
    paddingBlock: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    boxShadow: "none",
    resize: "none"
  }
})

/** Turns shadcn's Textarea into a borderless editor that grows with its text (titles, descriptions). */
export const bareTextarea = s.bareTextarea
