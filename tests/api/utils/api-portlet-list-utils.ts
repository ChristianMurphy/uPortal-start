import { expect, APIRequestContext } from "@playwright/test";
import { config } from "../../general-config";

/*
 * Creates a portlet-list with a given name, and returns the portlet-list id.
 */
export async function createPortletList(
  request: APIRequestContext,
  portletListName: string,
  items: Array<Record<string, string>>
): Promise<string> {
  const response = await request.post<unknown>(`${config.url}api/portlet-list/`, {
    data: {
      name: portletListName,
      items: items,
    },
  });
  const locationHeader: string = response.headers().location;
  expect(locationHeader).not.toEqual(undefined);
  expect(locationHeader).not.toHaveLength(0);
  expect(response.status()).toEqual(201);
  return locationHeader;
}

/*
 * Creates a portlet-list with a given name, and returns the portlet-list id.
 */
export async function createPortletListWithOwner(
  request: APIRequestContext,
  portletListName: string,
  ownerUsername: string,
  items: Array<Record<string, string>>
): Promise<string> {
  const response = await request.post<unknown>(`${config.url}api/portlet-list/`, {
    data: {
      name: portletListName,
      ownerUsername: ownerUsername,
      items: items,
    },
  });
  const locationHeader: string = response.headers().location;
  expect(locationHeader).not.toEqual(undefined);
  expect(locationHeader).not.toHaveLength(0);
  expect(response.status()).toEqual(201);
  return locationHeader;
}

/*
 * Update a portlet-list with a given name, and optionally, a new array of items.
 */
export async function updatePortletList(
  request: APIRequestContext,
  portletListUuid: string,
  portletListName: string,
  items: Array<Record<string, string>>
): Promise<void> {
  const payload = {
    name: portletListName,
    items: items,
  };

  const response = await request.put<unknown>(
    `${config.url}api/portlet-list/${portletListUuid}`,
    {
      data: payload,
    }
  );
  expect(response.status()).toEqual(200);
}

/*
 * Remove a portlet-list
 */
export async function removePortletList(
  request: APIRequestContext,
  portletListUuid: string
): Promise<void> {
  const response = await request.delete<unknown>(
    `${config.url}api/portlet-list/${portletListUuid}`
  );
  expect(response.status()).toEqual(200);
}

/*
 * Returns all portlet-lists for the logged in user
 */
export async function getAllPortletLists(
  request: APIRequestContext
): Promise<Array<Record<string, unknown>>> {
  // Future improvement - instead of 'unknown', leverage interfaces with a tool like https://zod.dev/
  const response = await request.get<Array<Record<string, unknown>>>(
    `${config.url}api/portlet-list/`
  );
  expect(response.status()).toEqual(200);
  const json = await response.json();
  return json;
}

/*
 * Returns the specific portlet-list for the logged in user
 */
export async function getPortletList(
  request: APIRequestContext,
  id: string
): Promise<Record<string, unknown>> {
  // Future improvement - instead of 'unknown', leverage interfaces with a tool like https://zod.dev/
  const response = await request.get<Record<string, unknown>>(
    `${config.url}api/portlet-list/${id}`
  );
  expect(response.status()).toEqual(200);
  const json = await response.json();
  return json;
}

/*
 * POST a portlet-list that fails validation. `rule` is the end of the message, such as
 * "must have 1 to 100 characters and no spaces."
 */
export async function createPortletListFailsWith409(
  request: APIRequestContext,
  inputTypeToFail: string,
  rule: string,
  ownerUsername: string,
  portletListName: string,
  items: Array<Record<string, string>>
): Promise<void> {
  const responseCreation = await request.post<unknown>(
    `${config.url}api/portlet-list/`,
    {
      data: {
        ownerUsername: ownerUsername,
        name: portletListName,
        items: items,
      },
    }
  );
  expect(responseCreation.status()).toEqual(409);
  expect(await responseCreation.json()).toEqual({
    message: `Specified ${inputTypeToFail} ${rule}`,
  });
}

/*
 * PUT a portlet-list change that fails validation. `rule` is the end of the message.
 */
export async function updatePortletListFailsWith409(
  request: APIRequestContext,
  portletListUuid: string,
  inputTypeToFail: string,
  rule: string,
  ownerUsername: string,
  portletListName: string,
  items: Array<Record<string, string>>
): Promise<void> {
  const responseCreation = await request.put<unknown>(
    `${config.url}api/portlet-list/${portletListUuid}`,
    {
      data: {
        ownerUsername: ownerUsername,
        name: portletListName,
        items: items,
      },
    }
  );
  expect(responseCreation.status()).toEqual(409);
  expect(await responseCreation.json()).toEqual({
    message: `Specified ${inputTypeToFail} ${rule}`,
  });
}

/*
 * Epoch milliseconds of a portlet-list audit timestamp such as
 * "2026-10-10 06:01:39 +0000" (config.formats.auditDateTimeTz).
 */
function auditTimestampMillis(value: unknown): number {
  const match =
    typeof value === "string"
      ? config.formats.auditDateTimeTz.exec(value)
      : undefined;
  if (!match) throw new Error(`Not an audit timestamp: ${String(value)}`);
  const [, year, month, day, hour, minute, second, zone] = match;
  return Date.parse(
    `${year}-${month}-${day}T${hour}:${minute}:${second}` +
      `+${zone.slice(0, 2)}:${zone.slice(2)}`
  );
}

/*
 * Assert that `current` equals `expected` in every field but updatedOn.
 *
 * The server stamps updatedOn on every successful PUT, at one-second
 * resolution, so two writes a few milliseconds apart get the same value
 * unless a second boundary falls between them. updatedOn must therefore
 * be no earlier than `previousUpdatedOn` (the value written before the
 * PUTs under test) and later by at most the whole seconds the caller
 * measured around those writes (`elapsedMs`).
 */
export function expectEqualExceptUpdatedOn(
  current: Record<string, unknown>,
  expected: Record<string, unknown>,
  previousUpdatedOn: unknown,
  elapsedMs: number
): void {
  expect(current).toEqual({
    ...expected,
    updatedOn: expect.stringMatching(config.formats.auditDateTimeTz),
  });
  const advancedBy =
    auditTimestampMillis(current.updatedOn) -
    auditTimestampMillis(previousUpdatedOn);
  expect(advancedBy).toBeGreaterThanOrEqual(0);
  expect(advancedBy).toBeLessThanOrEqual(Math.ceil(elapsedMs / 1000) * 1000);
}
