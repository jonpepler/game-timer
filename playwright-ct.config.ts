import { defineConfig, devices } from "@playwright/experimental-ct-react";
import path from "node:path";

export default defineConfig({
  testDir: "./tests-ct",
  snapshotDir: "./tests-ct/__screenshots__",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    trace: "on-first-retry",
    colorScheme: "dark",
    ctViteConfig: {
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "./src"),
        },
      },
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
