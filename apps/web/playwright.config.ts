import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer:
    process.env.E2E_EXTERNAL_SERVER === "true"
      ? undefined
      : {
          command: "pnpm dev --hostname 0.0.0.0",
          url: `${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/signin`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
