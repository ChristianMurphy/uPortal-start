import { expect, Locator, Page } from "@playwright/test";
import { config } from "../../general-config";
import { waitForPortalRequestsToSettle } from "./ux-general-utils";

/*
 * Helpers for the admin portlets built on Spring Web Flow (Portlet,
 * Groups, Permissions and User Administration). They are rendered as
 * transient portlets for admin, so every page change waits for the
 * current page's portal requests to settle first (see
 * trackPortalRequests() in ux-general-utils.ts).
 */

/*
 * The content area of a portlet, by fname. Excludes the portlet titlebar
 * and the portal chrome, so text locators only match the portlet's own
 * markup.
 */
export function portletContent(page: Page, fname: string): Locator {
  return page.locator(
    `.up-portlet-wrapper.${fname} .up-portlet-content-wrapper`
  );
}

/*
 * Open a portlet maximised via its /p/<fname> URL and return its content
 * area.
 */
export async function openPortlet(page: Page, fname: string): Promise<Locator> {
  await waitForPortalRequestsToSettle(page);
  await page.goto(`${config.url}p/${fname}/max/render.uP`);
  const content = portletContent(page, fname);
  await expect(content).toBeVisible();
  return content;
}

/*
 * Click a link or submit button that loads a new page, and wait for that
 * page to load. Web Flow gives every view a new execution key in the URL,
 * so the URL always changes.
 */
export async function clickToNavigate(
  page: Page,
  control: Locator
): Promise<void> {
  await waitForPortalRequestsToSettle(page);
  const before = page.url();
  await Promise.all([
    page.waitForURL((url) => url.href !== before),
    control.click(),
  ]);
}

/*
 * In the entity-selector flow view (entity-selector/selectEntities.jsp),
 * search for an entity and add the result called `name` to "Your
 * Selections".
 */
export async function selectEntityBySearch(
  content: Locator,
  query: string,
  name: string = query
): Promise<void> {
  await content.getByRole("searchbox", { name: "Enter a Name" }).fill(query);
  await content.getByRole("button", { name: "Go" }).click();
  await content
    .locator(".search-list")
    .getByRole("link", { name, exact: true })
    .click();
  await expect(selectionBasket(content, name)).toBeVisible();
}

/*
 * In the entity-selector flow view, add the entity being browsed (named in
 * the view's heading) to "Your Selections".
 */
export async function selectCurrentEntity(
  content: Locator,
  name: string
): Promise<void> {
  const heading = content.locator(".entity-browser h4.title");
  await expect(heading).toContainText(name);
  await heading.getByRole("button", { name: "Add to Selection" }).click();
  await expect(selectionBasket(content, name)).toBeVisible();
}

/*
 * In the entity-selector flow view, add a member listed under the entity
 * currently being browsed to "Your Selections".
 */
export async function selectBrowsedEntity(
  content: Locator,
  name: string
): Promise<void> {
  await content
    .locator(".member-list tr")
    .filter({
      has: content.page().getByRole("link", { name, exact: true }),
    })
    .getByRole("button", { name: "Add to Selection" })
    .click();
  await expect(selectionBasket(content, name)).toBeVisible();
}

/*
 * In the entity-selector flow view, browse into a member group listed under
 * the entity currently being browsed.
 */
export async function browseToEntity(
  content: Locator,
  name: string
): Promise<void> {
  await content
    .locator(".member-list")
    .getByRole("link", { name, exact: true })
    .click();
  await expect(content.locator(".entity-browser h4.title")).toContainText(name);
}

function selectionBasket(content: Locator, name: string): Locator {
  return content
    .locator(".selection-basket")
    .getByRole("link", { name, exact: true });
}
