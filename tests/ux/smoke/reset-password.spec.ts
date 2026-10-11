import {
  test,
  expect,
  APIRequestContext,
  Locator,
  Page,
} from "@playwright/test";
import { config } from "../../general-config";
import {
  expectLoginRefused,
  loginViaApi,
  loginViaUrl,
  openLoginForm,
  submitLoginForm,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";
import {
  Account,
  importLocalAccount,
  loginToken,
} from "../utils/local-account-utils";

/*
 * What the password reset link does today: the reset-password Web Flow, a
 * subflow of the login portlet's local-login flow. Forgot Password emails a
 * link to the login portlet carrying the user name and the account's reset
 * token (see forgot-password.spec.ts); these tests import an account that
 * already has a token and open that link. MOD-D19 maps the flow to a
 * Thymeleaf full-page flow.
 *
 * A valid link shows "Set new account password" with a new password and its
 * confirmation. Saving sets the password and removes the token, so the link
 * then shows "Invalid password reset URL", which offers to send a new email.
 *
 * Known defects (uPortal 5.17), recorded as they are:
 * - The two password inputs have no labels (their captions are table cells),
 *   so the tests find them by their name attributes.
 * - A confirmation that differs, or a blank password, gets only "Password was
 *   not updated." without saying why.
 * - The link works only in a session whose login portlet has not started its
 *   flow yet: after the login form has been shown, the link shows the login
 *   form again.
 * - The update-password flow, which asks for the current password, is not
 *   reachable: no portlet maps a flowId to it.
 *
 * Fixed (uPortal, MOD-D19 workstream): a failed token check logged the
 * account's real token and the submitted one at INFO, and the reset email
 * logged the link; neither logs a token now.
 *
 * Fixed (uPortal, approved by the project owner): tokens expire. The link
 * works for org.apereo.portal.portlets.account.resetTokenLifetime (default
 * PT1H) after the time in the account's loginTokenIssued attribute. An older
 * link, or one whose token has no issue time (issued before uPortal 6.0),
 * shows "This password reset URL has expired". The tests here date the
 * imported token now, or two hours ago for an expired one.
 *
 * Each test imports its own account and uses its own browser context.
 */
const NEW_PASSWORD = "Reset-Passw0rd";

function resetUrl(username: string, token: string): string {
  return `${config.url}p/login/max/render.uP?pP_username=${username}&pP_loginToken=${token}`;
}

function passwordInput(page: Page, name: string): Locator {
  return page.locator(`input[type="password"][name="${name}"]`);
}

async function openResetLink(
  page: Page,
  username: string,
  token: string,
): Promise<void> {
  await page.goto(resetUrl(username, token));
  await waitForPortalRequestsToSettle(page);
}

async function submitPasswords(
  page: Page,
  password: string,
  confirmPassword: string,
): Promise<void> {
  await passwordInput(page, "password").fill(password);
  await passwordInput(page, "confirmPassword").fill(confirmPassword);
  await page
    .getByRole("button", { name: "Update Password", exact: true })
    .click();
  await waitForPortalRequestsToSettle(page);
}

async function expectPasswordRefused(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto(config.url);
  await openLoginForm(page);
  await submitLoginForm(page, username, password);
  await expectLoginRefused(page);
}

test.describe("Reset password", () => {
  let admin: APIRequestContext;
  let account: Account;
  let token: string;

  test.beforeEach(async ({ playwright }) => {
    admin = await playwright.request.newContext();
    await loginViaApi(admin, config.users.admin);
    token = `Tok${Date.now()}`.padEnd(20, "x").slice(0, 20);
    account = await importLocalAccount(admin, "reset", "Rhea", {
      loginToken: token,
      loginTokenIssued: new Date().toISOString(),
    });
  });

  test.afterEach(async () => {
    await admin.dispose();
  });

  test("a valid link asks for a new password", async ({ page }) => {
    await openResetLink(page, account.username, token);
    await expect(
      page.getByRole("heading", { name: "Set new account password" }),
    ).toBeVisible();
    await expect(page.getByText("New Password", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Confirm Password", { exact: true }),
    ).toBeVisible();
    await expect(passwordInput(page, "password")).toHaveValue("");
    await expect(passwordInput(page, "confirmPassword")).toHaveValue("");
  });

  test("sets the password, after which the link is invalid", async ({
    browser,
    page,
  }) => {
    await openResetLink(page, account.username, token);
    await submitPasswords(page, NEW_PASSWORD, NEW_PASSWORD);

    await expect(page.getByRole("heading", { name: "Success" })).toBeVisible();
    await expect(
      page.getByText("Your password has been updated successfully"),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Login" })).toBeVisible();
    expect(await loginToken(admin, account.username)).toBeUndefined();

    await loginViaUrl(page, { ...account, password: NEW_PASSWORD });
    await page.goto(`${config.url}Logout`);
    await expectPasswordRefused(page, account.username, account.password);

    const again = await browser.newContext();
    const fresh = await again.newPage();
    await openResetLink(fresh, account.username, token);
    await expect(
      fresh.getByRole("heading", { name: "Invalid password reset URL" }),
    ).toBeVisible();
    await again.close();
  });

  test("refuses a confirmation that differs", async ({ page }) => {
    await openResetLink(page, account.username, token);
    await submitPasswords(page, NEW_PASSWORD, `${NEW_PASSWORD}-typo`);

    await expect(page.getByText("Password was not updated.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Set new account password" }),
    ).toBeVisible();
    expect(await loginToken(admin, account.username)).toBe(token);
    await expectPasswordRefused(page, account.username, NEW_PASSWORD);
  });

  test("refuses a blank password", async ({ page }) => {
    await openResetLink(page, account.username, token);
    await submitPasswords(page, "", "");

    await expect(page.getByText("Password was not updated.")).toBeVisible();
    expect(await loginToken(admin, account.username)).toBe(token);
  });

  test("a wrong token is invalid and offers a new email", async ({ page }) => {
    await openResetLink(page, account.username, `${token}-wrong`);
    await expect(
      page.getByRole("heading", { name: "Invalid password reset URL" }),
    ).toBeVisible();
    await expect(
      page.getByText("We were unable to validate your password reset URL"),
    ).toBeVisible();

    await page
      .getByRole("link", { name: "Send a new password reset email" })
      .click();
    await waitForPortalRequestsToSettle(page);
    await expect(
      page.getByRole("heading", { name: "Reset my password" }),
    ).toBeVisible();
    // The wrong attempt left the real token as it was
    expect(await loginToken(admin, account.username)).toBe(token);
  });

  test("an expired link says so and offers a new email", async ({ page }) => {
    const expired = await importLocalAccount(admin, "reset", "Rhea", {
      loginToken: token,
      loginTokenIssued: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    });
    await openResetLink(page, expired.username, token);
    await expect(
      page.getByRole("heading", { name: "Invalid password reset URL" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This password reset URL has expired. Send a new email to get a new one.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Set new account password" }),
    ).toHaveCount(0);
    await page
      .getByRole("link", { name: "Send a new password reset email" })
      .click();
    await waitForPortalRequestsToSettle(page);
    await expect(
      page.getByRole("heading", { name: "Reset my password" }),
    ).toBeVisible();
  });

  test("a token without an issue time has expired", async ({ page }) => {
    const undated = await importLocalAccount(admin, "reset", "Rhea", {
      loginToken: token,
    });
    await openResetLink(page, undated.username, token);
    await expect(
      page.getByText("This password reset URL has expired."),
    ).toBeVisible();
    expect(await loginToken(admin, undated.username)).toBe(token);
  });

  test("after the login form, the link shows the login form (defect)", async ({
    page,
  }) => {
    await page.goto(config.url);
    await openLoginForm(page);
    await openResetLink(page, account.username, token);
    await expect(
      page.getByRole("heading", { name: "Set new account password" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Forgot your username or password?" }),
    ).toBeVisible();
    expect(await loginToken(admin, account.username)).toBe(token);
  });
});
