import { test, expect } from "@playwright/test";
import { loginViaUrl, logout } from "../utils/ux-general-utils";
import { ownUser } from "../utils/own-users";
import { setUserLocale } from "../utils/user-locale";
import { config } from "../../general-config";

const CALENDAR_URL = `${config.url}p/calendar/max/render.uP`;

test.describe("Calendar Portlet", () => {
  test("renders calendar container", async ({ page }) => {
    await loginViaUrl(page, config.users.admin);
    await page.goto(CALENDAR_URL);

    // Calendar portlet should have its main container
    await expect(
      page.locator(".upcal-wideview, .upcal-narrowview, [class*='calendar']").first()
    ).toBeVisible();
  });

  test("day/week/month range buttons are visible", async ({ page }) => {
    await loginViaUrl(page, config.users.admin);
    await page.goto(CALENDAR_URL);

    // The range selector buttons should be present
    await expect(page.locator(".upcal-range-day").first()).toBeAttached();
  });

  test("no JavaScript errors on load", async ({ page }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (error) => jsErrors.push(error.message));

    await loginViaUrl(page, config.users.admin);
    await page.goto(CALENDAR_URL);

    // Wait for the calendar's main container to render — proxy for
    // "the page's main async JS has run".
    await expect(
      page.locator(".upcal-wideview, .upcal-narrowview").first()
    ).toBeVisible();

    // Filter out known non-critical errors (e.g., from portal chrome)
    const criticalErrors = jsErrors.filter(
      (error) =>
        !error.includes("noConflict") && !error.includes("is not defined")
    );
    expect(criticalErrors).toEqual([]);
  });

  test("event list renders without leaking Underscore template sigils", async ({
    page,
  }) => {
    // Regression guard: uPortal's respondr.xsl globally sets
    // up._.templateSettings to Mustache-style {{ }} delimiters, but
    // Calendar's Underscore templates use <% %> / <%= %>. If a future
    // refactor drops the per-call templateSettings override, the raw
    // template source leaks into the events column instead of being
    // interpolated. Catching that here is cheap.
    await loginViaUrl(page, config.users.admin);
    // <calendar-portlet> keeps .upcal-event-list hidden until its events
    // resource request returns. That request aggregates every configured
    // feed, including external ones that can be slow or unreachable, so
    // wait for the response itself rather than for a fixed timeout.
    const eventsLoaded = page.waitForResponse(
      (response) =>
        response.url().includes("/p/calendar.") &&
        response.url().includes(".resource.uP")
    );
    await page.goto(CALENDAR_URL);
    await eventsLoaded;

    const eventList = page.locator(".upcal-event-list");
    await expect(eventList).toBeVisible();
    // The list resolves to either the "No events" alert or one or
    // more day rows. Either way, no Underscore sigils should appear.
    await expect(eventList).not.toContainText("<%");
    await expect(eventList).not.toContainText("<%=");
  });
});

/*
 * The Calendar's labels in French (MOD-I400). The JSP writes them as JSON,
 * and CalendarPortlet 2.7.4 escapes them for JavaScript, which turns the
 * apostrophe of "Voir plus d'évènements" into \' and breaks the JSON. The
 * element then logs an error and shows its English labels. The JSPs in
 * overlays/CalendarPortlet repair the JSON until a release does. The test
 * changes the user's saved language, so it signs in as a user of its own
 * (own-users.ts), whose Welcome tab has the Calendar.
 */
test.describe("Calendar in French", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, ownUser("calendar"));
  });

  test.afterEach(async ({ page }) => {
    await setUserLocale(page, "en_US");
    await logout(page);
  });

  test("shows its labels in French", async ({ page }) => {
    const calendarErrors: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        message.text().includes("calendar-portlet")
      ) {
        calendarErrors.push(message.text());
      }
    });

    await setUserLocale(page, "fr_FR");
    await page.goto(config.url);

    const calendar = page.locator("calendar-portlet").first();
    await expect(
      calendar.getByRole("button", { name: "Semaine", exact: true }),
    ).toBeVisible();
    await expect(calendar.locator(".upcal-view-more-events")).toHaveText(
      /Voir plus d'évènements/,
    );
    expect(calendarErrors).toEqual([]);
  });
});
