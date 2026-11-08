import { request, APIRequestContext, FullConfig } from "@playwright/test";
import { config } from "./general-config";
import { importOwnUsers } from "./ux/utils/own-users";

/*
 * Renders the guest page and logs each test user in once, before the
 * first test. A portal that has just started builds a user's layout and
 * compiles its stylesheets on that user's first request, which can take
 * longer than a test's 30-second timeout: the tests that ran first then
 * failed and passed on their retry, which fails a CI run now that flaky
 * tests count as failures (MOD-D29). Each request here may take 3 minutes,
 * and the run stops if the portal does not answer as expected. Then it
 * imports the users of a spec's own for each worker slot
 * (ux/utils/own-users.ts) and logs each of them in once too.
 */
const TIMEOUT = 180_000;

async function logIn(
  context: APIRequestContext,
  user: Record<string, string>,
): Promise<void> {
  const url = `${config.url}Login?userName=${user.username}&password=${user.password}`;
  const response = await context.get<unknown>(url, { timeout: TIMEOUT });
  const body = await response.text();
  if (!response.ok() || !body.includes(user.displayName)) {
    throw new Error(
      `Login of ${user.username}: HTTP ${response.status()}, ` +
        `"${user.displayName}" ${body.includes(user.displayName) ? "shown" : "not shown"}`,
    );
  }
}

async function logInOnce(user: Record<string, string>): Promise<void> {
  const context = await request.newContext();
  try {
    await logIn(context, user);
  } finally {
    await context.dispose();
  }
}

export default async function globalSetup(
  fullConfig: FullConfig,
): Promise<void> {
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
    await logInOnce(user);
  }
  const admin = await request.newContext();
  try {
    await logIn(admin, config.users.admin);
    for (const user of await importOwnUsers(admin, fullConfig.workers)) {
      await logInOnce(user);
    }
  } finally {
    await admin.dispose();
  }
}
