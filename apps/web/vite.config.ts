import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const apiOrigin = process.env.HELIOS_API_ORIGIN ?? "http://127.0.0.1:4341";
const webPort = Number(process.env.HELIOS_WEB_PORT ?? 5184);

export default defineConfig({
  envDir: root,
  plugins: [react(), {
    name: "helios-complete-offline-shell",
    apply: "build",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle).filter(name => /\.(js|css)$/.test(name)).map(name => `/${name}`);
      assets.push("/fonts/Geist-Medium.woff2", "/fonts/GeistMono-Medium.woff2", "/yandex-logo.svg");
      const template = readFileSync(new URL("./public/sw.js", import.meta.url), "utf8");
      const version = createHash("sha256").update(template + JSON.stringify(assets)).digest("hex").slice(0, 16);
      this.emitFile({ type: "asset", fileName: "sw.js", source: template.replace("__HELIOS_BUILD__", version).replace("__HELIOS_SHELL_ASSETS__", JSON.stringify(assets)) });
    },
  }],
  server: {
    port: webPort,
    proxy: { "/api": apiOrigin },
  },
  preview: {
    port: webPort,
    proxy: { "/api": apiOrigin },
  },
});
