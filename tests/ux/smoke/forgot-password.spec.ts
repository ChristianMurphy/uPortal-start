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
  loginTokenIssued,
} from "../utils/local-account-utils";

/*
 * What Forgot Password does today: the Forgot Password channel (fname
 * forgot-password, framework portlet ForgotPassword, the forgot-password Web
 * Flow), which the login form also opens as a subflow from "Forgot your
 * username or password?". MOD-D19 maps it to a Thymeleaf full-page flow.
 *
 * The form asks for a username. For a local account with an email address
 * it stores a new 20-character reset token in the account's loginToken
 * attribute and emails a link to the login portlet with the user name and
 * token (see reset-password.spec.ts).
 *
 * Fixed (uPortal, MOD-D45, approved by the project owner): every user name
 * gets the same "Check your email" page, which says instructions were sent
 * if the account exists and to contact the help desk if nothing arrives. In
 * 5.17 an unknown username failed with the channel error and a known one got
 * "Reset email sent", so the form told anyone which local accounts exist. It
 * also claimed the email was sent when sending failed; a failed send is now
 * logged at ERROR for administrators, without the token, and the page stays
 * the same. The test portal has no mail server, so every send here fails and
 * these tests cover that path; uPortal's unit tests cover a send that works.
 *
 * Fixed (uPortal, approved by the project owner): reset tokens expire. The
 * flow stores when it issued the token in the loginTokenIssued attribute, and
 * the reset link works for org.apereo.portal.portlets.account.resetTokenLifetime
 * (default PT1H) after that (see reset-password.spec.ts).
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

const NEUTRAL_TEXT =
  "If that user name has a local account with an email address, reset instructions were sent. Contact the help desk if nothing arrives.";

/** The text of the page after a request, which must not depend on the name. */
async function expectNeutralPage(page: Page): Promise<string> {
  const heading = page.getByRole("heading", { name: "Check your email" });
  await expect(heading).toBeVisible();
  await expect(page.getByText(NEUTRAL_TEXT)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Return to log in form" }),
  ).toBeVisible();
  await expect(page.getByText("Reset email sent")).toHaveCount(0);
  return (
    (await page.locator("div.card.portlet", { has: heading }).textContent()) ??
    ""
  );
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

  test("stores a dated reset token and shows the neutral page when the send fails", async ({
    page,
  }) => {
    expect(await loginToken(admin, account.username)).toBeUndefined();
    const before = Date.now();
    await openForgotPassword(page);
    await requestReset(page, account.username);

    await expectNeutralPage(page);
    expect(await loginToken(admin, account.username)).toMatch(
      /^[\dA-Za-z]{20}$/,
    );
    // The portal and the tests run on the same machine, so share a clock
    const issued = Date.parse(
      (await loginTokenIssued(admin, account.username)) ?? "",
    );
    expect(issued).toBeGreaterThanOrEqual(before - 1000);
    expect(issued).toBeLessThanOrEqual(Date.now() + 1000);
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

  test("known and unknown user names get the identical page", async ({
    browser,
    page,
  }) => {
    await openForgotPassword(page);
    await requestReset(page, account.username);
    const known = await expectNeutralPage(page);

    const other = await browser.newContext();
    const guest = await other.newPage();
    await openForgotPassword(guest);
    await requestReset(guest, `${account.username}-unknown`);
    const unknown = await expectNeutralPage(guest);
    await expect(
      guest.getByText("An error occurred loading this content."),
    ).toHaveCount(0);
    await other.close();

    expect(unknown).toEqual(known);
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
    await expectNeutralPage(page);
  });
});
