import { createServer } from "vite";
const server = await createServer({
  root: process.cwd(),
  publicDir: "apps/web/public",
  cacheDir: `node_modules/.vite-test-${process.env.TEST_PORT ?? 4175}`,
  optimizeDeps: {
    include: [
      "idb",
      "fflate",
      "ajv/dist/2020.js",
      "ajv-formats",
      "fontkit",
      "fabric",
      "react",
      "react-dom/client",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.TEST_PORT ?? 4175),
    strictPort: true,
  },
});
await server.listen();
