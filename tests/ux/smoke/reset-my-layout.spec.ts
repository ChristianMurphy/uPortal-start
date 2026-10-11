import { test, expect, Page, Locator } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  logout,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";

/*
 * What the Reset My Layout channel (fname reset-my-layout) does for users.
 * The quickstart data places it in no layout, so the tests open it at
 * /p/reset-my-layout.
 *
 * The channel explains what it does and that the user must sign in again to
 * see the change, with a Reset Now button. Reset Now asks for confirmation,
 * naming the user; Cancel goes back without changing anything. Reset Layout
 * resets the signed-in user's own layout and says so; Continue goes back to
 * the start. The page the user is on keeps the old layout: the default tabs
 * and portlets come back at the next sign-in. Other users' layouts do not
 * change.
 *
 * Every test makes its own starting point: it adds a tab of its own to the
 * user's layout through the layout API, so a layout that is still customized
 * shows that tab, and a reset one does not. Tabs the tests add are removed
 * afterwards, so the users keep the quickstart's default layout.
 *
 * The locators use roles and names only, so the same tests describe the
 * portlet and any replacement that keeps its behaviour.
 */
const URL = `${config.url}p/reset-my-layout`;
const WELCOME_URL = `${config.url}f/welcome/normal/render.uP`;
const LAYOUT_API = `${config.url}api/layout`;

const STUDENT_TABS = ["Welcome", "Academics", "LMS", "Campus"];
const STUDENT_WELCOME_PORTLETS = ["Bookmarks", "Calendar", "My Drives"];
const STAFF_TABS = ["Welcome", "Main Staff Tab"];

/** The channel, which the theme marks with its fname. */
function channel(page: Page): Locator {
  return page.locator("section.up-portlet-wrapper.reset-my-layout");
}

async function openChannel(page: Page): Promise<Locator> {
  await page.goto(URL);
  await waitForPortalRequestsToSettle(page);
  const content = channel(page);
  await expect(content).toBeVisible();
  return content;
}

/** The CSRF token in the current page's portlet URLs, for the layout API. */
async function csrfToken(page: Page): Promise<string> {
  const token = /[&?]_csrf=([\da-f-]+)/.exec(await page.content())?.[1];
  expect(token, "a _csrf parameter on the page").toBeTruthy();
  return token ?? "";
}

/** Opens the Welcome tab, a page with the user's tabs and a CSRF token. */
async function openWelcome(page: Page): Promise<void> {
  await page.goto(WELCOME_URL);
  await waitForPortalRequestsToSettle(page);
}

/** Adds a one-column tab to the signed-in user's layout; resolves to its ID. */
async function addTab(page: Page, name: string): Promise<string> {
  await openWelcome(page);
  const response = await page.request.post<{ tabId?: string }>(LAYOUT_API, {
    form: {
      _csrf: await csrfToken(page),
      action: "addTab",
      "widths[]": "100",
      tabName: name,
    },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.tabId, "the new tab's ID").toBeTruthy();
  return body.tabId ?? "";
}

/** Removes the tabs of that name from the signed-in user's layout. */
async function removeTabs(page: Page, name: string): Promise<void> {
  await openWelcome(page);
  const ids = await page
    .locator(".portal-navigation", {
      has: page.locator(".portal-navigation-label", { hasText: name }),
    })
    .evaluateAll((tabs) =>
      tabs.map((tab) => tab.id.replace(/^portalNavigation_/, "")),
    );
  for (const id of ids) {
    const response = await page.request.post<unknown>(LAYOUT_API, {
      form: {
        _csrf: await csrfToken(page),
        action: "removeElement",
        elementID: id,
      },
    });
    expect(response.status()).toBe(200);
  }
}

async function tabNames(page: Page): Promise<string[]> {
  await openWelcome(page);
  return page.locator(".portal-navigation-label").allTextContents();
}

/** Signs out and in again, which is when a reset layout shows. */
async function signInAgain(
  page: Page,
  user: Record<string, string>,
): Promise<void> {
  await logout(page);
  await loginViaUrl(page, user);
}

/** Opens the channel and goes through Reset Now to the confirmation. */
async function startReset(page: Page): Promise<Locator> {
  const content = await openChannel(page);
  await content.getByRole("button", { name: "Reset Now" }).click();
  await expect(
    content.getByRole("button", { name: "Reset Layout" }),
  ).toBeVisible();
  return content;
}

async function expectStartView(content: Locator): Promise<void> {
  await expect(content).toContainText(
    "Use this portlet to reset your portal layout to the defaults.",
  );
  await expect(content).toContainText(
    "NOTE: You must sign on again to see the changes.",
  );
  await expect(
    content.getByRole("button", { name: "Reset Now" }),
  ).toBeVisible();
  await expect(
    content.getByRole("button", { name: "Reset Layout" }),
  ).toHaveCount(0);
}

test.describe("Reset My Layout", () => {
  // Each test owns a tab name, so a test's leftovers cannot pass another test
  let tab: string;

  test.beforeEach(async ({ page }, testInfo) => {
    // Tab names hold at most 35 characters
    tab = `Reset test ${testInfo.testId.slice(-8)}`;
    await loginViaUrl(page, config.users.student);
  });

  test.afterEach(async ({ page }) => {
    // A new session: the old one may still hold the layout from before a reset
    await signInAgain(page, config.users.student);
    await removeTabs(page, tab);
    await logout(page);
  });

  test("explains the reset and offers Reset Now", async ({ page }) => {
    const content = await openChannel(page);

    await expectStartView(content);
    await expect(content.getByRole("button", { name: "Cancel" })).toHaveCount(
      0,
    );
  });

  test("asks for confirmation, naming the user", async ({ page }) => {
    const content = await startReset(page);

    await expect(
      content.getByRole("heading", { name: "Reset User Layout", exact: true }),
    ).toBeVisible();
    await expect(content).toContainText(
      "Resetting a user's layout is irreversible.",
    );
    await expect(content).toContainText(
      `Are you sure you want to reset the layout for ${config.users.student.username}?`,
    );
    await expect(content.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(
      content.getByRole("button", { name: "Reset Now" }),
    ).toHaveCount(0);
  });

  test("Cancel goes back and keeps the layout", async ({ page }) => {
    await addTab(page, tab);
    const content = await startReset(page);

    await content.getByRole("button", { name: "Cancel" }).click();

    await expectStartView(content);
    await signInAgain(page, config.users.student);
    expect(await tabNames(page)).toContain(tab);
  });

  test("Reset Layout says the layout has been reset, and Continue starts over", async ({
    page,
  }) => {
    await addTab(page, tab);
    const content = await startReset(page);

    await content.getByRole("button", { name: "Reset Layout" }).click();

    await expect(content).toContainText("Success");
    await expect(content).toContainText(
      `Layout for ${config.users.student.username} has been reset`,
    );
    await expect(
      content.getByRole("button", { name: "Reset Layout" }),
    ).toHaveCount(0);
    await content.getByRole("button", { name: "Continue" }).click();
    await expectStartView(content);
  });

  test("the default tabs and portlets come back at the next sign-in", async ({
    page,
  }) => {
    await addTab(page, tab);
    const content = await startReset(page);
    await content.getByRole("button", { name: "Reset Layout" }).click();
    await expect(content).toContainText("Success");

    // The page keeps the layout the user signed in with
    expect(await tabNames(page)).toContain(tab);

    await signInAgain(page, config.users.student);
    expect(await tabNames(page)).toEqual(STUDENT_TABS);
    for (const title of STUDENT_WELCOME_PORTLETS) {
      await expect(
        page.locator(".up-portlet-titlebar").getByTitle(title),
      ).toBeVisible();
    }
  });

  test("leaves other users' layouts alone", async ({ page }) => {
    // Staff customize their layout, then the student resets theirs
    await signInAgain(page, config.users.staff);
    try {
      await addTab(page, tab);
      await signInAgain(page, config.users.student);
      const content = await startReset(page);
      await content.getByRole("button", { name: "Reset Layout" }).click();
      await expect(content).toContainText("Success");

      await signInAgain(page, config.users.staff);
      expect(await tabNames(page)).toEqual([...STAFF_TABS, tab]);
    } finally {
      await signInAgain(page, config.users.staff);
      await removeTabs(page, tab);
      expect(await tabNames(page)).toEqual(STAFF_TABS);
      await signInAgain(page, config.users.student);
    }
  });
});

test.describe("Reset My Layout as a guest", () => {
  test("is not offered to guests", async ({ page }) => {
    // The channel is published to Authenticated Users only; the portal asks
    // guests to sign in instead of rendering it
    await page.goto(URL);

    await expect(
      page.locator(".portal-navigation-label").first(),
    ).toBeAttached();
    await expect(channel(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reset Now" })).toHaveCount(
      0,
    );
  });
});
