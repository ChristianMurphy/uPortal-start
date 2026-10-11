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
  exportedAccount,
  grantUsersPermission,
  importLocalAccount,
} from "../utils/local-account-utils";

/*
 * What the Password Management channel (fname passwordmgr, framework portlet
 * SelfEditAccount, the self-edit-account Web Flow) does for users. The
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
 * Known defects (uPortal 5.17), recorded as they are:
 * - The edit form asks for a new password and its confirmation but not for
 *   the current password. (enterPassword.jsp has a Current Password field,
 *   but no flow state uses it.)
 * - The form's "Add Preference" link adds an input for any attribute name,
 *   but saving ignores attributes the user may not edit, so nothing it adds
 *   is stored. The tests leave the link alone.
 *
 * Fixed (uPortal, MOD-D19 workstream): a confirmation that differs from the
 * password is refused with "Passwords must match", by the form's script and,
 * with scripts off, by PersonFormValidator. Before, the password field was
 * saved: the script compared the fields only when the password input's
 * textLength was above 0, and inputs have no textLength; the validator never
 * ran because Web Flow looks for a bean named after the model,
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
const EDITABLE_ATTRIBUTES = [
  "title",
  "department",
  "organization",
  "mail",
  "telephoneNumber",
];

const UPDATED_MESSAGE =
  "Your account has been successfully updated. Your changes will be visible upon your next login.";

/**
 * A new local account with the password "student", the permissions to edit
 * itself and its five attributes, and a department of "Playwright
 * Department".
 */
async function createEditableAccount(
  admin: APIRequestContext,
): Promise<Account> {
  const account = await importLocalAccount(admin, "selfedit", "Selma", {
    department: "Playwright Department",
  });
  await grantUsersPermission(admin, account.username, "EDIT_USER", ["SELF"]);
  await grantUsersPermission(
    admin,
    account.username,
    "EDIT_USER_ATTRIBUTE",
    EDITABLE_ATTRIBUTES,
  );
  return account;
}

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
      await expect(page.getByLabel("Current Password")).toHaveCount(0);
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

    test("changes the password without asking for the current one", async ({
      page,
    }) => {
      const newPassword = `Pw-${Date.now()}`;
      await openEditForm(page);
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

    test("the form refuses a confirmation that differs", async ({ page }) => {
      const newPassword = `Pw-${Date.now()}`;
      await openEditForm(page);
      await page.getByLabel("Password", { exact: true }).fill(newPassword);
      await page.getByLabel("Confirm Password").fill(`${newPassword}-typo`);
      const alerts: string[] = [];
      page.once("dialog", (dialog) => {
        alerts.push(dialog.message());
        void dialog.dismiss();
      });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect
        .poll(() => alerts, { timeout: 10_000 })
        .toEqual(["Passwords must match"]);
      await expect(
        page.getByRole("heading", { name: "Edit My Account" }),
      ).toBeVisible();

      await logout(page);
      await openLoginForm(page);
      await submitLoginForm(page, account.username, newPassword);
      await expectLoginRefused(page);
    });

    test("the portal refuses a confirmation that differs", async ({
      browser,
      page,
    }) => {
      // With scripts off the form's own check cannot run, so the portal's does
      const context = await browser.newContext({ javaScriptEnabled: false });
      const noScript = await context.newPage();
      await noScript.goto(
        `${config.url}Login?userName=${account.username}&password=${account.password}`,
      );
      await expect(noScript.locator("div.user-name")).toContainText(
        account.displayName,
      );
      await noScript.goto(URL);
      await noScript.getByRole("link", { name: "Edit", exact: true }).click();
      const newPassword = `Pw-${Date.now()}`;
      await noScript.getByLabel("Password", { exact: true }).fill(newPassword);
      await noScript.getByLabel("Confirm Password").fill(`${newPassword}-typo`);
      await noScript.getByRole("button", { name: "Save", exact: true }).click();
      await expect(noScript.getByText("Passwords must match")).toBeVisible();
      await expect(
        noScript.getByRole("heading", { name: "Edit My Account" }),
      ).toBeVisible();
      await context.close();

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
