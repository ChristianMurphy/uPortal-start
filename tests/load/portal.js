// Load baseline (MOD-D29): guest browsing, login, and portlet rendering at a scale one GitHub
// runner sustains next to the portal. See docs/load-tests.md.
//
//   k6 run tests/load/portal.js                       # compare with tests/load/baseline.json
//   k6 run -e PORTAL_BASE_URL=http://host:8080/uPortal/ -e SCALE=10 tests/load/portal.js
//
// Each scenario's p50 and p95 response times and error rate become thresholds from baseline.json
// (p50 and p95 at most 1.5 x the baseline plus 50 ms and 100 ms, errors at most 1 %), so k6 exits
// non-zero when one is crossed. A scenario without a baseline only reports what it measured.

/* global __ENV, __VU, __ITER, open */

import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.PORTAL_BASE_URL || "http://localhost:8080/uPortal/";
const SCALE = Number(__ENV.SCALE || 1);
const DURATION = __ENV.DURATION || "3m";
const WARMUP = "30s";
const USERS = ["student", "staff", "faculty", "admin"];

let baseline = {};
try {
  baseline = JSON.parse(open("./baseline.json"));
} catch {
  baseline = {};
}

const scenario = (vus, exec) => ({
  executor: "constant-vus",
  vus: Math.max(1, Math.round(vus * SCALE)),
  duration: DURATION,
  startTime: WARMUP,
  exec,
});

const thresholds = {};
for (const name of ["guest", "login", "portlet"]) {
  const b = baseline[name];
  thresholds[`http_req_failed{scenario:${name}}`] = ["rate<0.01"];
  if (b) {
    thresholds[`http_req_duration{scenario:${name}}`] = [
      `med<${Math.round(b.p50 * 1.5 + 50)}`,
      `p(95)<${Math.round(b.p95 * 1.5 + 100)}`,
    ];
  } else {
    // No budget yet; keep the sub-metric so the summary reports it
    thresholds[`http_req_duration{scenario:${name}}`] = ["max>=0"];
  }
}

export const options = {
  scenarios: {
    // Fills the caches before anything is measured
    warmup: {
      executor: "constant-vus",
      vus: 2,
      duration: WARMUP,
      exec: "guest",
    },
    guest: scenario(5, "guest"),
    login: scenario(3, "login"),
    portlet: scenario(2, "portlet"),
  },
  thresholds,
  summaryTrendStats: ["med", "p(95)", "avg", "max", "count"],
};

export function guest() {
  const res = http.get(`${BASE}f/welcome/normal/render.uP`);
  check(res, {
    "guest page": (r) => r.status === 200 && r.body.includes("uPortal"),
  });
  sleep(1);
}

export function login() {
  const user = USERS[(__VU + __ITER) % USERS.length];
  http.cookieJar().clear(BASE);
  const res = http.get(`${BASE}Login?userName=${user}&password=${user}`);
  check(res, {
    "logged in": (r) => r.status === 200 && r.body.includes("user-name"),
  });
  sleep(1);
  http.get(`${BASE}Logout`, { redirects: 0 });
  sleep(1);
}

export function portlet() {
  if (__ITER === 0) {
    const user = USERS[__VU % USERS.length];
    http.get(`${BASE}Login?userName=${user}&password=${user}`, {
      tags: { name: "login" },
    });
  }
  const res = http.get(`${BASE}p/what-is-uportal/max/render.uP`);
  check(res, {
    "portlet rendered": (r) =>
      r.status === 200 && r.body.includes("up-portlet"),
  });
  sleep(1);
}

export function handleSummary(data) {
  const observed = {};
  const lines = [
    "scenario   p50 ms   p95 ms   errors   requests   baseline p50/p95",
  ];
  for (const name of ["guest", "login", "portlet"]) {
    const d = data.metrics[`http_req_duration{scenario:${name}}`];
    const f = data.metrics[`http_req_failed{scenario:${name}}`];
    if (!d) continue;
    observed[name] = {
      p50: Math.round(d.values.med),
      p95: Math.round(d.values["p(95)"]),
      errorRate: f ? Number(f.values.rate.toFixed(4)) : 0,
    };
    const b = baseline[name];
    lines.push(
      [
        name.padEnd(9),
        String(observed[name].p50).padStart(7),
        String(observed[name].p95).padStart(8),
        `${(observed[name].errorRate * 100).toFixed(2)}%`.padStart(8),
        String(d.values.count).padStart(10),
        b ? `   ${b.p50}/${b.p95}` : "   none",
      ].join(" "),
    );
  }
  const failed = Object.entries(data.metrics)
    .filter(
      ([, m]) => m.thresholds && Object.values(m.thresholds).some((t) => !t.ok),
    )
    .map(([k]) => k);
  lines.push(
    failed.length
      ? `FAILED thresholds: ${failed.join(", ")}`
      : "OK: within the baseline",
  );
  lines.push(`observed=${JSON.stringify(observed)}`);
  const text = `${lines.join("\n")}\n`;
  return {
    stdout: text,
    "build/load/summary.txt": text,
    "build/load/summary.json": JSON.stringify(data, null, 2),
  };
}
