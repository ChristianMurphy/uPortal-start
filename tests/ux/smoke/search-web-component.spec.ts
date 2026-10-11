import { test, expect, Page } from "@playwright/test";
import { config } from "../../general-config";
import { loginViaUrl, logout } from "../utils/ux-general-utils";

/*
 * Search as web components (uPortal MOD-D18): the header's search-launcher
 * channel is <up-search-launcher>, and the search channel is <up-search>,
 * which reads /api/v6-0/search. search.spec.ts checks that users see the same
 * as with the Search portlet; these tests cover what is new or specific to
 * the components.
 */
const SEARCH_URL = `${config.url}p/search/max`;

/**
 * The query in the page URL. The portal redirects /p/search/max?query=... to
 * the channel's render URL, where the parameter is the portlet parameter
 * pP_query.
 */
function queryInUrl(page: Page): string | null {
  const parameters = new URL(page.url()).searchParams;
  return parameters.get("pP_query") ?? parameters.get("query");
}

async function openSearch(page: Page, query: string): Promise<void> {
  await page.goto(`${SEARCH_URL}?query=${encodeURIComponent(query)}`);
  await expect(page.locator("up-search")).toHaveAttribute(
    "window-state",
    "maximized",
  );
}

/** Accented letters, a non-Latin script and a four-byte character (MOD-D50). */
const UNICODE_QUERY = "Zoë Ñandú 李小龍 😀";

/**
 * Stores the signed-in user's locale (es_ES, fr_FR, en_US) through the locale
 * selector channel, as a user would.
 */
async function setUserLocale(page: Page, code: string): Promise<void> {
  await page.goto(`${config.url}p/user-locales-selector/max`);
  await page.locator(`input[name="locale"][value="${code}"]`).check();
  await Promise.all([
    page.waitForLoadState("load"),
    page.locator('input[name="_eventId_updateLocale"]').click(),
  ]);
}

test.describe("Search web components", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, config.users.student);
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("the header holds up-search-launcher and loads the module once", async ({
    page,
  }) => {
    const launcher = page.locator("#region-header-right up-search-launcher");
    await expect(launcher).toHaveCount(1);
    await expect(launcher).toHaveAttribute("search-fname", "search");
    await expect(
      page.locator(
        'script[type="module"][src*="/webcomponents/assets/up-search-"]',
      ),
    ).toHaveCount(1);
  });

  test("the search channel reads the query from the URL", async ({ page }) => {
    await openSearch(page, "cartoon");
    const search = page.locator("up-search");
    await expect(
      search.getByRole("searchbox", { name: "Search Terms" }),
    ).toHaveValue("cartoon");
    await expect(search.getByRole("tab", { name: "People" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("a search from the channel's own box runs in place", async ({
    page,
  }) => {
    await openSearch(page, "cartoon");
    const search = page.locator("up-search");
    const box = search.getByRole("searchbox", { name: "Search Terms" });

    await box.fill("calendar");
    await box.press("Enter");

    await expect.poll(() => queryInUrl(page)).toBe("calendar");
    await search.getByRole("tab", { name: "Portlets" }).click();
    await expect(
      search.getByRole("heading", { level: 3, name: "Calendar" }),
    ).toBeVisible();
  });

  test("the results tabs follow the keyboard", async ({ page }) => {
    await openSearch(page, "cartoon");
    const search = page.locator("up-search");
    const people = search.getByRole("tab", { name: "People" });

    await people.focus();
    await page.keyboard.press("ArrowRight");

    const portlets = search.getByRole("tab", { name: "Portlets" });
    await expect(portlets).toHaveAttribute("aria-selected", "true");
    await expect(portlets).toBeFocused();
    await expect(
      search.getByRole("tabpanel").getByRole("heading", { level: 3 }),
    ).toContainText(["Daily Business Cartoon"]);
  });

  test("type-ahead works with the keyboard", async ({ page }) => {
    const box = page
      .locator("#region-header-right")
      .getByRole("searchbox", { name: "Search Terms" });

    await box.pressSequentially("cartoo", { delay: 50 });
    await expect(
      page.getByRole("option", { name: /Daily Business Cartoon/ }),
    ).toBeVisible();
    await box.press("ArrowDown");
    await expect(box).toHaveAttribute("aria-activedescendant", "suggestion-0");
    await box.press("Enter");

    await expect(page).toHaveURL(/\/p\/daily-business-cartoon[./].*max/);
  });

  test("a Unicode query reaches the API encoded once and comes back intact", async ({
    page,
  }) => {
    await openSearch(page, "cartoon");
    const search = page.locator("up-search");
    const box = search.getByRole("searchbox", { name: "Search Terms" });

    const request = page.waitForRequest((r) =>
      r.url().includes("/api/v6-0/search?"),
    );
    await box.fill(UNICODE_QUERY);
    await box.press("Enter");

    // Decoding the request and the page URL once gives the query back
    const sentRequest = await request;
    const sent = new URL(sentRequest.url());
    expect(sent.searchParams.get("q")).toBe(UNICODE_QUERY);
    expect(sent.search).not.toContain("%25");
    await expect.poll(() => queryInUrl(page)).toBe(UNICODE_QUERY);
    await expect(box).toHaveValue(UNICODE_QUERY);
    await expect(
      search.getByRole("status").filter({ hasText: "results for" }),
    ).toContainText(`results for ${UNICODE_QUERY}.`);

    // The query read back from the URL after a reload
    await page.reload();
    await expect(box).toHaveValue(UNICODE_QUERY);
  });

  test("the header's box sends a Unicode query encoded once", async ({
    page,
  }) => {
    const box = page
      .locator("#region-header-right up-search-launcher")
      .getByRole("searchbox", { name: "Search Terms" });
    await box.fill(UNICODE_QUERY);
    await box.press("Enter");

    await expect(page).toHaveURL(/\/p\/search[./]/);
    expect(queryInUrl(page)).toBe(UNICODE_QUERY);
    await expect(
      page
        .locator("up-search")
        .getByRole("searchbox", { name: "Search Terms" }),
    ).toHaveValue(UNICODE_QUERY);
  });

  for (const [code, people, noResults] of [
    ["es_ES", "Personas", "No hay resultados"],
    ["fr_FR", "Personnes", "Aucun résultat"],
  ] as const) {
    test(`speaks the user's language: ${code}`, async ({ page }) => {
      await setUserLocale(page, code);
      try {
        await openSearch(page, "zzqxjv");
        const search = page.locator("up-search");
        await expect(search).toHaveAttribute("locale", code.replace("_", "-"));
        await expect(search.getByRole("tab", { name: people })).toBeVisible();
        await expect(search.getByText(noResults)).toBeVisible();
      } finally {
        await setUserLocale(page, "en_US");
      }
    });
  }
});
