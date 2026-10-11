import { expect, Page, APIRequestContext, Locator } from "@playwright/test";
import { config } from "../../general-config";

interface BootstrapDropdownInstance {
  show(): void;
}

interface BootstrapGlobal {
  Dropdown: {
    getOrCreateInstance(element: Element): BootstrapDropdownInstance;
  };
}

declare global {
  interface Window {
    bootstrap?: BootstrapGlobal;
    upPortalRequestsInFlight?: number;
  }
}

const SEL_UPORTAL_LOGIN = "#portalCASLoginLink";
// The login form for each authMode:  uPortal's 'login' portlet, or CAS 8's login page
const LOGIN_FORM = {
  local: {
    usernameInput: 'form[action$="/Login"] input[name="userName"]',
    secretInput: 'form[action$="/Login"] input[name="password"]',
    submit: 'form[action$="/Login"] input[type="submit"]',
  },
  cas: {
    usernameInput: "#username",
    secretInput: "#password",
    submit: 'button[name="submitBtn"]',
  },
};

/*
 * Log into uPortal via an APIRequestContext
 */
export async function loginViaApi(
  request: APIRequestContext,
  user: Record<string, string>
): Promise<void> {
  const url = `${config.url}Login?userName=${user.username}&password=${user.password}`;
  const response = await request.get<unknown>(url);
  expect(response.status()).toEqual(200);
  const responseText = await response.text();
  expect(responseText).toContain(user.displayName);
}

/*
 * Log out of uPortal via an APIRequestContext
 *
 * In both authModes the logout ends on the portal's guest page:  directly, or
 * by way of CAS's logout, which redirects back to the portal.
 */
export async function logoutViaApi(request: APIRequestContext): Promise<void> {
  const url = `${config.url}Logout`;
  const response = await request.get<unknown>(url);
  expect(response.status()).toEqual(200);
  expect(response.url().startsWith(config.url)).toBe(true);
  const responseText = await response.text();
  expect(responseText).toContain('id="portalCASLoginLink"');
  // confirm known endpoint is unavailable for guest user
  await request.get<unknown>(`${config.url}api/portlet-list/`);
  expect(response.status()).toEqual(200);
}
/*
 * Log into uPortal via the UX
 */
export async function loginViaPage(
  page: Page,
  user: Record<string, string>
): Promise<void> {
  await trackPortalRequests(page);
  // Navigate to uPortal welcome page prior to login
  const landingPageUrl = `${config.url}f/welcome/normal/render.uP`;
  await page.goto(landingPageUrl);

  // Open the login form through the Sign In button, and submit it
  await openLoginForm(page);
  await submitLoginForm(page, user.username, user.password);

  // Confirm user is logged in
  const loggedInUserDisplay = page.locator("div.user-name");
  await expect(loggedInUserDisplay).toHaveText(
    `You are signed in as ${user.displayName}`
  );
  // As loginViaUrl does: a /p/ page opened next while the landing page's
  // portlets still have *.uP requests in flight renders without its
  // portlet (MOD-I56)
  await waitForPortalRequestsToSettle(page);
}

/*
 * Click the portal's Sign In button and wait for the login form of the
 * configured authMode:  uPortal's own form, or the CAS server's.
 */
export async function openLoginForm(page: Page): Promise<void> {
  const uportalSignin = page.locator(SEL_UPORTAL_LOGIN);
  await expect(uportalSignin).toHaveText("Sign In");
  await page.click(SEL_UPORTAL_LOGIN);
  await expectLoginForm(page);
}

/*
 * Confirm the page shows the login form of the configured authMode
 */
export async function expectLoginForm(page: Page): Promise<void> {
  if (config.authMode === "cas") {
    await expect(page).toHaveURL((url) =>
      url.href.startsWith(`${config.casUrl}login`)
    );
  }
  await expect(
    page.locator(LOGIN_FORM[config.authMode].usernameInput)
  ).toBeVisible();
}

/*
 * Fill in and submit the open login form (see openLoginForm)
 */
export async function submitLoginForm(
  page: Page,
  username: string,
  password: string
): Promise<void> {
  const form = LOGIN_FORM[config.authMode];
  await page.fill(form.usernameInput, username);
  await page.fill(form.secretInput, password);
  await page.click(form.submit);
}

/*
 * Confirm the page is the portal's guest view:  on the portal (not CAS), with
 * the Sign In button and nobody signed in
 */
export async function expectSignedOut(page: Page): Promise<void> {
  await expect(page).toHaveURL((url) => url.href.startsWith(config.url));
  await expect(page.locator(SEL_UPORTAL_LOGIN)).toHaveText("Sign In");
  await expect(page.locator("div.user-name")).toHaveCount(0);
}

/*
 * Confirm the login form rejected the credentials submitted by
 * submitLoginForm:  the user is back on the login form, which says why.
 */
export async function expectLoginRefused(page: Page): Promise<void> {
  if (config.authMode === "cas") {
    await expect(page).toHaveURL((url) =>
      url.href.startsWith(`${config.casUrl}login`)
    );
    await expect(page.locator("#loginErrorsPanel")).toContainText(
      "Authentication attempt has failed"
    );
  } else {
    await expect(page).toHaveURL((url) =>
      url.href.startsWith(`${config.url}p/login`)
    );
    await expect(page.locator(".portlet-msg-error")).toContainText(
      "Invalid username or password"
    );
    await expectLoginForm(page);
    await expect(page.locator("div.user-name")).toHaveCount(0);
  }
}

interface CsrfHeaders {
  sessionId: string;
  headers: Record<string, string>;
}

const csrfHeadersBySession = new WeakMap<APIRequestContext, CsrfHeaders>();

async function portalSessionId(request: APIRequestContext): Promise<string> {
  const portalPath = new URL(config.url).pathname;
  const { cookies } = await request.storageState();
  const session = cookies.find(
    (cookie) =>
      cookie.name === "JSESSIONID" && portalPath.startsWith(cookie.path)
  );
  return session?.value ?? "";
}

/*
 * The header that carries the session's CSRF token.  uPortal requires the
 * token on POST, PUT, PATCH and DELETE under /api (MOD-I130), unless the
 * request has a Bearer token.  Portal pages carry it in their _csrf and
 * _csrf_header meta tags:  this reads them from the user's default page, and
 * again whenever the session changes (logging in or out starts a new one).
 */
export async function sessionCsrfHeaders(
  request: APIRequestContext
): Promise<Record<string, string>> {
  const known = csrfHeadersBySession.get(request);
  const sessionId = await portalSessionId(request);
  if (known && sessionId !== "" && known.sessionId === sessionId) {
    return known.headers;
  }
  const response = await request.get<unknown>(config.url);
  expect(response.status()).toEqual(200);
  const html = await response.text();
  const token = /<meta name="_csrf" content="([^"]+)"/.exec(html)?.[1];
  const header = /<meta name="_csrf_header" content="([^"]+)"/.exec(html)?.[1];
  if (token === undefined || header === undefined) {
    throw new Error(`No CSRF meta tags on ${response.url()}`);
  }
  const headers = { [header]: token };
  csrfHeadersBySession.set(request, {
    sessionId: await portalSessionId(request),
    headers,
  });
  return headers;
}

const trackedPages = new WeakSet<Page>();

/*
 * Count the portal (*.uP) XHR and fetch requests a page has in flight, in
 * window.upPortalRequestsInFlight, for waitForPortalRequestsToSettle().
 *
 * Why: uPortal keeps the "focused" transient portlet (a /p/<fname> portlet
 * that is not in the user's layout, rendered as ctfN) in session state.
 * Every *.uP request clears it first (UserLayoutParameterProcessor calls
 * TransientUserLayoutManagerWrapper.setFocusedId(null)), including the
 * AJAX that portlets fire after load (emergency-alert, calendar, file
 * manager, ...). If one of those reaches the server while the next page
 * is rendering a transient portlet, that page renders without the
 * portlet. Leaving a page only once its *.uP requests have finished keeps
 * the session to one *.uP request at a time.
 *
 * A request stays counted until a task after it completes, so a request
 * started from the previous one's completion callback (as jQuery chains
 * do) keeps the counter above zero. Must be called before the page
 * navigates.
 */
export async function trackPortalRequests(page: Page): Promise<void> {
  if (trackedPages.has(page)) return;
  trackedPages.add(page);
  await page.addInitScript(() => {
    if (window.upPortalRequestsInFlight !== undefined) return;
    window.upPortalRequestsInFlight = 0;
    const portalUrl = /\.uP([#?]|$)/;
    const increment = (): void => {
      window.upPortalRequestsInFlight =
        (window.upPortalRequestsInFlight ?? 0) + 1;
    };
    const decrement = (): void => {
      window.upPortalRequestsInFlight =
        (window.upPortalRequestsInFlight ?? 1) - 1;
    };

    class TrackedXMLHttpRequest extends window.XMLHttpRequest {
      private portalRequest = false;

      open(
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null
      ): void {
        this.portalRequest = portalUrl.test(String(url));
        super.open(method, url, async ?? true, username, password);
      }

      send(body?: Document | XMLHttpRequestBodyInit | null): void {
        if (!this.portalRequest) {
          super.send(body);
          return;
        }
        increment();
        let finished = false;
        const finish = (): void => {
          if (finished) return;
          finished = true;
          window.setTimeout(decrement, 0);
        };
        this.addEventListener("loadend", finish);
        try {
          super.send(body);
        } catch (error) {
          finish();
          throw error;
        }
      }
    }
    window.XMLHttpRequest = TrackedXMLHttpRequest;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const url =
        typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url;
      if (!portalUrl.test(url)) return originalFetch(input, init);
      increment();
      try {
        return await originalFetch(input, init);
      } finally {
        window.setTimeout(decrement, 0);
      }
    };
  });
}

/*
 * Wait until the current page has loaded and none of its portal (*.uP)
 * requests are in flight. Call this before leaving a portal page (goto,
 * link click, form submit) when the next page renders a portlet that is
 * not in the user's layout; see trackPortalRequests() for why.
 */
export async function waitForPortalRequestsToSettle(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.readyState === "complete" &&
      (window.upPortalRequestsInFlight ?? 0) === 0
  );
}

/*
 * Log into uPortal via URL-based login (faster than the login form for smoke tests)
 *
 * Returns once the landing page's own portal requests have finished, so
 * that a test's next page.goto() cannot race with them.
 */
export async function loginViaUrl(
  page: Page,
  user: Record<string, string>
): Promise<void> {
  await trackPortalRequests(page);
  await page.goto(
    `${config.url}Login?userName=${user.username}&password=${user.password}`
  );
  const loggedIn = page.locator("div.user-name");
  await expect(loggedIn).toContainText(user.displayName);
  await waitForPortalRequestsToSettle(page);
}

/*
 * Log out of uPortal via the browser
 */
export async function logout(page: Page): Promise<void> {
  await page.goto(`${config.url}Logout`);
  // Navigate back to the portal so the next test's loginViaUrl starts
  // from a known state
  await page.goto(config.url);
}

/*
 * Force-unhide the .portlet-options-menu wrappers on the current page.
 *
 * The XSL renders these with class="hidden" and a jQuery document.ready
 * handler removes the class on portlets that have menu items. In headless
 * Playwright runs the timing is variable enough that the click target may
 * still be hidden when a test interacts with it. Real users hit it because
 * jQuery does eventually run; smoke tests need a deterministic unhide.
 *
 * Call after every page.goto(...) / page.reload() that lands on a view
 * where a test interacts with portlet options. `openDropdown` covers the
 * Bootstrap-side of the open path; this helper covers the upstream
 * jQuery-side that gates whether the toggle is rendered at all.
 */
export async function unhidePortletOptionsMenus(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll(
      ".portlet-options-menu.hidden"
    )) {
      element.classList.remove("hidden");
    }
  });
}

/*
 * Open a Bootstrap dropdown via the public Bootstrap.Dropdown API.
 *
 * Why not just .click() the toggle? In this environment Bootstrap 5's
 * data-bs-toggle="dropdown" auto-init wires an instance onto each
 * toggle (Bootstrap.Dropdown.getInstance returns it) but the click
 * delegate that should call .show() is not firing — synthetic clicks,
 * native MouseEvent dispatches, and Playwright's .click() all leave
 * `aria-expanded` at "false". Calling the public API directly works.
 * Tests that need to drive the menu open should use this; tests that
 * specifically want to assert click behavior should not.
 *
 * The Locator argument is the dropdown-toggle element (the trigger).
 */
export async function openDropdown(toggle: Locator): Promise<void> {
  await expect(toggle).toBeVisible();
  await toggle.evaluate((element) => {
    const bs = window.bootstrap;
    if (!bs?.Dropdown) throw new Error("Bootstrap Dropdown not loaded");
    bs.Dropdown.getOrCreateInstance(element).show();
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
