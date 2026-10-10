// Provided by Node at run time; declared here so tsc does not need @types/node.
declare const process: { env: Record<string, string | undefined> };

export type AuthMode = "local" | "cas";

// How the portal under test signs users in:  set AUTH_MODE=cas for a portal built with
// -PauthMode=cas, and CAS_BASE_URL (with a trailing slash) when CAS is not the development
// server on port 8090 (docs/authentication.md).
const authMode: AuthMode = process.env.AUTH_MODE === "cas" ? "cas" : "local";

export const config = {
  // Set PORTAL_BASE_URL (with a trailing slash) to test a portal on another port or host.
  url: process.env.PORTAL_BASE_URL ?? "http://localhost:8080/uPortal/",
  authMode,
  casUrl: process.env.CAS_BASE_URL ?? "http://localhost:8090/cas/",
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
  },
  formats: {
    auditDateTimeTz:
      /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) \+(\d{4})$/,
  },
};
