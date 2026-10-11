import { expect, Page } from "@playwright/test";
import { config } from "../../general-config";
import { waitForPortalRequestsToSettle } from "./ux-general-utils";

/*
 * The language the portal renders in for the signed-in user. The portal
 * ignores the browser's Accept-Language and takes the session's language,
 * then the user's saved one, then en_US. The User Locales Selector channel
 * (fname user-locales-selector) sets both the session's and the saved one.
 * A test that sets it restores en_US afterwards, and signs in as a user no
 * other spec uses, since a parallel spec signing in as the same user would
 * get the saved language.
 */
const SELECTOR_URL = `${config.url}p/user-locales-selector`;

/** Sets the signed-in user's language, such as "es_ES" or "fr_FR". */
export async function setUserLocale(page: Page, code: string): Promise<void> {
  await page.goto(SELECTOR_URL);
  await waitForPortalRequestsToSettle(page);
  const selector = page.locator(
    "section.up-portlet-wrapper.user-locales-selector",
  );
  await selector.locator(`input[type="radio"][value="${code}"]`).check();
  await selector.locator('input[name="_eventId_updateLocale"]').click();
  // The page after the update is in the new language
  await expect(page.locator("html")).toHaveAttribute(
    "lang",
    new RegExp(`^${code.slice(0, 2)}`),
  );
  await waitForPortalRequestsToSettle(page);
}
