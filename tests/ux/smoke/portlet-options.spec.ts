import { test, expect } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  logout,
  openDropdown,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";

test.describe("Portlet Options menu", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, config.users.student);
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("Options dropdown shows expected items for unlocked portlet", async ({
    page,
  }) => {
    // Calendar is an unlocked (movable) portlet
    const calendarWrapper = page.locator(
      ".up-portlet-wrapper:has(.portlet-title a[title='Calendar'])",
    );
    await openDropdown(
      calendarWrapper.locator(".portlet-options-menu .dropdown-toggle").first(),
    );

    const menu = calendarWrapper.locator(
      ".portlet-options-menu .dropdown-menu",
    );
    await expect(menu).toBeVisible();

    // Verify all expected menu items
    await expect(menu.locator(".up-portlet-options-item.rate")).toBeVisible();
    await expect(
      menu.locator(".up-portlet-options-item.favorite"),
    ).toBeVisible();
    await expect(menu.locator(".up-portlet-options-item.move")).toBeVisible();
    await expect(menu.locator(".up-portlet-options-item.remove")).toBeVisible();
    await expect(
      menu.locator(".up-portlet-options-item.maximize"),
    ).toBeVisible();
    await expect(
      menu.locator(".up-portlet-options-item.minimize"),
    ).toBeVisible();
    await expect(menu.locator(".up-portlet-options-item.edit")).toBeVisible();
    await expect(
      menu.locator(".up-portlet-options-item.directUrl"),
    ).toBeVisible();
  });

  test("Favorite and unfavorite from the menu send the CSRF token", async ({
    page,
  }) => {
    // modern-favorite.js posts to /api/layout, which needs the page's CSRF
    // token (MOD-I130). Toggling twice leaves the layout as it was.
    const calendarWrapper = page.locator(
      ".up-portlet-wrapper:has(.portlet-title a[title='Calendar'])",
    );
    for (let toggle = 0; toggle < 2; toggle++) {
      await openDropdown(
        calendarWrapper
          .locator(".portlet-options-menu .dropdown-toggle")
          .first(),
      );
      const [response] = await Promise.all([
        page.waitForResponse(
          (candidate) =>
            candidate.url().includes("/api/layout?action=") &&
            candidate.request().method() === "POST",
        ),
        calendarWrapper.locator(".up-portlet-options-item.favorite a").click(),
      ]);
      expect(response.request().headers()["x-csrf-token"]).toBeTruthy();
      expect(response.status()).toBe(200);
      await waitForPortalRequestsToSettle(page);
      await page.reload();
    }
  });

  test("Options dropdown shows expected items for locked portlet", async ({
    page,
  }) => {
    // Bookmarks is a locked portlet — should NOT have move/remove
    const bookmarksWrapper = page.locator(
      ".up-portlet-wrapper:has(.portlet-title a[title='Bookmarks'])",
    );
    await openDropdown(
      bookmarksWrapper
        .locator(".portlet-options-menu .dropdown-toggle")
        .first(),
    );

    const menu = bookmarksWrapper.locator(
      ".portlet-options-menu .dropdown-menu",
    );
    await expect(menu).toBeVisible();

    // Locked portlets should have rate, favorite, maximize, minimize, edit, directUrl
    await expect(menu.locator(".up-portlet-options-item.rate")).toBeVisible();
    await expect(
      menu.locator(".up-portlet-options-item.favorite"),
    ).toBeVisible();
    await expect(
      menu.locator(".up-portlet-options-item.maximize"),
    ).toBeVisible();

    // Locked portlets should NOT have move or remove
    await expect(
      menu.locator(".up-portlet-options-item.move"),
    ).not.toBeAttached();
    await expect(
      menu.locator(".up-portlet-options-item.remove"),
    ).not.toBeAttached();
  });
});

test.describe("Portlet maximized view", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, config.users.student);
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("Bookmarks portlet opens in maximized mode", async ({ page }) => {
    // Navigate to maximized view via direct URL
    await page.goto(`${config.url}p/bookmarks`);

    // Portlet title should be visible
    await expect(
      page.locator(".up-portlet-titlebar .portlet-title"),
    ).toContainText("Bookmarks");

    // Options dropdown should be available in maximized view
    await expect(
      page.locator(".portlet-options-menu .dropdown-toggle"),
    ).toBeVisible();

    // Portlet content is rendered by JavaScript; wait for it to load
    await expect(page.locator(".bookmarksPortlet")).toBeVisible();
  });

  test("Calendar portlet opens in maximized mode with expanded content", async ({
    page,
  }) => {
    await page.goto(`${config.url}p/calendar`);

    await expect(
      page.locator(".up-portlet-titlebar .portlet-title"),
    ).toContainText("Calendar");

    // Maximized Calendar shows "My Calendars" section
    await expect(page.getByText("My Calendars")).toBeVisible();
    // And a Preferences link
    await expect(page.getByText("Preferences")).toBeVisible();
  });

  test("maximized portlet Options has Return to dashboard", async ({
    page,
  }) => {
    await page.goto(`${config.url}p/calendar`);

    // Open Options in maximized mode
    await openDropdown(
      page.locator(".portlet-options-menu .dropdown-toggle").first(),
    );

    // Should have "Return to dashboard" instead of Maximize
    await expect(
      page.locator(".up-portlet-options-item.dashboard"),
    ).toBeVisible();
    await expect(
      page.locator(".up-portlet-options-item.dashboard a"),
    ).toContainText("Return to dashboard");
  });
});

test.describe("Portlet Options menu while the page finishes loading", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, config.users.student);
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  /*
   * MOD-I320: about 100 ms after the load event, portal-analytics.js sets up
   * every dropdown toggle again (it gives a toggle without an id the id
   * dropdown-<n>). It used to set aria-expanded="false" and replace the
   * Bootstrap instance whatever the menu's state, so a menu opened before
   * then stayed open while a screen reader was told it was closed.
   */
  test("a menu opened before the page's dropdown setup stays announced as open", async ({
    page,
  }) => {
    // Open the first Options menu on the load event, before the setup's timer runs
    await page.addInitScript(() => {
      window.addEventListener("load", () => {
        const first = document.querySelector(
          ".portlet-options-menu .dropdown-toggle",
        );
        const dropdown = window.bootstrap?.Dropdown;
        if (first && dropdown) {
          dropdown.getOrCreateInstance(first).show();
        }
      });
    });
    await page.goto(`${config.url}p/calendar`);
    const toggle = page
      .locator(".portlet-options-menu .dropdown-toggle")
      .first();
    const menu = page.locator(".portlet-options-menu .dropdown-menu").first();

    // The page's setup has run once the toggle has its generated id
    await expect(toggle).toHaveAttribute("id", /^dropdown-\d+$/);
    await expect(menu).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // and the menu still closes with the keyboard
    await toggle.focus();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("Portlet edit mode", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, config.users.student);
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("Bookmarks edit mode shows action buttons", async ({ page }) => {
    // Navigate to Bookmarks in maximized + edit mode via Options menu
    await page.goto(`${config.url}p/bookmarks`);

    // Click Edit in Options
    await openDropdown(
      page.locator(".portlet-options-menu .dropdown-toggle").first(),
    );
    await page.locator(".up-portlet-options-item.edit a").click();

    // Wait for edit mode content to load
    await expect(
      page.getByRole("button", { name: "Add Bookmark" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add Folder" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Stop editing" }),
    ).toBeVisible();
  });

  test("Announcements portlet has My Subscriptions and Archives links", async ({
    page,
  }) => {
    await page.goto(`${config.url}p/announcements`);

    await expect(page.getByText("My Subscriptions")).toBeVisible();
    await expect(page.getByText("Archives")).toBeVisible();
  });
});

test.describe("Portlet direct URL", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, config.users.student);
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("direct URL navigates to portlet in maximized view", async ({
    page,
  }) => {
    // /p/fname is the direct URL pattern
    await page.goto(`${config.url}p/bookmarks`);

    // Should render in maximized mode
    await expect(
      page.locator(".up-portlet-titlebar .portlet-title"),
    ).toContainText("Bookmarks");

    // URL should contain the portlet path
    expect(page.url()).toContain("/p/bookmarks");
  });

  test("direct URL for calendar works", async ({ page }) => {
    await page.goto(`${config.url}p/calendar`);

    await expect(
      page.locator(".up-portlet-titlebar .portlet-title"),
    ).toContainText("Calendar");
  });

  test("direct URL for courses works", async ({ page }) => {
    await page.goto(`${config.url}p/courses`);

    await expect(
      page.locator(".up-portlet-titlebar .portlet-title"),
    ).toContainText("Courses");
    // Course content should be present
    await expect(page.getByText("Design Awareness")).toBeVisible();
  });
});
