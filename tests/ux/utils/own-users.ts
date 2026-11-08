import { test, APIRequestContext } from "@playwright/test";
import { config } from "../../general-config";
import { Account, importNamedAccount } from "./local-account-utils";

export type { Account } from "./local-account-utils";

/*
 * Users of a spec's own (MOD-I380). A spec that changes what the portal saves
 * for the user it signs in as, such as the layout or the language, signs in
 * as one of these. With a shared user, a spec that signed in as the same
 * user at the same time saw the change, and on PostgreSQL its sign-in failed
 * with HTTP 500 when it saved the layout in the same moment as the change.
 *
 * global-setup.ts imports each one for every worker slot before the first
 * test, one import after another: imports that overlap can deadlock on
 * MariaDB. The worker's parallel index is part of the name, so two workers
 * that run at the same time never sign in as the same one, and neither do two
 * copies of a spec under --repeat-each. Each is a local account in no group,
 * so its only tab is Welcome (Bookmarks, Calendar and My Drives).
 */
const OWN_USERS = {
  favorites: "Fay",
  options: "Olive",
  language: "Lena",
  channel: "Cora",
} as const;

export type OwnUser = keyof typeof OWN_USERS;

/** The running worker's account of that name. */
export function ownUser(name: OwnUser): Account {
  const username = `e2e-${name}-${test.info().parallelIndex}`;
  return {
    username,
    password: config.users.student.password,
    displayName: `${OWN_USERS[name]} ${username}`,
  };
}

/** Imports every own user for each of the run's worker slots, as admin. */
export async function importOwnUsers(
  admin: APIRequestContext,
  workers: number,
): Promise<Account[]> {
  const accounts: Account[] = [];
  for (const [name, givenName] of Object.entries(OWN_USERS)) {
    for (let slot = 0; slot < workers; slot++) {
      const username = `e2e-${name}-${slot}`;
      accounts.push(await importNamedAccount(admin, username, givenName));
    }
  }
  return accounts;
}
