import { test, expect, APIResponse, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { config } from "../../general-config";
import {
  sessionCsrfHeaders,
  trackPortalRequests,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";
import {
  CHECKS,
  WIDTHS,
  measureLayout,
  nodesByCheck,
} from "../../layout/layout-checks";

/*
 * MOD-I234: Respondr right to left. For a locale written right to left the
 * page gets dir="rtl" from the user's locale and links defaultSkin-rtl.css,
 * the skin mirrored with RTLCSS. The test runs the same checks in en-US and
 * in the ar-XB pseudo-locale (MOD-D51) and expects opposite answers: the
 * header, the page's columns and the portlet title bars start on the right,
 * icons that point along the line face the other way, and a web component on
 * the page reads right to left too. ar-XB has no messages, so the text stays
 * English; only the direction changes.
 *
 * The visitor is a guest, whose locale lasts for the browser session, so
 * the test changes nothing for other specs. ar-XB is a test locale, which
 * the portal offers only when deployed with -PtestPortalLocales=ar_XB.
 */

const WELCOME = `${config.url}f/welcome/normal/render.uP`;

/** Each locale and whether it is written right to left */
const LOCALES = [
  { code: "en_US", lang: "en-US", rtl: false },
  { code: "ar_XB", lang: "ar-XB", rtl: true },
] as const;

/*
 * The locale API (PUT /api/v6-0/locale) takes the portal's locales only
 * (portal_locales). The release doesn't offer ar-XB: CI's portals add it with
 * -PtestPortalLocales=ar_XB (gradle/tasks/tomcat.gradle). Elsewhere the spec
 * skips and says so.
 */
async function chooseLocale(page: Page, code: string): Promise<void> {
  const api = `${config.url}api/v6-0/locale`;
  await page.request.get(config.url);
  const offered: APIResponse<{ locales: { code: string }[] }> =
    await page.request.get(api);
  const { locales } = await offered.json();
  const codes = locales.map((locale) => locale.code);
  test.skip(
    !codes.includes(code),
    `The portal doesn't offer ${code}; deploy it with -PtestPortalLocales=${code}`,
  );
  const response = await page.request.put<unknown>(api, {
    data: { code },
    headers: await sessionCsrfHeaders(page.request),
  });
  expect(response.status(), `PUT ${api} ${code}`).toBe(200);
}

async function open(page: Page, url: string): Promise<void> {
  await trackPortalRequests(page);
  await page.goto(url);
  await waitForPortalRequestsToSettle(page);
}

/* Pairs of elements whose order mirrors: [first, second] */
const PAIRS: Record<string, [string, string]> = {
  "header: logo before search": [".portal-logo", "#webSearchContainer"],
  "columns: first before second": [
    ".portal-page-column.column-1",
    ".portal-page-column.column-2",
  ],
  "title bar: title before options": [
    ".up-portlet-titlebar .portlet-title",
    ".up-portlet-titlebar .portlet-options-menu",
  ],
};

/**
 * For each pair, whether the first element's content is to the right of the
 * second's. The content's box counts, not the element's: a title spans the
 * whole title bar in both directions, and only its text moves.
 */
async function startsOnTheRight(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate(
    (pairs) =>
      Object.fromEntries(
        Object.entries(pairs).map(([name, [first, second]]) => {
          const centers = [first, second].map((selector) => {
            const element = document.querySelector(selector);
            if (element === null) throw new Error(`no ${selector}`);
            const range = document.createRange();
            range.selectNodeContents(element);
            const box = range.getBoundingClientRect();
            return box.left + box.width / 2;
          });
          return [name, centers[0] > centers[1]];
        }),
      ),
    PAIRS,
  );
}

/** The horizontal scale of an icon's transform: -1 when it is mirrored */
async function iconScale(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate(
      (icon) => new DOMMatrix(window.getComputedStyle(icon).transform).a,
    );
}

for (const { code, lang, rtl } of LOCALES) {
  test.describe(`Respondr in ${lang}`, () => {
    test.beforeEach(async ({ page }) => {
      await chooseLocale(page, code);
    });

    test(`is ${rtl ? "mirrored" : "not mirrored"}`, async ({ page }) => {
      await open(page, WELCOME);

      const html = page.locator("html");
      await expect(html).toHaveAttribute("lang", lang);
      await expect(html).toHaveAttribute("dir", rtl ? "rtl" : "ltr");
      const skins = await page
        .locator('link[rel="stylesheet"][href*="/skins/respondr/defaultSkin"]')
        .evaluateAll((links) =>
          links.map(
            (link) =>
              new URL(link.getAttribute("href") ?? "", document.baseURI)
                .pathname,
          ),
        );
      expect(skins).toEqual([
        `/uPortal/media/skins/respondr/defaultSkin${rtl ? "-rtl" : ""}.css`,
      ]);

      const positions = await startsOnTheRight(page);
      for (const [name, onTheRight] of Object.entries(positions)) {
        expect(onTheRight, name).toBe(rtl);
      }
      expect(await iconScale(page, ".fa-sign-in"), "sign-in icon").toBe(
        rtl ? -1 : 1,
      );
    });

    test(`shows a web component ${rtl ? "right to left" : "left to right"}`, async ({
      page,
    }) => {
      await open(page, `${config.url}p/popular-portlets/max/render.uP`);
      const component = page.locator("up-popular-portlets");
      await expect(component).toHaveAttribute("dir", rtl ? "rtl" : "ltr");
      // The Title column, the table's first, is on the right in Arabic
      const titleOnTheRight = await component.evaluate((host) => {
        const first = host.shadowRoot?.querySelector("thead th:first-child");
        const last = host.shadowRoot?.querySelector("thead th:last-child");
        if (!first || !last) throw new Error("no table header");
        return (
          first.getBoundingClientRect().left > last.getBoundingClientRect().left
        );
      });
      expect(titleOnTheRight).toBe(rtl);
    });
  });
}

/*
 * The layout checks of tests/layout (MOD-D52) on the mirrored page: at each
 * width it has no layout problem that the same page doesn't have in en-US.
 */
test.describe("Respondr in ar-XB, layout", () => {
  for (const width of WIDTHS) {
    test(`has no layout problem that en-US lacks at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, WELCOME);
      const leftToRight = nodesByCheck(await measureLayout(page));

      await chooseLocale(page, "ar_XB");
      await open(page, WELCOME);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      const problems = await measureLayout(page);

      const added = problems
        .filter(
          (problem) =>
            !(leftToRight[problem.check] ?? []).includes(problem.node),
        )
        .map(
          (problem) => `${problem.check}: ${problem.node} (${problem.detail})`,
        );
      expect(added, `checks: ${CHECKS.join(", ")}`).toEqual([]);
    });
  }
});

/** axe's violations (WCAG 2.1 A and AA, as in tests/a11y) as "rule: node" */
async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `${violation.id}: ${node.target.join(" > ").replaceAll(/\d+/g, "#")}`,
    ),
  );
}

/*
 * axe on the mirrored page: it has no violation that the same page doesn't
 * have in en-US (the axe baseline in tests/a11y covers en-US).
 */
test("Respondr in ar-XB has no accessibility violation that en-US lacks", async ({
  page,
}) => {
  await open(page, WELCOME);
  const leftToRight = new Set(await violations(page));

  await chooseLocale(page, "ar_XB");
  await open(page, WELCOME);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const rightToLeft = await violations(page);
  const added = rightToLeft.filter((violation) => !leftToRight.has(violation));
  expect(added).toEqual([]);
});
