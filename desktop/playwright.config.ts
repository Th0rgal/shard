import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  retries: 0,
  workers: 1,
  reporter: "html",
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: "http://localhost:1420",
    // Collect trace when retrying the failed test
    trace: "on-first-retry",
    // Take screenshot on failure
    screenshot: "only-on-failure",
  },
  // Run the local dev server before starting tests
  webServer: {
    command: "bun run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
