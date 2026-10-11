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
 * - A confirmation that differs from the password is not refused: the
 *   password field is saved. The form's script compares the fields only when
 *   the password input's textLength is above 0, and inputs have no
 *   textLength; PersonFormValidator never runs because Web Flow looks for a
 *   bean named after the model, accountFormValidator, and the bean is called
 *   personValidator.
 * - The form's "Add Preference" link adds an input for any attribute name,
 *   but saving ignores attributes the user may not edit, so nothing it adds
 *   is stored. The tests leave the link alone.
 *
 * The locators use roles and names only, so the same tests describe the
 * portlet and any replacement that keeps its behaviour.
 */
// Provided by Node at run time; declared here so tsc does not need @types/node.
declare const Buffer: { from(text: string): Uint8Array };

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

/** The hash of "student" from the quickstart data's student account. */
const STUDENT_PASSWORD_HASH = "(MD5)mhmjKvf2F3gPizS9DrA+CsFmqj74oTSb";

// A type, not an interface, so it fits the helpers' Record<string, string>
type Account = {
  username: string;
  password: string;
  displayName: string;
};

let accountCount = 0;

function userXml(username: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<user xmlns="https://source.jasig.org/schemas/uportal/io/user" version="4.0" username="${username}">
    <default-user>defaultTemplateUser</default-user>
    <password>${STUDENT_PASSWORD_HASH}</password>
    <attribute><name>givenName</name><value>Selma</value></attribute>
    <attribute><name>sn</name><value>${username}</value></attribute>
    <attribute><name>mail</name><value>${username}@example.org</value></attribute>
    <attribute><name>department</name><value>Playwright Department</value></attribute>
</user>`;
}

function permissionSetXml(
  username: string,
  activity: string,
  targets: string[],
): string {
  const targetXml = targets
    .map(
      (target) =>
        `<target permission-type="GRANT"><literal>${target}</literal></target>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<permission-set script="classpath://org/jasig/portal/io/import-permission_set_v3-1.crn">
    <owner>UP_USERS</owner>
    <principal-type>org.apereo.portal.security.IPerson</principal-type>
    <principal><literal>${username}</literal></principal>
    <activity>${activity}</activity>
    ${targetXml}
</permission-set>`;
}

async function importXml(
  admin: APIRequestContext,
  name: string,
  xml: string,
): Promise<void> {
  const response = await admin.post<unknown>(`${config.url}api/import`, {
    multipart: {
      file: { name, mimeType: "text/xml", buffer: Buffer.from(xml) },
    },
  });
  expect(response.status(), `import of ${name}`).toEqual(200);
}

/**
 * A new local account with the password "student", the permissions to edit
 * itself and its five attributes, and a department of "Playwright
 * Department".
 */
async function createEditableAccount(
  admin: APIRequestContext,
): Promise<Account> {
  accountCount += 1;
  const username = `selfedit-${Date.now()}-${accountCount}`;
  await importXml(admin, `${username}.user.xml`, userXml(username));
  await importXml(
    admin,
    `${username}-edit-user.permission-set.xml`,
    permissionSetXml(username, "EDIT_USER", ["SELF"]),
  );
  await importXml(
    admin,
    `${username}-edit-attributes.permission-set.xml`,
    permissionSetXml(username, "EDIT_USER_ATTRIBUTE", EDITABLE_ATTRIBUTES),
  );
  return {
    username,
    password: config.users.student.password,
    displayName: `Selma ${username}`,
  };
}

/** The local account as the export API sees it. */
async function exportedAccount(
  admin: APIRequestContext,
  username: string,
): Promise<string> {
  const response = await admin.get<unknown>(
    `${config.url}api/entity/user/${username}`,
  );
  expect(response.status()).toEqual(200);
  return response.text();
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

    test("saves the password when the confirmation differs (defect)", async ({
      page,
    }) => {
      const newPassword = `Pw-${Date.now()}`;
      await openEditForm(page);
      await page.getByLabel("Password", { exact: true }).fill(newPassword);
      await page.getByLabel("Confirm Password").fill(`${newPassword}-typo`);
      await save(page);
      await expect(
        page.getByRole("heading", { name: "Account Updated" }),
      ).toBeVisible();

      await logout(page);
      await loginViaUrl(page, { ...account, password: newPassword });
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
