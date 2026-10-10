import { test, expect, Page } from "@playwright/test";
import { config } from "../general-config";
import {
  loginViaUrl,
  trackPortalRequests,
  waitForPortalRequestsToSettle,
} from "../ux/utils/ux-general-utils";

/*
 * Visual snapshots of the key pages (MOD-D29), compared with the images in
 * snapshots/<project>/ within the tolerance in visual-pw.config.ts. The
 * portal chrome (header, navigation, layout, portlet title bars) is
 * compared everywhere; on the dashboards the portlet bodies are masked,
 * because they show live data (news feeds, dates, who is online). The
 * maximised portlet is static content and compared whole.
 *
 * Re-baseline after an intended change: see docs/browser-a11y-tests.md.
 */

interface KeyPage {
  name: string;
  user?: keyof typeof config.users;
  path: string;
  maskPortletContent: boolean;
}

const KEY_PAGES: KeyPage[] = [
  {
    name: "guest-welcome",
    path: "f/welcome/normal/render.uP",
    maskPortletContent: true,
  },
  { name: "student-home", user: "student", path: "", maskPortletContent: true },
  { name: "admin-home", user: "admin", path: "", maskPortletContent: true },
  {
    name: "admin-portlet-manager",
    user: "admin",
    path: "p/portlet-admin/max/render.uP",
    maskPortletContent: true,
  },
  {
    name: "student-maximized-portlet",
    user: "student",
    path: "p/what-is-uportal/max/render.uP",
    maskPortletContent: false,
  },
];

async function open(page: Page, keyPage: KeyPage): Promise<void> {
  if (keyPage.user === undefined) {
    await trackPortalRequests(page);
    await page.goto(`${config.url}${keyPage.path}`);
  } else {
    await loginViaUrl(page, config.users[keyPage.user]);
    if (keyPage.path === "") return;
    await page.goto(`${config.url}${keyPage.path}`);
  }
  await waitForPortalRequestsToSettle(page);
  await page.evaluate(async () => document.fonts.ready);
}

test.describe("Visual snapshots", () => {
  for (const keyPage of KEY_PAGES) {
    test(keyPage.name, async ({ page }) => {
      await open(page, keyPage);
      const mask = keyPage.maskPortletContent
        ? [page.locator(".up-portlet-content-wrapper")]
        : [];
      await expect(page).toHaveScreenshot(`${keyPage.name}.png`, {
        mask,
        animations: "disabled",
        caret: "hide",
      });
    });
  }
});
