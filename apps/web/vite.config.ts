import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const apiOrigin = process.env.HELIOS_API_ORIGIN ?? "http://127.0.0.1:4341";
const webPort = Number(process.env.HELIOS_WEB_PORT ?? 5184);

export default defineConfig({
  envDir: root,
  plugins: [react()],
  server: {
    port: webPort,
    proxy: { "/api": apiOrigin },
  },
});
