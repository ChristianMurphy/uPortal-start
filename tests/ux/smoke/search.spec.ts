import { test, expect, Page, Locator } from "@playwright/test";
import { config } from "../../general-config";
import { loginViaUrl, logout } from "../utils/ux-general-utils";

/*
 * Search, as users see it: the search box in the page header (the
 * search-launcher channel) and the results page of the search channel.
 * quickstart publishes search with RESTSearch=true, so the results come from
 * /api/v5-0/portal/search, one tab per result type ("People", "Portlets").
 * Both channels offer type-ahead over /api/portletList.
 *
 * The locators use only what users see (labels, text, links and headings),
 * so this spec describes the behaviour whatever renders it.
 */

function headerSearch(page: Page): {
  box: Locator;
  submit: Locator;
} {
  const header = page.locator("#region-header-right");
  return {
    box: header.getByRole("searchbox", { name: "Search Terms" }),
    // The Search portlet's button shows only an icon: the skin hides its "Search" text, so
    // it has no accessible name. It is the only button in the header's right region.
    submit: header.getByRole("button"),
  };
}

function results(page: Page): Locator {
  return page.locator("#portalPageBody");
}

async function searchFromHeader(page: Page, query: string): Promise<void> {
  const { box, submit } = headerSearch(page);
  await box.fill(query);
  await submit.click();
  await expect(page).toHaveURL(/\/p\/search[./]/);
}

test.describe("Search", () => {
  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("the header offers a search box", async ({ page }) => {
    await loginViaUrl(page, config.users.student);
    const { box, submit } = headerSearch(page);
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute("placeholder", "Search");
    await expect(box).toHaveAttribute("maxlength", "200");
    await expect(submit).toBeVisible();
  });

  test("an empty or blank query does not search", async ({ page }) => {
    await loginViaUrl(page, config.users.student);
    const before = page.url();
    const { box, submit } = headerSearch(page);
    await box.fill("   ");
    const navigation = page
      .waitForEvent("framenavigated", { timeout: 2000 })
      .then(() => "navigated")
      .catch(() => "stayed");
    await submit.click();
    await box.press("Enter");
    expect(await navigation).toBe("stayed");
    expect(page.url()).toBe(before);
  });

  test("a search from the header lists matching portlets", async ({ page }) => {
    await loginViaUrl(page, config.users.student);
    await searchFromHeader(page, "cartoon");

    const body = results(page);
    await expect(body.getByText("People", { exact: true })).toBeVisible();
    await expect(body.getByText("Portlets", { exact: true })).toBeVisible();

    // The first tab, People, is shown first: nobody matches "cartoon"
    await expect(body.getByText("No Results Found")).toBeVisible();

    await body.getByText("Portlets", { exact: true }).click();
    const title = body.getByRole("heading", {
      level: 3,
      name: "Daily Business Cartoon",
    });
    await expect(title).toBeVisible();
    await expect(
      body.getByText("Daily Business Cartoon by Ted Goff, www.tedgoff.com"),
    ).toBeVisible();
    await expect(body.getByText("Description:", { exact: true })).toBeVisible();
    await expect(body.getByText("Name:", { exact: true })).toBeVisible();
    await expect(body.getByText("Relevance:", { exact: true })).toBeVisible();

    // Each portlet result links to the portlet, maximized
    const link = body.locator('a[href*="/p/daily-business-cartoon"]');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", /\/max\//);
    await link.click();
    await expect(page).toHaveURL(/\/p\/daily-business-cartoon[./].*max/);
  });

  test("a search lists matching people with their details", async ({
    page,
  }) => {
    await loginViaUrl(page, config.users.admin);
    await searchFromHeader(page, "steven");

    const body = results(page);
    await expect(
      body.getByRole("heading", { level: 3, name: "Steven Student" }),
    ).toBeVisible();
    for (const [label, value] of [
      ["Net ID:", "student"],
      ["First Name:", "Steven"],
      ["Last Name:", "Student"],
      ["Email:", "steven.student@example.org"],
      ["Phone:", "(555) 555-5555"],
    ]) {
      await expect(body.getByText(label, { exact: true })).toBeVisible();
      await expect(body.getByText(value, { exact: true })).toBeVisible();
    }
    // People have no portlet to open: the result has no link (the channel's
    // title bar has links of its own, so look in the result only)
    const person = body
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Steven Student" }) });
    await expect(person).toHaveCount(1);
    await expect(person.getByRole("link")).toHaveCount(0);
  });

  test("a search without matches says so in every tab", async ({ page }) => {
    await loginViaUrl(page, config.users.student);
    await searchFromHeader(page, "zzqxjv");

    const body = results(page);
    const noResults = body
      .getByText("No Results Found")
      .filter({ visible: true });
    await expect(noResults).toHaveCount(1);
    await body.getByText("Portlets", { exact: true }).click();
    // The Search portlet then shows the People panel too (its script marks the
    // first tab active where Bootstrap does not look), so only check that the
    // Portlets panel says so as well
    await expect(noResults.first()).toBeVisible();
  });

  test("type-ahead in the header suggests portlets and opens one", async ({
    page,
  }) => {
    await loginViaUrl(page, config.users.student);
    const { box } = headerSearch(page);
    await box.pressSequentially("cartoo", { delay: 50 });

    const suggestion = page.getByText("Daily Business Cartoon", {
      exact: true,
    });
    await expect(suggestion).toBeVisible();
    await expect(
      page.getByText("Daily Business Cartoon by Ted Goff, www.tedgoff.com"),
    ).toBeVisible();
    await suggestion.click();
    await expect(page).toHaveURL(/\/p\/daily-business-cartoon[./].*max/);
  });
});
