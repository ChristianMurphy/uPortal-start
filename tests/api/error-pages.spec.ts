import { test, expect, APIRequestContext } from "@playwright/test";
import { config } from "../general-config";

/*
 * Tomcat writes its own error page when no webapp's error-page answers: a 404
 * in uPortal (whose web.xml maps only 500) or outside every webapp, a request
 * the connector rejects before any webapp sees it, and an exception in a webapp
 * without an error-page. By default that page shows the exception and
 * "Apache Tomcat/<version>". The ErrorReportValve on the Host in
 * etc/tomcat/conf/server.xml leaves both out (MOD-I250). Each request below
 * gets one of those pages; none of them may name Tomcat or a version, in the
 * body or in a header.
 */

const root = new URL("/", config.url).href;

/* A page and its status; `webapp` names the webapp it needs, if not uPortal */
const PAGES: Record<string, { url: string; status: number; webapp?: string }> =
  {
    "404 in uPortal": { url: `${config.url}e2e-no-such-page`, status: 404 },
    "404 outside every webapp": {
      url: `${root}e2e-no-such-webapp/`,
      status: 404,
    },
    // Invalid percent-encoding: the connector answers before uPortal runs.
    "400 from the connector": { url: `${config.url}%zz`, status: 400 },
    // Outside a portlet request <portlet:defineObjects/> throws, and the
    // pluto-testsuite webapp has no error-page.
    "500 in a webapp without an error-page": {
      url: `${root}pluto-testsuite/jsp/test_results.jsp`,
      status: 500,
      webapp: "pluto-testsuite",
    },
  };

const VERSION = /(?:\d{1,4}\.){2}\d{1,4}/;

/* Whether the webapp the page needs answers (uPortal itself always does) */
async function isDeployed(
  request: APIRequestContext,
  webapp: string | undefined,
): Promise<boolean> {
  if (webapp === undefined) return true;
  const response = await request.get<unknown>(`${root}${webapp}/`);
  return response.status() !== 404;
}

for (const [name, { url, status, webapp }] of Object.entries(PAGES)) {
  test(`${name} does not show the server's name or version`, async ({
    request,
  }) => {
    // The DB harness deploys uPortal alone, without pluto-testsuite.
    test.skip(
      !(await isDeployed(request, webapp)),
      `${webapp ?? ""} is not deployed`,
    );
    const response = await request.get<unknown>(url, { maxRedirects: 0 });
    expect(response.status()).toBe(status);
    const body = await response.text();
    // The request reached Tomcat's own error page, not a page of the portal.
    expect(body).toContain(`HTTP Status ${status}`);
    expect(body).not.toContain("Apache Tomcat");
    expect(body).not.toMatch(VERSION);
    for (const { name: header, value } of response.headersArray()) {
      expect(`${header}: ${value}`).not.toMatch(/tomcat/i);
      expect(`${header}: ${value}`).not.toMatch(VERSION);
    }
  });
}
