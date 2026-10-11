import {
  test,
  expect,
  APIRequestContext,
  Browser,
  Page,
} from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaApi,
  loginViaUrl,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";
import {
  Account,
  createEditableAccount,
  exportedAccount,
} from "../utils/self-edit-account-utils";

/*
 * The Password Management channel (passwordmgr) as the <up-self-edit-account>
 * web component, and the /api/v6-0/account API behind it, in a running
 * portal. self-edit-account.spec.ts checks what users see; this checks what
 * the component adds: how the channel is rendered, the API's rules (the
 * session's user only, the CSRF token, the permissions, no password in any
 * answer) and keyboard focus.
 */
const URL = `${config.url}p/passwordmgr`;
const API = `${config.url}api/v6-0/account`;
const MODULE_SCRIPT =
  'script[type="module"][src*="/webcomponents/assets/up-self-edit-account-"]';

interface AccountBody {
  username: string;
  canEdit: boolean;
  details: { name: string; label: string; value: string | null }[];
  editable: { name: string; label: string; value: string | null }[];
}

interface Csrf {
  header: string;
  token: string;
}

async function openAccount(page: Page): Promise<void> {
  await waitForPortalRequestsToSettle(page);
  await page.goto(URL);
  await waitForPortalRequestsToSettle(page);
  await expect(page.getByRole("heading", { name: "My Account" })).toBeVisible();
}

/** The CSRF header and token the portal put on the element. */
async function csrfOf(page: Page): Promise<Csrf> {
  const element = page.locator("up-self-edit-account");
  await expect(element).toHaveAttribute("csrf-header", /\S/);
  await expect(element).toHaveAttribute("csrf-token", /\S/);
  return {
    header: (await element.getAttribute("csrf-header")) ?? "",
    token: (await element.getAttribute("csrf-token")) ?? "",
  };
}

function put(
  page: Page,
  body: unknown,
  csrf?: Csrf,
): ReturnType<APIRequestContext["put"]> {
  return page.request.put<unknown>(API, {
    data: body,
    headers: csrf === undefined ? {} : { [csrf.header]: csrf.token },
  });
}

/** A page signed in as a new account that may edit itself. */
async function editorPage(
  browser: Browser,
  admin: APIRequestContext,
): Promise<{ page: Page; account: Account }> {
  const account = await createEditableAccount(admin);
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginViaUrl(page, account);
  return { page, account };
}

test.describe("Self edit account component", () => {
  test.describe.configure({ timeout: 120_000 });

  test("renders the channel as the element with its module", async ({
    page,
  }) => {
    await loginViaUrl(page, config.users.student);
    await openAccount(page);

    const element = page.locator("up-self-edit-account");
    await expect(element).toHaveCount(1);
    await expect(element).toHaveAttribute("fname", "passwordmgr");
    await expect(element).toHaveAttribute("context-path", "/uPortal");
    await expect(page.locator(MODULE_SCRIPT)).toHaveCount(1);
    // None of the portlet's markup is left
    await expect(page.locator("table.portlet-table")).toHaveCount(0);
  });

  test("answers guests with 401", async ({ playwright }) => {
    const guest = await playwright.request.newContext();
    const response = await guest.get<AccountBody>(API);
    expect(response.status()).toBe(401);
    await guest.dispose();
  });

  test("returns the session user's account without a password", async ({
    page,
  }) => {
    await loginViaUrl(page, config.users.student);
    const response = await page.request.get<AccountBody>(
      `${API}?username=admin`,
    );
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text.toLowerCase()).not.toContain("password");
    const body = await response.json();
    expect(body.username).toBe("student");
    expect(body.canEdit).toBe(false);
    expect(body.editable).toEqual([]);
    expect(body.details.map((detail) => detail.label)).toEqual([
      "Title",
      "Department",
      "Org",
      "Email",
      "Phone",
      "Address",
    ]);
  });

  test("refuses a change from a user who may not edit", async ({ page }) => {
    await loginViaUrl(page, config.users.student);
    await openAccount(page);
    const response = await put(
      page,
      { attributes: { mail: "changed@example.org" } },
      await csrfOf(page),
    );
    expect(response.status()).toBe(403);
  });

  test.describe("with permission to edit", () => {
    let admin: APIRequestContext;

    test.beforeEach(async ({ playwright }) => {
      admin = await playwright.request.newContext();
      await loginViaApi(admin, config.users.admin);
    });

    test.afterEach(async () => {
      await admin.dispose();
    });

    test("needs the CSRF token of the user's own session", async ({
      browser,
    }) => {
      const { page, account } = await editorPage(browser, admin);
      const other = await editorPage(browser, admin);
      await openAccount(page);
      await openAccount(other.page);
      const change = { attributes: { department: "Forged Department" } };

      const csrf = await csrfOf(page);
      const withoutToken = await put(page, change);
      expect(withoutToken.status()).toBe(403);
      const forged = await put(page, change, { ...csrf, token: "forged" });
      expect(forged.status()).toBe(403);
      const othersToken = await put(page, change, await csrfOf(other.page));
      expect(othersToken.status()).toBe(403);
      expect(await exportedAccount(admin, account.username)).not.toContain(
        "Forged Department",
      );

      const saved = await put(page, change, csrf);
      expect(saved.status()).toBe(204);
      expect(await exportedAccount(admin, account.username)).toContain(
        "<value>Forged Department</value>",
      );
      await page.context().close();
      await other.page.context().close();
    });

    test("refuses an attribute the user may not edit", async ({ browser }) => {
      const { page, account } = await editorPage(browser, admin);
      await openAccount(page);
      const response = await put(
        page,
        { attributes: { sn: "Somebody Else" } },
        await csrfOf(page),
      );
      expect(response.status()).toBe(403);
      expect(await response.text()).not.toContain("Somebody Else");
      expect(await exportedAccount(admin, account.username)).toContain(
        `<value>${account.username}</value>`,
      );
      await page.context().close();
    });

    test("never echoes a password", async ({ browser }) => {
      const { page } = await editorPage(browser, admin);
      await openAccount(page);
      const secret = `Pw-${Date.now()}`;
      const csrf = await csrfOf(page);
      const malformed = await page.request.put<unknown>(API, {
        data: `{"password": ${secret}}`,
        headers: {
          "Content-Type": "application/json",
          [csrf.header]: csrf.token,
        },
      });
      expect(malformed.status()).toBe(400);
      expect(await malformed.text()).not.toContain(secret);
      await page.context().close();
    });

    test("moves focus into the form and back to Edit", async ({ browser }) => {
      const { page } = await editorPage(browser, admin);
      await openAccount(page);

      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Title", exact: true }),
      ).toBeFocused();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Edit", exact: true }),
      ).toBeFocused();
      await page.context().close();
    });
  });
});
