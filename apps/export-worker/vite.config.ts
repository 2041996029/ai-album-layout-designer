import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: fileURLToPath(new URL("preflight.html", import.meta.url)),
    },
  },
});
