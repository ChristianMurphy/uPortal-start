import { test, expect } from "@playwright/test";
import { loginViaPage } from "../utils/ux-general-utils";
import { config } from "../../general-config";

/*
 * cas-proxy-test-portlet asks the portal for a CAS proxy ticket (the
 * casProxyTicket user attribute), validates it with CAS and asks CAS for a
 * proxy ticket of its own.  With CAS (AUTH_MODE=cas) that has to work end to
 * end; with local login there is no CAS session, and the portlet says so.
 */
const EXPECTED_RESULT = {
  cas: "Proxy ticket validated",
  local: "Failed to validated proxy ticket: No proxy ticket in UserInfo map",
}[config.authMode];

test("proxy ticket portlet reports the result for the portal's authMode", async ({
  page,
}) => {
  await loginViaPage(page, config.users.student);
  await page.goto(`${config.url}p/portlet-cas-test`);
  const result = page.locator(".up-portlet-wrapper p", {
    hasText: "proxy ticket",
  });
  await expect(result).toHaveText(EXPECTED_RESULT);
});
