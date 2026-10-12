import type { PlaywrightTestConfig } from "@playwright/test";
import base from "./uportal-pw.config";

/*
 * The accessibility ratchet (tests/a11y/*.a11y.ts) on Chromium. Its own
 * file suffix keeps it out of the default suite.
 */
const config: PlaywrightTestConfig = {
  ...base,
  testDir: "a11y",
  testMatch: "**/*.a11y.ts",
  // A ratchet result is deterministic; a retry would only hide a flaky page
  retries: 0,
};
export default config;
