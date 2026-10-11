import { test, expect, APIRequestContext } from "@playwright/test";
import { config } from "../general-config";
import { loginViaApi, logoutViaApi } from "../ux/utils/ux-general-utils";

/*
 * The REST API behind the Background Preference web component (uPortal
 * BackgroundPreferenceRESTController): GET
 * /api/v6-0/background-preference/{fname} lists the backgrounds the user may
 * choose and the one they chose; PUT saves a choice, which must be one of the
 * offered images (or null for none). The choice is stored on the user's own
 * portlet entity of the channel, where the portlet kept it. Guests get 401,
 * and the PUT needs the CSRF token the portal puts on web-component
 * elements. No browser: these run in the database harness too.
 */
const API = `${config.url}api/v6-0/background-preference/background-preference`;
// A page with a web-component element, which carries the CSRF header and token
const ELEMENT_PAGE = `${config.url}p/favorites`;
const ELEMENT = "up-favorites";
const IMAGES = `${new URL(config.url).pathname}media/skins/common/backgroundImages`;

interface BackgroundPreference {
  containerSelector: string;
  images: { url: string; thumbnailUrl: string; caption: string }[];
  // null when the user has chosen none
  selected: string | null;
}

/** The CSRF header and token on the page's web-component element. */
async function csrfHeaders(
  request: APIRequestContext,
): Promise<Record<string, string>> {
  const response = await request.get<unknown>(ELEMENT_PAGE);
  const html = await response.text();
  const element = new RegExp(`<${ELEMENT}\\b[^>]*>`).exec(html)?.[0] ?? "";
  const header = /\scsrf-header="([^"]+)"/.exec(element)?.[1] ?? "";
  const token = /\scsrf-token="([^"]+)"/.exec(element)?.[1] ?? "";
  expect(header, `csrf-header on ${ELEMENT}`).not.toBe("");
  expect(token, `csrf-token on ${ELEMENT}`).not.toBe("");
  return { [header]: token };
}

/** Saves a choice; without an image, the body has no selected value: none. */
async function choose(
  request: APIRequestContext,
  selected?: string,
): Promise<number> {
  const response = await request.put<BackgroundPreference>(API, {
    headers: await csrfHeaders(request),
    data: { selected },
  });
  return response.status();
}

/** The URL of the chosen image, as GET answers it. */
async function selectedImage(
  request: APIRequestContext,
): Promise<BackgroundPreference["selected"]> {
  const response = await request.get<BackgroundPreference>(API);
  expect(response.status()).toBe(200);
  const { selected } = await response.json();
  return selected;
}

test.describe("Background Preference API as a guest", () => {
  test("refuses a request without a session", async ({ request }) => {
    const response = await request.get<unknown>(API);

    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({
      status: 401,
      message: "Sign in to choose a background",
    });
  });
});

test.describe("Background Preference API as a user", () => {
  test.beforeEach(async ({ request }) => {
    await loginViaApi(request, config.users.student);
    expect(await choose(request)).toBe(200);
  });

  test.afterEach(async ({ request }) => {
    expect(await choose(request)).toBe(200);
    await logoutViaApi(request);
  });

  test("lists the quickstart's backgrounds, none chosen", async ({
    request,
  }) => {
    const response = await request.get<BackgroundPreference>(API);

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const { selected, ...offered } = await response.json();
    expect(selected).toBeNull();
    expect(offered).toEqual({
      containerSelector: "body.portal #portalPageBody::before",
      images: ["galaxy", "mountain", "nebula"].map((name) => ({
        url: `${IMAGES}/${name}.jpg`,
        thumbnailUrl: `${IMAGES}/thumbnails/${name}.jpg`,
        caption: name.charAt(0).toUpperCase() + name.slice(1),
      })),
    });
  });

  test("saves an offered image and clears it with null", async ({
    request,
  }) => {
    expect(await choose(request, `${IMAGES}/mountain.jpg`)).toBe(200);
    expect(await selectedImage(request)).toBe(`${IMAGES}/mountain.jpg`);

    expect(await choose(request)).toBe(200);
    expect(await selectedImage(request)).toBeNull();
  });

  test("refuses an image that is not offered", async ({ request }) => {
    expect(await choose(request, `${IMAGES}/nebula.jpg`)).toBe(200);

    expect(await choose(request, "https://example.org/elsewhere.jpg")).toBe(
      400,
    );
    expect(await choose(request, `${IMAGES}/thumbnails/galaxy.jpg`)).toBe(400);

    expect(await selectedImage(request)).toBe(`${IMAGES}/nebula.jpg`);
  });

  test("refuses a choice without the CSRF token", async ({ request }) => {
    const missing = await request.put<unknown>(API, {
      data: { selected: `${IMAGES}/galaxy.jpg` },
    });
    const forged = await request.put<unknown>(API, {
      headers: { "X-CSRF-TOKEN": "forged" },
      data: { selected: `${IMAGES}/galaxy.jpg` },
    });

    expect(missing.status()).toBe(403);
    expect(forged.status()).toBe(403);
    expect(await selectedImage(request)).toBeNull();
  });

  test("answers 404 for a channel that is not a background preference", async ({
    request,
  }) => {
    const response = await request.get<unknown>(
      `${config.url}api/v6-0/background-preference/favorites`,
    );

    expect(response.status()).toBe(404);
  });
});
