// Query-count budgets (MOD-D29): how many SQL statements uPortal runs for each key request,
// against the budgets in budgets.json. See docs/query-budgets.md.
//
//   node tests/query-budget/query-budget.mjs <sql log> [--record]
//
// The portal runs with p6spy in front of its JDBC driver (tests/query-budget/run.sh), which logs
// every statement through logback with the thread that ran it. A request's statements are the
// lines its Tomcat thread (http-nio-*) and the portlet threads it starts (uP-PortletExec-*) add to
// the log while it runs; the background jobs (uP-TaskExec-*, uP-TaskSched-*, uP-LockExec-*) and
// JGroups are not counted.
//
// Each request is made three times in a row. "first" is the count of the first time (the order of
// REQUESTS is fixed, so what is cached by then is too) and "warm" the count of the third. A count
// above its budget plus the tolerance fails; one far below it is reported, so the budget can be
// lowered. --record writes the observed counts to budgets.json instead.

/* global fetch */

import console from "node:console";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.env.PORTAL_BASE_URL ?? "http://localhost:8080/uPortal/";
const BUDGETS = new URL("budgets.json", import.meta.url);
const [logFile, ...flags] = process.argv.slice(2);
const RECORD = flags.includes("--record");

// Tolerance: a count may exceed its budget by 10 %, and at least by 2 statements
const allowed = (budget) => budget + Math.max(2, Math.ceil(budget * 0.1));
// A count this far under the budget is reported (the budget should come down)
const tooLow = (budget, count) => count < budget * 0.8 - 2;

const REQUESTS = [
  { name: "guest-welcome", path: "f/welcome/normal/render.uP" },
  { name: "guest-search", path: "api/v5-0/portal/search?q=cartoon" },
  { name: "student-login", user: "student", login: true },
  { name: "student-home", user: "student", path: "" },
  {
    name: "student-layout-json",
    user: "student",
    path: "api/v4-3/dlm/layout.json",
  },
  {
    name: "student-portlet-registry",
    user: "student",
    path: "api/v4-3/dlm/portletRegistry.json",
  },
  { name: "student-portlet-list", user: "student", path: "api/portlet-list/" },
  {
    name: "student-maximized-portlet",
    user: "student",
    path: "p/what-is-uportal/max/render.uP",
  },
  { name: "admin-login", user: "admin", login: true },
  { name: "admin-home", user: "admin", path: "" },
  {
    name: "admin-portlet-manager",
    user: "admin",
    path: "p/portlet-admin/max/render.uP",
  },
  {
    name: "admin-groups-manager",
    user: "admin",
    path: "p/groupsmanager/max/render.uP",
  },
  {
    name: "admin-permission-assignments",
    user: "admin",
    path: "api/permissionAssignments?owner=UP_ERROR_CHAN&activity=VIEW",
  },
  {
    name: "admin-people-search",
    user: "admin",
    path: "api/v5-0/portal/search?q=steven&type=people",
  },
];

const COUNTED_THREAD = /^(http-nio-\d+-exec-\d+|uP-PortletExec-\d+)$/;

class Session {
  cookies = new Map();

  async get(path) {
    let url = new URL(path, BASE);
    for (let hop = 0; hop < 10; hop++) {
      const response = await fetch(url, {
        redirect: "manual",
        headers: {
          cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        },
      });
      for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(";");
        const eq = pair.indexOf("=");
        this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
      const location = response.headers.get("location");
      await response.arrayBuffer();
      // Follow redirects within the portal only (logout and CAS go elsewhere)
      if (response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, url);
        if (!next.href.startsWith(BASE)) return response.status;
        url = next;
        continue;
      }
      return response.status;
    }
    throw new Error(`Too many redirects from ${path}`);
  }
}

async function login(session, user) {
  const status = await session.get(`Login?userName=${user}&password=${user}`);
  if (status !== 200) throw new Error(`Login of ${user} answered ${status}`);
}

// The statements the counted threads logged after `offset`, waiting until the log is quiet
async function statementsSince(offset) {
  let size = statSync(logFile).size;
  for (;;) {
    await sleep(300);
    const now = statSync(logFile).size;
    if (now === size) break;
    size = now;
  }
  const text = readFileSync(logFile, "latin1").slice(offset);
  let count = 0;
  for (const line of text.split("\n")) {
    // <timestamp>|<thread>|<category>|<sql>
    const [, thread, category] = line.split("|");
    if (category === "statement" && COUNTED_THREAD.test(thread)) count++;
  }
  return { count, end: size };
}

async function measure(request, sessions) {
  const counts = [];
  for (let i = 0; i < 3; i++) {
    let session;
    if (request.login) {
      session = new Session();
    } else if (request.user) {
      session = sessions.get(request.user);
      if (!session) {
        session = new Session();
        await login(session, request.user);
        sessions.set(request.user, session);
      }
    } else {
      session = sessions.get("guest") ?? new Session();
      sessions.set("guest", session);
    }
    await sleep(500);
    const offset = statSync(logFile).size;
    const status = request.login
      ? (await login(session, request.user), 200)
      : await session.get(request.path);
    if (status !== 200) throw new Error(`${request.name}: HTTP ${status}`);
    counts.push((await statementsSince(offset)).count);
  }
  return { first: counts[0], warm: counts[2] };
}

const budgets = (() => {
  try {
    return JSON.parse(readFileSync(BUDGETS, "utf8"));
  } catch {
    return {};
  }
})();

const observed = {};
const failures = [];
const notes = [];
const sessions = new Map();
// Warm the portal up first: the first requests after a start load the caches every request needs
await new Session().get("f/welcome/normal/render.uP");
for (const request of REQUESTS) {
  const result = await measure(request, sessions);
  observed[request.name] = result;
  const budget = budgets[request.name];
  let verdict = "recorded";
  if (!RECORD) {
    if (budget === undefined) {
      verdict = "NO BUDGET";
      failures.push(`${request.name}: no budget in budgets.json`);
    } else {
      verdict = "ok";
      for (const kind of ["first", "warm"]) {
        if (result[kind] > allowed(budget[kind])) {
          verdict = "OVER BUDGET";
          failures.push(
            `${request.name} (${kind}): ${result[kind]} statements, budget ${budget[kind]} (at most ${allowed(budget[kind])})`,
          );
        } else if (tooLow(budget[kind], result[kind])) {
          notes.push(
            `${request.name} (${kind}): ${result[kind]} statements, budget ${budget[kind]}; lower the budget`,
          );
        }
      }
    }
  }
  const b = budget ? ` (budget ${budget.first}/${budget.warm})` : "";
  console.log(
    `${request.name.padEnd(30)} first ${String(result.first).padStart(4)}  warm ${String(result.warm).padStart(4)}${b}  ${verdict}`,
  );
}

// Every request reads something: no statement at all means the instrumentation did not work
if (Object.values(observed).every((r) => r.first === 0 && r.warm === 0)) {
  console.log(
    "FAILED: no request counted a statement; p6spy did not log uPortal's SQL (see run.sh's output)",
  );
  process.exit(1);
}

const json = JSON.stringify(observed, null, 2);
if (RECORD) {
  writeFileSync(BUDGETS, `${json}\n`);
  console.log(
    `Recorded ${Object.keys(observed).length} budgets in budgets.json`,
  );
  process.exit(0);
}
for (const note of notes) console.log(`NOTE: ${note}`);
if (failures.length > 0) {
  console.log(`FAILED:\n  ${failures.join("\n  ")}`);
  console.log(`observed=${JSON.stringify(observed)}`);
  process.exit(1);
}
console.log(`OK: ${REQUESTS.length} requests within their query budgets`);
