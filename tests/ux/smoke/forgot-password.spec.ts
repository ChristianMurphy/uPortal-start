import { test, expect, APIRequestContext, Page } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaApi,
  openLoginForm,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";
import {
  Account,
  importLocalAccount,
  loginToken,
} from "../utils/local-account-utils";

/*
 * What Forgot Password does today: the Forgot Password channel (fname
 * forgot-password, framework portlet ForgotPassword, the forgot-password Web
 * Flow), which the login form also opens as a subflow from "Forgot your
 * username or password?". MOD-D19 maps it to a Thymeleaf full-page flow.
 *
 * The form asks for a username. For a local account it stores a new
 * 20-character reset token in the account's loginToken attribute, emails a
 * link to the login portlet with the user name and token (see
 * reset-password.spec.ts), and says the email was sent.
 *
 * Known defects (uPortal 5.17), recorded as they are:
 * - An unknown username fails with the channel error, because the flow calls
 *   setAttribute on the null account it found. A known username gets the
 *   "Reset email sent" page, so the form tells anyone which local accounts
 *   exist.
 * - The page says the email was sent whether or not it was:
 *   EmailPasswordResetNotificationImpl logs a failed send and carries on.
 *   The test portal has no mail server, so every test here sends nothing.
 * - Reset tokens do not expire; a token is valid until it is used or a new
 *   one replaces it.
 *
 * Each test imports its own local account and runs as a guest. The locators
 * use roles and names only, so the same tests describe the portlet and any
 * replacement that keeps its behaviour.
 */
const URL = `${config.url}p/forgot-password/max/render.uP`;

async function openForgotPassword(page: Page): Promise<void> {
  await page.goto(URL);
  await waitForPortalRequestsToSettle(page);
  await expect(
    page.getByRole("heading", { name: "Reset my password" }),
  ).toBeVisible();
}

async function requestReset(page: Page, username: string): Promise<void> {
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill(username);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await waitForPortalRequestsToSettle(page);
}

test.describe("Forgot password", () => {
  let admin: APIRequestContext;
  let account: Account;

  test.beforeEach(async ({ playwright }) => {
    admin = await playwright.request.newContext();
    await loginViaApi(admin, config.users.admin);
    account = await importLocalAccount(admin, "forgot", "Fern");
  });

  test.afterEach(async () => {
    await admin.dispose();
  });

  test("asks for a username", async ({ page }) => {
    await openForgotPassword(page);
    await expect(
      page.getByRole("textbox", { name: "Username", exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Reset", exact: true }),
    ).toBeVisible();
  });

  test("stores a reset token and says the email was sent", async ({ page }) => {
    expect(await loginToken(admin, account.username)).toBeUndefined();
    await openForgotPassword(page);
    await requestReset(page, account.username);

    await expect(
      page.getByRole("heading", { name: "Reset email sent" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Password reset instructions have been sent to your email address.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Return to log in form" }),
    ).toBeVisible();
    expect(await loginToken(admin, account.username)).toMatch(
      /^[\dA-Za-z]{20}$/,
    );
  });

  test("a second request replaces the token", async ({ page }) => {
    await openForgotPassword(page);
    await requestReset(page, account.username);
    const first = await loginToken(admin, account.username);

    await openForgotPassword(page);
    await requestReset(page, account.username);
    const second = await loginToken(admin, account.username);
    expect(second).toMatch(/^[\dA-Za-z]{20}$/);
    expect(second).not.toEqual(first);
  });

  test("an unknown username fails with the channel error (defect)", async ({
    page,
  }) => {
    await openForgotPassword(page);
    await requestReset(page, `${account.username}-unknown`);
    await expect(
      page.getByText("An error occurred loading this content."),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Reset email sent" }),
    ).toHaveCount(0);
  });

  test("the login form opens it", async ({ page }) => {
    await page.goto(`${config.url}f/welcome/normal/render.uP`);
    await waitForPortalRequestsToSettle(page);
    await openLoginForm(page);
    await page
      .getByRole("link", { name: "Forgot your username or password?" })
      .click();
    await waitForPortalRequestsToSettle(page);
    await expect(
      page.getByRole("heading", { name: "Reset my password" }),
    ).toBeVisible();
    await requestReset(page, account.username);
    await expect(
      page.getByRole("heading", { name: "Reset email sent" }),
    ).toBeVisible();
  });
});
