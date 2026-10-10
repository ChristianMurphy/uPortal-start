import { test, expect, Page, Locator } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  logout,
  openDropdown,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";

/*
 * Favorites has two halves: the "Add to my Favorites" item of every portlet's
 * Options menu (rendered by the theme) and the Favorites channel at
 * /p/favorites, which is the <up-favorites> web component (a "Web Component"
 * channel, uPortal MOD-D18) backed by /api/v6-0/favorites.
 */
const FAVORITES_URL = `${config.url}p/favorites`;
const FAVORITES_API = `${config.url}api/v6-0/favorites`;

interface FavoritePortlet {
  nodeId: string;
  fname: string;
  name: string;
}

async function openCalendarOptionsMenu(page: Page): Promise<Locator> {
  const calendarWrapper = page.locator(
    ".up-portlet-wrapper:has(.portlet-title a[title='Calendar'])"
  );
  const toggle = calendarWrapper
    .locator(".portlet-options-menu .dropdown-toggle")
    .first();
  await openDropdown(toggle);
  return calendarWrapper;
}

/**
 * After toggling Calendar's favorite state via the Options menu, reload
 * the page and assert the favorite link text matches the expected state.
 * The remove/add API call returns 200 before uPortal has invalidated the
 * server-side layout cache, so a reload that fires immediately after
 * the notification can re-render the *previous* state. Reload + reopen
 * + assert is wrapped in a poll so a second pass picks up the cache
 * invalidation if the first one was too early.
 */
async function expectFavoriteLinkText(
  page: Page,
  expected: "Add to my Favorites" | "Remove from my favorites"
): Promise<void> {
  await expect(async () => {
    await page.reload();
    const calendarWrapper = await openCalendarOptionsMenu(page);
    await expect(
      calendarWrapper.locator(".up-portlet-options-item.favorite a")
    ).toContainText(expected, { timeout: 1500 });
  }).toPass({ timeout: 10_000 });
}

/**
 * Ensure Calendar is in the expected favorites state before a test runs.
 * Self-clean across sessions: student's persisted layout accumulates
 * favorites over time, so we can't assume any starting state.
 */
async function ensureCalendarFavoriteState(
  page: Page,
  shouldBeFavorite: boolean
): Promise<void> {
  const calendarWrapper = await openCalendarOptionsMenu(page);

  const favLink = calendarWrapper.locator(
    ".up-portlet-options-item.favorite a"
  );
  const linkText = (await favLink.textContent()) ?? "";
  const isFavorite = linkText.includes("Remove");

  if (isFavorite === shouldBeFavorite) {
    await page.keyboard.press("Escape");
    return;
  }

  await favLink.click();
  await expect(page.locator(".modern-notification")).toBeVisible();
  await page.reload();
}

test.describe("Favorites", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, config.users.student);
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("add a portlet to favorites via Options menu", async ({ page }) => {
    await ensureCalendarFavoriteState(page, false);

    const calendarWrapper = await openCalendarOptionsMenu(page);

    const favLink = calendarWrapper.locator(
      ".up-portlet-options-item.favorite a"
    );
    await expect(favLink).toContainText("Add to my Favorites");
    await favLink.click();

    await expect(page.locator(".modern-notification")).toContainText(
      "You have added Calendar as a favorite"
    );

    await expectFavoriteLinkText(page, "Remove from my favorites");

    // Clean up — restore Calendar to NOT-favorite so the next test
    // starts from the same state we found.
    const reopened = await openCalendarOptionsMenu(page);
    await reopened.locator(".up-portlet-options-item.favorite a").click();
    await expect(page.locator(".modern-notification")).toContainText(
      "Removed from Favorites successfully"
    );
  });

  test("remove a portlet from favorites via Options menu", async ({ page }) => {
    await ensureCalendarFavoriteState(page, true);

    const calendarWrapper = await openCalendarOptionsMenu(page);

    const removeLink = calendarWrapper.locator(
      ".up-portlet-options-item.favorite a"
    );
    await expect(removeLink).toContainText("Remove from my favorites");
    await removeLink.click();

    await expect(page.locator(".modern-notification")).toContainText(
      "Removed from Favorites successfully"
    );

    await expectFavoriteLinkText(page, "Add to my Favorites");
  });

  test("Options menu shows Add to my Favorites link", async ({ page }) => {
    await ensureCalendarFavoriteState(page, false);

    const calendarWrapper = await openCalendarOptionsMenu(page);

    const favOption = calendarWrapper.locator(
      ".up-portlet-options-item.favorite a"
    );
    await expect(favOption).toBeVisible();
    await expect(favOption).toHaveAttribute(
      "title",
      "Add this portlet to my favorites"
    );
  });

  test("every portlet with an options menu has a favorite item", async ({
    page,
  }) => {
    /*
     * Earlier this assertion hard-coded `toHaveCount(3)` against the
     * three portlets in the seeded Welcome layout (Bookmarks, Calendar,
     * My Drives). uPortal persists per-user customizations to the DB,
     * so once a student has favorited additional portlets in the
     * session their layout grows (E! Online, NY Times, Campus News
     * are common). The semantically interesting invariant isn't "3
     * favorites items" — it's "every portlet with an Options menu has
     * a favorite item underneath it". Count those dynamically.
     */
    const wrappersWithMenu = page.locator(
      ".up-portlet-wrapper:has(.portlet-options-menu .dropdown-toggle)"
    );
    const favItems = page.locator(".up-portlet-options-item.favorite");

    const expected = await wrappersWithMenu.count();
    expect(expected).toBeGreaterThanOrEqual(3);
    await expect(favItems).toHaveCount(expected);
  });
});

/**
 * Open the Favorites channel, maximized at /p/favorites, and wait until its
 * <up-favorites> element has loaded the favorites. Playwright's CSS and role
 * locators reach into the element's (open) shadow root.
 */
async function openFavoritesChannel(page: Page): Promise<Locator> {
  // /p/favorites is a transient (focused) portlet: no portal request of the
  // previous page may still be running when it renders
  await waitForPortalRequestsToSettle(page);
  await page.goto(FAVORITES_URL);
  const favorites = page.locator("up-favorites");
  await expect(favorites).toHaveAttribute("window-state", "maximized");
  await expect(favorites.locator(".favorites")).toBeVisible();
  return favorites;
}

/** The names of the favorite portlets, in the order the component lists them. */
async function listedPortlets(favorites: Locator): Promise<string[]> {
  return favorites
    .locator("li.favorite[data-kind='portlet'] .favorite-name")
    .allTextContents();
}

/**
 * The CSRF header and token the portal gave the element, for REST calls made
 * the way the component makes them.
 */
async function csrfHeaders(
  favorites: Locator
): Promise<Record<string, string>> {
  await expect(favorites).toHaveAttribute("csrf-header", /\S/);
  await expect(favorites).toHaveAttribute("csrf-token", /\S/);
  const header = (await favorites.getAttribute("csrf-header")) ?? "";
  const token = (await favorites.getAttribute("csrf-token")) ?? "";
  return { [header]: token };
}

/**
 * Make sure the student has the portlet as a favorite, through the REST API.
 * Returns its node ID when this call created it (so the test removes it
 * again), or undefined when it was a favorite already.
 */
async function addFavorite(
  page: Page,
  headers: Record<string, string>,
  fname: string
): Promise<string | undefined> {
  const response = await page.request.post<FavoritePortlet>(FAVORITES_API, {
    data: { fname },
    headers,
  });
  expect([200, 201]).toContain(response.status());
  const favorite = await response.json();
  expect(favorite.fname).toBe(fname);
  return response.status() === 201 ? favorite.nodeId : undefined;
}

async function removeFavorites(
  page: Page,
  headers: Record<string, string>,
  nodeIds: string[]
): Promise<void> {
  for (const nodeId of nodeIds) {
    const response = await page.request.delete<unknown>(
      `${FAVORITES_API}/${encodeURIComponent(nodeId)}`,
      { headers }
    );
    expect(response.status()).toBe(204);
  }
}

/** The order after moving the named entry one place up, or down if it is first. */
function orderAfterMove(order: string[], name: string): string[] {
  const index = order.indexOf(name);
  const target = index === 0 ? 1 : index - 1;
  const moved = [...order];
  moved[index] = order[target] ?? name;
  moved[target] = name;
  return moved;
}

/** Which way orderAfterMove() moves the named entry. */
function moveDirection(order: string[], name: string): "up" | "down" {
  return order.indexOf(name) === 0 ? "down" : "up";
}

test.describe("Favorites web component", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, config.users.student);
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("lists a portlet favorited via the Options menu", async ({ page }) => {
    await ensureCalendarFavoriteState(page, true);

    const favorites = await openFavoritesChannel(page);

    const calendar = favorites.getByRole("link", {
      name: "Calendar",
      exact: true,
    });
    await expect(calendar).toBeVisible();
    await expect(calendar).toHaveAttribute("href", /\/p\/calendar\//);
    await expect(
      favorites.getByRole("list", { name: "Favorites" })
    ).toBeVisible();
  });

  test("unfavorites a portlet, and the Options menu follows", async ({
    page,
  }) => {
    await ensureCalendarFavoriteState(page, true);
    const favorites = await openFavoritesChannel(page);

    await favorites
      .getByRole("button", { name: "Remove Calendar from my favorites" })
      .click();

    await expect(favorites.locator(".notice")).toContainText(
      "You have unfavorited Calendar."
    );
    await expect(
      favorites.getByRole("link", { name: "Calendar", exact: true })
    ).toHaveCount(0);

    // The layout changed on the server, not just on the page
    const reloaded = await openFavoritesChannel(page);
    await expect(
      reloaded.getByRole("link", { name: "Calendar", exact: true })
    ).toHaveCount(0);
    await page.goto(config.url);
    await expectFavoriteLinkText(page, "Add to my Favorites");
  });

  test("reorders favorites and keeps the new order", async ({ page }) => {
    let favorites = await openFavoritesChannel(page);
    const headers = await csrfHeaders(favorites);
    const created = [
      await addFavorite(page, headers, "calendar"),
      await addFavorite(page, headers, "bookmarks"),
    ].filter((nodeId): nodeId is string => nodeId !== undefined);

    try {
      favorites = await openFavoritesChannel(page);
      const before = await listedPortlets(favorites);
      expect(before).toContain("Calendar");
      const after = orderAfterMove(before, "Calendar");
      const direction = moveDirection(before, "Calendar");

      await favorites
        .getByRole("button", { name: "Reorder favorites" })
        .click();
      await favorites
        .getByRole("button", { name: `Move Calendar ${direction}` })
        .click();

      await expect(favorites.getByRole("status")).toContainText(
        `Moved Calendar to position ${after.indexOf("Calendar") + 1} of ${after.length}.`
      );
      expect(await listedPortlets(favorites)).toEqual(after);

      // The move is saved in the layout
      await expect(async () => {
        favorites = await openFavoritesChannel(page);
        expect(await listedPortlets(favorites)).toEqual(after);
      }).toPass({ timeout: 15_000 });

      // Put Calendar back where it was
      await favorites
        .getByRole("button", { name: "Reorder favorites" })
        .click();
      await favorites
        .getByRole("button", {
          name: `Move Calendar ${direction === "up" ? "down" : "up"}`,
        })
        .click();
      await expect(favorites.getByRole("status")).toContainText(
        `Moved Calendar to position ${before.indexOf("Calendar") + 1}`
      );
    } finally {
      await removeFavorites(page, headers, created);
    }
  });

  test("refuses a REST change without the page's CSRF token", async ({
    page,
  }) => {
    const favorites = await openFavoritesChannel(page);
    const before = await listedPortlets(favorites);

    const response = await page.request.post<unknown>(FAVORITES_API, {
      data: { fname: "calendar" },
    });

    expect(response.status()).toBe(403);
    const after = await openFavoritesChannel(page);
    expect(await listedPortlets(after)).toEqual(before);
  });
});
