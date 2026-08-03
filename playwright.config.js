const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  webServer: {
    command: "python -m uvicorn app:app --host 127.0.0.1 --port 8769",
    url: "http://127.0.0.1:8769/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 20_000
  },
  use: {
    baseURL: "http://127.0.0.1:8769",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chrome",
      testIgnore: "**/webkit-smoke.spec.js",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] }
      }
    },
    {
      name: "edge",
      testIgnore: "**/webkit-smoke.spec.js",
      use: {
        ...devices["Desktop Edge"],
        channel: "msedge",
        launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] }
      }
    },
    {
      name: "firefox",
      testIgnore: "**/webkit-smoke.spec.js",
      use: {
        ...devices["Desktop Firefox"],
        firefoxUserPrefs: {
          "media.autoplay.default": 0,
          "media.autoplay.blocking_policy": 0,
          "media.autoplay.enabled.user-gestures-needed": false,
          "media.block-autoplay-until-in-foreground": false
        }
      }
    },
    {
      name: "webkit",
      testMatch: "**/webkit-smoke.spec.js",
      use: { ...devices["Desktop Safari"] }
    }
  ]
});
