import { test, expect } from "@playwright/test";
import { config } from "../general-config";
import { loginViaApi } from "../ux/utils/ux-general-utils";

/*
 * The entity selector of Groups, Permissions and Portlet administration
 * searches /api/entities.json. GroupListHelperImpl.search asks the group
 * service for each entity type with SearchMethod.CONTAINS_CI, so a part of a
 * name in any case finds the entity. Groups and people are found by their
 * group stores, portlets by PortletDefinitionSearcher (uPortal-groups-local).
 */
interface EntityBean {
  name: string;
  entityType: string;
}

interface EntitySearch {
  jsonEntityBeanList: EntityBean[];
}

function entitiesUrl(entityType: string, q: string): string {
  const query = new URLSearchParams({ q, "entityType[]": entityType });
  return `${config.url}api/entities.json?${query.toString()}`;
}

test("finds a group by part of its name in another case", async ({
  request,
}) => {
  await loginViaApi(request, config.users.admin);
  const response = await request.get<EntitySearch>(
    entitiesUrl("group", "aDMINISTRAT"),
  );
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.jsonEntityBeanList.map((entity) => entity.name)).toContain(
    "Portal Administrators",
  );
});

/*
 * PortletDefinitionSearcher maps the _CI search methods to its searches that
 * ignore case. Before MOD-I203 it threw GroupsException("Unknown search
 * type") for the CONTAINS_CI the entity selector asks for, and the search
 * answered HTTP 500, as it does in 5.17.
 */
test("finds a portlet by part of its name in another case", async ({
  request,
}) => {
  await loginViaApi(request, config.users.admin);
  const response = await request.get<EntitySearch>(
    entitiesUrl("portlet", "oOKMARK"),
  );
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.jsonEntityBeanList.map((entity) => entity.name)).toContain(
    "Bookmarks",
  );
});
