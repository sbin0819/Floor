import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/stress",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3111",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: {
    command: "pnpm dev --port 3111",
    url: "http://127.0.0.1:3111/dev/stress-render",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      FLOOR_STRESS_TEST: "1",
      DATABASE_URL: "",
      AUTH_SECRET: "",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3111",
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
});
