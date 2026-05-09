import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const webPort = Number(process.env.SECRET_WIKI_WEB_PORT ?? 5173);
const apiPort = Number(process.env.SECRET_WIKI_API_PORT ?? process.env.PORT ?? 3001);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`
    }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  }
});
