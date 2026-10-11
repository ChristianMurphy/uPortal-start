import { test, Page } from "@playwright/test";
import { config } from "../general-config";
import {
  loginViaUrl,
  trackPortalRequests,
  waitForPortalRequestsToSettle,
} from "../ux/utils/ux-general-utils";
import { baseline } from "./baseline";
import { WIDTHS, expectLayoutAsRecorded } from "./layout-checks";

/*
 * The layout checks of layout-checks.ts (MOD-D52) on every tab of each
 * quickstart user, the login page, each web component maximized and the
 * main admin pages, at the six standard widths. Each problem the pages have
 * today is in baseline.ts under "<page> <width>"; a problem that isn't
 * recorded fails the test. Re-record a page by copying the "observed" JSON
 * that the test attaches into baseline.ts (docs/layout-tests.md).
 */

/* A height that goes with each width: phone, phone, tablet, laptop, laptop, desktop */
const HEIGHTS: Record<(typeof WIDTHS)[number], number> = {
  320: 568,
  390: 844,
  768: 1024,
  1024: 768,
  1366: 768,
  1920: 1080,
};

interface Visitor {
  name: string;
  user?: keyof typeof config.users;
  /* pages besides the tabs: name -> path under the portal */
  pages: Record<string, string>;
}

const VISITORS: Visitor[] = [
  { name: "guest", pages: { login: "p/login" } },
  {
    name: "student",
    user: "student",
    pages: {
      "favorites max": "p/favorites/max/render.uP",
      "popular-portlets max": "p/popular-portlets/max/render.uP",
    },
  },
  { name: "staff", user: "staff", pages: {} },
  { name: "faculty", user: "faculty", pages: {} },
  {
    name: "admin",
    user: "admin",
    pages: {
      "portlet-admin": "p/portlet-admin/max/render.uP",
      permissionsmanager: "p/permissionsmanager/max/render.uP",
      groupsmanager: "p/groupsmanager/max/render.uP",
      "user-administration": "p/user-administration/max/render.uP",
    },
  },
];

/* The visitor's tabs as name -> URL, read from the tab bar */
async function tabs(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const result: Record<string, string> = {};
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      "#portalNavigationList a.portal-navigation-link",
    )) {
      const name = (link.getAttribute("title") ?? link.textContent ?? "")
        .trim()
        .toLowerCase()
        .replaceAll(/\s+/g, "-");
      result[`tab ${name}`] = link.href;
    }
    return result;
  });
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await waitForPortalRequestsToSettle(page);
}

/* Signs the visitor in (a guest just opens the portal) */
async function arrive(page: Page, visitor: Visitor): Promise<void> {
  if (visitor.user === undefined) {
    await trackPortalRequests(page);
    await open(page, config.url);
  } else {
    await loginViaUrl(page, config.users[visitor.user]);
  }
}

for (const width of WIDTHS) {
  test.describe(`Layout at ${width}px`, () => {
    test.use({ viewport: { width, height: HEIGHTS[width] } });

    for (const visitor of VISITORS) {
      test(visitor.name, async ({ page }, testInfo) => {
        test.setTimeout(300_000);
        await arrive(page, visitor);
        const urls: Record<string, string> = { ...(await tabs(page)) };
        for (const [name, path] of Object.entries(visitor.pages)) {
          urls[name] = `${config.url}${path}`;
        }
        for (const [name, url] of Object.entries(urls)) {
          await open(page, url);
          await expectLayoutAsRecorded(
            page,
            `${visitor.name} ${name} ${width}`,
            baseline,
            testInfo,
          );
        }
      });
    }
  });
}
