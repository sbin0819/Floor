import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm start --port 3100",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      env: {
        AUTH_SECRET: "floor-e2e-placeholder-secret-at-least-32-bytes",
        DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/floor",
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        GITHUB_CLIENT_ID: "",
        GITHUB_CLIENT_SECRET: "",
        ABLY_API_KEY: "",
        LIVEKIT_URL: "",
        LIVEKIT_API_KEY: "",
        LIVEKIT_API_SECRET: "",
        FILE_STORAGE: "disabled",
        FILE_STORAGE_DIR: "",
      },
    },
    {
      command: "node --import=tsx tests/e2e/serve-storybook.ts",
      url: "http://127.0.0.1:6106",
      reuseExistingServer: false,
    },
  ],
});
