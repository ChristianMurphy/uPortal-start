import { expect, Page } from "@playwright/test";
import { config } from "../../general-config";
import {
  sessionCsrfHeaders,
  waitForPortalRequestsToSettle,
} from "./ux-general-utils";

/*
 * The language the portal renders in for the signed-in user. The portal
 * ignores the browser's Accept-Language and takes the session's language,
 * then the user's saved one, then en_US. PUT /api/v6-0/locale, which the
 * User Locale web component calls, sets both the session's and the saved
 * one. A test that sets it restores en_US afterwards, and signs in as a user
 * no other spec uses, since a parallel spec signing in as the same user would
 * get the saved language.
 */

/** Sets the signed-in user's language, such as "es_ES" or "fr_FR". */
export async function setUserLocale(page: Page, code: string): Promise<void> {
  await waitForPortalRequestsToSettle(page);
  const response = await page.request.put<unknown>(
    `${config.url}api/v6-0/locale`,
    {
      data: { code },
      headers: await sessionCsrfHeaders(page.request),
    },
  );
  expect(response.status(), `PUT /api/v6-0/locale ${code}`).toBe(200);
}
