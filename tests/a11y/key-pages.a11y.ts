import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { config } from "../general-config";
import {
  loginViaUrl,
  trackPortalRequests,
  waitForPortalRequestsToSettle,
} from "../ux/utils/ux-general-utils";
import { baseline } from "./baseline";

/*
 * Accessibility ratchet (MOD-D29): axe-core on the key pages. The
 * violations 5.17 has today are recorded in baseline.json by page, rule
 * and node; a violation that is not recorded fails the test, and one that
 * is recorded but gone is reported so the baseline can be tightened.
 *
 * A node is axe's CSS selector for the element, with every run of digits
 * replaced by "#", because portlet window and layout node ids differ
 * between portals. Re-record a page by copying the "observed" JSON that a
 * failing test prints into baseline.ts (docs/browser-a11y-tests.md).
 */

interface KeyPage {
  name: string;
  user?: keyof typeof config.users;
  path: string;
}

const KEY_PAGES: KeyPage[] = [
  { name: "guest-welcome", path: "f/welcome/normal/render.uP" },
  { name: "student-home", user: "student", path: "" },
  { name: "staff-home", user: "staff", path: "" },
  { name: "faculty-home", user: "faculty", path: "" },
  { name: "admin-home", user: "admin", path: "" },
  {
    name: "admin-portlet-manager",
    user: "admin",
    path: "p/portlet-admin/max/render.uP",
  },
  {
    name: "admin-permissions",
    user: "admin",
    path: "p/permissionsmanager/max/render.uP",
  },
  {
    name: "admin-groups",
    user: "admin",
    path: "p/groupsmanager/max/render.uP",
  },
  {
    name: "admin-users",
    user: "admin",
    path: "p/user-administration/max/render.uP",
  },
  {
    name: "student-maximized-portlet",
    user: "student",
    path: "p/what-is-uportal/max/render.uP",
  },
];

const normalize = (target: string): string => target.replaceAll(/\d+/g, "#");
const byText = (a: string, b: string): number => a.localeCompare(b);

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
}

async function observe(page: Page): Promise<Record<string, string[]>> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const observed: Record<string, string[]> = {};
  for (const violation of results.violations) {
    const nodes = violation.nodes.map((node) =>
      normalize(
        node.target
          .map((part) => (Array.isArray(part) ? part.join(" >>> ") : part))
          .join(" > "),
      ),
    );
    observed[violation.id] = [...new Set(nodes)].toSorted(byText);
  }
  return observed;
}

/* "rule: node" for every node in `a` that is not in `b` */
function missingFrom(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
): string[] {
  const missing: string[] = [];
  for (const [rule, nodes] of Object.entries(a)) {
    const known = new Set(b[rule] ?? []);
    missing.push(
      ...nodes
        .filter((node) => !known.has(node))
        .map((node) => `${rule}: ${node}`),
    );
  }
  return missing;
}

test.describe("Accessibility ratchet", () => {
  for (const keyPage of KEY_PAGES) {
    test(keyPage.name, async ({ page }, testInfo) => {
      await open(page, keyPage);
      const observed = await observe(page);
      const recorded = baseline[keyPage.name] ?? {};
      const json = JSON.stringify({ [keyPage.name]: observed });
      await testInfo.attach("observed", {
        body: json,
        contentType: "application/json",
      });
      testInfo.annotations.push({
        type: "fixed",
        description: `No longer seen; remove from baseline.ts: ${missingFrom(recorded, observed).join("; ") || "none"}`,
      });
      expect(
        missingFrom(observed, recorded),
        `New accessibility violations on ${keyPage.name}. observed=${json}`,
      ).toEqual([]);
    });
  }
});
