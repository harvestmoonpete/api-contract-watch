import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:5191/api-contract-watch/",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command:
      "npm run build -- --base=/api-contract-watch/ && npx vite preview --base=/api-contract-watch/ --host 127.0.0.1 --port 5191 --strictPort",
    url: "http://127.0.0.1:5191/api-contract-watch/",
  },
});
