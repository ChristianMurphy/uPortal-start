import { test, expect, APIRequestContext } from "@playwright/test";
import { config } from "../general-config";
import { loginViaApi, logoutViaApi } from "../ux/utils/ux-general-utils";

/*
 * GET /api/v6-0/popular-portlets: how many times users added each portlet to
 * their layouts in the last N days, for the <up-popular-portlets> web
 * component. Which portlets it lists depends on what the statistics
 * aggregation has counted so far, so these tests check the shape, the order
 * and the parameter checks; tests/ux/portlets/popular-portlets.spec.ts checks
 * the content.
 */
const API = `${config.url}api/v6-0/popular-portlets`;

interface PopularPortlet {
  fname: string;
  title: string;
  description: string | null;
  url: string;
  count: number;
}

interface PopularPortlets {
  days: number;
  portlets: PopularPortlet[];
}

async function getPopular(
  request: APIRequestContext,
  query = ""
): Promise<PopularPortlets> {
  const response = await request.get<PopularPortlets>(`${API}${query}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  return response.json();
}

function expectWellFormed(body: PopularPortlets): void {
  for (const portlet of body.portlets) {
    expect(portlet.fname).toMatch(/\S/);
    expect(portlet.title).toMatch(/\S/);
    expect(portlet.url).toBe(`/uPortal/p/${portlet.fname}`);
    expect(Number.isInteger(portlet.count)).toBe(true);
    expect(portlet.count).toBeGreaterThanOrEqual(1);
    expect(
      portlet.description === null || typeof portlet.description === "string"
    ).toBe(true);
  }
  // Most added first, ties by fname
  const order = body.portlets.map((portlet) => portlet.fname);
  const sorted = [...body.portlets]
    .sort((a, b) => b.count - a.count || (a.fname < b.fname ? -1 : 1))
    .map((portlet) => portlet.fname);
  expect(order).toEqual(sorted);
}

test("lists the popular portlets of the last 30 days by default", async ({
  request,
}) => {
  await loginViaApi(request, config.users.student);
  const body = await getPopular(request);
  expect(body.days).toBe(30);
  expectWellFormed(body);
  await logoutViaApi(request);
});

test("counts the given number of days", async ({ request }) => {
  await loginViaApi(request, config.users.student);
  for (const days of [1, 7, 90, 365]) {
    const body = await getPopular(request, `?days=${days}&locale=en-US`);
    expect(body.days).toBe(days);
    expectWellFormed(body);
  }
  await logoutViaApi(request);
});

test("answers guests too", async ({ request }) => {
  const body = await getPopular(request, "?days=7");
  expect(body.days).toBe(7);
  expectWellFormed(body);
});

test("refuses a number of days outside 1 to 365", async ({ request }) => {
  for (const days of ["0", "366", "-5", "thirty"]) {
    const response = await request.get<{ status: number; message: string }>(
      `${API}?days=${days}`
    );
    expect(response.status(), `days=${days}`).toBe(400);
    const body = await response.json();
    expect(body.status).toBe(400);
    expect(body.message).toMatch(/days/);
  }
});

test("refuses an unsafe request without the CSRF token", async ({
  request,
}) => {
  await loginViaApi(request, config.users.student);
  const response = await request.post<unknown>(API, { data: {} });
  expect(response.status()).toBe(403);
  await logoutViaApi(request);
});
