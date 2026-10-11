import { expect, Page, TestInfo } from "@playwright/test";
import { Check, Problem, layoutScript } from "./measure";

/*
 * Layout checks at standard screen sizes (MOD-D52). Each check measures
 * element boxes in the browser (measure.ts); nothing compares screenshots.
 *
 *  1. scroll:   the page never scrolls sideways.
 *  2. cut-off:  a box that hides overflow shows all of its content, unless it
 *               ends in an ellipsis and the full text is in its title (hover)
 *               as well as in the DOM (screen readers).
 *  3. spill:    no element's content runs out of its box, and no two
 *               controls overlap.
 *  4. wrap:     from 768 pixels up, buttons, tabs, menu items, table
 *               headers, labels and badges stay on one line; from 1024 up
 *               the tab bar is one row.
 *  5. collapse: a portlet, region, column or component with content keeps a
 *               usable size, a column with portlets is at least 240 pixels
 *               wide, and images keep their proportions.
 *  6. spacing:  with the WCAG 1.4.12 text spacing applied, check 2 still
 *               passes.
 *
 * A problem is a check, a node and a detail. The node names the element:
 * its id, or the nearest id above it and its tag and classes, with every
 * run of digits replaced by "#" because layout node ids differ between
 * portals. The baseline records nodes, not details (pixel counts change
 * with fonts).
 *
 * uPortal's web component browser tests run the same checks
 * (uPortal-webcomponents src/test/layout-checks.ts); change both together.
 */

export type { Check, Problem } from "./measure";

export const WIDTHS = [320, 390, 768, 1024, 1366, 1920] as const;
export const CHECKS: readonly Check[] = [
  "scroll",
  "cut-off",
  "spill",
  "wrap",
  "collapse",
  "spacing",
];

/* page name -> check -> nodes */
export type Baseline = Record<string, Partial<Record<Check, string[]>>>;

/*
 * Waits until the page stops changing after load (a table filled from an
 * API, a component that renders late): the number of elements and the
 * page's size stay the same for four checks 250ms apart.
 */
async function waitForLayoutToSettle(page: Page): Promise<void> {
  let last = "";
  let same = 0;
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => {
          const root = document.documentElement;
          return `${document.querySelectorAll("*").length} ${root.scrollWidth}x${root.scrollHeight}`;
        });
        same = now === last ? same + 1 : 0;
        last = now;
        return same;
      },
      { intervals: [250], timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(3);
}

/** Every problem of the six checks on the page as it is now. */
export async function measureLayout(page: Page): Promise<Problem[]> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await waitForLayoutToSettle(page);
  await page.addScriptTag({ content: layoutScript() });
  return page.evaluate(() => window.upLayoutMeasure?.() ?? []);
}

const byText = (a: string, b: string): number => a.localeCompare(b);

/** check -> sorted, distinct nodes */
export function nodesByCheck(
  problems: Problem[],
): Partial<Record<Check, string[]>> {
  const result: Partial<Record<Check, string[]>> = {};
  for (const check of CHECKS) {
    const nodes = [
      ...new Set(
        problems
          .filter((each) => each.check === check)
          .map((each) => each.node),
      ),
    ].toSorted(byText);
    if (nodes.length > 0) result[check] = nodes;
  }
  return result;
}

/**
 * Measures the page and fails (softly, so every page of a test is measured)
 * on any problem that `baseline[name]` doesn't record. Attaches what it
 * observed, so a re-recording can copy it, and notes recorded problems that
 * are gone.
 */
export async function expectLayoutAsRecorded(
  page: Page,
  name: string,
  baseline: Baseline,
  testInfo: TestInfo,
): Promise<void> {
  const problems = await measureLayout(page);
  const observed = nodesByCheck(problems);
  const recorded = baseline[name] ?? {};
  const json = JSON.stringify({ [name]: observed });
  await testInfo.attach(`observed ${name}`, {
    body: json,
    contentType: "application/json",
  });
  const gone = CHECKS.flatMap((check) =>
    (recorded[check] ?? [])
      .filter((node) => !(observed[check] ?? []).includes(node))
      .map((node) => `${check}: ${node}`),
  );
  if (gone.length > 0) {
    testInfo.annotations.push({
      type: "fixed",
      description: `${name}: no longer seen; remove from the baseline: ${gone.join("; ")}`,
    });
  }
  const unrecorded = problems
    .filter((each) => !(recorded[each.check] ?? []).includes(each.node))
    .map((each) => `${each.check}: ${each.node} (${each.detail})`);
  expect
    .soft(unrecorded, `New layout problems on ${name}. observed=${json}`)
    .toEqual([]);
}
