import { test, expect, Page, Locator } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  logout,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";

/*
 * What the Background Preference channel (fname background-preference) does
 * for users. The quickstart places it in the Customize panel of the
 * authenticated-lo fragment, which the Customize button under the tabs
 * opens.
 *
 * The channel offers "Change Background Image", which opens a list of None
 * and the quickstart's three images (Galaxy, Mountain, Nebula), each with a
 * thumbnail. Choosing an image puts its full-size version behind the page
 * content (the #portalPageBody::before pseudo-element) at once, and saves
 * the choice, so it is still there on the next page and at the next sign-in.
 * None removes it, and the skin's own background shows again. The choice
 * belongs to the user. Guests do not get the Customize panel.
 *
 * Every test starts from None, chosen through the channel, so the result
 * does not depend on test order. Inside the channel the locators use visible
 * text only, so the same tests describe the portlet and any replacement that
 * keeps its behaviour; the Customize button and the channel's wrapper are the
 * theme's.
 */
const WELCOME_URL = `${config.url}f/welcome/normal/render.uP`;
const IMAGES = ["Galaxy", "Mountain", "Nebula"];

async function openWelcome(page: Page): Promise<void> {
  await page.goto(WELCOME_URL);
  await waitForPortalRequestsToSettle(page);
}

/** The channel, which the theme marks with its fname. */
function channel(page: Page): Locator {
  return page.locator("section.up-portlet-wrapper.background-preference");
}

/** Opens the Customize panel and the list of backgrounds. */
async function openChoices(page: Page): Promise<Locator> {
  const customize = page.locator("#customizeButton");
  if ((await customize.getAttribute("aria-expanded")) !== "true") {
    await customize.click();
  }
  const content = channel(page);
  await content.getByText("Change Background Image").click();
  await expect(content.getByText("Mountain", { exact: true })).toBeVisible();
  return content;
}

/** Chooses a background by its caption, and waits until the portal saved it. */
async function choose(page: Page, caption: string): Promise<void> {
  const content = await openChoices(page);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() !== "GET" &&
      response.url().startsWith(config.url) &&
      response.ok(),
  );
  await content.getByText(caption, { exact: true }).click();
  await saved;
}

/** The background-image behind the page content. */
async function pageBackground(page: Page): Promise<string> {
  return page.evaluate(() => {
    const body = document.querySelector("#portalPageBody");
    return body === null
      ? "no #portalPageBody"
      : window.getComputedStyle(body, "::before").backgroundImage;
  });
}

/** Any of the channel's images; without one the skin's own background shows. */
const CHOSEN = /\/backgroundImages\//;

/** The full-size image of that name. */
function fullSize(image: string): RegExp {
  return new RegExp(`/media/skins/common/backgroundImages/${image}\\.jpg`);
}

test.describe("Background Preference", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, config.users.student);
    await openWelcome(page);
    await choose(page, "None");
    await openWelcome(page);
  });

  test.afterEach(async ({ page }) => {
    await openWelcome(page);
    await choose(page, "None");
    await logout(page);
  });

  test("offers None and the three images, each with a thumbnail", async ({
    page,
  }) => {
    await expect.poll(() => pageBackground(page)).not.toMatch(CHOSEN);

    const content = await openChoices(page);

    for (const caption of ["None", ...IMAGES]) {
      await expect(content.getByText(caption, { exact: true })).toBeVisible();
    }
    const thumbnails = content.locator(
      'img[src*="/backgroundImages/thumbnails/"]',
    );
    await expect(thumbnails).toHaveCount(IMAGES.length);
  });

  test("puts the chosen image behind the page at once", async ({ page }) => {
    await choose(page, "Mountain");

    // The full-size image, not its thumbnail
    await expect.poll(() => pageBackground(page)).toMatch(fullSize("mountain"));
    expect(await pageBackground(page)).not.toContain("/thumbnails/");
  });

  test("keeps the choice on the next page and at the next sign-in", async ({
    page,
  }) => {
    await choose(page, "Nebula");

    await openWelcome(page);
    await expect.poll(() => pageBackground(page)).toMatch(fullSize("nebula"));

    await logout(page);
    await loginViaUrl(page, config.users.student);
    await openWelcome(page);
    await expect.poll(() => pageBackground(page)).toMatch(fullSize("nebula"));
  });

  test("None removes the background", async ({ page }) => {
    await choose(page, "Galaxy");
    await expect.poll(() => pageBackground(page)).toMatch(fullSize("galaxy"));

    await choose(page, "None");

    await expect.poll(() => pageBackground(page)).not.toMatch(CHOSEN);
    await openWelcome(page);
    await expect.poll(() => pageBackground(page)).not.toMatch(CHOSEN);
  });

  test("the choice belongs to the user", async ({ page }) => {
    await choose(page, "Galaxy");

    await logout(page);
    await loginViaUrl(page, config.users.staff);
    await openWelcome(page);
    await expect.poll(() => pageBackground(page)).not.toMatch(CHOSEN);

    await logout(page);
    await loginViaUrl(page, config.users.student);
    await openWelcome(page);
    await expect.poll(() => pageBackground(page)).toMatch(fullSize("galaxy"));
  });
});

test.describe("Background Preference as a guest", () => {
  test("is not offered to guests", async ({ page }) => {
    await page.goto(config.url);

    await expect(
      page.locator(".portal-navigation-label").first(),
    ).toBeAttached();
    await expect(page.locator("#customizeButton")).toHaveCount(0);
    await expect(channel(page)).toHaveCount(0);
    await expect.poll(() => pageBackground(page)).not.toMatch(CHOSEN);
  });
});
