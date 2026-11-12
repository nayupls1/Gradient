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
      {/*
        Keyed, so the app remounts per account. The child must be plain JSX: a
        zero-argument function child is not called by Match but handed to the
        renderer, which builds the whole app inside an effect callback, where
        nothing is tracked (dialogs, for one, never open).
      */}
      <Match when={auth.session()?.user.id} keyed>
        <App />
      </Match>
    </Switch>
  )
}

render(() => <Root />, document.getElementById("root")!)
