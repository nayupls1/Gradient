import "@fontsource-variable/inter"
import "./global.css"
import "./theme/theme.ts"
import { render } from "@solidjs/web"
import { onSettled } from "solid-js"
import { Sync } from "./app/context.ts"
import { Router } from "./app/router.tsx"
import { Shell } from "./app/Shell.tsx"
import { createSyncEngine } from "./sync/engine.ts"

const App = () => {
  const engine = createSyncEngine()
  onSettled(() => {
    engine.start()
    return () => engine.dispose()
  })
  return (
    <Sync value={engine}>
      <Router>{(props) => <Shell>{props.children}</Shell>}</Router>
    </Sync>
  )
}

render(() => <App />, document.getElementById("root")!)
