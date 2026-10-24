import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  base: "./",
  server: { host: "127.0.0.1" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        commerce: fileURLToPath(new URL("commerce.html", import.meta.url)),
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        render: fileURLToPath(new URL("render.html", import.meta.url)),
      },
    },
  },
});
