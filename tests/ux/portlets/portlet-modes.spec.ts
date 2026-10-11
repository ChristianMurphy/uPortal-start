import {
  test,
  expect,
  ConsoleMessage,
  Locator,
  Page,
  Request,
  TestInfo,
} from "@playwright/test";
import { config } from "../../general-config";
import {
  loginViaUrl,
  trackPortalRequests,
  waitForPortalRequestsToSettle,
} from "../utils/ux-general-utils";
import { BUNDLED_PORTLETS, BundledPortlet } from "./portlet-modes.data";

/*
 * Every bundled portlet in every portlet mode it declares, maximised and in
 * normal state (MOD-D29 item 5). Each render must answer 200, show the
 * portlet in the requested mode without uPortal's error portlet, and leave no
 * console error or uncaught exception behind (messages from other hosts are
 * annotated instead, see isOtherHostMessage). The portlets come from the
 * quickstart data (portlet-modes.data.ts); the first test checks that the
 * portal registers exactly those, so none is left out.
 *
 * A portlet renders as a user who may subscribe to it (its <group>s), and in
 * config mode as admin, who alone may configure portlets. Portlets are
 * opened by their /p/<fname> URL, with uPortal's mode and state parameters.
 * EXCEPTIONS lists every render that is expected to differ, and why.
 */

type Mode = BundledPortlet["modes"][number];

/*
 * Portlets that other specs register for the length of a test, in parallel
 * with this one: e2e-portlet-* (portlet-manager.spec.ts), e2e-import-*
 * (import-export.spec.ts) and pluto-286-* (pluto-testsuite.spec.ts).
 */
const TRANSIENT_FNAME = /^(e2e-|pluto-286-)/;
type User = Record<string, string> | undefined;

const STATES = ["max", "normal"] as const;
type State = (typeof STATES)[number];

interface Exception {
  // What the render shows instead: uPortal's error portlet, console errors
  // matching a pattern, or both
  errorPortlet?: boolean;
  consoleErrors?: RegExp;
  reason: string;
}

/*
 * Renders that are expected to show an error, keyed "<fname>" (every mode
 * and state) or "<fname> <mode>". Each says why.
 */
const EXCEPTIONS: Record<string, Exception> = {
  error: {
    errorPortlet: true,
    reason:
      "the Error portlet exists to render uPortal's error portlet (it throws on purpose)",
  },
  "portlet-cas-test edit": {
    errorPortlet: true,
    reason:
      "MOD-I158: cas-proxy-test-portlet declares EDIT in its portlet.xml, but its Spring " +
      "DispatcherPortlet has no handler for it (NoHandlerFoundException); a bug in the " +
      "portlet WAR, not in uPortal",
  },
  // MOD-I159: a portlet that is also in a region of admin's layout renders
  // twice on its /p/ page, with the same window namespace. Both copies load
  // the portlet's script, which defines its custom element, and in config
  // mode both start CKEditor on the same element. Each browser words the
  // second define differently: Chromium, WebKit, Firefox.
  ...Object.fromEntries(
    [
      "feedback-navigation",
      "legal-footer",
      "notification-icon",
      "portal-logo",
      "waffle-menu",
    ].map((fname) => [
      fname,
      {
        consoleErrors:
          /\[CKEDITOR].*editor-element-conflict|has already been used with this registry|Cannot define multiple custom elements with the same tag name|has already been defined as a custom element/,
        reason:
          "MOD-I159: the portlet is also in a region of the layout and renders twice with " +
          "one namespace: the second CKEditor finds its element taken, and the second " +
          "customElements.define fails",
      },
    ]),
  ),
  "google-analytics-config config": {
    consoleErrors: /\/uPortal\/icons\/destroy\.png/,
    reason:
      "MOD-I159: _googleAnalytics.scss points at icons/destroy.png, which uPortal " +
      "does not have (404)",
  },
  "js-demo": {
    // The TypeError's wording differs by browser: "reading 'reorderList'",
    // "evaluating 'up.fluid.reorderList'", "can't access property "reorderList""
    consoleErrors: /reorderList/,
    reason:
      "MOD-I159: js-demo's content (quickstart data) calls up.fluid.reorderList, and " +
      "the portal does not load up.fluid",
  },
};

/*
 * Console errors expected on any page, each with its reason.
 */
const EXPECTED_ON_ANY_PAGE: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /This CKEditor 4\.22\.1 \(Standard\) version is not secure/,
    reason:
      "MOD-I159: the resource server ships CKEditor 4.22.1, and CKEditor's online version " +
      "check reports it as not secure wherever an editor loads (only with internet access)",
  },
];

const PORTAL_ORIGIN = new URL(config.url).origin;

/*
 * A console message from another host: a resource of another host that
 * failed to load, or a frame of another host that the browser replaced by
 * its error page. Portlet content and scripts load from other hosts (a
 * comic's image, CKEditor 4's version check, Google's retired image chart
 * API, a framed web site). Whether those load depends on the hosts and the
 * network, not on the portal, so they are reported as annotations. Every
 * message from the portal's own pages and resources counts.
 *
 * A site of another host that refuses to be framed (uportal-home-page frames
 * www.apereo.org, which sends X-Frame-Options: SAMEORIGIN) is one of them.
 * WebKit gives that message no location, so its text names the frame:
 * "Refused to display '<url>' in a frame" (Chromium, WebKit) or "The
 * loading of “<url>” in a frame is denied" (Firefox).
 */
const REFUSED_FRAME =
  /Refused to display '([^']+)' in a frame|The loading of “([^”]+)” in a frame is denied/;

function isOtherHostMessage(message: ConsoleMessage): boolean {
  const url = message.location().url;
  if (url.startsWith("chrome-error:")) return true;
  if (url.startsWith("http") && new URL(url).origin !== PORTAL_ORIGIN) {
    return true;
  }
  const refused = REFUSED_FRAME.exec(message.text());
  const frameUrl = refused?.[1] ?? refused?.[2] ?? "";
  return (
    frameUrl.startsWith("http") && new URL(frameUrl).origin !== PORTAL_ORIGIN
  );
}

/*
 * The portlet in the requested mode and state: it renders in the page
 * body's columns. A portlet that is also in a region of the user's layout
 * (the eyebrow, the footer, ...) appears a second time there, in view mode.
 */
function wrapperOf(page: Page, fname: string): Locator {
  return page.locator(`#portalPageBodyColumns .up-portlet-wrapper.${fname}`);
}

const IN_FLIGHT_NOTE = "requests still in flight";

/*
 * The URLs of the XHR and fetch requests to the portal that the page has in
 * flight. Errors in their callbacks belong to the render, so a render waits
 * for them (see settle()).
 */
function trackScriptRequests(page: Page): () => string[] {
  const inFlight = new Set<Request>();
  page.on("request", (request) => {
    if (
      ["xhr", "fetch"].includes(request.resourceType()) &&
      new URL(request.url()).origin === PORTAL_ORIGIN
    ) {
      inFlight.add(request);
    }
  });
  const finished = (request: Request): void => {
    inFlight.delete(request);
  };
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  return () => [...inFlight].map((request) => request.url());
}

/*
 * Give the page's requests to the portal up to 3 seconds to end, so that
 * errors in their callbacks count against this render. Requests that take
 * longer are annotated, and the render's checks go on. The annotation is
 * printed only if the test fails (see the afterEach hook below): in CI on
 * HSQLDB many renders had a request in flight for over 30 seconds, and a
 * line for each of them hid the failures in the job log. Waiting that long
 * made the job exceed its 45-minute limit.
 */
async function settle(
  page: Page,
  scriptRequests: () => string[],
): Promise<void> {
  try {
    await expect.poll(scriptRequests, { timeout: 3000 }).toEqual([]);
  } catch {
    const pending = scriptRequests().join(" ");
    test.info().annotations.push({
      type: IN_FLIGHT_NOTE,
      description: `after 3 s on ${page.url()}: ${pending}`,
    });
  }
}

function printInFlightNotesOfFailedTest(info: TestInfo): void {
  if (info.status === info.expectedStatus) return;
  for (const { type, description } of info.annotations) {
    if (type === IN_FLIGHT_NOTE) {
      console.log(`Requests still in flight ${description}`);
    }
  }
}

/*
 * The user who renders a portlet: guest for Guests-only portlets, staff for
 * portlets of Everyone or Authenticated Users, admin otherwise (Portal
 * Administrators hold ALL_PERMISSIONS) and always in config mode. Staff,
 * not student: favorites.spec.ts changes student's favorites, and in
 * Integration run 38109073749 two of its tests passed only on a retry while
 * this spec rendered portlets as student in parallel.
 */
function userFor(portlet: BundledPortlet, mode: Mode): User {
  if (mode === "config") return config.users.admin;
  if (portlet.groups.length === 1 && portlet.groups[0] === "Guests")
    return undefined;
  if (
    portlet.groups.some((group) =>
      ["Everyone", "Authenticated Users"].includes(group),
    )
  ) {
    return config.users.staff;
  }
  return config.users.admin;
}

function exceptionFor(fname: string, mode: Mode): Exception | undefined {
  return EXCEPTIONS[`${fname} ${mode}`] ?? EXCEPTIONS[fname];
}

/*
 * Console errors and uncaught exceptions of the page's current document. The
 * list starts again when a new document replaces the old one, so errors that
 * a document raises while it is being unloaded do not count against the next
 * render (Portlet Administration's table reads api.page.info() of a table
 * that its beforeunload handler destroyed, MOD-I159).
 */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) errors.length = 0;
  });
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    const text = `console: ${message.text()} (${message.location().url})`;
    const expected = EXPECTED_ON_ANY_PAGE.find(({ pattern }) =>
      pattern.test(text),
    );
    if (isOtherHostMessage(message) || expected) {
      test.info().annotations.push({
        type: expected ? "expected" : "other host",
        description: text,
      });
    } else {
      errors.push(text);
    }
  });
  page.on("pageerror", (error) => errors.push(`uncaught: ${error.message}`));
  return errors;
}

async function render(
  page: Page,
  portlet: BundledPortlet,
  mode: Mode,
  state: State,
  scriptRequests: () => string[],
): Promise<void> {
  await waitForPortalRequestsToSettle(page);
  const url = `${config.url}p/${portlet.fname}/${state}/render.uP?pCm=${mode}`;
  const response = await page.goto(url);
  expect(response?.status(), `HTTP status of ${url}`).toEqual(200);
  await expect(
    wrapperOf(page, portlet.fname),
    `${portlet.fname} on the page`,
  ).toBeVisible();
  await waitForPortalRequestsToSettle(page);
  await settle(page, scriptRequests);
}

test.describe("Bundled portlets in every mode and window state", () => {
  // A request that was still in flight may explain a failure, so a failed test prints the
  // notes that settle() made; a passing test prints nothing.
  test.afterEach(() => printInFlightNotesOfFailedTest(test.info()));

  test("the portal registers exactly the bundled portlets", async ({
    page,
  }) => {
    await loginViaUrl(page, config.users.admin);
    const response = await page.request.get<{ portlets: { fname: string }[] }>(
      `${config.url}api/portlets.json`,
    );
    expect(response.status()).toEqual(200);
    const body = await response.json();
    const registered = body.portlets
      .map((portlet) => portlet.fname)
      .filter((fname) => !TRANSIENT_FNAME.test(fname))
      .sort((a, b) => a.localeCompare(b));
    expect(registered).toEqual(
      BUNDLED_PORTLETS.map((portlet) => portlet.fname).sort((a, b) =>
        a.localeCompare(b),
      ),
    );
  });

  for (const portlet of BUNDLED_PORTLETS) {
    test(`${portlet.fname}: ${portlet.modes.join(", ")}`, async ({ page }) => {
      test.setTimeout(60_000 + portlet.modes.length * STATES.length * 30_000);
      await trackPortalRequests(page);
      const scriptRequests = trackScriptRequests(page);
      const errors = collectErrors(page);
      let current: User | "none" = "none";
      for (const mode of portlet.modes) {
        const user = userFor(portlet, mode);
        if (user !== current) {
          await page.context().clearCookies();
          if (user) await loginViaUrl(page, user);
          current = user;
        }
        for (const state of STATES) {
          await test.step(`${mode}, ${state === "max" ? "maximised" : "normal"}`, async () => {
            errors.length = 0;
            await render(page, portlet, mode, state, scriptRequests);
            const exception = exceptionFor(portlet.fname, mode);
            const errorPortlet = wrapperOf(page, portlet.fname).locator(
              ".portlet.error",
            );
            await expect(errorPortlet, "uPortal's error portlet").toHaveCount(
              exception?.errorPortlet ? 1 : 0,
            );
            const unexpected = errors.filter(
              (error) => !exception?.consoleErrors?.test(error),
            );
            expect(unexpected, "console errors").toEqual([]);
          });
        }
      }
    });
  }
});
