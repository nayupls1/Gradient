import "./global.css"
import * as stylex from "@stylexjs/stylex"
import { createSignal } from "solid-js"
import { render } from "@solidjs/web"
import { colors } from "./tokens.stylex.ts"

const s = stylex.create({ root: { color: colors.fg, backgroundColor: colors.bg, padding: 16 } })

function App() {
  const [n, setN] = createSignal(0)
  return <div {...stylex.attrs(s.root)}><button onClick={() => setN((x) => x + 1)}>count {n()}</button><pre id="v">{String(colors.bg)}</pre></div>
}
render(() => <App />, document.getElementById("root")!)
