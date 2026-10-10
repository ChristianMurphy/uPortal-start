import { test, expect, Page, Locator } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  logout,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";

/*
 * The "Web Component" channel type (uPortal MOD-D18): a portlet definition of
 * that type renders a custom element plus its ES module instead of going
 * through the portlet container, and the element talks to the portal's REST
 * API with the session cookie and the CSRF token the portal put on it.
 *
 * The quickstart's Favorites channel is one (<up-favorites>). These tests put
 * it on faculty's Welcome tab twice, through the layout API, so that they also
 * see that a page loads the module once however many channels use it, and
 * remove it again afterwards. Other specs only look for faculty's tabs and
 * named portlets, which stay as they were.
 */
const FNAME = "favorites";
const LAYOUT_API = `${config.url}api/layout`;
const MODULE_SCRIPT =
  'script[type="module"][src*="/webcomponents/assets/up-favorites-"]';

interface LayoutResponse {
  newNodeId?: string;
}

interface FavoritesBody {
  collections: unknown[];
  portlets: unknown[];
}

async function addChannel(page: Page): Promise<void> {
  const response = await page.request.post<LayoutResponse>(LAYOUT_API, {
    form: { action: "addPortlet", fname: FNAME, tabName: "Welcome" },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.newNodeId).toBeTruthy();
}

/** Remove every copy of the channel from the layout, also one a failed run left. */
async function removeChannels(page: Page): Promise<void> {
  for (let removed = 0; removed < 10; removed++) {
    const response = await page.request.post<unknown>(LAYOUT_API, {
      form: { action: "removeByFName", fname: FNAME },
    });
    // 400: no channel with the fname is left
    if (response.status() === 400) return;
    expect(response.status()).toBe(200);
  }
  throw new Error(`More than 10 ${FNAME} channels in the layout`);
}

/** What /api/v6-0/favorites returns for the signed-in user. */
async function favoriteCount(page: Page): Promise<number> {
  const response = await page.request.get<FavoritesBody>(
    `${config.url}api/v6-0/favorites`
  );
  expect(response.status()).toBe(200);
  const body = await response.json();
  return body.collections.length + body.portlets.length;
}

/** Wait until the element has rendered the favorites the REST API returns. */
async function expectFavoritesRendered(
  element: Locator,
  count: number
): Promise<void> {
  await expect(
    element.locator(".favorites"),
    "the element upgraded and rendered what the API returned"
  ).toBeVisible();
  await expect(element.locator("li.favorite")).toHaveCount(count);
  await expect(element.locator(".alert.theme-danger")).toHaveCount(0);
}

test.describe("Web component channel", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, config.users.faculty);
    await removeChannels(page);
    await addChannel(page);
    await addChannel(page);
  });

  test.afterEach(async ({ page }) => {
    await removeChannels(page);
    await logout(page);
  });

  test("renders its element with the portal context, and loads the module once", async ({
    page,
  }) => {
    const favoritesCalls = page.waitForResponse((response) =>
      response.url().includes("/api/v6-0/favorites")
    );
    const messagesCalls = page.waitForResponse((response) =>
      response.url().includes("/api/v6-0/messages?")
    );
    await page.goto(config.url);

    const elements = page.locator("up-favorites");
    await expect(elements).toHaveCount(2);
    await expect(page.locator(MODULE_SCRIPT)).toHaveCount(1);

    // The portal chrome around it is the usual one
    await expect(
      page
        .locator(".up-portlet-wrapper:has(up-favorites) .portlet-title")
        .first()
    ).toContainText("Favorites");

    const element = elements.first();
    await expect(element).toHaveAttribute("fname", FNAME);
    await expect(element).toHaveAttribute("window-state", "normal");
    await expect(element).toHaveAttribute("context-path", "/uPortal");
    await expect(element).toHaveAttribute(
      "locale",
      /^[a-z]{2,3}(-[\dA-Za-z]+)*$/
    );
    await expect(element).toHaveAttribute("csrf-header", /^X-/);
    await expect(element).toHaveAttribute("csrf-token", /\S/);

    // The module ran (the element upgraded) and the element reached the API
    await expect(
      element.locator(".favorites"),
      "the element upgraded and rendered what the API returned"
    ).toBeVisible();
    const favoritesResponse = await favoritesCalls;
    const messagesResponse = await messagesCalls;
    expect(favoritesResponse.status()).toBe(200);
    expect(messagesResponse.status()).toBe(200);
    const count = await favoriteCount(page);
    for (const each of await elements.all()) {
      await expectFavoritesRendered(each, count);
    }
  });

  test("keeps working when maximized", async ({ page }) => {
    await page.goto(config.url);
    const wrapper = page
      .locator(".up-portlet-wrapper:has(up-favorites)")
      .first();
    const maximizeLink = wrapper.locator(".up-portlet-options-item.maximize a");
    await expect(maximizeLink).toHaveAttribute("href", /\/max\//);
    const maximize = (await maximizeLink.getAttribute("href")) ?? "";

    await waitForPortalRequestsToSettle(page);
    await page.goto(new URL(maximize, page.url()).href);

    const element = page.locator("up-favorites");
    await expect(element).toHaveCount(1);
    await expect(element).toHaveAttribute("window-state", "maximized");
    await expect(page.locator(MODULE_SCRIPT)).toHaveCount(1);
    await expectFavoritesRendered(element, await favoriteCount(page));
    await expect(
      page.locator(".up-portlet-titlebar .portlet-title")
    ).toContainText("Favorites");
  });

  test("calls the REST API with the token the portal gave it", async ({
    page,
  }) => {
    await page.goto(config.url);
    const element = page.locator("up-favorites").first();
    await expect(element.locator(".favorites")).toBeVisible();
    const header = (await element.getAttribute("csrf-header")) ?? "";
    const token = (await element.getAttribute("csrf-token")) ?? "";
    const api = `${config.url}api/v6-0/favorites`;

    // Without the token a change is refused, with it the change is made
    const refused = await page.request.post<unknown>(api, {
      data: { fname: "calendar" },
    });
    expect(refused.status()).toBe(403);

    const added = await page.request.post<{ nodeId: string }>(api, {
      data: { fname: "calendar" },
      headers: { [header]: token },
    });
    expect([200, 201]).toContain(added.status());
    const { nodeId } = await added.json();
    const removed = await page.request.delete<unknown>(
      `${api}/${encodeURIComponent(nodeId)}`,
      { headers: { [header]: token } }
    );
    expect(removed.status()).toBe(204);
  });
});
