import { test, expect, APIRequestContext } from "@playwright/test";
import { config } from "../general-config";
import { loginViaApi, logoutViaApi } from "../ux/utils/ux-general-utils";

/*
 * The REST API behind the Reset My Layout web component (uPortal
 * ResetMyLayoutRESTController): GET /api/v6-0/layout/reset names the user
 * whose layout a reset acts on, POST /api/v6-0/layout/reset resets that
 * layout. The request names no user: it is always the signed-in one.
 * Guests get 401, and the POST needs the CSRF token the portal puts on
 * web-component elements. No browser: these run in the database harness too.
 */
const RESET_API = `${config.url}api/v6-0/layout/reset`;
const LAYOUT_API = `${config.url}api/layout`;
const WELCOME_URL = `${config.url}f/welcome/normal/render.uP`;
// A page with a web-component element, which carries the CSRF header and token
const ELEMENT_PAGE = `${config.url}p/favorites`;
const ELEMENT = "up-favorites";

/** The CSRF header and token on the page's web-component element. */
async function csrfHeaders(
  request: APIRequestContext,
): Promise<Record<string, string>> {
  const response = await request.get<unknown>(ELEMENT_PAGE);
  const html = await response.text();
  const element = new RegExp(`<${ELEMENT}\\b[^>]*>`).exec(html)?.[0] ?? "";
  const header = /\scsrf-header="([^"]+)"/.exec(element)?.[1] ?? "";
  const token = /\scsrf-token="([^"]+)"/.exec(element)?.[1] ?? "";
  expect(header, `csrf-header on ${ELEMENT}`).not.toBe("");
  expect(token, `csrf-token on ${ELEMENT}`).not.toBe("");
  return { [header]: token };
}

/** The Welcome page's HTML: the user's tabs and a CSRF token. */
async function welcomePage(request: APIRequestContext): Promise<string> {
  const response = await request.get<unknown>(WELCOME_URL);
  expect(response.status()).toBe(200);
  return response.text();
}

/** Adds a one-column tab to the signed-in user's layout. */
async function addTab(request: APIRequestContext, name: string): Promise<void> {
  const token = /[&?]_csrf=([\da-f-]+)/.exec(await welcomePage(request))?.[1];
  expect(token, "a _csrf parameter on the page").toBeTruthy();
  const response = await request.post<unknown>(LAYOUT_API, {
    form: {
      _csrf: token ?? "",
      action: "addTab",
      "widths[]": "100",
      tabName: name,
    },
  });
  expect(response.status()).toBe(200);
}

test.describe("Reset My Layout API as a guest", () => {
  test("refuses a request without a session", async ({ request }) => {
    const response = await request.get<unknown>(RESET_API);

    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({
      status: 401,
      message: "Sign in to reset your layout",
    });
  });

  test("refuses a guest's reset, CSRF token and all", async ({ request }) => {
    // The guest page gives the guest a session and a CSRF token
    const headers = await csrfHeaders(request);

    const response = await request.post<unknown>(RESET_API, { headers });

    expect(response.status()).toBe(401);
  });
});

test.describe("Reset My Layout API as a user", () => {
  // Each test owns a tab name; tab names hold at most 35 characters
  let tab: string;

  test.beforeEach(async ({ request }, testInfo) => {
    tab = `Reset api ${testInfo.testId.slice(-8)}`;
    await loginViaApi(request, config.users.student);
  });

  test.afterEach(async ({ request }) => {
    // Leave the student the default layout from the next sign-in on
    await resetWithToken(request);
    await logoutViaApi(request);
  });

  test("names the signed-in user", async ({ request }) => {
    const response = await request.get<unknown>(RESET_API);

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({
      userName: config.users.student.username,
    });
  });

  test("refuses a reset without the CSRF token", async ({ request }) => {
    await addTab(request, tab);

    const missing = await request.post<unknown>(RESET_API);
    const forged = await request.post<unknown>(RESET_API, {
      headers: { "X-CSRF-TOKEN": "forged" },
    });

    expect(missing.status()).toBe(403);
    expect(forged.status()).toBe(403);
    // Nothing was reset: the tab is still there at the next sign-in
    await logoutViaApi(request);
    await loginViaApi(request, config.users.student);
    expect(await welcomePage(request)).toContain(tab);
  });

  test("resets the signed-in user's layout, whoever the body names", async ({
    request,
  }) => {
    await addTab(request, tab);

    const response = await request.post<unknown>(RESET_API, {
      headers: await csrfHeaders(request),
      data: { userName: config.users.staff.username },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({
      userName: config.users.student.username,
    });
    // The default layout comes back at the next sign-in
    await logoutViaApi(request);
    await loginViaApi(request, config.users.student);
    expect(await welcomePage(request)).not.toContain(tab);
  });
});

/** Resets the signed-in user's layout, so the test leaves the default one. */
async function resetWithToken(request: APIRequestContext): Promise<void> {
  const response = await request.post<unknown>(RESET_API, {
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(200);
}
