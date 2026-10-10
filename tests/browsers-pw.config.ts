import { devices, type PlaywrightTestConfig } from "@playwright/test";
import base from "./uportal-pw.config";

/*
 * The suite on other browsers (MOD-D29), run nightly: every UI spec on
 * Firefox and WebKit at the default desktop size, and the smoke, auth and
 * skin specs on a phone viewport. Select one with --project.
 */
const desktop = { viewport: { width: 1280, height: 720 } };

const config: PlaywrightTestConfig = {
  ...base,
  testDir: "ux",
  projects: [
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], ...desktop },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], ...desktop },
    },
    {
      name: "phone",
      use: { ...devices["Pixel 7"] },
      testMatch: [
        "smoke/guest-page.spec.ts",
        "auth/**/*.spec.ts",
        "skin/**/*.spec.ts",
      ],
    },
  ],
};
export default config;
