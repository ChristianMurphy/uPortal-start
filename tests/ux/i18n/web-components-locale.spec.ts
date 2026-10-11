import { test, expect, Browser, Page } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  sessionCsrfHeaders,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";

/*
 * MOD-D50: web components come in English, Spanish and French. Each test
 * signs in as a user whose locale is Spanish or French, set through the User
 * Locales Selector portlet as a person would, and finds a translated text in
 * <up-favorites> (/p/favorites) and <up-popular-portlets>
 * (/p/popular-portlets). The component renders its English defaults first,
 * then the texts /api/v6-0/messages returns in the user's locale.
 *
 * The selector stores the locale for the user, so the tests use an account of
 * their own: another spec signing in as a shared user while a locale is set
 * would see the portal in Spanish or French. The account is imported once
 * (re-importing replaces it), each test sets the locale and puts back the one
 * the account had, and afterAll removes the account's portal records.
 */
const LOCALE_USER = {
  username: "e2e-locale",
  // The same password hash as the quickstart student account
  // eslint-disable-next-line sonarjs/no-hardcoded-credentials
  password: "student",
  displayName: "Locale Tester",
};

const LOCALE_USER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<user xmlns="https://source.jasig.org/schemas/uportal/io/user" version="4.0" username="${LOCALE_USER.username}">
    <default-user>defaultTemplateUser</default-user>
    <password>(MD5)mhmjKvf2F3gPizS9DrA+CsFmqj74oTSb</password>
    <attribute>
        <name>givenName</name>
        <value>Locale</value>
    </attribute>
    <attribute>
        <name>sn</name>
        <value>Tester</value>
    </attribute>
    <attribute>
        <name>displayName</name>
        <value>${LOCALE_USER.displayName}</value>
    </attribute>
</user>
`;

const SELECTOR_URL = `${config.url}p/user-locales-selector`;

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

async function asAdmin(
  browser: Browser,
  action: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginViaUrl(page, config.users.admin);
    await action(page);
  } finally {
    await context.close();
  }
}

/**
 * The user's locale as the selector names it, such as "en_US". The selector
 * does not mark it, so this reads the locale attribute the portal gives a web
 * component ("en-US").
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

/** Chooses a locale in the User Locales Selector, in whatever language it shows. */
async function chooseLocale(page: Page, locale: string): Promise<void> {
  await waitForPortalRequestsToSettle(page);
  await page.goto(SELECTOR_URL);
  const form = page.locator(".loc-sel form");
  await form.locator(`input[name="locale"][value="${locale}"]`).check();
  await Promise.all([
    page.waitForLoadState("load"),
    form.locator('input[type="submit"][name="_eventId_updateLocale"]').click(),
  ]);
  await expect(
    page.locator(`.loc-sel input[name="locale"][value="${locale}"]`),
  ).toBeChecked();
}

test.beforeAll(async ({ browser }) => {
  await asAdmin(browser, async (page) => {
    const headers = await sessionCsrfHeaders(page.request);
    const status = await page.evaluate(
      async ({ body, url, csrf }) => {
        const data = new window.FormData();
        data.append(
          "file",
          new window.File([body], "e2e-locale.user.xml", { type: "text/xml" }),
        );
        const response = await window.fetch(`${url}api/import`, {
          method: "POST",
          headers: csrf,
          body: data,
        });
        return response.status;
      },
      { body: LOCALE_USER_XML, url: config.url, csrf: headers },
    );
    expect(status, "import the e2e-locale account").toEqual(200);
  });
});

test.afterAll(async ({ browser }) => {
  // Removes the portal's records of the account (layout, locale); the local
  // account itself stays, and the next import replaces it
  await asAdmin(browser, async (page) => {
    const response = await page.request.delete<unknown>(
      `${config.url}api/entity/user/${LOCALE_USER.username}`,
      { headers: await sessionCsrfHeaders(page.request) },
    );
    expect(response.status()).toEqual(204);
  });
});

for (const { locale, component, url, text } of CASES) {
  test(`${component} shows ${locale} text to a user whose locale is ${locale}`, async ({
    page,
  }) => {
    await loginViaUrl(page, LOCALE_USER);
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
