import { expect, APIRequestContext } from "@playwright/test";
import { config } from "../../general-config";
import { sessionCsrfHeaders } from "./ux-general-utils";

/*
 * Local accounts for the account and password specs. Each test imports its
 * own account through /api/import as admin, so no test changes a shared
 * account's password and no test depends on another. Local accounts have no
 * REST delete (/api/entity/user removes only portal user records), so the
 * accounts stay; CI starts from a fresh database.
 */

// Provided by Node at run time; declared here so tsc does not need @types/node.
declare const Buffer: { from(text: string): Uint8Array };

/** The hash of "student" from the quickstart data's student account. */
const STUDENT_PASSWORD_HASH = "(MD5)mhmjKvf2F3gPizS9DrA+CsFmqj74oTSb";

// A type, not an interface, so it fits the login helpers' Record<string, string>
export type Account = {
  username: string;
  password: string;
  displayName: string;
};

let accountCount = 0;

/**
 * Import one entity file as admin, with the session's CSRF token (MOD-I130);
 * /api/import answers 200 when it worked.
 */
export async function importXml(
  admin: APIRequestContext,
  name: string,
  xml: string,
): Promise<void> {
  const response = await admin.post<unknown>(`${config.url}api/import`, {
    headers: await sessionCsrfHeaders(admin),
    multipart: {
      file: { name, mimeType: "text/xml", buffer: Buffer.from(xml) },
    },
  });
  expect(response.status(), `import of ${name}`).toEqual(200);
}

/**
 * A new local account named "<prefix>-<time>-<n>" with the password
 * "student", the given name `givenName`, the mail address
 * "<username>@example.org" and the extra attributes given.
 */
export async function importLocalAccount(
  admin: APIRequestContext,
  prefix: string,
  givenName: string,
  attributes: Record<string, string> = {},
): Promise<Account> {
  accountCount += 1;
  const username = `${prefix}-${Date.now()}-${accountCount}`;
  const attributeXml = Object.entries(attributes)
    .map(
      ([name, value]) =>
        `<attribute><name>${name}</name><value>${value}</value></attribute>`,
    )
    .join("\n    ");
  await importXml(
    admin,
    `${username}.user.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>
<user xmlns="https://source.jasig.org/schemas/uportal/io/user" version="4.0" username="${username}">
    <default-user>defaultTemplateUser</default-user>
    <password>${STUDENT_PASSWORD_HASH}</password>
    <attribute><name>givenName</name><value>${givenName}</value></attribute>
    <attribute><name>sn</name><value>${username}</value></attribute>
    <attribute><name>mail</name><value>${username}@example.org</value></attribute>
    ${attributeXml}
</user>`,
  );
  return {
    username,
    password: config.users.student.password,
    displayName: `${givenName} ${username}`,
  };
}

/** Grant one UP_USERS activity on the given targets to a single user. */
export async function grantUsersPermission(
  admin: APIRequestContext,
  username: string,
  activity: string,
  targets: string[],
): Promise<void> {
  const targetXml = targets
    .map(
      (target) =>
        `<target permission-type="GRANT"><literal>${target}</literal></target>`,
    )
    .join("");
  await importXml(
    admin,
    `${username}-${activity}.permission-set.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>
<permission-set script="classpath://org/jasig/portal/io/import-permission_set_v3-1.crn">
    <owner>UP_USERS</owner>
    <principal-type>org.apereo.portal.security.IPerson</principal-type>
    <principal><literal>${username}</literal></principal>
    <activity>${activity}</activity>
    ${targetXml}
</permission-set>`,
  );
}

/** The local account as the export API sees it. */
export async function exportedAccount(
  admin: APIRequestContext,
  username: string,
): Promise<string> {
  const response = await admin.get<unknown>(
    `${config.url}api/entity/user/${username}`,
  );
  expect(response.status()).toEqual(200);
  return response.text();
}

/** The value of one attribute of the local account, if it has one. */
async function accountAttribute(
  admin: APIRequestContext,
  username: string,
  name: string,
): Promise<string | undefined> {
  const xml = await exportedAccount(admin, username);
  return new RegExp(`<name>${name}</name>\\s*<value>([^<]+)</value>`).exec(
    xml,
  )?.[1];
}

/** The account's password reset token, if it has one. */
export async function loginToken(
  admin: APIRequestContext,
  username: string,
): Promise<string | undefined> {
  return accountAttribute(admin, username, "loginToken");
}

/** When the account's password reset token was issued, if it was dated. */
export async function loginTokenIssued(
  admin: APIRequestContext,
  username: string,
): Promise<string | undefined> {
  return accountAttribute(admin, username, "loginTokenIssued");
}
