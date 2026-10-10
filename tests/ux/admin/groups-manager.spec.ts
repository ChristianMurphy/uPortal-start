import { test, expect, Page } from "@playwright/test";
import { config } from "../../general-config";
import { loginViaUrl } from "../utils/ux-general-utils";
import {
  browseToEntity,
  clickToNavigate,
  openPortlet,
  selectCurrentEntity,
  selectEntityBySearch,
} from "../utils/ux-admin-utils";

/*
 * Groups Administration (fname groupsmanager) is the groups-manager Web
 * Flow, with the edit-group subflow (and its createChildGroup recursion)
 * and the entity-selector subflow for choosing groups and members. This
 * creates a group under "Everyone", adds the student user to it, checks
 * the membership, and deletes the group.
 *
 * "Everyone" is the parent because every user is already in it: the new
 * group changes no one's effective memberships, so specs running in
 * parallel (student layouts, permissions) are unaffected.
 */

const GROUPS_FNAME = "groupsmanager";
const PARENT_GROUP = "Everyone";

async function parentHasMember(
  page: Page,
  groupName: string
): Promise<boolean> {
  const parent = await page.request.get<unknown>(
    `${config.url}api/entity/group-membership/${PARENT_GROUP}`
  );
  const xml = await parent.text();
  return xml.includes(`<group>${groupName}</group>`);
}

/*
 * Delete a group left under PARENT_GROUP by a failed run. Groups have no
 * REST delete, so this walks the same flow as the test.
 */
async function deleteLeftoverGroup(
  page: Page,
  groupName: string
): Promise<void> {
  if (!(await parentHasMember(page, groupName))) return;
  const content = await openPortlet(page, GROUPS_FNAME);
  await clickToNavigate(
    page,
    content.getByRole("link", { name: "Groups of People" })
  );
  await browseToEntity(content, groupName);
  await selectCurrentEntity(content, groupName);
  await clickToNavigate(
    page,
    content.getByRole("button", { name: "Next", exact: true })
  );
  await clickToNavigate(
    page,
    content.getByRole("link", { name: "Delete", exact: true })
  );
  await clickToNavigate(
    page,
    content.getByRole("button", { name: "Remove", exact: true })
  );
}

test.describe("Groups Administration", () => {
  test.describe.configure({ timeout: 120_000 });

  const stamp = Date.now();
  const groupName = `E2E Group ${stamp}`;
  const student = config.users.student;

  test.afterEach(async ({ page }) => {
    await deleteLeftoverGroup(page, groupName);
  });

  test("create a member group, add a person, and delete it", async ({
    page,
  }) => {
    await loginViaUrl(page, config.users.admin);
    const content = await openPortlet(page, GROUPS_FNAME);

    // selectGroupType -> selectGroup (entity-selector subflow)
    await clickToNavigate(
      page,
      content.getByRole("link", { name: "Groups of People" })
    );
    await expect(
      content.getByRole("heading", { name: "Select Group" })
    ).toBeVisible();
    await selectCurrentEntity(content, PARENT_GROUP);
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Next", exact: true })
    );

    // edit-group subflow: reviewGroup for the parent
    await expect(
      content.getByRole("heading", { name: PARENT_GROUP, exact: true })
    ).toBeVisible();
    await clickToNavigate(
      page,
      content.getByRole("link", { name: "Create Member Group" })
    );

    // createChildGroup -> editDetails
    await expect(
      content.getByRole("heading", { name: "Edit Group Details" })
    ).toBeVisible();
    await content.getByLabel("Name:").fill(groupName);
    await content
      .getByLabel("Description:")
      .fill("Created by the Playwright groups-manager spec");
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Next", exact: true })
    );

    // editMembers (entity-selector subflow)
    await expect(
      content.getByRole("heading", { name: "Select People and Groups" })
    ).toBeVisible();
    await selectEntityBySearch(content, student.username, student.displayName);
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Next", exact: true })
    );

    // reviewGroup for the new group, then save (createGroup)
    await expect(
      content.getByRole("heading", { name: groupName, exact: true })
    ).toBeVisible();
    await expect(content.locator(".group-member")).toContainText(
      student.displayName
    );
    await clickToNavigate(
      page,
      content.getByRole("link", { name: "Save", exact: true })
    );

    // Back on the parent's review, which now lists the new group
    await expect(
      content.getByRole("heading", { name: PARENT_GROUP, exact: true })
    ).toBeVisible();
    await expect(
      content.locator(".group-member").getByRole("link", {
        name: groupName,
        exact: true,
      })
    ).toBeVisible();

    // Membership is stored: start over, browse from the parent to the new
    // group, and open it
    await clickToNavigate(
      page,
      content.getByRole("link", { name: "Done", exact: true })
    );
    await clickToNavigate(
      page,
      content.getByRole("link", { name: "Groups of People" })
    );
    await browseToEntity(content, groupName);
    await selectCurrentEntity(content, groupName);
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Next", exact: true })
    );
    await expect(
      content.getByRole("heading", { name: groupName, exact: true })
    ).toBeVisible();
    await expect(content.locator(".group-member")).toContainText(
      student.displayName
    );

    // Delete it: reviewGroup -> confirmRemove -> removeGroup
    await clickToNavigate(
      page,
      content.getByRole("link", { name: "Delete", exact: true })
    );
    await expect(
      content.getByRole("heading", { name: `Delete Group ${groupName}` })
    ).toBeVisible();
    await clickToNavigate(
      page,
      content.getByRole("button", { name: "Remove", exact: true })
    );

    // The flow returns to the start, and the parent no longer has it
    await expect(
      content.getByRole("link", { name: "Groups of People" })
    ).toBeVisible();
    expect(await parentHasMember(page, groupName)).toBe(false);
  });
});
