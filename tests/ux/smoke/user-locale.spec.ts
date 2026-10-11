import { test, expect, Page } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  logout,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";

/*
 * What the User Locales Selector channel (fname user-locales-selector) does
 * for users. The quickstart data places it in no layout, so the tests open it
 * at /p/user-locales-selector.
 *
 * The channel lists the portal's locales (portal.properties
 * org.apereo.portal.i18n.LocaleManager.portal_locales, eight in the
 * quickstart) as a radio group, each labelled with its language in the
 * user's current language, and an Update button. Update switches the page to
 * the chosen language at once. For a signed-in user the choice is saved, so
 * it is still in effect at the next login; for a guest it lasts the session.
 *
 * The locators use roles and names only, so the same tests describe the
 * portlet and any replacement that keeps its behaviour.
 */
const URL = `${config.url}p/user-locales-selector`;

const ENGLISH_LABELS = [
  "English",
  "French",
  "Spanish",
  "Japanese",
  "Swedish",
  "German",
  "Macedonian",
  "Latvian",
];

async function openSelector(page: Page): Promise<void> {
  await page.goto(URL);
  await waitForPortalRequestsToSettle(page);
}

/** Choose a language by its label and press the Update button. */
async function chooseLanguage(
  page: Page,
  label: string,
  update: string,
): Promise<void> {
  await page.getByRole("radio", { name: label, exact: true }).check();
  await page.getByRole("button", { name: update, exact: true }).click();
  await waitForPortalRequestsToSettle(page);
}

/**
 * Save English as the user's language, whatever language the page is in, so
 * every test starts from the same choice. Until a user saves one, no
 * language is chosen at all.
 */
async function chooseEnglish(page: Page): Promise<void> {
  await openSelector(page);
  const lang = await page.locator("html").getAttribute("lang");
  // In French the English radio is "anglais" and the button "Mise à jour"
  await (lang?.startsWith("fr")
    ? chooseLanguage(page, "anglais", "Mise à jour")
    : chooseLanguage(page, "English", "Update"));
  await expect(page.locator("html")).toHaveAttribute("lang", /^en/);
}

test.describe("User locale selector", () => {
  test.describe("signed in", () => {
    test.beforeEach(async ({ page }) => {
      await loginViaUrl(page, config.users.student);
      await chooseEnglish(page);
    });

    test.afterEach(async ({ page }) => {
      await chooseEnglish(page);
      await logout(page);
    });

    test("lists the portal's languages with the current one chosen", async ({
      page,
    }) => {
      await openSelector(page);
      await expect(
        page.getByRole("heading", { name: "Set Language Preference" }),
      ).toBeVisible();
      const radios = page.getByRole("radio");
      await expect(radios).toHaveCount(ENGLISH_LABELS.length);
      for (const label of ENGLISH_LABELS) {
        await expect(
          page.getByRole("radio", { name: label, exact: true }),
        ).toBeVisible();
      }
      await expect(
        page.getByRole("radio", { name: "English", exact: true }),
      ).toBeChecked();
      await expect(
        page.getByRole("button", { name: "Update", exact: true }),
      ).toBeVisible();
    });

    test("switches the page to the chosen language", async ({ page }) => {
      await openSelector(page);
      await chooseLanguage(page, "French", "Update");

      await expect(page.locator("html")).toHaveAttribute("lang", /^fr/);
      await expect(
        page.getByRole("heading", { name: "Modifier le choix de la langue" }),
      ).toBeVisible();
      // The labels are now in French, and French is the chosen one
      await expect(
        page.getByRole("radio", { name: "français", exact: true }),
      ).toBeChecked();
      await expect(
        page.getByRole("radio", { name: "anglais", exact: true }),
      ).not.toBeChecked();
      await expect(
        page.getByRole("button", { name: "Mise à jour", exact: true }),
      ).toBeVisible();
    });

    test("keeps the choice at the next login", async ({ page }) => {
      await openSelector(page);
      await chooseLanguage(page, "French", "Update");
      await expect(page.locator("html")).toHaveAttribute("lang", /^fr/);

      await logout(page);
      await loginViaUrl(page, config.users.student);
      await openSelector(page);
      await expect(page.locator("html")).toHaveAttribute("lang", /^fr/);
      await expect(
        page.getByRole("radio", { name: "français", exact: true }),
      ).toBeChecked();
    });
  });

  test("a guest's choice lasts only the session", async ({ page, browser }) => {
    await openSelector(page);
    await expect(page.getByRole("radio")).toHaveCount(ENGLISH_LABELS.length);
    // A new session has no chosen language, so nothing is checked
    await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
    await chooseLanguage(page, "French", "Update");
    await expect(page.locator("html")).toHaveAttribute("lang", /^fr/);

    // Another guest, in a new session, still gets the default language
    const other = await browser.newContext();
    try {
      const otherPage = await other.newPage();
      await otherPage.goto(URL);
      await expect(otherPage.locator("html")).toHaveAttribute("lang", /^en/);
    } finally {
      await other.close();
    }
  });
});
