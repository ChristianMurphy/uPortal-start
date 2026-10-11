import { test, expect } from "@playwright/test";
import { config } from "../general-config";

/*
 * uPortal-start installs Tomcat without its documentation and examples
 * webapps, and with a ROOT webapp that only sends / to the portal
 * (MOD-I251). Tomcat's own ROOT page named the Tomcat version, and the
 * documentation and examples were open to anyone. The manager webapps
 * stay; they have no users and answer 401.
 */

const root = new URL("/", config.url);
const VERSION = /(?:\d{1,4}\.){2}\d{1,4}/;

test("/ redirects to the portal", async ({ request }) => {
  const response = await request.get<unknown>(root.href, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(new URL(response.headers()["location"] ?? "", root).href).toBe(
    config.url,
  );
});

for (const path of ["docs/", "examples/"]) {
  test(`/${path} is gone`, async ({ request }) => {
    const response = await request.get<unknown>(`${root.href}${path}`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(404);
    const body = await response.text();
    expect(body).not.toContain("Apache Tomcat");
    expect(body).not.toMatch(VERSION);
  });
}
