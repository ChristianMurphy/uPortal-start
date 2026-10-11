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
* `events-aggregated`: no raw event is left unaggregated behind the aggregator's last event date.
* `no-overlap`: from both nodes' `ClusterLockServiceImpl` TRACE logs, no job held its lock on
  both nodes at once.

Seeded faults (`--fault`, nightly matrix): `replication-off` (uPortal's own
`ehcache-no-jgroups.xml`) must fail `invalidation-portlet`. `lock-ignored`
(`abandonedLockAge=PT0S`) must fail `failover-takeover` and `no-overlap`. The layout check does
not depend on replication (uPortal reads a layout from the database when a session starts), so
no seeded fault covers it yet.

`invalidation-permission` and `events-aggregated` fail because of the uPortal problems under
"Findings". They are listed in `KNOWN_FAILURES` in `cluster.sh`, which reports them as warnings
without failing the run.

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

k6 (the `grafana/k6` image pinned by digest, CI only) runs 10 virtual users on PostgreSQL 18 for 3
minutes after a warm-up. Half browse as guests, the rest log in and out or render a portlet. p50, p95 and error rate per
scenario are thresholds from `tests/load/baseline.json` (1.5 × + 50/100 ms, < 1 % errors).
`docs/load-tests.md` describes scaling to MOD-Q7's large campus on real hardware.

## CI results

Status at the checkpoint (2026-10-11 01:40 UTC). Nothing is green yet.

* Run 38095302669 (head `ba30c74`) was the first run of the cluster test. Setup worked: both
  nodes started on PostgreSQL 18 and both registered in `JGROUPSPING`. `jobs-once` passed
  (24 logins and 444 portlet renders, each interval's aggregates grew by exactly that).
  `invalidation-portlet` failed: node B still showed the old title 30 s after node A's import.
  The other failures were errors in the test, fixed in `a63e95a`. The `updatePermission` call
  got HTTP 400 from unencoded `[]` in the query. The layout check looked for the tab in the
  wrong place. The lock times were read as timestamps.
* Run 38100770775 (head `9c71a8e`, every job once):
  * Passed: the UI specs on Firefox, WebKit and the phone viewport. The visual job passed too
    and wrote 10 snapshots, now recorded in `tests/visual/snapshots`.
  * a11y: failed as expected with an empty baseline. The observed violations are recorded in
    `tests/a11y/baseline.ts`.
  * Cluster: both nodes now report their own `portal.home` and server name. `invalidation-layout`
    passed (674 ms) and `no-overlap` passed (383 runs, all on node A). `invalidation-portlet`
    failed: node B kept the old title for 300 s although the database had the new one.
    `invalidation-permission` failed: node B still denied the portlet 330 s after the grant.
    `jobs-once` failed: 22 raw events stayed unaggregated. The next run prints the JGroups
    views, the permission rows and the stuck events.
  * Query budgets: uPortal did not start with p6spy (404). Load: the k6 install failed. Both
    fixed, see the commits after the run.
* Run 38106773735 (head `250bc60d1`, the fixes merged with the integration branch):
  * Firefox, WebKit, phone, a11y (the ratchet against the recorded baseline) and load passed.
    Load observed p50/p95 of 1/69 ms (guest), 5/152 ms (login) and 2/45 ms (portlet), error
    rates up to 0.08 % (three "unexpected EOF" responses), now in `tests/load/baseline.json`.
  * Visual: 9 of 10 passed. The phone's guest page, the first page after the portal started,
    did not load within 30 s. The suite's timeout is now 60 s.
  * Query budgets: uPortal started with p6spy, but every request counted 0 statements. The
    next run prints what `sql.log` holds.
  * Cluster, main leg: `invalidation-portlet` passed (1 372 ms), `invalidation-layout` passed
    (645 ms), `no-overlap` passed (256 runs). `invalidation-permission` failed (node B denied
    the grant 330 s later). `jobs-once` failed: 96 events node B stored in its first seconds
    were never aggregated (see "Findings"), and the failover checks did not run.
  * Cluster, `replication-off`: `invalidation-portlet` failed as it should (no catch-up in
    300 s). `invalidation-layout` passed, which showed it does not depend on replication.
    With the cluster wait taking 2 minutes, node B's events were stored in time, so
    `jobs-once` (48 logins, 888 renders), `failover-takeover` (60 208 ms after the last
    update), `failover-jobs-once` and `no-overlap` (336 runs) all passed. That run is the
    first evidence that failover works.
  * Cluster, `lock-ignored`: stopped at `jobs-once` like the main leg, so the checks that
    must catch the fault never ran.
* Run for `ff634d161` (cluster test waits for node B's tasks, known failures, JGroups views,
  query diagnostics, visual timeout, load baseline) is next.

## Findings

Confirmed in CI:

* **Events lost at node start.** A node queues its portal events in memory and writes them to
  `UP_RAW_EVENTS` only once its scheduled tasks start, 120 s after uPortal starts
  (`uPortalTaskScheduler` `initialDelay` PT120S also delays `portalEventDaoQueuingEventHandler.flush`).
  The aggregator reads only events after its last event date
  (`PortalRawEventsAggregatorImpl.doAggregateRawEventsInternal`), so when another node has
  aggregated past them by then, they are never aggregated. Run 38106773735: 96 events of
  node B from 03:19:08 to 03:19:14, aggregator at 03:29:41. Every node restart in a running
  cluster loses its first minutes from the statistics. The check `events-aggregated` covers it.
* **Permission changes do not reach the other node.** After node B checked the student's denied
  SUBSCRIBE, node A's grant (stored in `UP_PERMISSION`, enforced on node A) did not reach node B
  within 330 s, with or without replication, in all three legs of run 38106773735. The next run
  checks node A's own cached denial first and what a new session on node B gets, which tells
  a missing eviction from a missing replication.
* **The server names are right.** Since `a63e95a` both nodes report their own `portal.home`
  and server name, and the raw events hold `node-a` and `node-b`.

Candidates:

* Portlet definition change not visible on the other node within 30 s, nor 300 s, in runs
  38095302669 and 38100770775. It showed in under 1.5 s in the two legs of run 38106773735
  that had replication. A change made before the nodes share a JGroups view would explain it.
  The test now logs the views and waits for a view of two members.
* From reading `ehcache.xml`: permission checks are cached per node without replication
  (`AuthorizationImpl.PRINCIPAL_HAS_PERMISSION` 180 s, `AnyUnblockedGrantPermissionPolicy.HAS_UNBLOCKED_GRANT`
  300 s). Another node can keep allowing a revoked permission for up to 5 minutes.
* From reading the code: `LoginAggregationImpl` and the other aggregation entities are cached
  in Hibernate L2 without replication and have no `@Version`. If aggregation moves from node A
  to node B and back within the 10-minute idle time, node A can update a stale copy and lose
  counts. Not yet tested (see "What's left").
* `jgroups.xml` reads `jgroups.tcp.bind_port`, while uPortal sets
  `uPortal.cacheManager.jgroups.tcp.bind_port`, so the port setting in `portal.properties`
  has no effect. Nodes on one host still start, through the port range.

## Proposed LOG entries

Draft, to finalise once CI confirms the findings:

* `MOD-D?`: the two-node cluster test is a required check on every push (`tests/cluster/cluster.sh`),
  with seeded faults nightly; browsers, accessibility and visual snapshots, query budgets and the
  load baseline run nightly (budgets also on integration-branch pushes).
* `MOD-I?`: events a node stores in its first 120 s are never aggregated when another node's
  aggregator has passed their time (the event flush waits for the task scheduler's initial
  delay).
* `MOD-I?`: a permission granted on one node does not reach another node's checks within
  330 s. The next run says whether a new session sees it.
* `MOD-I?`: portlet definition changes sometimes do not reach the other node at all (two of
  four runs), if the JGroups view logging confirms a late view.
* `MOD-I?`: the `uPortal.cacheManager.jgroups.tcp.bind_port` setting does not reach `jgroups.xml`.
* `MOD-I?`: one pushed commit message of this workstream (the one that renamed the cluster test
  a required check) quotes a word the uPortal Vale style flags. It was not rewritten.

## Environment notes

* Maven Central answered HTTP 429 for the whole session, and the local Google-mirror init script
  was refused by the permission classifier, so no portal ran in this container: every portal
  result above comes from GitHub CI. Docker Hub pulls worked once `mirror.gcr.io` was configured.
* `github.com` release downloads and `dl.k6.io` are blocked by the sandbox proxy (403); k6 is
  installed only in CI.
* The runners were saturated (13 workstreams); a CI cycle took over an hour, which limited
  iteration.

## What's left

Next step: read the jobs of the run for `ff634d161` (or its successor) on this branch.

1. Cluster: the main leg must pass with only the known failures. The `replication-off` and
   `lock-ignored` legs must each report the fault caught. Update "Findings" from the JGroups
   views, the permission diagnosis and the unaggregated events.
2. Query budgets: fix the counting with the help of the `sql.log` summary. Record
   `tests/query-budget/budgets.json` from the `observed=` line once the counts are not zero.
3. Visual: should pass with the longer timeout.
4. Revert `9c71a8e` (the on-push-once commit) so those jobs are nightly again.
5. Finalise the proposed LOG entries.

Not started: a test for stale aggregation caches. Node A is frozen with SIGSTOP past the server
bias so that node B aggregates. Node A then resumes after node B stops, and the counts must still
match the raw events.
