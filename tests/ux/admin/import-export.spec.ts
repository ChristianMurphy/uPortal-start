import { test, expect, Locator, Page } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";
import { clickToNavigate, openPortlet } from "../utils/ux-admin-utils";

/*
 * The Import/Export portlet (fname ImportExportPortlet) is a UI over the
 * portal data REST API: /api/entity/{type}/{id} (export, delete) and
 * /api/import, which run on JaxbPortalDataHandlerService. This exports a
 * seeded portlet definition, imports a renamed copy, re-imports it with
 * changes, checks each import by rendering the portlet, and deletes it.
 *
 * whos-online is the source because no other spec reads or changes it.
 * The copy is only visible to Portal Administrators, and its title and
 * description avoid words other specs search for.
 */

const IMPORT_EXPORT_FNAME = "ImportExportPortlet";
const SOURCE_FNAME = "whos-online";
const PORTLET_DEFINITION = "portlet-definition";

/*
 * Rename a portlet-definition export and replace its content preference.
 */
function portletCopy(
  sourceXml: string,
  fname: string,
  title: string,
  content: string
): string {
  return sourceXml
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<name>[^<]*<\/name>/, `<name>${title}</name>`)
    .replace(/<fname>[^<]*<\/fname>/, `<fname>${fname}</fname>`)
    .replace(
      /<desc>[^<]*<\/desc>/,
      "<desc>Imported by the Playwright import/export spec</desc>"
    )
    .replaceAll(
      "<group>Everyone</group>",
      "<group>Portal Administrators</group>"
    )
    .replace(
      /(<name>content<\/name>\s*<readOnly>false<\/readOnly>\s*<value>)[\S\s]*?(<\/value>)/,
      `$1&lt;p&gt;${content}&lt;/p&gt;$2`
    );
}

/*
 * Import view: queue a file in the uploader and upload it. The uploader
 * posts it to /api/import and reloads the page when every upload worked.
 */
async function importFile(
  page: Page,
  content: Locator,
  fileName: string,
  xml: string
): Promise<void> {
  await expect(
    content.getByRole("heading", { name: "Upload entities to be imported:" })
  ).toBeVisible();
  await content.locator(".uploader-form input[type='file']").evaluate(
    (input: HTMLInputElement, file) => {
      const transfer = new window.DataTransfer();
      transfer.items.add(
        new window.File([file.xml], file.name, { type: "text/xml" })
      );
      input.files = transfer.files;
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    },
    { name: fileName, xml }
  );
  const queued = content
    .locator(".uploader-queue tbody tr")
    .filter({ hasText: fileName });
  await expect(queued).toBeVisible();

  // A successful upload reloads the page, so settle first like any other
  // navigation
  await waitForPortalRequestsToSettle(page);
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/api/import") &&
        candidate.request().method() === "POST"
    ),
    content.getByRole("button", { name: "Upload" }).click(),
  ]);
  expect(response.status()).toEqual(200);
  // The reload empties the queue
  await expect(queued).toHaveCount(0);
}

test.describe("Import/Export portlet", () => {
  test.describe.configure({ timeout: 120_000 });

  const stamp = Date.now();
  const fname = `e2e-import-${stamp}`;
  const title = `E2E Imported ${stamp}`;
  const marker = `E2E imported content ${stamp}`;
  const updatedTitle = `${title} (re-imported)`;
  const updatedMarker = `${marker} (re-imported)`;

  test.afterEach(async ({ page }) => {
    // Removes the copy if the test failed before its own delete step. A
    // missing entity is not an error.
    await page.request.delete<unknown>(
      `${config.url}api/entity/${PORTLET_DEFINITION}/${fname}`
    );
  });

  test("export, import, re-import and delete a portlet definition", async ({
    page,
  }) => {
    await loginViaUrl(page, config.users.admin);
    const content = await openPortlet(page, IMPORT_EXPORT_FNAME);

    // Export view: the portlet builds the download link from the form
    await clickToNavigate(page, content.getByRole("link", { name: "Export" }));
    await content.getByLabel("Type:").selectOption(PORTLET_DEFINITION);
    await content.getByLabel("id:").fill(SOURCE_FNAME);
    await content.getByLabel("id:").press("Tab");
    const exportLink = content.locator("a[id$='exportLink']");
    await expect(exportLink).toHaveAttribute(
      "href",
      new RegExp(
        `/api/entity/${PORTLET_DEFINITION}/${SOURCE_FNAME}\\?download=true$`
      )
    );
    const href = await exportLink.getAttribute("href");
    const exported = await page.request.get<unknown>(
      new URL(href ?? "", page.url()).href
    );
    expect(exported.status()).toEqual(200);
    expect(exported.headers()["content-disposition"]).toContain(
      `${SOURCE_FNAME}.${PORTLET_DEFINITION}.xml`
    );
    const sourceXml = await exported.text();
    expect(sourceXml).toContain(`<fname>${SOURCE_FNAME}</fname>`);
    expect(sourceXml).toContain("<title>Who's Online</title>");
    expect(sourceXml).toContain("<type>CMS</type>");
    expect(sourceXml).toContain("<name>content</name>");
    expect(sourceXml).toContain("Mock of Who's Online");

    // Import a renamed copy, then render it
    await clickToNavigate(page, content.getByRole("link", { name: "Import" }));
    await importFile(
      page,
      content,
      `${fname}.${PORTLET_DEFINITION}.xml`,
      portletCopy(sourceXml, fname, title, marker)
    );
    let rendered = await openPortlet(page, fname);
    await expect(
      page.locator(`.up-portlet-wrapper.${fname} .up-portlet-titlebar`)
    ).toContainText(title);
    await expect(rendered).toContainText(marker);

    // Re-import it with a new title and content; the import updates it
    await openPortlet(page, IMPORT_EXPORT_FNAME);
    await importFile(
      page,
      content,
      `${fname}.${PORTLET_DEFINITION}.xml`,
      portletCopy(sourceXml, fname, updatedTitle, updatedMarker)
    );
    rendered = await openPortlet(page, fname);
    await expect(
      page.locator(`.up-portlet-wrapper.${fname} .up-portlet-titlebar`)
    ).toContainText(updatedTitle);
    await expect(rendered).toContainText(updatedMarker);
    const reExported = await page.request.get<unknown>(
      `${config.url}api/entity/${PORTLET_DEFINITION}/${fname}`
    );
    expect(await reExported.text()).toContain(`<title>${updatedTitle}</title>`);

    // Delete view: the portlet sends DELETE /api/entity/{type}/{id}
    await openPortlet(page, IMPORT_EXPORT_FNAME);
    await clickToNavigate(page, content.getByRole("link", { name: "Delete" }));
    // Known defect: delete.jsp closes its <nav> and <header> with
    // </div></div>, so the browser moves the form out of the portlet
    // content, where #portalPageBody covers it and it cannot be clicked.
    // Scope to the whole portlet and submit the form from the keyboard.
    const deleteView = page.locator(
      `.up-portlet-wrapper.${IMPORT_EXPORT_FNAME}`
    );
    await deleteView.getByLabel("Type:").selectOption(PORTLET_DEFINITION);
    const idInput = deleteView.getByLabel("id:");
    await idInput.fill(fname);
    const [deleted] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate
            .url()
            .endsWith(`/api/entity/${PORTLET_DEFINITION}/${fname}`) &&
          candidate.request().method() === "DELETE"
      ),
      idInput.press("Enter"),
    ]);
    expect(deleted.status()).toEqual(204);
    const afterDelete = await page.request.get<unknown>(
      `${config.url}api/entity/${PORTLET_DEFINITION}/${fname}`
    );
    expect(await afterDelete.text()).not.toContain(`<fname>${fname}</fname>`);
  });
});
