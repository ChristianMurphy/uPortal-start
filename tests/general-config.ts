// Provided by Node at run time; declared here so tsc does not need @types/node.
declare const process: { env: Record<string, string | undefined> };

export type AuthMode = "local" | "cas";

// How the portal under test signs users in:  set AUTH_MODE=cas for a portal built with
// -PauthMode=cas, and CAS_BASE_URL (with a trailing slash) when CAS is not the development
// server on port 8090 (docs/authentication.md).
const authMode: AuthMode = process.env.AUTH_MODE === "cas" ? "cas" : "local";

const DATABASES = [
  "hsqldb",
  "mariadb",
  "mysql",
  "oracle",
  "postgres",
  "sqlserver",
] as const;
export type Database = (typeof DATABASES)[number];

/**
 * The database the portal under test runs on, from UPORTAL_DB_VENDOR: a name
 * from tests/db/vendors such as sqlserver-2025 or oracle-xe-21. The DB
 * harness and G-migrate set it; elsewhere it is unset and the result is
 * undefined. An unknown name throws, so a new vendor can't pass unnoticed.
 */
function parseDatabase(vendor: string | undefined): Database | undefined {
  if (vendor === undefined || vendor === "") return undefined;
  const database = DATABASES.find((name) =>
    new RegExp(`^${name}(-xe)?(-[0-9.]+)?$`).test(vendor),
  );
  if (database === undefined) {
    throw new Error(`Unknown UPORTAL_DB_VENDOR '${vendor}'`);
  }
  return database;
}

export const config = {
  // Set PORTAL_BASE_URL (with a trailing slash) to test a portal on another port or host.
  url: process.env.PORTAL_BASE_URL ?? "http://localhost:8080/uPortal/",
  authMode,
  casUrl: process.env.CAS_BASE_URL ?? "http://localhost:8090/cas/",
  database: parseDatabase(process.env.UPORTAL_DB_VENDOR),
  users: {
    admin: {
      id: "13",
      username: "admin",
      // eslint-disable-next-line sonarjs/no-hardcoded-credentials
      password: "admin",
      displayName: "Amy Administrator",
    },
    staff: {
      id: "xx",
      username: "staff",
      // eslint-disable-next-line sonarjs/no-hardcoded-credentials
      password: "staff",
      displayName: "Samuel Staff",
    },
    faculty: {
      id: "xx",
      username: "faculty",
      // eslint-disable-next-line sonarjs/no-hardcoded-credentials
      password: "faculty",
      displayName: "Felicia Faculty",
    },
    student: {
      id: "29",
      username: "student",
      // eslint-disable-next-line sonarjs/no-hardcoded-credentials
      password: "student",
      displayName: "Steven Student",
    },
    // A student whose layout only the Reset My Layout UX spec changes: every
    // sign-in of a user lets the user's other sessions reload the layout
    riley: {
      id: "xx",
      username: "riley",
      // eslint-disable-next-line sonarjs/no-hardcoded-credentials
      password: "riley",
      displayName: "Riley Reset",
    },
    // The language tests sign in as the developer, since they change the
    // user's saved language, which a parallel spec would see at its sign-in.
    // The Reset My Layout API spec changes only the developer's layout and
    // checks nothing that depends on the language.
    developer: {
      id: "xx",
      username: "developer",
      // eslint-disable-next-line sonarjs/no-hardcoded-credentials
      password: "developer",
      displayName: "Developer User",
    },
  },
  formats: {
    auditDateTimeTz:
      /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) \+(\d{4})$/,
  },
};
