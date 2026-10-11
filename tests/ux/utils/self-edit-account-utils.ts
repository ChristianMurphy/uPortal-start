import { APIRequestContext } from "@playwright/test";
import {
  Account,
  grantUsersPermission,
  importLocalAccount,
} from "./local-account-utils";

/*
 * Local accounts for the self edit account specs. The quickstart data lets no
 * group edit its own account, so each test imports a new local account with
 * the UP_USERS EDIT_USER permission on SELF and EDIT_USER_ATTRIBUTE on the
 * five editable attributes (see local-account-utils.ts). That way no test
 * changes a shared account's password, and no test depends on another.
 */
export type { Account } from "./local-account-utils";
export { exportedAccount } from "./local-account-utils";

export const EDITABLE_ATTRIBUTES = [
  "title",
  "department",
  "organization",
  "mail",
  "telephoneNumber",
];

/**
 * A new local account with the password "student", the permissions to edit
 * itself and its five attributes, and a department of "Playwright
 * Department".
 */
export async function createEditableAccount(
  admin: APIRequestContext,
): Promise<Account> {
  const account = await importLocalAccount(admin, "selfedit", "Selma", {
    department: "Playwright Department",
  });
  await grantUsersPermission(admin, account.username, "EDIT_USER", ["SELF"]);
  await grantUsersPermission(
    admin,
    account.username,
    "EDIT_USER_ATTRIBUTE",
    EDITABLE_ATTRIBUTES,
  );
  return account;
}
