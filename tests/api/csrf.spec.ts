import { test, expect, APIRequestContext } from "@playwright/test";
import { config } from "../general-config";
import {
  loginViaApi,
  sessionCsrfHeaders,
} from "../ux/utils/ux-general-utils";

/*
 * uPortal requires the session's CSRF token on every POST, PUT, PATCH and
 * DELETE under /api (MOD-I130), except with a Bearer token and on the OIDC
 * endpoints.  Each request below names something that does not exist, so
 * the endpoint itself refuses it or does nothing.  Without the token the
 * CSRF filter answers 403 before the endpoint runs; with it the request
 * reaches the endpoint, which answers anything but 403.
 */

type Send = (
  request: APIRequestContext,
  headers: Record<string, string>
) => ReturnType<APIRequestContext["fetch"]>;

const NONE = "e2e-csrf-none";
const api = `${config.url}api`;

const postToLayout: Send = async (request, headers) =>
  request.post<unknown>(`${api}/layout`, {
    form: { action: "removeByFName", fname: NONE },
    headers,
  });

const PROTECTED: Record<string, Send> = {
  "POST /api/layout": postToLayout,
  "POST /api/marketplace/{fname}/rating/{rating}": async (request, headers) =>
    request.post<unknown>(`${api}/marketplace/${NONE}/rating/5`, { headers }),
  "PUT /api/preferences/{fname}": async (request, headers) =>
    request.put<unknown>(`${api}/preferences/${NONE}`, {
      data: { key: "value" },
      headers,
    }),
  "PUT /api/preferences/definition/{fname}": async (request, headers) =>
    request.put<unknown>(`${api}/preferences/definition/${NONE}`, {
      data: { key: "value" },
      headers,
    }),
  "POST /api/portlet-list/": async (request, headers) =>
    request.post<unknown>(`${api}/portlet-list/`, {
      data: { bogus: NONE },
      headers,
    }),
  "PUT /api/portlet-list/{id}": async (request, headers) =>
    request.put<unknown>(`${api}/portlet-list/${NONE}`, {
      data: { name: NONE },
      headers,
    }),
  "DELETE /api/portlet-list/{id}": async (request, headers) =>
    request.delete<unknown>(`${api}/portlet-list/${NONE}`, { headers }),
  "POST /api/v4-3/pags/{parent}.json": async (request, headers) =>
    request.post<unknown>(`${api}/v4-3/pags/${NONE}.json`, {
      data: {},
      headers,
    }),
  "PUT /api/v4-3/pags/{group}.json": async (request, headers) =>
    request.put<unknown>(`${api}/v4-3/pags/${NONE}.json`, {
      data: {},
      headers,
    }),
  "POST /api/import": async (request, headers) =>
    request.post<unknown>(`${api}/import`, { headers }),
  "DELETE /api/entity/{type}/{id}": async (request, headers) =>
    request.delete<unknown>(`${api}/entity/portlet-definition/${NONE}`, {
      headers,
    }),
  "POST /api/deletePermission": async (request, headers) =>
    request.post<unknown>(`${api}/deletePermission`, {
      form: { principal: NONE, owner: NONE, activity: NONE, target: NONE },
      headers,
    }),
  "POST /api/updatePermission": async (request, headers) =>
    request.post<unknown>(`${api}/updatePermission`, {
      form: {
        principal: NONE,
        assignment: "INHERIT",
        "principals[]": NONE,
        owner: NONE,
        activity: NONE,
        target: NONE,
      },
      headers,
    }),
  "DELETE /api/v5-4/caches": async (request, headers) =>
    request.delete<unknown>(`${api}/v5-4/caches`, { headers }),
  "POST /api/analytics": async (request, headers) =>
    request.post<unknown>(`${api}/analytics`, {
      data: { url: "https://www.apereo.org/", type: "link" },
      headers,
    }),
};

test.describe("CSRF token on the REST API", () => {
  for (const [name, send] of Object.entries(PROTECTED)) {
    test(`${name} is refused without the token and accepted with it`, async ({
      request,
    }) => {
      await loginViaApi(request, config.users.admin);
      const refused = await send(request, {});
      expect(refused.status(), `${name} without the token`).toBe(403);

      const accepted = await send(request, await sessionCsrfHeaders(request));
      expect(accepted.status(), `${name} with the token`).not.toBe(403);
    });
  }

  test("a token from another session is refused", async ({
    request,
    playwright,
  }) => {
    const other = await playwright.request.newContext();
    try {
      await loginViaApi(other, config.users.admin);
      const otherHeaders = await sessionCsrfHeaders(other);
      await loginViaApi(request, config.users.admin);
      const response = await postToLayout(request, otherHeaders);
      expect(response.status()).toBe(403);
    } finally {
      await other.dispose();
    }
  });

  test("a Bearer token stands in for the CSRF token", async ({ request }) => {
    await loginViaApi(request, config.users.admin);
    const userinfo = await request.get<unknown>(`${api}/v5-1/userinfo`);
    expect(userinfo.status()).toBe(200);
    const body = await userinfo.text();
    const response = await postToLayout(request, {
      Authorization: `Bearer ${body.trim()}`,
    });
    expect(response.status()).not.toBe(403);
  });

  test("the OIDC userinfo endpoint takes a POST without the token", async ({
    request,
  }) => {
    await loginViaApi(request, config.users.admin);
    const response = await request.post<unknown>(`${api}/v5-1/userinfo`);
    expect(response.status()).toBe(200);
  });
});
