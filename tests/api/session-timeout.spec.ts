import { test, expect, APIRequestContext } from "@playwright/test";
import { config } from "../general-config";
import { loginViaApi, logoutViaApi } from "../ux/utils/ux-general-utils";

/*
 * The session REST API behind the Session Timeout web component (uPortal
 * SessionTimeoutRESTController): GET /api/v6-0/session answers the session's
 * timeout, POST /api/v6-0/session/keep-alive extends the session. Guests get
 * 401, and the POST needs the CSRF token the portal puts on web-component
 * elements. No browser: these run in the database harness too.
 */
const SESSION_API = `${config.url}api/v6-0/session`;
const KEEP_ALIVE_API = `${SESSION_API}/keep-alive`;

/** The CSRF header and token on the page's up-session-timeout element. */
async function csrfHeaders(
  request: APIRequestContext,
): Promise<Record<string, string>> {
  const response = await request.get<unknown>(config.url);
  const html = await response.text();
  const element = /<up-session-timeout\b[^>]*>/.exec(html)?.[0] ?? "";
  const header = /\scsrf-header="([^"]+)"/.exec(element)?.[1] ?? "";
  const token = /\scsrf-token="([^"]+)"/.exec(element)?.[1] ?? "";
  expect(header, "csrf-header on up-session-timeout").not.toBe("");
  expect(token, "csrf-token on up-session-timeout").not.toBe("");
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

  test("refuses a guest who has a session", async ({ request }) => {
    // The guest page gives the guest a session cookie
    const page = await request.get<unknown>(config.url);
    expect(page.status()).toBe(200);

    const response = await request.get<unknown>(SESSION_API);

    expect(response.status()).toBe(401);
  });
});

test.describe("Session API as a user", () => {
  test.beforeEach(async ({ request }) => {
    await loginViaApi(request, config.users.student);
  });

  test.afterEach(async ({ request }) => {
    await logoutViaApi(request);
  });

  test("answers the session timeout", async ({ request }) => {
    const response = await request.get<unknown>(SESSION_API);

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    // Tomcat's default session timeout; the quickstart sets no other
    expect(await response.json()).toEqual({ maxInactiveIntervalSeconds: 1800 });
  });

  test("keeps the session alive with the page's CSRF token", async ({
    request,
  }) => {
    const headers = await csrfHeaders(request);

    const response = await request.post<unknown>(KEEP_ALIVE_API, { headers });

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ maxInactiveIntervalSeconds: 1800 });
  });

  test("refuses a keep-alive without the CSRF token", async ({ request }) => {
    const response = await request.post<unknown>(KEEP_ALIVE_API);

    expect(response.status()).toBe(403);
  });
});
