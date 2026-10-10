import { test, expect, Locator, Page } from "@playwright/test";
import { config } from "../../general-config";
import { loginViaUrl } from "../utils/ux-general-utils";
import { clickToNavigate, openPortlet } from "../utils/ux-admin-utils";

/*
 * User Administration (fname user-administration) is the user-manager Web
 * Flow, with the edit-account subflow for creating and editing local
 * accounts and the person-lookup subflow for finding them. This creates a
 * local account, edits one of its attributes, and deletes it.
 *
 * Known defects (uPortal 5.17), both from the caching person directory
 * (CachingPersonAttributeDaoImpl with cacheNullResults=true, cache
 * USER_INFO.merged, 15 minute TTL), which the flows read accounts through:
 * - Saving a new account succeeds, but a null for the new username gets
 *   cached while it is saved. The create subflow's end state then finds
 *   no person and viewUserDetails fails with a NullPointerException in
 *   UserAccountHelper.groupPersonAttributes, and "Find an existing user"
 *   cannot open the account until the entry expires. (An account imported
 *   through /api/import opens straight away.)
 * - Saving an edited account stores the change, but viewUserDetails keeps
 *   showing the cached attributes until the entry expires.
 * The spec checks what was saved through the export API, and empties that
 * cache with the Cache Manager portlet (the cache-manager Web Flow)
 * before it reads an account back through the UI.
 */

const USERS_FNAME = "user-administration";
const CACHE_FNAME = "cache-manager";
const USER_INFO_CACHE = "org.apereo.services.persondir.USER_INFO.merged";

async function exportedAccount(page: Page, username: string): Promise<string> {
  const response = await page.request.get(
    `${config.url}api/entity/user/${username}`
  );
  return response.text();
}

/*
 * The user export always names the user; only an existing local account
 * adds its password and attributes.
 */
async function accountExists(page: Page, username: string): Promise<boolean> {
  const xml = await exportedAccount(page, username);
  return xml.includes("<password>");
}

async function flushUserInfoCache(page: Page): Promise<void> {
  const content = await openPortlet(page, CACHE_FNAME);
  await clickToNavigate(
    page,
    content
      .locator("tr")
      .filter({
        has: page.getByRole("link", { name: USER_INFO_CACHE, exact: true }),
      })
      .getByRole("link", { name: "Flush", exact: true })
  );
  await expect(content).toContainText(
    `Are you sure you want to remove all elements from ${USER_INFO_CACHE}?`
  );
  await clickToNavigate(
    page,
    content.getByRole("button", { name: "Empty Cache", exact: true })
  );
}

/*
 * selectUserAction -> person-lookup subflow -> viewUserDetails
 */
async function openAccount(page: Page, username: string): Promise<Locator> {
  const content = await openPortlet(page, USERS_FNAME);
  await clickToNavigate(
    page,
    content.getByRole("link", { name: "Find an existing user" })
  );
  await content.getByRole("searchbox", { name: "Search Terms" }).fill(username);
  await content.getByRole("button", { name: "Search", exact: true }).click();
  await clickToNavigate(
    page,
    content
      .locator("table tbody")
      .getByRole("link", { name: username, exact: true })
  );
  await expect(
    content.getByRole("heading", { name: username, exact: true })
  ).toBeVisible();
  return content;
}

/*
 * viewUserDetails -> confirmRemove -> remove
 */
async function deleteAccount(page: Page, username: string): Promise<void> {
  const content = await openAccount(page, username);
  await clickToNavigate(
    page,
    content.getByRole("link", { name: "Delete", exact: true })
  );
  await expect(
    content.getByRole("heading", { name: `Remove User ${username}` })
  ).toBeVisible();
  await clickToNavigate(
    page,
    content.getByRole("button", { name: "Remove", exact: true })
  );
  // The user-manager flow ends and starts over
  await expect(
    content.getByRole("link", { name: "Find an existing user" })
  ).toBeVisible();
}

test.describe("User Administration", () => {
  test.describe.configure({ timeout: 120_000 });

  const stamp = Date.now();
  const username = `e2e-user-${stamp}`;
  const mail = `${username}@example.org`;
  const department = "Playwright Department";
  const editedDepartment = "Playwright Department (edited)";

  test.afterEach(async ({ page }) => {
    // Local accounts have no REST delete (/api/entity/user only removes
    // portal user records), so a failed run is cleaned up through the UI.
    if (!(await accountExists(page, username))) return;
    await flushUserInfoCache(page);
    await deleteAccount(page, username);
  });

  test("create, edit and delete a local account", async ({ page }) => {
    await loginViaUrl(page, config.users.admin);
    const content = await openPortlet(page, USERS_FNAME);

    // selectUserAction -> createLocalAccount (edit-account subflow)
    await clickToNavigate(
      page,
      content.getByRole("link", { name: "Create a User" })
    );
    await expect(
      content.getByRole("heading", { name: "Create a User" })
    ).toBeVisible();
    // A throwaway account: the password only has to satisfy the form.
    const password = `Pw-${stamp}`;
    await content.getByLabel("Username").fill(username);
    await content.getByLabel("Password", { exact: true }).fill(password);
    await content.getByLabel("Confirm Password").fill(password);
    await content
      .getByRole("textbox", { name: "Department", exact: true })
      .fill(department);
    await content
      .getByRole("textbox", { name: "Email", exact: true })
      .fill(mail);
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Save", exact: true })
    );

    // saveAccount stored the account and its attributes
    const created = await exportedAccount(page, username);
    expect(created).toContain("<password>");
    expect(created).toContain(`<value>${department}</value>`);
    expect(created).toContain(`<value>${mail}</value>`);

    // Open it from "Find an existing user" (see the known defect above)
    await flushUserInfoCache(page);
    const details = await openAccount(page, username);
    const attributes = details.locator("table tbody tr");
    await expect(attributes.filter({ hasText: "department" })).toContainText(
      department
    );
    await expect(attributes.filter({ hasText: "mail" })).toContainText(mail);

    // editUser -> edit-account subflow -> save -> viewUserDetails
    await clickToNavigate(
      page,
      details.getByRole("link", { name: "Edit", exact: true })
    );
    const departmentInput = details.getByRole("textbox", {
      name: "Department",
      exact: true,
    });
    await expect(departmentInput).toHaveValue(department);
    await departmentInput.fill(editedDepartment);
    await clickToNavigate(
      page,
      details.getByRole("button", { name: "Save", exact: true })
    );
    await expect(
      details.getByRole("heading", { name: username, exact: true })
    ).toBeVisible();
    const edited = await exportedAccount(page, username);
    expect(edited).toContain(`<value>${editedDepartment}</value>`);
    expect(edited).toContain(`<value>${mail}</value>`);

    // Read the edit back through the UI (see the known defects above)
    await flushUserInfoCache(page);
    await openAccount(page, username);
    await expect(attributes.filter({ hasText: "department" })).toContainText(
      editedDepartment
    );

    // Delete it
    await deleteAccount(page, username);
    expect(await accountExists(page, username)).toBe(false);
  });
});
