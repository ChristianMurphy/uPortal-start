import { test, expect, Page } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  sessionCsrfHeaders,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";
import { ownUser } from "../utils/own-users";

/*
 * MOD-D50: web components come in English, Spanish and French. Each test
 * signs in as a user whose locale is Spanish or French, saved through the
 * locale API that the User Locales Selector uses, and finds a translated text in
 * <up-favorites> (/p/favorites) and <up-popular-portlets>
 * (/p/popular-portlets). The component renders its English defaults first,
 * then the texts /api/v6-0/messages returns in the user's locale.
 *
 * The portal stores the locale for the user, so the tests use an account of
 * their own (own-users.ts): another spec signing in as a shared user while a
 * locale is set would see the portal in Spanish or French. Each test sets the
 * locale and puts back the one the account had.
 */

/* One translated text per component and locale */
const CASES = [
  {
    locale: "es_ES",
    component: "up-favorites",
    url: `${config.url}p/favorites`,
    // favorites.instruction.add.via.contextual.menu, shown with or without favorites
    text: "Puede favorecer cualquier portlet que utilice",
  },
  {
    locale: "fr_FR",
    component: "up-favorites",
    url: `${config.url}p/favorites`,
    text: "Vous pouvez marquer une portlet en favori",
  },
  {
    locale: "es_ES",
    component: "up-popular-portlets",
    url: `${config.url}p/popular-portlets`,
    // popular.portlets.aggregation.note, shown whatever the table holds
    text: "* Estos valores provienen de la agregación diaria de estadísticas",
  },
  {
    locale: "fr_FR",
    component: "up-popular-portlets",
    url: `${config.url}p/popular-portlets`,
    text: "* Ces valeurs proviennent de l'agrégation quotidienne des statistiques",
  },
];

/**
 * The user's locale as the locale API names it, such as "en_US", read from
 * the locale attribute the portal gives a web component ("en-US").
 */
async function currentLocale(
  page: Page,
  url: string,
  component: string,
): Promise<string> {
  await waitForPortalRequestsToSettle(page);
  await page.goto(url);
  const element = page.locator(component);
  await expect(element).toHaveAttribute("locale", /\S/);
  const tag = await element.getAttribute("locale");
  return (tag ?? "").replace("-", "_");
}

/** Saves the signed-in user's locale through the API the selector uses. */
async function chooseLocale(page: Page, code: string): Promise<void> {
  const response = await page.request.put<unknown>(
    `${config.url}api/v6-0/locale`,
    {
      data: { code },
      headers: await sessionCsrfHeaders(page.request),
    },
  );
  expect(response.status(), `PUT /api/v6-0/locale ${code}`).toBe(200);
}

for (const { locale, component, url, text } of CASES) {
  test(`${component} shows ${locale} text to a user whose locale is ${locale}`, async ({
    page,
  }) => {
    await loginViaUrl(page, ownUser("locale"));
    const previous = await currentLocale(page, url, component);
    try {
      await chooseLocale(page, locale);

      await waitForPortalRequestsToSettle(page);
      await page.goto(url);
      const element = page.locator(component);
      await expect(element).toHaveAttribute("locale", locale.replace("_", "-"));
      await expect(element.getByText(text)).toBeVisible();
    } finally {
      await chooseLocale(page, previous);
    }
  });
}
