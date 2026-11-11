import stylex from "@stylexjs/unplugin"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

const serverPort = Number(process.env.GRADIENT_PORT ?? 4100)
const webPort = Number(process.env.GRADIENT_WEB_PORT ?? 4200)

export default defineConfig({
  plugins: [stylex.vite({ useCSSLayers: true }), solid()],
  server: {
    port: webPort,
    proxy: {
      "/rpc": { target: `ws://localhost:${serverPort}`, ws: true },
      "/webhooks": `http://localhost:${serverPort}`,
      "/repo-files": `http://localhost:${serverPort}`,
      "/health": `http://localhost:${serverPort}`
    }
  },
  // `bun run start`: the built app on the dev port, with the same proxy.
  preview: { port: webPort }
})
