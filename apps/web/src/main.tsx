import "@fontsource-variable/inter"
import "./global.css"
import "./theme/theme.ts"
import { render } from "@solidjs/web"
import { Match, onSettled, Switch } from "solid-js"
import { auth } from "./app/auth.ts"
import { Sync } from "./app/context.ts"
import { KeymapProvider } from "./keys/solid.tsx"
import { Router } from "./app/router.tsx"
import { Shell } from "./app/Shell.tsx"
import { AuthPage } from "./pages/AuthPage.tsx"
import { createSyncEngine } from "./sync/engine.ts"

/** The signed-in app. It mounts per session, so signing out drops the synced data with it. */
const App = () => {
  const engine = createSyncEngine({ onUnauthorized: auth.sessionEnded, onDisconnected: auth.connectionLost })
  onSettled(() => {
    engine.start()
    return () => engine.dispose()
  })
  return (
    <Sync value={engine}>
      <KeymapProvider>
        <Router>{(props) => <Shell>{props.children}</Shell>}</Router>
      </KeymapProvider>
    </Sync>
  )
}

const Root = () => {
  onSettled(() => void auth.refresh())
  return (
    <Switch>
      <Match when={auth.session() === null}>
        <AuthPage />
      </Match>
      {/* Switching accounts always passes through null, so the app remounts per session. */}
      <Match when={auth.session()?.user.id}>
        {() => <App />}
      </Match>
    </Switch>
  )
}

render(() => <Root />, document.getElementById("root")!)
