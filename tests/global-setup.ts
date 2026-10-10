import { request } from "@playwright/test";
import { config } from "./general-config";

/*
 * Renders the guest page and logs each test user in once, before the
 * first test. A portal that has just started builds a user's layout and
 * compiles its stylesheets on that user's first request, which can take
 * longer than a test's 30-second timeout: the tests that ran first then
 * failed and passed on their retry, which fails a CI run now that flaky
 * tests count as failures (MOD-D29). Each request here may take 3 minutes,
 * and the run stops if the portal does not answer as expected.
 */
const TIMEOUT = 180_000;

export default async function globalSetup(): Promise<void> {
  const guest = await request.newContext();
  try {
    const response = await guest.get<unknown>(config.url, { timeout: TIMEOUT });
    if (!response.ok()) {
      throw new Error(`Guest page ${config.url}: HTTP ${response.status()}`);
    }
  } finally {
    await guest.dispose();
  }
  for (const user of Object.values(config.users)) {
    const context = await request.newContext();
    try {
      const url = `${config.url}Login?userName=${user.username}&password=${user.password}`;
      const response = await context.get<unknown>(url, { timeout: TIMEOUT });
      const body = await response.text();
      if (!response.ok() || !body.includes(user.displayName)) {
        throw new Error(
          `Login of ${user.username}: HTTP ${response.status()}, ` +
            `"${user.displayName}" ${body.includes(user.displayName) ? "shown" : "not shown"}`,
        );
      }
    } finally {
      await context.dispose();
    }
  }
}
