import type { PlaywrightTestConfig } from "@playwright/test";

// Provided by Node at run time; declared here so tsc does not need @types/node.
declare const process: { env: Record<string, string | undefined> };

const config: PlaywrightTestConfig = {
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    video: "on-first-retry",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // The list reporter prints a line for every passing test, which buries the failures in a CI
  // job log. On CI the dot reporter prints a character per test and the failures with their
  // file and line at the end, and the github reporter adds an annotation for each failure.
  // Locally the list reporter shows each test as it runs.
  reporter: process.env.CI
    ? [["dot"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  // Warms the portal up before the first test (see global-setup.ts)
  globalSetup: "./global-setup.ts",
  // A failed test is retried so that the retry records a video and a trace,
  // and the report shows whether it fails every time. On CI a test that only
  // passes on a retry still fails the run (MOD-D29): a flaky test is a bug in
  // the test or in the portal, and retries must not hide it.
  retries: 2,
  failOnFlakyTests: Boolean(process.env.CI),
};
export default config;
