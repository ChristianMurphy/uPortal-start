import { test, expect, Locator, Page } from "@playwright/test";
import { config } from "../../general-config";
import { loginViaUrl } from "../utils/ux-general-utils";
import {
  clickToNavigate,
  openPortlet,
  selectEntityBySearch,
} from "../utils/ux-admin-utils";

/*
 * Permissions Administration (fname permissionsmanager) is the
 * permissions-administration Web Flow, with the edit-permission subflow
 * and its entity-selector subflow for principals. This browses to a
 * permission activity, grants it to a person on one target, checks the
 * assignment is listed, and removes it again.
 *
 * The permission is Error Channel > View on the "Stack Trace" target,
 * granted to the admin user. Admin is a superuser already, so the grant
 * changes nothing for specs running in parallel, and the seeded
 * assignment for that target (Portal Developers) is left alone.
 */

const PERMISSIONS_FNAME = "permissionsmanager";
const OWNER = { fname: "UP_ERROR_CHAN", name: "Error Channel" };
const ACTIVITY = { fname: "VIEW", name: "View" };
const TARGET = { key: "DETAILS", name: "Stack Trace" };
const SEEDED_PRINCIPAL = "Portal Developers";

interface PermissionAssignment {
  principalKey: string;
  principalName: string;
  permissionType: string;
  target: string;
  targetName: string;
}

async function assignments(page: Page): Promise<PermissionAssignment[]> {
  const response = await page.request.get<{
    permissionsList: PermissionAssignment[];
  }>(
    `${config.url}api/permissionAssignments?owner=${OWNER.fname}&activity=${ACTIVITY.fname}`
  );
  expect(response.status()).toEqual(200);
  const body = await response.json();
  return body.permissionsList;
}

/*
 * Open the portlet and browse listOwners -> listActivities -> showActivity.
 * Returns the portlet content area once the assignments table has loaded.
 */
async function openActivity(page: Page): Promise<Locator> {
  const content = await openPortlet(page, PERMISSIONS_FNAME);
  await clickToNavigate(
    page,
    content.getByRole("link", { name: OWNER.name, exact: true })
  );
  await expect(
    content.getByRole("heading", { name: `Permissions in ${OWNER.name}` })
  ).toBeVisible();
  await clickToNavigate(
    page,
    content.getByRole("link", { name: ACTIVITY.name, exact: true })
  );
  await expect(
    content.getByRole("heading", { name: `Assignments for ${ACTIVITY.name}` })
  ).toBeVisible();
  await expect(
    assignmentRows(content).filter({ hasText: SEEDED_PRINCIPAL })
  ).toContainText(TARGET.name);
  return content;
}

function assignmentRows(content: Locator): Locator {
  return content.locator("table.dataTable tbody tr");
}

test.describe("Permissions Administration", () => {
  test.describe.configure({ timeout: 120_000 });

  const admin = config.users.admin;

  test.afterEach(async ({ page }) => {
    // If the test failed before its own remove step, delete the grant
    // through the same API the remove button calls.
    const current = await assignments(page);
    const leftovers = current.filter(
      (assignment) =>
        assignment.principalName === admin.displayName &&
        assignment.target === TARGET.key
    );
    for (const assignment of leftovers) {
      await page.request.post<unknown>(`${config.url}api/deletePermission`, {
        form: {
          principal: assignment.principalKey,
          owner: OWNER.fname,
          activity: ACTIVITY.fname,
          target: TARGET.key,
        },
      });
    }
  });

  test("grant and remove a permission assignment", async ({ page }) => {
    await loginViaUrl(page, config.users.admin);
    const content = await openActivity(page);
    const rows = assignmentRows(content);
    await expect(rows.filter({ hasText: admin.displayName })).toHaveCount(0);

    // createPermission -> selectTarget
    await clickToNavigate(
      page,
      content.getByRole("link", { name: "Add an Assignment" })
    );
    const targetInput = content.locator("input[name='targetDisplayName']");
    await targetInput.clear();
    await targetInput.pressSequentially(TARGET.name.split(" ")[0]);
    await content
      .locator(".up-autocomplete-matches")
      .getByRole("link", { name: TARGET.name, exact: true })
      .click();
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Submit", exact: true })
    );

    // edit-permission subflow: editPermission -> choosePrinicipals
    await expect(
      content.getByRole("heading", {
        name: `Edit Assignment for ${ACTIVITY.name}`,
      })
    ).toBeVisible();
    await expect(
      content.getByRole("heading", { name: `With target ${TARGET.name}` })
    ).toBeVisible();
    await clickToNavigate(
      page,
      content.getByRole("link", { name: "Choose Principals" })
    );
    await selectEntityBySearch(content, admin.username, admin.displayName);
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Submit", exact: true })
    );

    // Back on editPermission: grant it to the new principal. The select
    // posts the change to /api/updatePermission and redraws the tree.
    const adminAssignment = content
      .locator(".assignment-wrapper")
      .filter({
        has: page.locator(".principal-name", { hasText: admin.displayName }),
      })
      .locator("select")
      .first();
    await adminAssignment.selectOption("GRANT");
    await expect(adminAssignment).toHaveClass(/\bgrant\b/);

    // The editPermission breadcrumbs are action URLs rendered as plain
    // links, and a GET to action.uP answers 405, so start over to see the
    // activity's assignments again.
    await openActivity(page);
    const adminRow = rows.filter({ hasText: admin.displayName });
    await expect(adminRow).toContainText(TARGET.name);
    await expect(adminRow).toContainText("GRANT");
    expect(await assignments(page)).toContainEqual(
      expect.objectContaining({
        principalName: admin.displayName,
        permissionType: "GRANT",
        target: TARGET.key,
      })
    );

    // Remove it: showActivity -> deletePermission -> remove
    await clickToNavigate(
      page,
      adminRow.getByRole("link", { name: "Delete", exact: true })
    );
    await expect(content).toContainText(
      `You are about to remove the GRANT ${ACTIVITY.name} permission on ${TARGET.name} for ${admin.displayName}.`
    );
    await clickToNavigate(
      page,
      content.getByRole("link", { name: "Remove", exact: true })
    );
    await expect(
      content.getByRole("heading", { name: `Assignments for ${ACTIVITY.name}` })
    ).toBeVisible();
    await expect(rows.filter({ hasText: SEEDED_PRINCIPAL })).toBeVisible();
    await expect(rows.filter({ hasText: admin.displayName })).toHaveCount(0);
    expect(await assignments(page)).not.toContainEqual(
      expect.objectContaining({ principalName: admin.displayName })
    );
  });
});
