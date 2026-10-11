import { devices, type PlaywrightTestConfig } from "@playwright/test";
import base from "./uportal-pw.config";

/*
 * Visual snapshots of the key pages (tests/visual/*.visual.ts), on
 * Chromium at the desktop size and on a phone viewport. A snapshot that
 * does not exist yet is written instead of compared; re-baseline with
 * --update-snapshots (docs/browser-a11y-tests.md).
 */
const config: PlaywrightTestConfig = {
  ...base,
  testDir: "visual",
  testMatch: "**/*.visual.ts",
  retries: 0,
  // One page at a time: in four runs (38106773735 to 38120174431) the guest
  // page's load event never fired when both workers opened their first page
  // on a fresh portal at the same moment
  workers: 1,
  // The first pages after the portal starts load its caches
  timeout: 60_000,
  updateSnapshots: "missing",
  snapshotPathTemplate: "{testDir}/snapshots/{projectName}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      // Font hinting and anti-aliasing differ slightly between runs and
      // runner images; a moved or restyled element changes far more
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
    },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
};
export default config;
