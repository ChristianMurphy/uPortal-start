import {
  test,
  expect,
  APIRequestContext,
  Locator,
  Page,
} from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaApi,
  loginViaPage,
  loginViaUrl,
  logout,
  expectLoginForm,
  expectLoginRefused,
  openLoginForm,
  submitLoginForm,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";
import {
  Account,
  createEditableAccount,
  exportedAccount,
} from "../utils/self-edit-account-utils";

/*
 * What the Password Management channel (fname passwordmgr) does for users. It
 * was the SelfEditAccount portlet (the self-edit-account Web Flow) and is now
 * the <up-self-edit-account> web component (MOD-D46); these tests describe
 * both, and self-edit-account-component.spec.ts what the component adds. The
 * quickstart data places it in no layout, so the tests open it at
 * /p/passwordmgr.
 *
 * The channel shows the signed-in user's directory details (title,
 * department, org, email, phone and address). A user may edit their own
 * local account only with the UP_USERS EDIT_USER permission on SELF, and
 * each attribute only with EDIT_USER_ATTRIBUTE on its name. The quickstart
 * data grants these to no group, so only admin (a superuser) gets the Edit
 * button. Each editing test therefore imports its own local account and
 * permissions through /api/import as admin, so that it never changes a
 * shared account's password and does not depend on what other tests did.
 *
 * Guests opening the channel get the login form instead, as for any channel
 * they may not see.
 *
 * The portlet's "Add Preference" link, which added inputs that saving
 * ignored, is gone from the component. The form shows the user name,
 * read-only, for password managers.
 *
 * Fixed (uPortal, MOD-D45, approved by the project owner):
 * - A new password needs the current password: "Please enter your current
 *   password" when it is missing, "Provided password does not match the
 *   current account password" when it is wrong. uPortal 5.17 asked only for
 *   the new password and its confirmation (enterPassword.jsp had a Current
 *   Password field, but no flow state used it).
 *
 * Fixed (uPortal, MOD-D45): a confirmation that differs from the password is
 * refused with "Passwords must match", by the form and by the API (see
 * self-edit-account-component.spec.ts). uPortal 5.17 saved the password
 * field: its script compared the fields only when the password input's
 * textLength was above 0, and inputs have no textLength; PersonFormValidator
 * never ran because Web Flow looks for a bean named after the model,
 * accountFormValidator, and the bean was only called personValidator.
 *
 * The locators use roles and names only, so the same tests describe the
 * portlet and any replacement that keeps its behaviour.
 */
const URL = `${config.url}p/passwordmgr`;

const DETAIL_LABELS = [
  "Title",
  "Department",
  "Org",
  "Email",
  "Phone",
  "Address",
];
const EDITABLE_LABELS = ["Title", "Department", "Org", "Email", "Phone"];

const UPDATED_MESSAGE =
  "Your account has been successfully updated. Your changes will be visible upon your next login.";

async function openAccount(page: Page): Promise<void> {
  await waitForPortalRequestsToSettle(page);
  await page.goto(URL);
  await waitForPortalRequestsToSettle(page);
}

function detailRow(page: Page, label: string): Locator {
  return page.getByRole("row").filter({
    has: page.getByRole("cell", { name: label, exact: true }),
  });
}

/** The portlet's Edit control is a link; a replacement may make it a button. */
function editControl(page: Page): Locator {
  return page
    .getByRole("link", { name: "Edit", exact: true })
    .or(page.getByRole("button", { name: "Edit", exact: true }));
}

async function openEditForm(page: Page): Promise<void> {
  await openAccount(page);
  await editControl(page).click();
  await expect(
    page.getByRole("heading", { name: "Edit My Account" }),
  ).toBeVisible();
}

async function save(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await waitForPortalRequestsToSettle(page);
}

test.describe("Self edit account", () => {
  test.describe.configure({ timeout: 120_000 });

  test("shows a user their details without an Edit button", async ({
    page,
  }) => {
    await loginViaUrl(page, config.users.student);
    await openAccount(page);

    await expect(
      page.getByRole("heading", { name: "My Account" }),
    ).toBeVisible();
    for (const label of DETAIL_LABELS) {
      await expect(detailRow(page, label)).toHaveCount(1);
    }
    await expect(detailRow(page, "Email")).toContainText(
      "steven.student@example.org",
    );
    await expect(detailRow(page, "Phone")).toContainText("(555) 555-5555");
    await expect(detailRow(page, "Title").getByRole("cell").nth(1)).toHaveText(
      "",
    );
    await expect(editControl(page)).toHaveCount(0);
    await logout(page);
  });

  test("sends guests to the login form", async ({ page }) => {
    await page.goto(URL);
    await expectLoginForm(page);
    await expect(page.getByRole("heading", { name: "My Account" })).toHaveCount(
      0,
    );
  });

  test("offers admin the Edit button", async ({ page }) => {
    await loginViaUrl(page, config.users.admin);
    await openAccount(page);
    await expect(
      page.getByRole("heading", { name: "My Account" }),
    ).toBeVisible();
    await expect(editControl(page)).toBeVisible();
    await logout(page);
  });

  test.describe("with permission to edit", () => {
    let admin: APIRequestContext;
    let account: Account;

    test.beforeEach(async ({ playwright, page }) => {
      admin = await playwright.request.newContext();
      await loginViaApi(admin, config.users.admin);
      account = await createEditableAccount(admin);
      await loginViaUrl(page, account);
    });

    test.afterEach(async () => {
      await admin.dispose();
    });

    test("opens a form with the editable attributes and empty passwords", async ({
      page,
    }) => {
      await openEditForm(page);
      for (const label of EDITABLE_LABELS) {
        await expect(
          page.getByRole("textbox", { name: label, exact: true }),
        ).toBeVisible();
      }
      await expect(
        page.getByRole("textbox", { name: "Address", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("textbox", { name: "Department", exact: true }),
      ).toHaveValue("Playwright Department");
      await expect(
        page.getByRole("textbox", { name: "Email", exact: true }),
      ).toHaveValue(`${account.username}@example.org`);
      await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
        "",
      );
      await expect(page.getByLabel("Confirm Password")).toHaveValue("");
      await expect(page.getByLabel("Current Password")).toHaveValue("");
      await expect(
        page.getByRole("textbox", { name: "Username", exact: true }),
      ).toHaveValue(account.username);
    });

    test("cancel goes back to the details", async ({ page }) => {
      await openEditForm(page);
      await page
        .getByRole("textbox", { name: "Department", exact: true })
        .fill("Not saved");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await waitForPortalRequestsToSettle(page);
      await expect(
        page.getByRole("heading", { name: "My Account" }),
      ).toBeVisible();
      expect(await exportedAccount(admin, account.username)).toContain(
        "<value>Playwright Department</value>",
      );
    });

    test("saves the attributes, shown from the next login", async ({
      page,
    }) => {
      await openEditForm(page);
      await page
        .getByRole("textbox", { name: "Department", exact: true })
        .fill("Edited Department");
      await page
        .getByRole("textbox", { name: "Title", exact: true })
        .fill("Edited Title");
      await save(page);

      await expect(
        page.getByRole("heading", { name: "Account Updated" }),
      ).toBeVisible();
      await expect(page.getByText(UPDATED_MESSAGE)).toBeVisible();
      const saved = await exportedAccount(admin, account.username);
      expect(saved).toContain("<value>Edited Department</value>");
      expect(saved).toContain("<value>Edited Title</value>");

      // The details come from the session, so they still show the old values
      await openAccount(page);
      await expect(
        page.getByRole("heading", { name: "My Account" }),
      ).toBeVisible();
      await expect(detailRow(page, "Department")).toContainText(
        "Playwright Department",
      );

      // and change at the next login
      await logout(page);
      await loginViaUrl(page, account);
      await openAccount(page);
      await expect(detailRow(page, "Department")).toContainText(
        "Edited Department",
      );
      await expect(detailRow(page, "Title")).toContainText("Edited Title");
    });

    test("an emptied attribute is removed", async ({ page }) => {
      await openEditForm(page);
      await page
        .getByRole("textbox", { name: "Department", exact: true })
        .fill("");
      await save(page);
      await expect(
        page.getByRole("heading", { name: "Account Updated" }),
      ).toBeVisible();
      expect(await exportedAccount(admin, account.username)).not.toContain(
        "Playwright Department",
      );
    });

    test("changes the password with the current one", async ({ page }) => {
      const newPassword = `Pw-${Date.now()}`;
      await openEditForm(page);
      await page.getByLabel("Current Password").fill(account.password);
      await page.getByLabel("Password", { exact: true }).fill(newPassword);
      await page.getByLabel("Confirm Password").fill(newPassword);
      await save(page);
      await expect(
        page.getByRole("heading", { name: "Account Updated" }),
      ).toBeVisible();

      await logout(page);
      await loginViaPage(page, { ...account, password: newPassword });
      await logout(page);
      await openLoginForm(page);
      await submitLoginForm(page, account.username, account.password);
      await expectLoginRefused(page);
    });

    test("refuses a new password without the right current one", async ({
      page,
    }) => {
      const newPassword = `Pw-${Date.now()}`;
      await openEditForm(page);
      await page.getByLabel("Password", { exact: true }).fill(newPassword);
      await page.getByLabel("Confirm Password").fill(newPassword);
      await save(page);
      await expect(
        page.getByText("Please enter your current password"),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Edit My Account" }),
      ).toBeVisible();

      await page.getByLabel("Current Password").fill("not-the-password");
      await page.getByLabel("Password", { exact: true }).fill(newPassword);
      await page.getByLabel("Confirm Password").fill(newPassword);
      await save(page);
      await expect(
        page.getByText(
          "Provided password does not match the current account password",
        ),
      ).toBeVisible();

      // The password is as it was
      await logout(page);
      await openLoginForm(page);
      await submitLoginForm(page, account.username, newPassword);
      await expectLoginRefused(page);
      await loginViaUrl(page, account);
    });

    test("refuses a confirmation that differs", async ({ page }) => {
      const newPassword = `Pw-${Date.now()}`;
      await openEditForm(page);
      await page.getByLabel("Current Password").fill(account.password);
      await page.getByLabel("Password", { exact: true }).fill(newPassword);
      await page.getByLabel("Confirm Password").fill(`${newPassword}-typo`);
      await save(page);
      await expect(page.getByText("Passwords must match")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Edit My Account" }),
      ).toBeVisible();

      await logout(page);
      await openLoginForm(page);
      await submitLoginForm(page, account.username, newPassword);
      await expectLoginRefused(page);
    });

    test("a blank password leaves the password as it was", async ({ page }) => {
      await openEditForm(page);
      await save(page);
      await expect(
        page.getByRole("heading", { name: "Account Updated" }),
      ).toBeVisible();
      await logout(page);
      await loginViaUrl(page, account);
    });
  });
});
