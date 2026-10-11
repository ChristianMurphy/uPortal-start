import { test, expect, Page } from "@playwright/test";
import { config } from "../general-config";
import { loginViaUrl, logout } from "../ux/utils/ux-general-utils";

/*
 * The session REST API behind the Session Timeout web component (uPortal
 * SessionTimeoutRESTController): GET /api/v6-0/session answers the session's
 * timeout, POST /api/v6-0/session/keep-alive extends the session. Guests get
 * 401, and the POST needs the CSRF token the portal puts on web-component
 * elements.
 */
const SESSION_API = `${config.url}api/v6-0/session`;
const KEEP_ALIVE_API = `${SESSION_API}/keep-alive`;

/** The CSRF header and token the portal gives web-component elements. */
async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  await page.goto(`${config.url}p/favorites`);
  const element = page.locator("up-favorites");
  await expect(element).toHaveAttribute("csrf-token", /\S/);
  const header = (await element.getAttribute("csrf-header")) ?? "";
  const token = (await element.getAttribute("csrf-token")) ?? "";
  return { [header]: token };
}

test.describe("Session API as a guest", () => {
  test("refuses a request without a session", async ({ request }) => {
    const response = await request.get<unknown>(SESSION_API);

    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({
      status: 401,
      message: "Sign in to have a session timeout",
    });
  });

  test("refuses a guest who has a session", async ({ page }) => {
    await page.goto(config.url);
    await expect(page.locator("div.user-name")).toHaveCount(0);

    const response = await page.request.get<unknown>(SESSION_API);

    expect(response.status()).toBe(401);
  });
});

test.describe("Session API as a user", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, config.users.student);
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("answers the session timeout", async ({ page }) => {
    const response = await page.request.get<unknown>(SESSION_API);

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    // Tomcat's default session timeout; the quickstart sets no other
    expect(await response.json()).toEqual({ maxInactiveIntervalSeconds: 1800 });
  });

  test("keeps the session alive with the page's CSRF token", async ({
    page,
  }) => {
    const headers = await csrfHeaders(page);

    const response = await page.request.post<unknown>(KEEP_ALIVE_API, {
      headers,
    });

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ maxInactiveIntervalSeconds: 1800 });
  });

  test("refuses a keep-alive without the CSRF token", async ({ page }) => {
    const response = await page.request.post<unknown>(KEEP_ALIVE_API);

    expect(response.status()).toBe(403);
  });
});
