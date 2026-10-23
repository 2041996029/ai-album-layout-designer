import { defineConfig } from "@playwright/test";
const port = Number(process.env.TEST_PORT ?? 4175);
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: "npx tsx tests/browser/harness/host.ts",
    url: `http://127.0.0.1:${port}/tests/browser/harness/`,
    reuseExistingServer: false,
  },
});
