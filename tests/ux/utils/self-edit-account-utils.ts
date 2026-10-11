import { expect, APIRequestContext } from "@playwright/test";
import { config } from "../../general-config";

/*
 * Local accounts for the self edit account specs. The quickstart data lets no
 * group edit its own account, so each test imports a new local account with
 * the UP_USERS EDIT_USER permission on SELF and EDIT_USER_ATTRIBUTE on the
 * five editable attributes, through /api/import as admin. That way no test
 * changes a shared account's password, and no test depends on another.
 */
// Provided by Node at run time; declared here so tsc does not need @types/node.
declare const Buffer: { from(text: string): Uint8Array };

export const EDITABLE_ATTRIBUTES = [
  "title",
  "department",
  "organization",
  "mail",
  "telephoneNumber",
];

/** The hash of "student" from the quickstart data's student account. */
const STUDENT_PASSWORD_HASH = "(MD5)mhmjKvf2F3gPizS9DrA+CsFmqj74oTSb";

// A type, not an interface, so it fits the helpers' Record<string, string>
export type Account = {
  username: string;
  password: string;
  displayName: string;
};

let accountCount = 0;

function userXml(username: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<user xmlns="https://source.jasig.org/schemas/uportal/io/user" version="4.0" username="${username}">
    <default-user>defaultTemplateUser</default-user>
    <password>${STUDENT_PASSWORD_HASH}</password>
    <attribute><name>givenName</name><value>Selma</value></attribute>
    <attribute><name>sn</name><value>${username}</value></attribute>
    <attribute><name>mail</name><value>${username}@example.org</value></attribute>
    <attribute><name>department</name><value>Playwright Department</value></attribute>
</user>`;
}

function permissionSetXml(
  username: string,
  activity: string,
  targets: string[],
): string {
  const targetXml = targets
    .map(
      (target) =>
        `<target permission-type="GRANT"><literal>${target}</literal></target>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<permission-set script="classpath://org/jasig/portal/io/import-permission_set_v3-1.crn">
    <owner>UP_USERS</owner>
    <principal-type>org.apereo.portal.security.IPerson</principal-type>
    <principal><literal>${username}</literal></principal>
    <activity>${activity}</activity>
    ${targetXml}
</permission-set>`;
}

async function importXml(
  admin: APIRequestContext,
  name: string,
  xml: string,
): Promise<void> {
  const response = await admin.post<unknown>(`${config.url}api/import`, {
    multipart: {
      file: { name, mimeType: "text/xml", buffer: Buffer.from(xml) },
    },
  });
  expect(response.status(), `import of ${name}`).toEqual(200);
}

/**
 * A new local account with the password "student", the permissions to edit
 * itself and its five attributes, and a department of "Playwright
 * Department".
 */
export async function createEditableAccount(
  admin: APIRequestContext,
): Promise<Account> {
  accountCount += 1;
  const username = `selfedit-${Date.now()}-${accountCount}`;
  await importXml(admin, `${username}.user.xml`, userXml(username));
  await importXml(
    admin,
    `${username}-edit-user.permission-set.xml`,
    permissionSetXml(username, "EDIT_USER", ["SELF"]),
  );
  await importXml(
    admin,
    `${username}-edit-attributes.permission-set.xml`,
    permissionSetXml(username, "EDIT_USER_ATTRIBUTE", EDITABLE_ATTRIBUTES),
  );
  return {
    username,
    password: config.users.student.password,
    displayName: `Selma ${username}`,
  };
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
