import stylex from "@stylexjs/unplugin"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

const serverPort = Number(process.env.GRADIENT_PORT ?? 4100)

export default defineConfig({
  plugins: [stylex.vite({ useCSSLayers: true }), solid()],
  server: {
    port: Number(process.env.GRADIENT_WEB_PORT ?? 4200),
    proxy: {
      "/rpc": { target: `ws://localhost:${serverPort}`, ws: true },
      "/webhooks": `http://localhost:${serverPort}`,
      "/health": `http://localhost:${serverPort}`
    }
  }
})
