import { test, expect } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  logout,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";

/*
 * The user locale selector as a web component (uPortal MOD-D18): the
 * user-locales-selector channel is a "Web Component" channel that renders
 * <up-user-locale>, backed by /api/v6-0/locale. What it does for users is in
 * user-locale.spec.ts; these tests cover what is specific to the component.
 */
const URL = `${config.url}p/user-locales-selector`;
const API = `${config.url}api/v6-0/locale`;
const MODULE_SCRIPT =
  'script[type="module"][src*="/webcomponents/assets/up-user-locale-"]';

interface UserLocaleBody {
  selected: string | null;
  locales: { code: string; tag: string; name: string }[];
}

test.describe("User locale web component", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, config.users.staff);
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("renders its element with the portal context", async ({ page }) => {
    await page.goto(URL);

    const element = page.locator("up-user-locale");
    await expect(element).toHaveCount(1);
    await expect(page.locator(MODULE_SCRIPT)).toHaveCount(1);
    await expect(element).toHaveAttribute("fname", "user-locales-selector");
    await expect(element).toHaveAttribute("context-path", "/uPortal");
    await expect(element).toHaveAttribute("csrf-header", /^X-/);
    await expect(element).toHaveAttribute("csrf-token", /\S/);
    await expect(
      page.locator(".up-portlet-titlebar .portlet-title"),
    ).toContainText("User Locales Selector");
    await expect(element.getByRole("radio")).toHaveCount(8);
  });

  test("its API needs the CSRF token and takes only the portal's locales", async ({
    page,
  }) => {
    await page.goto(URL);
    const element = page.locator("up-user-locale");
    await expect(element.getByRole("radio")).toHaveCount(8);
    const header = (await element.getAttribute("csrf-header")) ?? "";
    const token = (await element.getAttribute("csrf-token")) ?? "";

    const read = await page.request.get<UserLocaleBody>(API);
    expect(read.status()).toBe(200);
    const body = await read.json();
    expect(body.locales.map((locale) => locale.code)).toContain("fr_FR");

    const refused = await page.request.put<unknown>(API, {
      data: { code: "fr_FR" },
    });
    expect(refused.status()).toBe(403);

    const unknown = await page.request.put<unknown>(API, {
      data: { code: "xx_YY" },
      headers: { [header]: token },
    });
    expect(unknown.status()).toBe(400);

    const kept = await page.request.put<UserLocaleBody>(API, {
      data: { code: "en_US" },
      headers: { [header]: token },
    });
    expect(kept.status()).toBe(200);
    const keptBody = await kept.json();
    expect(keptBody.selected).toBe("en_US");
  });

  test("keeps the page and says so when the portal refuses the change", async ({
    page,
  }) => {
    await page.route(API, async (route) => {
      await (route.request().method() === "PUT"
        ? route.fulfill({ status: 500, body: "" })
        : route.continue());
    });
    await page.goto(URL);
    await waitForPortalRequestsToSettle(page);
    const element = page.locator("up-user-locale");

    await element.getByRole("radio", { name: "French", exact: true }).check();
    await element.getByRole("button", { name: "Update", exact: true }).click();

    await expect(element.getByRole("alert")).toContainText(
      "Your language could not be changed.",
    );
    await expect(page.locator("html")).toHaveAttribute("lang", /^en/);
  });
});
