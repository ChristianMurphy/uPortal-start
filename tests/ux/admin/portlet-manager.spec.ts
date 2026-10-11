import { test, expect } from "@playwright/test";
import { config } from "../../general-config";
import { loginViaUrl, sessionCsrfHeaders } from "../utils/ux-general-utils";
import {
  clickToNavigate,
  openPortlet,
  selectBrowsedEntity,
  selectEntityBySearch,
} from "../utils/ux-admin-utils";

/*
 * Portlet Administration (fname portlet-admin) is the portlet-manager Web
 * Flow, with the edit-portlet subflow for registration and the
 * entity-selector subflow for principals and categories. This registers
 * a CMS (SimpleContentPortlet) portlet end to end, renders it through its
 * own fname URL, and deletes it again through the flow.
 */

const ADMIN_FNAME = "portlet-admin";

test.describe("Portlet Administration", () => {
  // A dozen Web Flow round trips, each waiting for the previous page to
  // settle, take longer than the default 30s on a dev portal.
  test.describe.configure({ timeout: 120_000 });

  const stamp = Date.now();
  const fname = `e2e-portlet-${stamp}`;
  const title = `E2E Portlet ${stamp}`;
  const marker = `E2E portlet content ${stamp}`;

  test.afterEach(async ({ page }) => {
    // If the test failed before its own delete step, remove the portlet
    // through the import/export REST API so later runs start clean. A
    // missing entity is not an error.
    await page.request.delete<unknown>(
      `${config.url}api/entity/portlet-definition/${fname}`,
      { headers: await sessionCsrfHeaders(page.request) }
    );
  });

  test("register, render and delete a CMS portlet", async ({ page }) => {
    await loginViaUrl(page, config.users.admin);
    const content = await openPortlet(page, ADMIN_FNAME);

    // listChannels -> edit-portlet subflow, chooseType
    await clickToNavigate(
      page,
      content.getByRole("link", { name: "Register New Portlet" })
    );
    await expect(
      content.getByRole("heading", { name: "Select Type" })
    ).toBeVisible();
    await content.getByLabel("CMS", { exact: true }).check();
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Continue" })
    );

    // portletConfig: summary information
    await expect(
      content.getByRole("heading", { name: "Summary Information" })
    ).toBeVisible();
    await content.getByLabel("Portlet Title").fill(title);
    await content.getByLabel("Portlet Name").fill(title);
    await content.getByLabel("Portlet Functional Name").fill(fname);
    await content
      .getByLabel("Portlet Description")
      .fill("Registered by the Playwright portlet-manager spec");

    // choosePrincipal (entity-selector subflow)
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Edit Principals" })
    );
    await expect(
      content.getByRole("heading", { name: "Select People and Groups" })
    ).toBeVisible();
    await selectEntityBySearch(content, "Portal Administrators");
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Save", exact: true })
    );

    // Back on portletConfig: the form kept the summary fields, and the
    // principal is listed with browse and subscribe granted by default.
    await expect(content.getByLabel("Portlet Functional Name")).toHaveValue(
      fname
    );
    const principalRow = content
      .locator(".permissions-options-table tbody tr")
      .filter({ hasText: "Portal Administrators" });
    await expect(principalRow.locator("input[name$='_BROWSE']")).toBeChecked();
    await expect(
      principalRow.locator("input[name$='_SUBSCRIBE']")
    ).toBeChecked();

    // chooseCategory (entity-selector subflow)
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Edit Categories" })
    );
    await expect(
      content.getByRole("heading", { name: "Select Categories" })
    ).toBeVisible();
    await selectBrowsedEntity(content, "Development");
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Save", exact: true })
    );
    await expect(content.locator(".config-list")).toContainText("Development");

    // Portlet preference: the CMS portlet renders its "content" preference
    await content.getByRole("link", { name: "Add Preference" }).click();
    const addDialog = page.getByRole("dialog", { name: "Add Preference" });
    await addDialog.locator("input[name='name']").fill("content");
    await addDialog.getByRole("button", { name: "Add" }).click();
    await content
      .locator("input[name=\"portletPreferences['content'].value\"]")
      .fill(`<p>${marker}</p>`);

    // Lifecycle, then save
    await content.getByLabel("Published", { exact: true }).check();
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Save", exact: true })
    );

    // listChannels: confirmation, and the new portlet is in the registry
    await expect(content.locator(".alert-success")).toContainText(
      `Portlet ${title} has been successfully registered.`
    );
    // The registry table filters on keyup, on the name/type/state columns
    await content.getByLabel("Search").pressSequentially(title);
    const listRow = content
      .locator("table.portlet-table tbody tr")
      .filter({ hasText: title });
    await expect(listRow).toContainText("CMS");
    await expect(listRow).toContainText("PUBLISHED");

    // The saved definition carries what the flow collected
    const exported = await page.request.get<unknown>(
      `${config.url}api/entity/portlet-definition/${fname}`
    );
    const exportedXml = await exported.text();
    expect(exportedXml).toContain(`<fname>${fname}</fname>`);
    expect(exportedXml).toContain("<category>Development</category>");
    expect(exportedXml).toContain("<group>Portal Administrators</group>");
    expect(exportedXml).toContain(marker);

    // The portlet renders through its own fname URL
    const rendered = await openPortlet(page, fname);
    await expect(
      page.locator(`.up-portlet-wrapper.${fname} .up-portlet-titlebar`)
    ).toContainText(title);
    await expect(rendered).toContainText(marker);

    // Delete it through the flow: listChannels -> confirmRemove
    const adminContent = await openPortlet(page, ADMIN_FNAME);
    await adminContent.getByLabel("Search").pressSequentially(title);
    await clickToNavigate(
      page,
      adminContent
        .locator("table.portlet-table tbody tr")
        .filter({ hasText: title })
        .getByRole("link", { name: "Delete" })
    );
    await expect(
      adminContent.getByRole("heading", { name: `Remove Portlet ${title}` })
    ).toBeVisible();
    await clickToNavigate(
      page,
      adminContent.getByRole("button", { name: "Remove Portlet" })
    );
    await expect(adminContent.locator(".alert-success")).toContainText(
      `Portlet ${title} has been removed.`
    );

    // It is gone from the registry
    const afterDelete = await page.request.get<unknown>(
      `${config.url}api/entity/portlet-definition/${fname}`
    );
    expect(await afterDelete.text()).not.toContain(`<fname>${fname}</fname>`);
  });
});
