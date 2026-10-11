import { test, expect } from "@playwright/test";
import { config } from "../general-config";
import { loginViaApi } from "../ux/utils/ux-general-utils";

/*
 * /api/v6-0/search, the API behind the <up-search> web component (uPortal
 * MOD-D18). It runs the same search strategies as /api/v5-0/portal/search
 * (search-v5-0.spec.ts) and returns one group per result type.
 */
const SEARCH_API = `${config.url}api/v6-0/search`;

interface SearchBody {
  query: string;
  groups: {
    type: string;
    results: {
      title: string;
      url: string | null;
      attributes: Record<string, string[]>;
    }[];
  }[];
}

test("search all types", async ({ request }) => {
  await loginViaApi(request, config.users.admin);
  const response = await request.get<SearchBody>(`${SEARCH_API}?q=cartoon`);
  expect(response.status()).toEqual(200);
  const body = await response.json();
  expect(body.query).toBe("cartoon");
  expect(body.groups.map((group) => group.type)).toEqual([
    "people",
    "portlets",
  ]);
  expect(body.groups[0]?.results).toEqual([]);
  const portlets = body.groups[1]?.results ?? [];
  expect(portlets).toHaveLength(1);
  expect(portlets[0]).toMatchObject({
    title: "Daily Business Cartoon",
    attributes: {
      description: ["Daily Business Cartoon by Ted Goff, www.tedgoff.com"],
      fname: ["daily-business-cartoon"],
      name: ["Daily Business Cartoon"],
    },
  });
  expect(portlets[0]?.url).toMatch(
    /\/uPortal\/p\/daily-business-cartoon\.ctf\d+\/max\/render\.uP/,
  );
});

test("search people", async ({ request }) => {
  await loginViaApi(request, config.users.admin);
  const response = await request.get<SearchBody>(
    `${SEARCH_API}?q=steven&type=people`,
  );
  expect(response.status()).toEqual(200);
  const body = await response.json();
  expect(body.groups).toHaveLength(1);
  const people = body.groups[0]?.results ?? [];
  expect(people).toHaveLength(1);
  // A person has no link
  expect(people[0]?.url ?? undefined).toBeUndefined();
  expect(people).toMatchObject([
    {
      title: "Steven Student",
      attributes: expect.objectContaining({
        username: ["student"],
        mail: ["steven.student@example.org"],
        givenName: ["Steven"],
        sn: ["Student"],
      }) as unknown,
    },
  ]);
});

test("refuses a blank query", async ({ request }) => {
  await loginViaApi(request, config.users.admin);
  const response = await request.get<{ message: string }>(
    `${SEARCH_API}?q=%20`,
  );
  expect(response.status()).toEqual(400);
  const body = await response.json();
  expect(body.message).toBe("Enter something to search for");
});

test("refuses unsafe requests without the CSRF token", async ({ request }) => {
  await loginViaApi(request, config.users.admin);
  const response = await request.post<unknown>(`${SEARCH_API}?q=cartoon`);
  expect(response.status()).toEqual(403);
});
