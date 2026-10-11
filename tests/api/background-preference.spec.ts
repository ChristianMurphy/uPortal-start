import { expect, APIRequestContext } from "@playwright/test";
import { config } from "../general-config";
import {
  loginViaApi,
  logoutViaApi,
  sessionCsrfHeaders,
} from "../ux/utils/ux-general-utils";
import { test } from "./utils/csrf-request";

/*
 * The REST API behind the Background Preference web component (uPortal
 * BackgroundPreferenceRESTController): GET
 * /api/v6-0/background-preference/{fname} lists the backgrounds the user may
 * choose and the one they chose; PUT saves a choice, which must be one of the
 * offered images (or null for none). The choice is stored on the user's own
 * portlet entity of the channel, where the portlet kept it. Guests get 401,
 * and the PUT needs the session's CSRF token, which this spec's `request`
 * sends (utils/csrf-request.ts). No browser: these run in the database
 * harness too.
 */
const API = `${config.url}api/v6-0/background-preference/background-preference`;
const IMAGES = `${new URL(config.url).pathname}media/skins/common/backgroundImages`;

interface BackgroundPreference {
  containerSelector: string;
  images: { url: string; thumbnailUrl: string; caption: string }[];
  // null when the user has chosen none
  selected: string | null;
}

/** Saves a choice; without an image, the body has no selected value: none. */
async function choose(
  request: APIRequestContext,
  selected?: string,
): Promise<number> {
  const response = await request.put<BackgroundPreference>(API, {
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

  test("refuses a guest's choice, CSRF token and all", async ({ request }) => {
    // The guest page gives the guest a session; the request sends its token
    const guestPage = await request.get<unknown>(config.url);
    expect(guestPage.status()).toBe(200);

    const status = await choose(request, `${IMAGES}/galaxy.jpg`);

    expect(status).toBe(401);
  });
});

test.describe("Background Preference API as a user", () => {
  test.beforeEach(async ({ request }) => {
    // Not the student: the UX spec changes the student's background, and the two
    // spec files can run at the same time
    await loginViaApi(request, config.users.faculty);
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
    const [header = "X-CSRF-TOKEN"] = Object.keys(
      await sessionCsrfHeaders(request),
    );
    const missing = await request.put<unknown>(API, {
      headers: { [header]: "" },
      data: { selected: `${IMAGES}/galaxy.jpg` },
    });
    const forged = await request.put<unknown>(API, {
      headers: { [header]: "forged" },
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
