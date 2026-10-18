// Dev server for the timeline harness: `npx vite --config app/timeline/harness/vite.config.ts`.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");

// bb's own Inter, when bb is installed, so screenshots match the app.
const bbAssets = "/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/app/dist/assets";
const inter = existsSync(bbAssets) ? readdirSync(bbAssets).find((f) => f.startsWith("inter-latin-wght-normal")) : undefined;

export default defineConfig({
  root: here,
  resolve: { alias: { "@": repo } },
  define: { __HARNESS_INTER__: JSON.stringify(inter ? `/@fs${join(bbAssets, inter)}` : "") },
  server: { port: 5199, strictPort: true, fs: { allow: [repo, bbAssets] } },
  oxc: { jsx: { runtime: "automatic" } },
});
