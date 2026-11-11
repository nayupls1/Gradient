import { createSignal, useContext } from "solid-js"
import { Sync } from "./context.ts"

/** The server's MCP URL, from the server itself (it knows its host and port). */
export const useMcpUrl = () => {
  const sync = useContext(Sync)
  const [url, setUrl] = createSignal("http://127.0.0.1:4100/mcp")
  sync.call((c) => c.ServerInfo()).then((info) => setUrl(info.mcpUrl), () => {})
  return url
}

/**
 * The one-liners that connect a coding agent to Gradient over MCP. Agents
 * authenticate with an agent key (`Authorization: Bearer grd_…`); without a
 * real key the commands show a placeholder.
 */
export const agentCommands = (url: string, key: string | null) => {
  const token = key ?? "<agent key>"
  return [
    {
      name: "Claude Code",
      command: `claude mcp add --transport http --scope user gradient ${url} --header "Authorization: Bearer ${token}"`
    },
    {
      name: "Codex",
      command: `export GRADIENT_API_KEY=${token}\ncodex mcp add gradient --url ${url} --bearer-token-env-var GRADIENT_API_KEY`
    }
  ]
}
