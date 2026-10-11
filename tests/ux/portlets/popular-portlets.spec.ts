import { test, expect, Page, Locator, Browser } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  logout,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";

/*
 * Popular Portlets ("Most Popular Apps", /p/popular-portlets) lists how many
 * times users added each portlet to their layouts, summed from the daily
 * statistics aggregation of the last N days. This spec records what users see
 * and what each control does, so that the replacement keeps it.
 *
 * Data: staff adds six portlets to the "Main Staff Tab" and admin adds one
 * that only administrators may subscribe to. The aggregation runs about once a
 * minute, 30 seconds behind, so the first test waits until the additions show.
 * The portlets are removed from the layouts again afterwards; their counts
 * stay, which is why the tests check counts as at least 1, never exact.
 */
const POPULAR_URL = `${config.url}p/popular-portlets`;
const LAYOUT_API = `${config.url}api/layout`;

interface Seeded {
  fname: string;
  title: string;
  description: string;
}

const STAFF_TAB = "Main Staff Tab";
const SEEDED: Seeded[] = [
  {
    fname: "courses",
    title: "Courses",
    description: "Course links and announcements.",
  },
  {
    fname: "logging-in",
    title: "Logging in",
    description: "Summary of default user accounts.",
  },
  {
    fname: "please-register",
    title: "Please Register",
    description: "uPortal registration message.",
  },
  {
    fname: "uportal-links",
    title: "uPortal Links",
    description: "Useful uPortal links.",
  },
  {
    fname: "what-is-uportal",
    title: "Welcome to uPortal",
    description: "Description of uPortal.",
  },
  {
    fname: "whos-online",
    title: "Who's Online",
    description: "Mockup of a Who's Online portlet.",
  },
];
/** Only Portal Administrators may subscribe to it. */
const ADMIN_ONLY = { fname: "fragment-audit", title: "Audit DLM Fragments" };
const ADMIN_TAB = "Testing";

const INFO =
  /^Viewing page (\d+)\. Showing records (\d+) to (\d+) of (\d+) items\.$/;

async function addToLayout(
  page: Page,
  fname: string,
  tabName: string
): Promise<void> {
  const response = await page.request.post<unknown>(LAYOUT_API, {
    form: { action: "addPortlet", fname, tabName },
  });
  expect(response.status(), `add ${fname}`).toBe(200);
}

/** Remove every copy of the portlet from the signed-in user's layout. */
async function removeFromLayout(page: Page, fname: string): Promise<void> {
  for (let removed = 0; removed < 10; removed++) {
    const response = await page.request.post<unknown>(LAYOUT_API, {
      form: { action: "removeByFName", fname },
    });
    // 400: no channel with the fname is left
    if (response.status() === 400) return;
    expect(response.status()).toBe(200);
  }
  throw new Error(`More than 10 ${fname} channels in the layout`);
}

async function asUser(
  browser: Browser,
  user: Record<string, string>,
  action: (page: Page) => Promise<void>
): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginViaUrl(page, user);
    await action(page);
  } finally {
    await context.close();
  }
}

/** Open /p/popular-portlets and wait until its table has rows or says it has none. */
async function openPopularPortlets(page: Page): Promise<Locator> {
  // A /p/ page renders a transient portlet: no portal request of the previous
  // page may still be running (see trackPortalRequests)
  await waitForPortalRequestsToSettle(page);
  await page.goto(POPULAR_URL);
  const table = page.getByRole("table");
  await expect(table.getByRole("row").nth(1)).toBeVisible({ timeout: 15_000 });
  return table;
}

/** The data rows of the table, without the header row. */
function dataRows(table: Locator): Locator {
  return table.locator("tbody").getByRole("row");
}

function info(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: /^Viewing page/ });
}

async function infoNumbers(
  page: Page
): Promise<{ page: number; from: number; to: number; total: number }> {
  await expect(info(page)).toHaveText(INFO);
  const match = INFO.exec((await info(page).textContent()) ?? "");
  if (!match) throw new Error("No paging information");
  return {
    page: Number(match[1]),
    from: Number(match[2]),
    to: Number(match[3]),
    total: Number(match[4]),
  };
}

/** The fnames of the listed portlets, in table order, read from their links. */
async function listedFnames(table: Locator): Promise<string[]> {
  const hrefs = await dataRows(table)
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  return hrefs.map((href) => (href ?? "").replace(/^.*\/p\//, ""));
}

async function listedCounts(table: Locator): Promise<number[]> {
  const cells = await dataRows(table)
    .locator("td:nth-child(2)")
    .allTextContents();
  return cells.map((cell) => Number(cell.trim()));
}

/** JavaScript's default sort order, which the portlet uses: by UTF-16 code units. */
function byCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** The number of previous days to count. */
function daysChoice(page: Page): Locator {
  return page.getByRole("combobox", { name: "Previous", exact: true });
}

function pageSize(page: Page): Locator {
  return page.getByRole("combobox", { name: "per page" });
}

function linkTo(table: Locator, title: string): Locator {
  return table.getByRole("link", { name: title, exact: true });
}

test.describe("Popular Portlets", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    // Waiting for the aggregation takes up to about two minutes
    test.setTimeout(360_000);
    await asUser(browser, config.users.staff, async (page) => {
      for (const portlet of SEEDED) {
        await addToLayout(page, portlet.fname, STAFF_TAB);
      }
    });
    await asUser(browser, config.users.admin, async (page) => {
      await addToLayout(page, ADMIN_ONLY.fname, ADMIN_TAB);
      await expect(async () => {
        const table = await openPopularPortlets(page);
        for (const portlet of [...SEEDED, ADMIN_ONLY]) {
          await expect(linkTo(table, portlet.title)).toHaveCount(1, {
            timeout: 1000,
          });
        }
      }, "the aggregation counted the additions").toPass({
        timeout: 300_000,
        intervals: [10_000],
      });
    });
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUrl(page, config.users.staff);
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test.afterAll(async ({ browser }) => {
    await asUser(browser, config.users.staff, async (page) => {
      for (const portlet of SEEDED) {
        await removeFromLayout(page, portlet.fname);
      }
    });
    await asUser(browser, config.users.admin, async (page) => {
      await removeFromLayout(page, ADMIN_ONLY.fname);
    });
  });

  test("shows its title, heading, controls and note", async ({ page }) => {
    await openPopularPortlets(page);

    await expect(
      page.locator(".up-portlet-titlebar .portlet-title")
    ).toContainText("Most Popular Apps");
    await expect(
      page.getByRole("heading", { name: "Most Frequently Added" })
    ).toBeVisible();

    const days = daysChoice(page);
    await expect(days).toHaveValue("30");
    await expect(days.locator("option")).toHaveText([
      "1",
      "7",
      "30",
      "90",
      "365",
    ]);

    await expect(page.getByRole("columnheader")).toHaveCount(2);
    await expect(page.getByRole("columnheader").nth(0)).toContainText("Title");
    await expect(page.getByRole("columnheader").nth(1)).toContainText(
      "# Times"
    );

    await expect(page.getByText("Filters", { exact: true })).toBeVisible();
    const size = pageSize(page);
    await expect(size).toHaveValue("10");
    await expect(size.locator("option")).toHaveText(["5", "10", "20", "50"]);

    await expect(
      page.getByText(
        "* These values are provided by daily statistics aggregation"
      )
    ).toBeVisible();
  });

  test("lists each added portlet with a link to it and its count", async ({
    page,
  }) => {
    const table = await openPopularPortlets(page);
    await pageSize(page).selectOption("50");

    for (const portlet of SEEDED) {
      const link = linkTo(table, portlet.title);
      await expect(link).toHaveAttribute("href", `/uPortal/p/${portlet.fname}`);
      await expect(link).toHaveAttribute("title", portlet.description);
      const row = dataRows(table).filter({
        has: page.getByRole("link", { name: portlet.title, exact: true }),
      });
      const cell = await row.locator("td:nth-child(2)").textContent();
      const count = Number(cell?.trim());
      expect(count).toBeGreaterThanOrEqual(1);
    }

    const { page: current, from, to, total } = await infoNumbers(page);
    expect(current).toBe(1);
    expect(from).toBe(1);
    expect(total).toBeGreaterThanOrEqual(SEEDED.length);
    expect(to).toBe(Math.min(total, 50));
    await expect(dataRows(table)).toHaveCount(to);
  });

  test("leaves out portlets the user may not subscribe to", async ({
    page,
    browser,
  }) => {
    const table = await openPopularPortlets(page);
    await pageSize(page).selectOption("50");
    await expect(linkTo(table, SEEDED[0].title)).toBeVisible();
    await expect(linkTo(table, ADMIN_ONLY.title)).toHaveCount(0);

    await asUser(browser, config.users.admin, async (adminPage) => {
      const adminTable = await openPopularPortlets(adminPage);
      await pageSize(adminPage).selectOption("50");
      await expect(linkTo(adminTable, ADMIN_ONLY.title)).toBeVisible();
    });
  });

  test("lists the portlets by fname first, and sorts by a column", async ({
    page,
  }) => {
    const table = await openPopularPortlets(page);
    await pageSize(page).selectOption("50");

    const title = page.getByRole("columnheader").nth(0);
    const times = page.getByRole("columnheader").nth(1);
    await expect(title).toHaveAttribute("aria-sort", "ascending");
    const fnames = await listedFnames(table);
    expect(fnames).toEqual([...fnames].sort(byCodeUnits));

    await times.click();
    await expect(times).toHaveAttribute("aria-sort", "ascending");
    const ascending = await listedCounts(table);
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b));

    await times.click();
    await expect(times).toHaveAttribute("aria-sort", "descending");
    const descending = await listedCounts(table);
    expect(descending).toEqual([...descending].sort((a, b) => b - a));

    await title.click();
    await expect(title).toHaveAttribute("aria-sort", "ascending");
    expect(await listedFnames(table)).toEqual(fnames);
  });

  test("pages through the list", async ({ page }) => {
    const table = await openPopularPortlets(page);
    const { total } = await infoNumbers(page);
    expect(total).toBeGreaterThan(5);

    await pageSize(page).selectOption("5");
    await expect(dataRows(table)).toHaveCount(5);
    await expect(info(page)).toHaveText(
      `Viewing page 1. Showing records 1 to 5 of ${total} items.`
    );
    const firstPage = await listedFnames(table);

    const paging = page.getByRole("navigation", { name: "pagination" });
    const previous = paging.getByLabel("Previous", { exact: true });
    const next = paging.getByLabel("Next", { exact: true });
    await expect(previous).toHaveText("< Previous");
    await expect(next).toHaveText("Next >");
    await expect(previous).toHaveAttribute("aria-disabled", "true");

    await next.click();
    const to = Math.min(10, total);
    await expect(info(page)).toHaveText(
      `Viewing page 2. Showing records 6 to ${to} of ${total} items.`
    );
    await expect(dataRows(table)).toHaveCount(to - 5);
    const secondPage = await listedFnames(table);
    expect(secondPage.filter((fname) => firstPage.includes(fname))).toEqual([]);

    await previous.click();
    await expect(info(page)).toHaveText(
      `Viewing page 1. Showing records 1 to 5 of ${total} items.`
    );
    expect(await listedFnames(table)).toEqual(firstPage);

    // The page number buttons go straight to a page
    await paging.getByText("2", { exact: true }).click();
    await expect(info(page)).toHaveText(/^Viewing page 2\./);
  });

  /*
   * The portlet's filters keep the right number of rows but not always the
   * right rows: they look a row's value up by its load position in the
   * column's sorted data. So this test checks how many rows a filter keeps,
   * not which ones.
   */
  test("filters by a portlet and by a count", async ({ page }) => {
    const table = await openPopularPortlets(page);
    await pageSize(page).selectOption("50");
    const { total } = await infoNumbers(page);
    const allCounts = await listedCounts(table);

    // The Title filter lists the fnames of the listed portlets
    const titleFilter = page.locator("select").filter({
      has: page.locator("option", { hasText: /^Title$/ }),
    });
    await expect(titleFilter.locator("option").first()).toHaveText("Title");
    const titleOptions = await titleFilter.locator("option").allTextContents();
    const options = titleOptions.slice(1).map((option) => option.trim());
    expect(options).toEqual([...options].sort(byCodeUnits));
    expect(options).toEqual(expect.arrayContaining(SEEDED.map((p) => p.fname)));
    expect(options).toHaveLength(total);

    // Choosing a value adds it as a term and keeps the rows it matches
    await titleFilter.selectOption("courses");
    await expect(titleFilter).toHaveValue("");
    const courses = page.locator(".filter-term", { hasText: "courses" });
    await expect(courses).toBeVisible();
    await expect(dataRows(table)).toHaveCount(1);
    await expect(info(page)).toHaveText(
      "Viewing page 1. Showing records 1 to 1 of 1 items."
    );

    // A second value widens the filter
    await titleFilter.selectOption("logging-in");
    await expect(page.locator(".filter-term")).toHaveCount(2);
    await expect(dataRows(table)).toHaveCount(2);
    await expect(info(page)).toHaveText(
      "Viewing page 1. Showing records 1 to 2 of 2 items."
    );

    // Clicking a term removes it
    await courses.click();
    await expect(courses).toHaveCount(0);
    await expect(dataRows(table)).toHaveCount(1);
    await page.locator(".filter-term", { hasText: "logging-in" }).click();
    await expect(page.locator(".filter-term")).toHaveCount(0);
    await expect(info(page)).toHaveText(
      `Viewing page 1. Showing records 1 to ${Math.min(50, total)} of ${total} items.`
    );

    // The # Times filter lists the distinct counts; disabled when there is one
    const timesFilter = page.locator("select").filter({
      has: page.locator("option", { hasText: /^# Times$/ }),
    });
    await expect(timesFilter.locator("option").first()).toHaveText("# Times");
    const timesOptions = await timesFilter.locator("option").allTextContents();
    const counts = timesOptions.slice(1).map((count) => count.trim());
    expect(counts).toEqual(
      [...new Set(allCounts.map(String))].sort(byCodeUnits)
    );
    if (counts.length === 1) {
      await expect(timesFilter).toBeDisabled();
    } else {
      await timesFilter.selectOption(counts[0]);
      await expect(dataRows(table)).toHaveCount(
        allCounts.filter((count) => String(count) === counts[0]).length
      );
    }
  });

  test("counts the chosen number of previous days", async ({ page }) => {
    const table = await openPopularPortlets(page);
    await pageSize(page).selectOption("50");
    const thirtyDays = await listedCounts(table);

    // Today's additions are within every choice, also the shortest
    const days = daysChoice(page);
    await days.selectOption("1");
    await expect(days).toHaveValue("1");
    await expect(linkTo(table, SEEDED[0].title)).toBeVisible();
    const { total } = await infoNumbers(page);
    expect(total).toBeGreaterThanOrEqual(SEEDED.length);
    const oneDay = await listedCounts(table);
    expect(oneDay.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(
      thirtyDays.reduce((a, b) => a + b, 0)
    );

    await days.selectOption("365");
    await expect(days).toHaveValue("365");
    await expect(linkTo(table, SEEDED[0].title)).toBeVisible();
  });

  test("opens a portlet from its link", async ({ page }) => {
    const table = await openPopularPortlets(page);
    await pageSize(page).selectOption("50");

    await waitForPortalRequestsToSettle(page);
    await linkTo(table, "Courses").click();
    await expect(page).toHaveURL(/\/p\/courses/);
    await expect(
      page.locator(".up-portlet-titlebar .portlet-title")
    ).toContainText("Courses");
  });
});
