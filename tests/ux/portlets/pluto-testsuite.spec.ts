import { test, expect, Browser, Locator, Page } from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";
import {
  PLUTO_286_COMPANION_DEFINITION,
  PLUTO_286_TEST_DEFINITION,
} from "./pluto-testsuite-definitions";

/*
 * Apache Pluto's portlet API compatibility test suite (overlays/pluto-testsuite,
 * MOD-D29 item 4), run through uPortal. It checks the JSR-286 portlet
 * container that runs the bundled portlet WARs: Apache Pluto 2.1.0-M3's jars
 * today, and later the Pluto sources in uPortal's tree, moved to
 * jakarta.servlet, on Tomcat 11 (MOD-Q5).
 *
 * The suite has three portlets, each with a list of tests:
 *  - test-portlet-1 and test-portlet-2 (quickstart data, on the Testing tab of
 *    Portal Administrators and Portal Developers): 16 Portlet 1.0/2.0 tests
 *    each, with different descriptors (resource bundle, preference validator);
 *  - the JSR-286 test portlet and its companion: 7 tests of filters, events,
 *    public render parameters and resource serving. The quickstart has no
 *    definitions for them, so this spec imports two (as admin), puts both on
 *    a tab of developer's layout, and removes both afterwards.
 *
 * Every test of every portlet is a Playwright test of its own, named
 * "<portlet>: <test>". A test is passed when every check on its results page
 * passed, apart from the checks EXCEPTIONS lists: each with the result it
 * must have and why. An exception that stops matching (a check that starts to
 * pass, or fails differently) fails the test too, so the list stays exact.
 * The event tests must also show their event-phase checks (REQUIRED_CHECKS)
 * and the companion portlet's report of the event. The public render
 * parameter test expects the companion to miss the parameter, by name
 * (MOD-I156), until uPortal shares public render parameters.
 *
 * The suite's "manual" tests are driven as a person would: the Portlet Mode
 * and Window State tests follow their links and check the mode or state the
 * portal then renders, the Session Timeout test waits out the 5-second
 * session it set up, and the External Application Scoped Attribute and
 * Resource Filter tests open the window they offer and read its result.
 *
 * The test links are portlet action URLs. uPortal accepts actions as POST
 * only (with the _csrf parameter the URL carries), so the spec posts them as
 * a form would, then loads the render URL the portal redirects to.
 */

type Outcome = "PASSED" | "FAILED" | "UNDECIDED";

interface Check {
  name: string;
  outcome: Outcome;
  message: string;
}

interface Exception {
  // The result the check has; a list when it varies from one run of the portal to the next
  outcome: Outcome | Outcome[];
  reason: string;
  // The uPortal release that fixes it: from that version on the check must pass
  fixedIn?: string;
}

const SUITE_TESTS = [
  "Render Parameter Test",
  "Action Parameter Test",
  "Dispatcher Render Parameter Test",
  "Dispatcher Request Test",
  "Simple Attribute Test",
  "Application Scoped Session Attribute Test",
  "External Application Scoped Attribute Test",
  "Context Init Parameter Test",
  "Preference In Action Test",
  "Preference In Render Test",
  "Session Timeout Test",
  "Portlet Mode Test",
  "Window State Test",
  "Misc Test",
  "Security Mapping Test",
  "Resource Bundle Test",
];

const SUITE_286_TESTS = [
  "Render Filter Test",
  "Action Filter Test",
  "Resource Filter Test",
  "Event Filter Test",
  "Simple Payload Event Test",
  "Complex Payload Event Test",
  "Public Render Parameter Test",
];

/*
 * Checks whose result is not PASSED, keyed "<test> / <check>". Each says why.
 * The same list applies to test-portlet-1 and test-portlet-2. An entry with
 * fixedIn applies to older uPortal versions only (the version comes from the
 * suite's expectedResults.properties, see portalVersion()).
 */
const EXCEPTIONS: Record<string, Exception> = {
  "Dispatcher Render Parameter Test / checkInvalidParameters": {
    outcome: "FAILED",
    reason:
      "the test dispatches to ?a&b=value&c= and expects the valueless 'a' to be dropped; " +
      'Tomcat, which parses the query string of an included request, gives it the value "" ' +
      "(the Servlet specification does not say), so this is the servlet container, not uPortal",
  },
  "Simple Attribute Test / checkEnumerateAttributes": {
    // The suite runs a test's check methods in the order Class.getDeclaredMethods()
    // returns them, which HotSpot does not keep from one JVM start to the next: the
    // check only sees the stale name when it runs after checkRemoveAttribute
    outcome: ["FAILED", "PASSED"],
    reason:
      "MOD-I151: a removed request attribute stayed in getAttributeNames() " +
      "(PortletRequestContextImpl kept the name with a null value); seen only when the " +
      "check runs after the removal, and the order changes with each portal start",
    fixedIn: "5.17.10",
  },
  "Preference In Action Test / checkGetNoValuePreference": {
    outcome: "FAILED",
    reason:
      "MOD-I152: getValues() returned {} instead of the default for a portlet.xml " +
      "preference without a value",
    fixedIn: "5.17.10",
  },
  "Preference In Render Test / checkGetNoValuePreference": {
    outcome: "FAILED",
    reason: "MOD-I152 (see Preference In Action Test)",
    fixedIn: "5.17.10",
  },
  "Preference In Action Test / checkPreferenceValidator": {
    outcome: "FAILED",
    reason:
      "MOD-I153: uPortal never calls the portlet's PreferencesValidator on store() " +
      "(PLT.17.4); logged, not fixed in this change",
  },
  "Misc Test / checkContextServerInfo": {
    outcome: "FAILED",
    reason:
      "MOD-I150: PortletContext.getServerInfo() said 'Pluto/${pluto.version}' " +
      "(uPortal's copy of Pluto's driver configuration was never filtered)",
    fixedIn: "5.17.10",
  },
  "Security Mapping Test / checkIsUserInUnmappedRole": {
    outcome: "UNDECIDED",
    reason:
      "uPortal answers isUserInRole(role) by membership of a group named after the role; the " +
      "suite's roles are Tomcat container roles ('tomcat'), and the quickstart has no such group",
  },
  "Security Mapping Test / checkIsUserInMappedRole": {
    outcome: "UNDECIDED",
    reason:
      "plutoTestRole links to the container role 'tomcat' (security-role-ref); see " +
      "checkIsUserInUnmappedRole",
  },
  // The JSR-286 portlet's action-phase checks only start what the event phase
  // or the companion portlet then checks: Pluto marks them UNDEFINED on
  // purpose, and REQUIRED_CHECKS and the companion assertions hold the result
  "Event Filter Test / checkTriggerEventFromActionPhase": {
    outcome: "UNDECIDED",
    reason:
      "Pluto's action-phase half only fires trigger-event-phase (TestResult.UNDEFINED); the " +
      "event-phase filter checks that follow carry the result",
  },
  "Simple Payload Event Test / checkFireEventsFromActionPhase": {
    outcome: "UNDECIDED",
    reason:
      "Pluto's action-phase half only fires the event (TestResult.UNDEFINED); the event-phase " +
      "checks and the companion portlet carry the result",
  },
  "Complex Payload Event Test / checkFireEventsFromActionPhase": {
    outcome: "UNDECIDED",
    reason: "see Simple Payload Event Test / checkFireEventsFromActionPhase",
  },
  "Public Render Parameter Test / checkPublicRenderParameter": {
    outcome: "UNDECIDED",
    reason:
      "Pluto reports a WARNING on purpose: the evidence is in the companion portlet, which the " +
      "spec reads",
  },
};

/*
 * Checks that must be on a test's results page: the event-phase checks of
 * the JSR-286 tests, which run only when the portal delivers the event the
 * action phase fired (PLT.15.2).
 */
const REQUIRED_CHECKS: Record<string, string[]> = {
  "Event Filter Test": [
    "checkTestsRunInCorrectPhase",
    "checkAttributeFromWildcardFilter",
    "checkSecondFilterOverwroteAttribute",
    "checkAttributeFromTestFilter",
  ],
  "Simple Payload Event Test": [
    "checkExpectedEventWasFired",
    "checkEventPayloadIsCorrectClass",
    "checkEventPayloadIsCorrect",
  ],
  "Complex Payload Event Test": [
    "checkExpectedEventWasFired",
    "checkEventPayloadIsCorrectClass",
    "checkEventPayloadIsCorrect",
  ],
};

/*
 * The uPortal release that delivers the JSR-286 tests' events. Before it, on
 * Java 11 and later, uPortal created no event with a payload when the
 * portlet WAR has no JAXB implementation of its own (MOD-I157): the event
 * phase never ran and the companion portlet received nothing.
 */
const EVENTS_FIXED_IN = "5.17.10";

function eventsDelivered(): boolean {
  return atLeast(testedVersion, EVENTS_FIXED_IN);
}

const SUITE_PORTLETS = ["test-portlet-1", "test-portlet-2"];
const FNAME_286 = "pluto-286-test";
const FNAME_286_COMPANION = "pluto-286-companion";
const DEVELOPER = {
  username: "developer",
  // eslint-disable-next-line sonarjs/no-hardcoded-credentials
  password: "developer",
  displayName: "Developer User",
};

/*
 * The content area of a portlet, by fname.
 */
function content(page: Page, fname: string): Locator {
  return page.locator(
    `.up-portlet-wrapper.${fname} .up-portlet-content-wrapper`,
  );
}

/*
 * Post a portlet action URL as a form would, then load the page the portal
 * redirects to. Returns the render URL that was loaded.
 */
async function postAction(page: Page, actionUrl: string): Promise<string> {
  await waitForPortalRequestsToSettle(page);
  const target = new URL(actionUrl, page.url()).href;
  const response = await page.request.post<unknown>(target, {
    maxRedirects: 0,
  });
  expect(response.status(), `POST ${target}`).toEqual(302);
  const location = new URL(response.headers()["location"] ?? "", target).href;
  await page.goto(location);
  return location;
}

/*
 * The href of the link or the URL in a portlet, decoded once more where the
 * suite's JSP escaped an already escaped portlet URL (c:out over a
 * portlet:renderURL var, whose value JSR-286 escapes by default).
 */
async function linkUrl(link: Locator): Promise<string> {
  const href = (await link.getAttribute("href")) ?? "";
  expect(href, "link without href").not.toEqual("");
  return href.replaceAll("&amp;", "&");
}

/*
 * Start one test of a suite portlet from its introduction page.
 */
async function startTest(
  page: Page,
  portlet: Locator,
  testName: string,
): Promise<void> {
  const row = portlet.locator("tr").filter({
    has: page.locator("td", { hasText: new RegExp(`^\\s*${testName}\\s*$`) }),
  });
  await expect(row, `"${testName}" on the introduction page`).toHaveCount(1);
  await postAction(
    page,
    await linkUrl(row.getByRole("link", { name: "Test" })),
  );
}

/*
 * The checks on a results page (jsp/test_results.inc): one row per check,
 * with an image for its result, "PLT <section> - <name>", and a message.
 */
async function readChecks(portlet: Locator): Promise<Check[]> {
  return portlet.evaluate((root) => {
    const outcomes: Record<string, "PASSED" | "FAILED" | "UNDECIDED"> = {
      "yes.gif": "PASSED",
      "no.gif": "FAILED",
      "question.gif": "UNDECIDED",
    };
    const checks: {
      name: string;
      outcome: "PASSED" | "FAILED" | "UNDECIDED";
      message: string;
    }[] = [];
    for (const image of root.querySelectorAll("img")) {
      const file = (image.getAttribute("src") ?? "").split("/").pop() ?? "";
      const outcome = outcomes[file];
      const row = image.closest("tr");
      if (!outcome || !row) continue;
      const label = row.querySelectorAll("td")[1]?.textContent ?? "";
      const name = label.replace(/^\s*PLT\s+\S+\s+-\s+/, "").trim();
      const detail = row.nextElementSibling?.querySelector("span");
      checks.push({
        name,
        outcome,
        message: (detail?.textContent ?? "").replaceAll(/\s+/g, " ").trim(),
      });
    }
    return checks;
  });
}

let testedVersion = "";

/*
 * The uPortal version under test: the one the suite's MiscTest expects in
 * PortalContext.getPortalInfo(), which overlays/pluto-testsuite fills in from
 * uPortalVersion and also serves as /pluto-testsuite/expectedResults.properties.
 */
async function portalVersion(page: Page): Promise<string> {
  if (!testedVersion) {
    const response = await page.request.get<unknown>(
      new URL("../pluto-testsuite/expectedResults.properties", config.url).href,
    );
    expect(response.status(), "expectedResults.properties").toEqual(200);
    const match = /^expected\.portalInfo\s*=\s*uPortal\/(\S+)/m.exec(
      await response.text(),
    );
    expect(
      match,
      "expected.portalInfo in expectedResults.properties",
    ).toBeTruthy();
    testedVersion = match?.[1] ?? "";
  }
  return testedVersion;
}

/*
 * The numbers of a version: 5.17.10-SNAPSHOT gives [5, 17, 10].
 */
function versionParts(version: string): number[] {
  const numbers = /^[\d.]*/.exec(version)?.[0] ?? "";
  return numbers
    .split(".")
    .filter((part) => part !== "")
    .map(Number);
}

/*
 * Whether version a (e.g. 5.17.10-SNAPSHOT) is at least b (e.g. 5.17.10).
 * A snapshot counts as its release: it already has the fixes.
 */
function atLeast(a: string, b: string): boolean {
  const [x, y] = [versionParts(a), versionParts(b)];
  for (let index = 0; index < Math.max(x.length, y.length); index++) {
    const difference = (x[index] ?? 0) - (y[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

function applicableException(key: string): Exception | undefined {
  const exception = EXCEPTIONS[key];
  if (exception?.fixedIn && atLeast(testedVersion, exception.fixedIn)) {
    return undefined;
  }
  return exception;
}

/*
 * Require every check to pass, apart from the listed exceptions.
 */
function expectChecks(testName: string, checks: Check[]): void {
  test.info().annotations.push(
    ...checks.map((check) => ({
      type: check.outcome,
      description: [`${testName} / ${check.name}`, check.message]
        .filter(Boolean)
        .join(": "),
    })),
  );
  expect(checks.length, `checks of ${testName}`).toBeGreaterThan(0);
  const required = eventsDelivered() ? (REQUIRED_CHECKS[testName] ?? []) : [];
  for (const name of required) {
    expect
      .soft(
        checks.map((check) => check.name),
        `${testName} / ${name} must run (the portal delivers the event)`,
      )
      .toContain(name);
  }
  for (const check of checks) {
    const key = `${testName} / ${check.name}`;
    const exception = applicableException(key);
    const expected = [exception?.outcome ?? "PASSED"].flat();
    const details = [key];
    if (check.message) details.push(`(${check.message})`);
    if (exception) {
      details.push(`[expected ${expected.join(" or ")}: ${exception.reason}]`);
    }
    expect.soft(expected, details.join(" ")).toContain(check.outcome);
  }
  for (const key of Object.keys(EXCEPTIONS).filter(
    (k) => k.startsWith(`${testName} / `) && applicableException(k),
  )) {
    expect
      .soft(
        checks.map((check) => `${testName} / ${check.name}`),
        `${key} is listed as an exception but did not run`,
      )
      .toContain(key);
  }
}

async function withUser<T>(
  browser: Browser,
  user: Record<string, string>,
  action: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginViaUrl(page, user);
    return await action(page);
  } finally {
    await context.close();
  }
}

async function layoutAction(
  page: Page,
  form: Record<string, string>,
): Promise<Record<string, string>> {
  await waitForPortalRequestsToSettle(page);
  const response = await page.request.post<Record<string, string>>(
    `${config.url}api/layout`,
    { form },
  );
  expect(response.status(), `layout action ${form.action}`).toEqual(200);
  return response.json();
}

// Which exceptions apply depends on the uPortal version under test
test.beforeEach(async ({ page }) => {
  await portalVersion(page);
});

test.describe("Pluto portlet test suite", () => {
  test.describe.configure({ timeout: 120_000 });

  for (const fname of SUITE_PORTLETS) {
    test(`${fname}: lists the suite's tests`, async ({ page }) => {
      await loginViaUrl(page, config.users.admin);
      await page.goto(`${config.url}p/${fname}/max/render.uP`);
      const portlet = content(page, fname);
      await expect(
        portlet.getByText("Please select one of the following tests"),
      ).toBeVisible();
      const names = await portlet
        .locator("tr")
        .filter({ has: page.getByRole("link", { name: "Test" }) })
        .evaluateAll((rows) =>
          rows.map(
            (row) => row.querySelectorAll("td")[1]?.textContent?.trim() ?? "",
          ),
        );
      expect(names).toEqual(SUITE_TESTS);
    });

    for (const testName of SUITE_TESTS.filter(
      (name) =>
        ![
          "External Application Scoped Attribute Test",
          "Session Timeout Test",
          "Portlet Mode Test",
          "Window State Test",
        ].includes(name),
    )) {
      test(`${fname}: ${testName}`, async ({ page }) => {
        await loginViaUrl(page, config.users.admin);
        await page.goto(`${config.url}p/${fname}/max/render.uP`);
        const portlet = content(page, fname);
        await startTest(page, portlet, testName);
        await expect(
          portlet.getByRole("columnheader", {
            name: /^(TEST PASSED|TEST FAILED|WARNING)$/,
          }),
        ).toBeVisible();
        expectChecks(testName, await readChecks(portlet));
      });
    }

    test(`${fname}: External Application Scoped Attribute Test`, async ({
      page,
    }) => {
      await loginViaUrl(page, config.users.admin);
      await page.goto(`${config.url}p/${fname}/max/render.uP`);
      const portlet = content(page, fname);
      await startTest(
        page,
        portlet,
        "External Application Scoped Attribute Test",
      );
      // The portlet set an application-scoped attribute and offers a link to
      // a servlet of its own web application, which must see the attribute
      // in its HttpSession (PLT.15.3) and sets one the portlet must see back
      await expect(portlet.getByText("MANUAL TEST")).toBeVisible();
      const link = portlet.getByRole("link", { name: "here" });
      const servletUrl = await linkUrl(link);
      expect(servletUrl).toContain(
        "/pluto-testsuite/test/ExternalAppScopedAttributeTest_Servlet",
      );
      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        link.click(),
      ]);
      await popup.waitForLoadState();
      const verdict = popup.getByRole("columnheader").first();
      await expect(verdict, "the servlet's verdict").toHaveText("PASSED");
      // Both sides report the same session
      const sessionIds = await popup
        .locator("tr:has(td)")
        .evaluateAll((rows) =>
          rows
            .filter((row) => /Session Id/.test(row.textContent ?? ""))
            .map(
              (row) => row.querySelectorAll("td")[1]?.textContent?.trim() ?? "",
            ),
        );
      expect(sessionIds).toHaveLength(2);
      expect(sessionIds[0]).toEqual(sessionIds[1]);
      await popup.close();
      // The servlet's PASSED is the test's result: the page keeps showing the
      // manual instructions, because the portlet's own half of the check
      // (checkSetAppScopedAttributeHereSeenElsewhere) always reports a warning
    });

    test(`${fname}: Session Timeout Test`, async ({ page }) => {
      await loginViaUrl(page, config.users.admin);
      await page.goto(`${config.url}p/${fname}/max/render.uP`);
      const portlet = content(page, fname);
      await startTest(page, portlet, "Session Timeout Test");
      // The test set the portlet session to expire after 5 seconds of
      // inactivity (PLT.15.6) and offers a maximised render link. The wait is
      // what the test measures, not a synchronisation.
      await expect(portlet.getByText("MANUAL TEST")).toBeVisible();
      const next = await linkUrl(portlet.getByRole("link", { name: "here" }));
      await waitForPortalRequestsToSettle(page);
      // eslint-disable-next-line playwright/no-wait-for-timeout -- the 5-second inactivity is the subject of the test
      await page.waitForTimeout(6000);
      await page.goto(new URL(next, page.url()).href);
      await expect(
        portlet.getByRole("columnheader", {
          name: /^(TEST PASSED|TEST FAILED|WARNING)$/,
        }),
      ).toBeVisible();
      expectChecks("Session Timeout Test", await readChecks(portlet));
    });

    test(`${fname}: Portlet Mode Test`, async ({ page }) => {
      await loginViaUrl(page, config.users.admin);
      await page.goto(`${config.url}p/${fname}/max/render.uP`);
      const portlet = content(page, fname);
      await startTest(page, portlet, "Portlet Mode Test");
      await expect(portlet.getByText("MANUAL TEST")).toBeVisible();
      const modeLinks = {
        help: await linkUrl(
          portlet.getByRole("link", { name: "Help", exact: true }),
        ),
        edit: await linkUrl(
          portlet.getByRole("link", { name: "Edit", exact: true }),
        ),
        view: await linkUrl(
          portlet.getByRole("link", { name: "View", exact: true }),
        ),
      };
      // Help: the portlet renders its help page (doHelp)
      await postAction(page, modeLinks.help);
      await expect(portlet.getByText("Test Portlet Help Page")).toBeVisible();
      // Edit: the portlet renders its edit page (doEdit)
      await postAction(page, modeLinks.edit);
      await expect(portlet.getByText("THIS IS THE EDIT PAGE")).toBeVisible();
      // View: back to the test page itself
      await postAction(page, modeLinks.view);
      await expect(portlet.getByText("MANUAL TEST")).toBeVisible();
      await expect(
        portlet.getByRole("columnheader", { name: "Portlet Mode Test" }),
      ).toBeVisible();
    });

    test(`${fname}: Window State Test`, async ({ page }) => {
      await loginViaUrl(page, config.users.admin);
      // In normal state, on the Testing tab next to the other test portlet
      await page.goto(`${config.url}f/testing/normal/render.uP`);
      const portlet = content(page, fname);
      const other = content(
        page,
        SUITE_PORTLETS.find((name) => name !== fname) ?? "",
      );
      await expect(other).toBeVisible();
      await startTest(page, portlet, "Window State Test");
      await expect(portlet.getByText("MANUAL TEST")).toBeVisible();
      const stateLinks = {
        max: await linkUrl(
          portlet.getByRole("link", { name: "Max", exact: true }),
        ),
        min: await linkUrl(
          portlet.getByRole("link", { name: "Min", exact: true }),
        ),
        normal: await linkUrl(
          portlet.getByRole("link", { name: "Nor", exact: true }),
        ),
      };
      // Maximized: the portlet alone, with its content
      await postAction(page, stateLinks.max);
      expect(page.url()).toContain("/max/");
      await expect(portlet.getByText("MANUAL TEST")).toBeVisible();
      await expect(other).toHaveCount(0);
      // Minimized: back on the tab, the portlet's content is not rendered
      await postAction(page, stateLinks.min);
      await expect(other).toBeVisible();
      await expect(page.locator(`.up-portlet-wrapper.${fname}`)).toBeVisible();
      await expect(portlet.getByText("MANUAL TEST")).toHaveCount(0);
      await expect(portlet).toHaveText(/^\s*$/);
      // Normal: the content is back, next to the other portlet
      await postAction(page, stateLinks.normal);
      await expect(other).toBeVisible();
      await expect(portlet.getByText("MANUAL TEST")).toBeVisible();
    });
  }
});

test.describe("Pluto JSR-286 test suite", () => {
  test.describe.configure({ timeout: 120_000 });

  let tabId = "";

  test.beforeAll(async ({ browser }) => {
    await withUser(browser, config.users.admin, async (page) => {
      for (const [fileName, xml] of [
        [`${FNAME_286}.portlet-definition.xml`, PLUTO_286_TEST_DEFINITION],
        [
          `${FNAME_286_COMPANION}.portlet-definition.xml`,
          PLUTO_286_COMPANION_DEFINITION,
        ],
      ]) {
        const status = await page.evaluate(
          async ({ name, body, url }) => {
            const data = new window.FormData();
            data.append(
              "file",
              new window.File([body], name, { type: "text/xml" }),
            );
            const response = await window.fetch(`${url}api/import`, {
              method: "POST",
              body: data,
            });
            return response.status;
          },
          { name: fileName, body: xml, url: config.url },
        );
        expect(status, `import ${fileName}`).toEqual(200);
      }
    });
    tabId = await withUser(browser, DEVELOPER, async (page) => {
      const tab = await layoutAction(page, {
        action: "addTab",
        tabName: "Pluto JSR-286",
        "widths[]": "50",
      });
      expect(tab.tabId).toBeTruthy();
      const columns = await page.request.get<{
        layout: {
          navigation: { tabs: { ID: string; content: { ID: string }[] }[] };
        };
      }>(`${config.url}api/v4-3/dlm/layout.json`);
      const layout = await columns.json();
      const column =
        layout.layout.navigation.tabs.find((t) => t.ID === tab.tabId)
          ?.content[0]?.ID ?? "";
      expect(column).not.toEqual("");
      for (const fname of [FNAME_286, FNAME_286_COMPANION]) {
        const added = await layoutAction(page, {
          action: "addPortlet",
          fname,
          elementID: column,
        });
        expect(added.response).toEqual("Added new portlet");
      }
      return tab.tabId;
    });
  });

  test.afterAll(async ({ browser }) => {
    if (tabId) {
      await withUser(browser, DEVELOPER, async (page) => {
        await layoutAction(page, { action: "removeElement", elementID: tabId });
      });
    }
    await withUser(browser, config.users.admin, async (page) => {
      for (const fname of [FNAME_286, FNAME_286_COMPANION]) {
        await page.request.delete<unknown>(
          `${config.url}api/entity/portlet-definition/${fname}`,
        );
      }
    });
  });

  async function openTab(
    page: Page,
  ): Promise<{ portlet: Locator; companion: Locator }> {
    await loginViaUrl(page, DEVELOPER);
    await page.goto(`${config.url}f/${tabId}/normal/render.uP`);
    const portlet = content(page, FNAME_286);
    const companion = content(page, FNAME_286_COMPANION);
    await expect(
      portlet.getByText("Please select one of the following tests"),
    ).toBeVisible();
    await expect(
      companion.getByText("This portlet is a companion portlet"),
    ).toBeVisible();
    return { portlet, companion };
  }

  test(`${FNAME_286}: lists the suite's tests`, async ({ page }) => {
    const { portlet } = await openTab(page);
    const names = await portlet
      .locator("tr")
      .filter({ has: page.getByRole("link", { name: "Test" }) })
      .evaluateAll((rows) =>
        rows.map(
          (row) => row.querySelectorAll("td")[1]?.textContent?.trim() ?? "",
        ),
      );
    expect(names).toEqual(SUITE_286_TESTS);
  });

  for (const testName of [
    "Render Filter Test",
    "Action Filter Test",
    "Event Filter Test",
  ]) {
    test(`${FNAME_286}: ${testName}`, async ({ page }) => {
      const { portlet } = await openTab(page);
      await startTest(page, portlet, testName);
      await expect(
        portlet.getByRole("columnheader", {
          name: /^(TEST PASSED|TEST FAILED|WARNING)$/,
        }),
      ).toBeVisible();
      expectChecks(testName, await readChecks(portlet));
    });
  }

  for (const [testName, evidence] of [
    [
      "Simple Payload Event Test",
      "Simple Payload Event received.  Payload matched expected value.",
    ],
    [
      "Complex Payload Event Test",
      "Complex Payload Event received.  Payload matched expected values.",
    ],
  ]) {
    test(`${FNAME_286}: ${testName}`, async ({ page }) => {
      const { portlet, companion } = await openTab(page);
      await startTest(page, portlet, testName);
      await expect(
        portlet.getByRole("columnheader", {
          name: /^(TEST PASSED|TEST FAILED|WARNING)$/,
        }),
      ).toBeVisible();
      expectChecks(testName, await readChecks(portlet));
      // The companion portlet processed the event (PLT.15.2) and reports it;
      // before EVENTS_FIXED_IN it received none (MOD-I157)
      const delivered = eventsDelivered();
      await expect(
        companion.getByText("Information from last event:"),
        `companion portlet on uPortal ${testedVersion}`,
      ).toHaveCount(delivered ? 1 : 0);
      if (delivered) {
        await expect(companion).toContainText(
          evidence.replaceAll(/\s+/g, " ").trim(),
        );
      }
    });
  }

  test(`${FNAME_286}: Public Render Parameter Test`, async ({ page }) => {
    const { portlet, companion } = await openTab(page);
    await startTest(page, portlet, "Public Render Parameter Test");
    await expect(
      portlet.getByRole("columnheader", {
        name: /^(TEST PASSED|TEST FAILED|WARNING)$/,
      }),
    ).toBeVisible();
    expectChecks("Public Render Parameter Test", await readChecks(portlet));
    // public-render-param1, which both portlets declare, must reach the
    // companion (PLT.11.1.2). uPortal does not share public render
    // parameters between portlet windows (MOD-I156): the action's redirect
    // carries it as a private parameter of the test portlet, and the companion
    // shows no result. This expectation fails once uPortal shares them; then
    // require "checkPublicRenderParameter test: Passed" in the companion.
    expect(page.url(), "the render URL after the action").toContain(
      "pP_public-render-param1=Passed",
    );
    await expect(
      companion.getByText("Public Render Parameter Test Results:"),
      "MOD-I156: the companion portlet does not get the public render parameter",
    ).toHaveCount(0);
  });

  test(`${FNAME_286}: Resource Filter Test`, async ({ page }) => {
    const { portlet } = await openTab(page);
    // The test page opens the portlet's resource URL in a new window
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      startTest(page, portlet, "Resource Filter Test"),
    ]);
    await popup.waitForLoadState();
    expect(popup.url()).toContain("resource.uP");
    await expect(
      popup.getByRole("columnheader", {
        name: /^(TEST PASSED|TEST FAILED|WARNING)$/,
      }),
    ).toBeVisible();
    expectChecks(
      "Resource Filter Test",
      await readChecks(popup.locator("body")),
    );
    await popup.close();
  });
});
