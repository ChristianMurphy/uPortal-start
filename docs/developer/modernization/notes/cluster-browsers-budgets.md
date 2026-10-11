# Handoff: cluster, browsers, accessibility, query and load budgets

Workstream branch: `ccr-43ba0785-hzlrj5-cluster` (uPortal-start only. uPortal is unchanged).
Scope: MOD-D29 item 9 (two-node cluster) and the "strength and non-functional" list (other
browsers, accessibility, visual snapshots, query-count budgets, load baseline).

## What was built

| Part | Files | Runs |
| --- | --- | --- |
| 1. Two-node cluster | `tests/cluster/cluster.sh`, `cluster.properties`, `lock-overlap.mjs`, `docs/cluster-tests.md` | Integration job `cluster`: every push; seeded faults nightly |
| 2. Browsers, a11y, visual | `tests/browsers-pw.config.ts`, `tests/a11y/`, `tests/a11y-pw.config.ts`, `tests/visual/`, `tests/visual-pw.config.ts`, `docs/browser-a11y-tests.md` | Integration job matrix `browsers`: nightly |
| 3. Query-count budgets | `tests/query-budget/`, `docs/query-budgets.md` | Integration job `query-budgets`: integration branch every push, nightly |
| 4. Load baseline | `tests/load/portal.js`, `tests/load/baseline.json`, `docs/load-tests.md` | Integration job `load`: nightly |

### 1. Two-node cluster

The test runs two Tomcats from one checkout (node B is a copy of node A's `.gradle/tomcat` on ports
8180/8105, without CAS) on one PostgreSQL 18 container, with uPortal's default cluster
configuration. That is Ehcache 2 replication over JGroups (TCP, `JDBC_PING` in the shared database), and
`UP_MUTEX` cluster locks. Test-only settings shorten the clustered jobs' periods to ~7 s; the
lock-abandonment age stays at its 60 s default. Checks (details and bounds in
`docs/cluster-tests.md`):

* `invalidation-portlet`, `invalidation-layout`, `invalidation-permission`: a portlet
  definition (imported through node A's `/api/import`), a user's layout (`/api/layout?action=addTab`)
  and a revoked SUBSCRIBE permission (`/api/updatePermission`) show on node B within a bound.
* `jobs-once`: logins and renders by four users on both nodes; every interval's login and
  portlet-render aggregates (group Everyone) grow by exactly the number of raw events.
* `failover-takeover`: a table lock on `UP_EVENT_AGGR_STATUS` holds the next aggregation run
  inside its cluster lock; that node is killed with `kill -9`; the survivor must take the lock no
  sooner than 60 s after the dead node's last lock update, and within 60 s + the 28 s server bias
  + 60 s.
* `failover-jobs-once`: events from before and after the kill are aggregated once.
* `no-overlap`: from both nodes' `ClusterLockServiceImpl` TRACE logs, no job held its lock on
  both nodes at once.

Seeded faults (`--fault`, nightly matrix): `replication-off` (uPortal's own
`ehcache-no-jgroups.xml`) must fail `invalidation-portlet` and `invalidation-layout`.
`lock-ignored` (`abandonedLockAge=PT0S`) must fail `failover-takeover` and `no-overlap`.

### 2. Browsers, accessibility, visual snapshots

* Firefox and WebKit run every spec in `tests/ux` at 1280 × 720; a Pixel 7 viewport runs the
  guest-page, auth and skin specs.
* `@axe-core/playwright` (WCAG 2.1 A/AA) on ten key pages, as a ratchet against
  `tests/a11y/baseline.ts` (page → rule → node, digits normalised).
* Viewport snapshots of five pages on desktop Chromium and a Pixel 7, 1 % pixel tolerance,
  portlet bodies masked on dashboards. Snapshots are recorded on the CI runner: the job prints
  new ones into its log as base64 and `tests/visual/fetch-snapshots.sh` restores them.

The new suites use their own suffixes (`.a11y.ts`, `.visual.ts`) or config, so the default
suite stays at 124 tests.

### 3. Query-count budgets

p6spy 3.9.1 (pinned by SHA-256) wraps uPortal's JDBC driver in the deployed test portal only,
through `${portal.home}/uPortal.properties` (which the portlets do not read), and logs each
statement with its thread. Statements of the request thread and the portlet threads it starts
are counted. Background jobs and JGroups are not. 14 key requests, each three times
(`first`, `warm`); tolerance +10 % (at least +2 statements); counts 20 % under budget are
reported for lowering.

### 4. Load baseline

k6 (Grafana's signed apt repository, CI only) runs 10 virtual users on PostgreSQL 18 for 3
minutes after a warm-up. Half browse as guests, the rest log in and out or render a portlet. p50, p95 and error rate per
scenario are thresholds from `tests/load/baseline.json` (1.5 × + 50/100 ms, < 1 % errors).
`docs/load-tests.md` describes scaling to MOD-Q7's large campus on real hardware.

## CI results

RESULTS

## Findings

FINDINGS

## Proposed LOG entries

PROPOSED

## Environment notes

* Maven Central answered HTTP 429 for the whole session, and the local Google-mirror init script
  was refused by the permission classifier, so no portal ran in this container: every portal
  result above comes from GitHub CI. Docker Hub pulls worked once `mirror.gcr.io` was configured.
* `github.com` release downloads and `dl.k6.io` are blocked by the sandbox proxy (403); k6 is
  installed only in CI.
* The runners were saturated (13 workstreams); a CI cycle took over an hour, which limited
  iteration.

## What's left

LEFT
