import { test as base, APIRequestContext } from "@playwright/test";
import { sessionCsrfHeaders } from "../../ux/utils/ux-general-utils";

type Headers = Record<string, string>;

/* The session's CSRF header, unless the request sets that header itself */
async function withCsrfHeaders(
  request: APIRequestContext,
  headers?: Headers
): Promise<Headers> {
  return { ...(await sessionCsrfHeaders(request)), ...headers };
}

/*
 * `test` for the API specs:  its `request` sends the session's CSRF token with
 * every POST, PUT, PATCH and DELETE, as the portal's own scripts do, since
 * uPortal requires it under /api (MOD-I130).  tests/api/csrf.spec.ts checks
 * that the token is required.
 */
export const test = base.extend({
  request: async ({ request }, use) => {
    const post = request.post.bind(request);
    const put = request.put.bind(request);
    const patch = request.patch.bind(request);
    const remove = request.delete.bind(request);
    request.post = async (url, options) =>
      post(url, {
        ...options,
        headers: await withCsrfHeaders(request, options?.headers),
      });
    request.put = async (url, options) =>
      put(url, {
        ...options,
        headers: await withCsrfHeaders(request, options?.headers),
      });
    request.patch = async (url, options) =>
      patch(url, {
        ...options,
        headers: await withCsrfHeaders(request, options?.headers),
      });
    request.delete = async (url, options) =>
      remove(url, {
        ...options,
        headers: await withCsrfHeaders(request, options?.headers),
      });
    await use(request);
  },
});
