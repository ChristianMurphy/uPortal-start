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

async function openSearch(page: Page, query: string): Promise<void> {
  await page.goto(`${SEARCH_URL}?query=${encodeURIComponent(query)}`);
  await expect(page.locator("up-search")).toHaveAttribute(
    "window-state",
    "maximized",
  );
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

    await expect(page).toHaveURL(/[&?]query=calendar(&|$)/);
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
});
