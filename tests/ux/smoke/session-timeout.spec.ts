import { test, expect, Page, Locator } from "@playwright/test";
import { config } from "../../general-config";
import { loginViaUrl, logout } from "../utils/ux-general-utils";

/*
 * Session Timeout (fname session-timeout) sits in the header region of the
 * authenticated layout. It shows nothing until shortly before the session
 * expires, then opens a modal warning with a countdown and two choices:
 * keep the session, or log out. When the countdown reaches zero the page
 * logs the user out.
 *
 * Timings: Tomcat's default session timeout is 30 minutes (the quickstart
 * sets no other), the warning stays up for the definition's
 * dialogDisplaySeconds (60), and it opens a further 30 seconds early, so
 * the session cannot expire on the server first. The tests run the page's
 * clock forward instead of waiting.
 *
 * The assertions name only what a user sees and does, so the same spec
 * covers the portlet and the web component that replaces it.
 */
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const SESSION_TIMEOUT_MS = 30 * MINUTE;
const DIALOG_DISPLAY_MS = 60 * SECOND;
const WARNING_LEAD_MS = DIALOG_DISPLAY_MS + 30 * SECOND;
const WARNING_OPENS_AFTER_MS = SESSION_TIMEOUT_MS - WARNING_LEAD_MS;

const REMAINING = /Your session will expire\s+in (\d+) seconds\./;

function warning(page: Page, title = "Session expiration"): Locator {
  return page.getByRole("dialog").filter({ hasText: title });
}

async function remainingSeconds(dialog: Locator): Promise<number> {
  const text = (await dialog.textContent()) ?? "";
  const match = REMAINING.exec(text);
  expect(match, `countdown in "${text}"`).not.toBeNull();
  return Number(match?.[1]);
}

/** Runs the clock to just before the warning, checks it is not shown, then opens it. */
async function runUntilWarning(
  page: Page,
  title = "Session expiration",
): Promise<Locator> {
  await page.clock.fastForward(WARNING_OPENS_AFTER_MS - 5 * SECOND);
  await page.clock.runFor(2 * SECOND);
  await expect(warning(page, title)).toBeHidden();
  await page.clock.runFor(4 * SECOND);
  const dialog = warning(page, title);
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Session timeout warning", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
    await loginViaUrl(page, config.users.student);
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("opens 90 seconds before the session expires", async ({ page }) => {
    const dialog = await runUntilWarning(page);

    await expect(dialog).toContainText("Session expiration");
    await expect(dialog).toContainText(REMAINING);
    await expect(dialog).toContainText("Do you want to stay signed in?");
    await expect(
      dialog.getByRole("button", { name: "Yes, keep me signed in" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "No, log me out" }),
    ).toBeVisible();

    const seconds = await remainingSeconds(dialog);
    expect(seconds).toBeGreaterThan(50);
    expect(seconds).toBeLessThanOrEqual(60);
  });

  test("counts down while it is open", async ({ page }) => {
    const dialog = await runUntilWarning(page);
    const before = await remainingSeconds(dialog);

    await page.clock.runFor(10 * SECOND);

    await expect
      .poll(() => remainingSeconds(dialog))
      .toBeLessThanOrEqual(before - 9);
    expect(await remainingSeconds(dialog)).toBeGreaterThanOrEqual(before - 11);
  });

  test("stays open when the user presses Escape", async ({ page }) => {
    const dialog = await runUntilWarning(page);

    await page.keyboard.press("Escape");
    await page.clock.runFor(SECOND);

    await expect(dialog).toBeVisible();
  });

  test("keep me signed in closes the warning and starts a new session period", async ({
    page,
  }) => {
    const dialog = await runUntilWarning(page);

    const keepAlive = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${config.url}api/`) && response.ok(),
    );
    await dialog
      .getByRole("button", { name: "Yes, keep me signed in" })
      .click();
    await keepAlive;
    await page.clock.runFor(2 * SECOND);

    await expect(warning(page)).toBeHidden();
    await expect(page.locator("div.user-name")).toContainText(
      config.users.student.displayName,
    );

    // The next warning comes a whole session period after the keep-alive
    await runUntilWarning(page);
  });

  test("log me out ends the session", async ({ page }) => {
    const dialog = await runUntilWarning(page);

    const logoutRequest = page.waitForRequest(`${config.url}Logout`);
    await dialog.getByRole("button", { name: "No, log me out" }).click();
    await logoutRequest;

    await page.goto(config.url);
    await expect(page.locator("div.user-name")).toHaveCount(0);
  });

  test("logs the user out when the countdown reaches zero", async ({
    page,
  }) => {
    await runUntilWarning(page);

    const logoutRequest = page.waitForRequest(`${config.url}Logout`);
    await page.clock.runFor(DIALOG_DISPLAY_MS + 2 * SECOND);
    await logoutRequest;

    await page.goto(config.url);
    await expect(page.locator("div.user-name")).toHaveCount(0);
  });

  test("tells the user when the session cannot be extended", async ({
    page,
  }) => {
    const dialog = await runUntilWarning(page);

    const messages: string[] = [];
    page.on("dialog", (browserDialog) => {
      messages.push(browserDialog.message());
      void browserDialog.dismiss();
    });
    await page.route(`${config.url}api/**`, (route) => route.abort());
    await dialog
      .getByRole("button", { name: "Yes, keep me signed in" })
      .click();

    // The portlet shows it as a browser alert, the web component in the warning
    const message = "Error resetting your session!";
    await expect
      .poll(
        async () =>
          messages.includes(message) ||
          (await page.getByText(message).isVisible()),
      )
      .toBe(true);
    await page.unroute(`${config.url}api/**`);
  });

  test("a tab opened later postpones the warning in an earlier tab", async ({
    page,
    context,
  }) => {
    await page.clock.fastForward(10 * MINUTE);

    const laterTab = await context.newPage();
    await laterTab.goto(config.url);
    await expect(laterTab.locator("div.user-name")).toContainText(
      config.users.student.displayName,
    );

    // The first tab's own warning time passes without a warning
    await page.clock.fastForward(
      WARNING_OPENS_AFTER_MS - 10 * MINUTE + 5 * SECOND,
    );
    await page.clock.runFor(2 * SECOND);
    await expect(warning(page)).toBeHidden();

    // It warns at the later tab's time instead
    await page.clock.fastForward(10 * MINUTE - 10 * SECOND);
    await page.clock.runFor(2 * SECOND);
    await expect(warning(page)).toBeHidden();
    await page.clock.runFor(10 * SECOND);
    await expect(warning(page)).toBeVisible();

    await laterTab.close();
  });
});

test.describe("Session timeout warning for guests", () => {
  test("is not shown to guests", async ({ page }) => {
    await page.clock.install();
    await page.goto(config.url);
    await expect(page.locator("div.user-name")).toHaveCount(0);

    await page.clock.fastForward(SESSION_TIMEOUT_MS);
    await page.clock.runFor(2 * SECOND);

    await expect(warning(page)).toHaveCount(0);
  });
});

/*
 * The web component behind the warning (uPortal MOD-D18): a Web Component
 * channel that renders <up-session-timeout> and talks to /api/v6-0/session.
 */
test.describe("Session timeout web component", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
    await loginViaUrl(page, config.users.student);
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("is rendered as up-session-timeout with the portal's attributes", async ({
    page,
  }) => {
    const element = page.locator("up-session-timeout");

    await expect(element).toHaveCount(1);
    await expect(element).toHaveAttribute("fname", "session-timeout");
    await expect(element).toHaveAttribute("context-path", "/uPortal");
    await expect(element).toHaveAttribute("csrf-token", /\S/);
    await expect(
      page.locator('script[type="module"][src*="up-session-timeout"]'),
    ).toHaveCount(1);
    // Nothing of the portlet is left on the page
    await expect(page.locator("[id$='session-timeout-dlg']")).toHaveCount(0);
  });

  test("names the warning dialog by its title and focuses the keep-alive button", async ({
    page,
  }) => {
    await runUntilWarning(page);

    const dialog = page.getByRole("dialog", { name: "Session expiration" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Yes, keep me signed in" }),
    ).toBeFocused();
  });

  test("keeps the session alive through the session API with the CSRF token", async ({
    page,
  }) => {
    const element = page.locator("up-session-timeout");
    const header = (await element.getAttribute("csrf-header")) ?? "";
    const token = (await element.getAttribute("csrf-token")) ?? "";
    const dialog = await runUntilWarning(page);

    const keepAlive = page.waitForRequest(
      `${config.url}api/v6-0/session/keep-alive`,
    );
    await dialog
      .getByRole("button", { name: "Yes, keep me signed in" })
      .click();
    const request = await keepAlive;

    expect(request.method()).toBe("POST");
    expect(request.headers()[header.toLowerCase()]).toBe(token);
    await expect(warning(page)).toBeHidden();
  });

  test("shares the logout time under the portlet's storage key", async ({
    page,
  }) => {
    const saved = await page.evaluate(() =>
      Number(window.localStorage.getItem("UportalSessionTimeoutLogoutTime")),
    );
    const now = await page.evaluate(() => Date.now());

    // Logged out 30 seconds before the 30-minute session would expire; the page
    // loaded the session a few seconds before this check
    expect(saved - now).toBeGreaterThan(SESSION_TIMEOUT_MS - 40 * SECOND);
    expect(saved - now).toBeLessThanOrEqual(SESSION_TIMEOUT_MS - 30 * SECOND);
  });
});

/*
 * The warning in the user's own locale. The renderer passes the locale the
 * user chose in the User Locales Selector to the element, which asks the
 * portal for its messages in that locale. The locale is stored for the user,
 * so these tests sign in as developer, whom no other spec uses, and set it
 * back to en_US at the end of each test.
 */
const developer = {
  username: "developer",
  // eslint-disable-next-line sonarjs/no-hardcoded-credentials
  password: "developer",
  displayName: "Developer User",
};

async function chooseLocale(page: Page, code: string): Promise<void> {
  await page.goto(`${config.url}p/user-locales-selector/max/render.uP`);
  await page.locator(`input[name="locale"][value="${code}"]`).check();
  await page.locator('input[name="_eventId_updateLocale"]').click();
  await page.waitForLoadState("load");
}

for (const { code, title, remaining } of [
  {
    code: "es_ES",
    title: "Caducidad de la sesión",
    remaining: /Su sesión expirará en (\d+) segundos\./,
  },
  {
    code: "fr_FR",
    title: "Expiration de la session",
    remaining: /Votre session expirera dans (\d+) secondes\./,
  },
]) {
  test(`Session timeout warning in ${code}`, async ({ page }) => {
    await loginViaUrl(page, developer);
    try {
      await chooseLocale(page, code);
      await page.clock.install();
      await page.goto(config.url);
      await expect(page.locator("up-session-timeout")).toHaveAttribute(
        "locale",
        code.replace("_", "-"),
      );

      const dialog = await runUntilWarning(page, title);

      await expect(dialog).toContainText(remaining);
    } finally {
      await chooseLocale(page, "en_US");
      await logout(page);
    }
  });
}
