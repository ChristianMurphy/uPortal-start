import { test, expect, APIResponse, Page, Response } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";
import { PSEUDO_LOCALES, pseudoMessages } from "../../i18n/pseudo-locales";

/*
 * MOD-D51: the web components in the pseudo-locales of tests/i18n
 * (en-XA, accented, 40% longer and in [brackets]; ar-XB, right to left).
 * The pseudo messages are built at test time from the portal's English
 * messages: the test answers /api/v6-0/messages for a pseudo-locale with the
 * en-US answer, transformed. Nothing is deployed for them.
 *
 * Each component fails when it shows
 * - letters outside brackets that are not data (portlet titles, names,
 *   descriptions the component's REST API returned): English written into
 *   the code;
 * - text cut off by its box (scrollWidth > clientWidth);
 * - a select whose arrow is not at its inline end, where it covers the value;
 * - in ar-XB, a layout that does not mirror, or in en-XA one that does.
 *
 * The student only reads, so the test changes nothing for other specs.
 */

const COMPONENTS = [
  {
    tag: "up-favorites",
    url: `${config.url}p/favorites`,
    api: "/api/v6-0/favorites",
  },
  {
    tag: "up-popular-portlets",
    url: `${config.url}p/popular-portlets`,
    api: "/api/v6-0/popular-portlets",
  },
];

/** Answers the messages API for a pseudo-locale with its English answer, transformed. */
async function servePseudoMessages(page: Page): Promise<void> {
  await page.route("**/api/v6-0/messages?**", async (route) => {
    const url = new URL(route.request().url());
    const locale = PSEUDO_LOCALES.find(
      (pseudo) => pseudo === url.searchParams.get("locale"),
    );
    if (locale === undefined) {
      await route.continue();
      return;
    }
    url.searchParams.set("locale", "en-US");
    const response: APIResponse<{ messages: Record<string, string> }> =
      await route.fetch({ url: url.toString() });
    const body = await response.json();
    await route.fulfill({
      response,
      json: { locale, messages: pseudoMessages(body.messages, locale) },
    });
  });
}

/** Every string in a JSON value. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return (value as unknown[]).flatMap((item) => strings(item));
  }
  if (typeof value === "object" && value !== null) {
    const values: unknown[] = Object.values(value);
    return values.flatMap((item) => strings(item));
  }
  return [];
}

/** Shown text with letters outside brackets that is not data. */
async function untranslatedText(
  page: Page,
  tag: string,
  data: readonly string[],
): Promise<string[]> {
  return page.locator(tag).evaluate((element, dataTexts) => {
    const found: string[] = [];
    const known = new Set(dataTexts.map((text) => text.trim()));
    const walker = document.createTreeWalker(
      element.shadowRoot ?? element,
      NodeFilter.SHOW_TEXT,
    );
    for (
      let node = walker.nextNode();
      node !== null;
      node = walker.nextNode()
    ) {
      const text = (node.textContent ?? "").trim();
      // Hidden text (another state's markup) is not shown
      const shown =
        node.parentElement !== null &&
        node.parentElement.closest("[hidden]") === null &&
        node.parentElement.getClientRects().length > 0;
      const bracketed = text.includes("[") || text.includes("]");
      if (shown && /\p{L}/u.test(text) && !bracketed && !known.has(text)) {
        found.push(text);
      }
    }
    return found;
  }, data);
}

/** Boxes whose own text is wider than they are. */
async function clippedText(page: Page, tag: string): Promise<string[]> {
  return page
    .locator(tag)
    .evaluate((element) =>
      [...(element.shadowRoot?.querySelectorAll<HTMLElement>("*") ?? [])]
        .filter(
          (box) =>
            box.clientWidth > 0 &&
            box.scrollWidth > box.clientWidth + 1 &&
            [...box.childNodes].some(
              (child) =>
                child.nodeType === Node.TEXT_NODE &&
                /\p{L}/u.test(child.textContent ?? ""),
            ),
        )
        .map(
          (box) =>
            `${box.tagName.toLowerCase()}.${box.className}: ${(box.textContent ?? "").trim().slice(0, 60)}`,
        ),
    );
}

/** Selects whose arrow is not at their inline end, where it covers the value. */
async function misplacedArrows(page: Page, tag: string): Promise<string[]> {
  return page.locator(tag).evaluate((element) => {
    const end =
      window.getComputedStyle(element).direction === "rtl" ? "left" : "right";
    return [...(element.shadowRoot?.querySelectorAll("select") ?? [])]
      .map((select) => ({ select, style: window.getComputedStyle(select) }))
      .filter(
        ({ style }) =>
          style.backgroundImage !== "none" &&
          // Chromium writes the right edge as "right 7.5px" or "calc(100% - 7.5px)"
          (/(?:^right\b)|(?:100%)/.test(style.backgroundPositionX)
            ? "right"
            : "left") !== end,
      )
      .map(
        ({ select, style }) =>
          `select#${select.id}: ${style.backgroundPosition}`,
      );
  });
}

/**
 * Whether the start of a row is on the right: Popular Portlets' Title column
 * (the first) and Favorites' icon (before its name).
 */
async function startsOnTheRight(page: Page, tag: string): Promise<boolean> {
  return page.locator(tag).evaluate((element) => {
    const root = element.shadowRoot;
    const pairs: [string, string][] = [
      ["thead th:first-child", "thead th:last-child"],
      [".favorite-link > :first-child", ".favorite-link > .favorite-name"],
      [".alert > :first-child", ".footer > :first-child"],
    ];
    for (const [first, second] of pairs) {
      const a = root?.querySelector(first);
      const b = root?.querySelector(second);
      if (a && b) {
        const left = (box: Element) => box.getBoundingClientRect().left;
        return left(a) > left(b);
      }
    }
    // Fall back to the text alignment of the host
    return window.getComputedStyle(element).direction === "rtl";
  });
}

for (const { tag, url, api } of COMPONENTS) {
  for (const locale of PSEUDO_LOCALES) {
    test(`${tag} in ${locale} is translated, unclipped and ${
      locale === "ar-XB" ? "mirrored" : "not mirrored"
    }`, async ({ page }) => {
      const data: string[] = [];
      page.on("response", (response: Response) => {
        if (new URL(response.url()).pathname.endsWith(api)) {
          void response
            .json()
            .then((body: unknown) => data.push(...strings(body)))
            .catch(() => []);
        }
      });
      await servePseudoMessages(page);
      await loginViaUrl(page, config.users.student);
      await waitForPortalRequestsToSettle(page);
      await page.goto(url);
      const element = page.locator(tag);
      await expect(element).toBeVisible();

      await element.evaluate((host, value) => {
        // As narrow as a portlet in a side column, where long text has to wrap
        host.style.width = "360px";
        host.setAttribute("locale", value);
      }, locale);
      await expect(element).toHaveAttribute(
        "dir",
        locale === "ar-XB" ? "rtl" : "ltr",
      );
      // The pseudo messages have arrived once a bracketed text shows
      await expect(element.getByText(/\[/).first()).toBeVisible();
      await waitForPortalRequestsToSettle(page);

      expect(await untranslatedText(page, tag, data), "untranslated").toEqual(
        [],
      );
      expect(await clippedText(page, tag), "clipped").toEqual([]);
      expect(await misplacedArrows(page, tag), "select arrows").toEqual([]);
      expect(await startsOnTheRight(page, tag)).toBe(locale === "ar-XB");
    });
  }
}
