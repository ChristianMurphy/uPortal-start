# Handoff: cluster, browsers, accessibility, query and load budgets

Workstream branch `ccr-43ba0785-hzlrj5-cluster`, in uPortal-start and in uPortal. Scope: MOD-D29
item 9 (two-node cluster) and the "strength and non-functional" list (other browsers,
accessibility, visual snapshots, query-count budgets, load baseline). At the owner's request it
also fixes the three cluster problems the two-node test found, in uPortal 6.0.

## What was built

| Part | Files | Runs |
| --- | --- | --- |
| 1. Two-node cluster | `tests/cluster/cluster.sh`, `cluster.properties`, `cluster-join.mjs`, `lock-overlap.mjs`, `fixtures/`, `docs/cluster-tests.md` | Integration job `cluster`: main leg on every push, seeded faults nightly |
| 2. Browsers, a11y, visual | `tests/browsers-pw.config.ts`, `tests/a11y/`, `tests/a11y-pw.config.ts`, `tests/visual/`, `tests/visual-pw.config.ts`, `docs/browser-a11y-tests.md` | Integration job matrix `browsers`: nightly |
| 3. Query-count budgets | `tests/query-budget/`, `docs/query-budgets.md` | Integration job `query-budgets`: integration branch every push, nightly |
| 4. Load baseline | `tests/load/portal.js`, `tests/load/baseline.json`, `docs/load-tests.md` | Integration job `load`: nightly |

### 1. Two-node cluster

Node A is the checkout's `.gradle/tomcat`, and node B a copy of it on ports 8180/8105, without
CAS. They share one PostgreSQL 18 container and run uPortal's default cluster configuration,
with Ehcache 2 replication over JGroups (TCP, `JDBC_PING` in the shared database) and
`UP_MUTEX` cluster locks. Test-only settings shorten the clustered jobs' periods to about 7 s. The
lock-abandonment age keeps its 60 s default. The checks (details and bounds in
`docs/cluster-tests.md`):

* `cluster-join`: node B joins node A's JGroups cluster when it starts. Both nodes must install
  the same view of two members within 30 s of node B's channel starting
  (`tests/cluster/cluster-join.mjs`, from both nodes' Tomcat logs).
* `invalidation-portlet`, `invalidation-layout`, `invalidation-permission`: a portlet
  definition (node A's `/api/import`), a user's layout (`/api/layout?action=addTab`) and a
  SUBSCRIBE permission (`/api/updatePermission`, a POST with the CSRF token since uPortal
  `dc9f4c90f`) changed on node A show on node B.
* `permission-session`: a session that checked the permission before a grant or a revocation
  follows the change within 30 s, on both nodes.
* `split-heal`: `iptables` drops the JGroups packets between the nodes until each installs a
  view of one member. Node A changes a portlet title and grants a permission, and node B must
  still show the old state. Once the ports are open and both nodes install a MergeView, node B
  must show both changes within 30 s, the permission in an existing session.
* `jobs-once`, `failover-jobs-once`: logins and renders on both nodes are aggregated exactly
  once, before and after a failover.
* `failover-takeover`: the node holding the aggregation lock is killed with `kill -9` after
  95 s inside the lock. The survivor takes the lock no sooner than 60 s after the dead node's
  last update, and within 60 s + the 28 s server bias + 60 s.
* `events-aggregated`: no raw event is left behind the aggregator's last event date.
* `no-overlap`: from both nodes' `ClusterLockServiceImpl` TRACE logs, no job held its lock on
  both nodes at once.

Seeded faults, each run nightly with `--fault` and caught when the listed checks fail:

| Fault | Seeded by | Must fail |
| --- | --- | --- |
| `replication-off` | uPortal's own `ehcache-no-jgroups.xml` | `invalidation-portlet`, `invalidation-permission` |
| `lock-ignored` | `abandonedLockAge=PT0S` | `failover-takeover` |
| `event-flush-delayed` | `flushInitialDelay=PT120S`, uPortal 5's delay | `events-aggregated` |
| `join-gives-up` | node B's `jgroups.xml` with `join_timeout="1" max_join_attempts="1"` | `cluster-join` |
| `merge-clear-off` | `org.apereo.portal.cache.clearReplicatedCachesOnMerge=false` | `split-heal` |
| (fixture) | `tests/cluster/fixtures/overlap-*.log`, checked before each run | `no-overlap` |

`lock-ignored` rarely makes two nodes run a job at the same moment, so `no-overlap` is shown to
work on the fixture logs instead. `permission-session` has no fault in the matrix, at the
owner's request: the local demo below showed it fails without the cache clear, and
`AuthorizationImplCacheTest` in uPortal guards the clear. `KNOWN_FAILURES` in `cluster.sh` is
empty.

For measurements, `--join-starts N` skips the checks, starts and stops node B N times
against node A and counts the joins. `--lone-restarts N` kills node A, running alone, with
`kill -9` and restarts it N times, timing how long it waits on the coordinator row it left in
`JGROUPSPING`.

### 2. Browsers, accessibility, visual snapshots

* Firefox and WebKit run every spec in `tests/ux` at 1280 × 720. A Pixel 7 viewport runs the
  guest-page, auth and skin specs.
* `@axe-core/playwright` (WCAG 2.1 A/AA) on ten key pages, as a ratchet against
  `tests/a11y/baseline.ts` (page → rule → node, digits normalised).
* Viewport snapshots of five pages on desktop Chromium and a Pixel 7, 1 % pixel tolerance,
  portlet bodies masked on dashboards. Snapshots are recorded on the CI runner: the job prints
  new ones into its log as base64 and `tests/visual/fetch-snapshots.sh` restores them. The
  visual suite runs on one worker without retries (see MOD-I213 below).

### 3. Query-count budgets

p6spy 3.9.1 (pinned by SHA-256) wraps uPortal's JDBC driver in the deployed test portal only,
through `${portal.home}/uPortal.properties` (which the portlets do not read), and logs each
statement with its thread. Statements of the request thread and the portlet threads it starts
are counted. Background jobs and JGroups are not. 14 key requests, each three times
(`first`, `warm`), with a tolerance of +10 % (at least +2 statements). A count 20 % under its
budget is reported for lowering. The budgets were recorded from run 38113631592.

### 4. Load baseline

k6 (the `grafana/k6` image pinned by digest, CI only) runs 10 virtual users on PostgreSQL 18 for 3
minutes after a warm-up. Half browse as guests, the rest log in and out or render a portlet.
p50, p95 and error rate per scenario are thresholds from `tests/load/baseline.json` (1.5 × +
50/100 ms, under 1 % errors). `docs/load-tests.md` describes scaling to MOD-Q7's large campus on
real hardware.

## Fixes in uPortal

The cluster problems the test found are fixed on uPortal branch `ccr-43ba0785-hzlrj5-cluster`,
which this branch's Integration runs build. `docs/UPGRADING-6.0.md` has a section for each,
under "Clusters: permission changes and portal events".

| Problem | Test first | Fix | Proof |
| --- | --- | --- | --- |
| Stale permission decisions | `411a0111b` + `d1acaca7e`: `AuthorizationImplCacheTest` | `134e56ec1`: `AuthorizationImpl` clears `PRINCIPAL_HAS_PERMISSION` and `HAS_UNBLOCKED_GRANT` on every add, remove and update, and `ehcache.xml` replicates only their removals | Local eviction demo below, and `permission-session` in CI run 38136427089 |
| Events lost at node start | `EventFlushScheduleTest` | `4cc3ecb1c`: the event queue is flushed by its own scheduler, `uPortalEventFlushScheduler`, from the start (`...PortalEventDaoQueuingEventHandler.flushInitialDelay`, default PT0S) | `events-aggregated` in CI runs 38120174431 and 38136427089, `event-flush-delayed` caught |
| A starting node splits from the cluster | `cluster-join` in uPortal-start | `58168e0fe`: `jgroups.xml` GMS `max_join_attempts` 4 → 8, `join_timeout` kept at 1000 ms | Local measurement below |
| Stale entries after a split heals (owner's decision, MOD-D54) | `ReplicatedCachesMergeClearerTest`, and `split-heal` in uPortal-start | `07ecf0939`: on a JGroups MergeView each node empties every cache with a JGroups replicator, locally, and logs one INFO line. Setting `org.apereo.portal.cache.clearReplicatedCachesOnMerge`, default true | Local split-heal runs below |

Unit test runs:

* The coordinator ran them on `d1acaca7e` (JDK 21, 07:05 UTC), before the fixes. In
  `AuthorizationImplCacheTest` 4 of 7 failed. `EventFlushScheduleTest` read PT2M where it
  expected PT0S.
* The coordinator, on `4337f8c8f` (07:12 UTC) and on `c5cf6fb6e` (the Hibernate 5.2 merge,
  10:12 UTC): 7 of 7 and 1 of 1 pass, with `uPortal-security-permissions` (7 tests) and
  `uPortal-webapp` (443 tests, 78 skipped for other databases) at 0 failures.
* This session, on `2b7d81dce` (the CSRF merge): 8 of 8.

## Local runs (MOD-D53)

From 12:00 UTC this session ran Gradle and Docker in its own container: `./gradlew install` of
the uPortal branch (with a Maven-mirror init script kept outside the repositories), then
`tests/cluster/cluster.sh` with the portal on JDK 11 and PostgreSQL 18 in Docker. The
coordinator accepted these runs as the evidence for the eviction demo and the join tuning. The
CI cluster run on the head commit is the evidence for landing.

**Eviction demo.** A local commit, `0d85f1565` on a branch that was never pushed, commented out
the three `clearPermissionDecisions()` calls of `134e56ec1`.

| Leg (12:27 to 12:59 UTC) | uPortal | `permission-session` | `invalidation-permission` | Harness verdict |
| --- | --- | --- | --- | --- |
| Without the clear | `0d85f1565` | FAIL on both nodes: sessions kept the old decision more than 150 s after the grant and after the revocation | 302 683 ms | `FAILED: permission-session` |
| With the fix | `2b7d81dce` | PASS within 30 s | 2 422 ms | `OK`, 9 of 9 |

**Join measurement.** `--join-starts 20` and `--lone-restarts 10` on each setting:

| Setting | Node B joined within 30 s | Restart of the only node after a crash |
| --- | --- | --- |
| `join_timeout="1000" max_join_attempts="4"` (`2b7d81dce`, 13:05 to 13:50 UTC) | 14 of 20. 6 split: 4 shared a view only after 48 to 52 s, 2 were still split when the wait ran out | 4 251 to 4 473 ms, 4 JOIN timeouts |
| `join_timeout="1000" max_join_attempts="8"` (`58168e0fe`, 13:51 to 14:38 UTC) | 20 of 20. 7 joined at 4 260 to 4 430 ms, on the fifth attempt | 8 494 to 8 688 ms, 8 JOIN timeouts |

On `58168e0fe` the `join-gives-up` fault made `cluster-join` fail (14:38 to 14:48 UTC), and the
main leg passed 10 of 10 with `cluster-join` at 516 ms (14:48 to 14:58 UTC).

**Split and heal.** On uPortal `32b2e99c8` with the merge clear (the same two commits, on a local
tree, because the integration branch then failed to load layouts on PostgreSQL, MOD-I224):

| Leg | `split-heal` | The rest |
| --- | --- | --- |
| Main, 15:24 to 15:36 UTC | PASS. The ports were blocked at 15:30:05 and each node had a view of one member at 15:30:19. After node A's two changes, the ports opened at 15:30:25, and JGroups merged the nodes at 15:31:55. Node B then showed both changes within 186 ms. Each node logged "cleared 112 replicated caches on this node" | 11 of 11 |
| `merge-clear-off`, 15:36 to 15:48 UTC | FAIL as it should: 30 s after the merge node B still showed the old title and denied the student (HTTP 403) | The others passed |

## CI results

* Runs 38095302669 to 38113631592 built the test: the first working setup, the `updatePermission`
  encoding and layout fixes, both nodes' own `portal.home`, the query budgets (uPortal renames
  its threads), the cluster wait for node B's tasks, the failover hold of 95 s. Run
  38110056978 was the first where every cluster leg passed, with the two known failures as
  warnings, and run 38113631592 recorded the query budgets.
* Run 38120174431 (head `a8cb738ff`, the uPortal fixes): the main leg passed 9 of 9, with
  `permission-session` and `events-aggregated` (job 114416516483). The replication-off leg
  showed that `invalidation-permission` fails before `permission-session` can, and the
  lock-ignored leg had no overlap to find, so the expectations were corrected (`70aefffcf`) and
  `no-overlap` moved to the fixture. In the lock-ignored leg node B kept a portlet's old title
  for more than 300 s (job 114416516551), the third such miss in about twelve legs with
  replication. Visual failed only because `failOnFlakyTests` counted its retry (job
  114416516552).
* Run 38136427089 (head `89659be44`, the CSRF and Hibernate 5.2 merges): the main leg passed 9 of
  9 (job 114475287994), with node B joining at once. Query budgets, load, the phone viewport and
  the hsqldb Playwright jobs passed. WebKit had one flaky test, the student home in
  `tests/ux/smoke/visual-resource-server.spec.ts` (WebKit cancelled `/api/portletList`), routed
  to the e2e agent. The replication-off, lock-ignored and event-flush-delayed legs each caught
  their fault (jobs 114475288019, 114475288025, 114475288040). Visual passed on one worker without
  retries, and a11y, Playwright postgres-18 and the DB harness passed. Firefox had one flaky
  test, `tests/ux/admin/import-export.spec.ts:117` (the re-imported title was not in the title
  bar yet), reported to the coordinator.

## Findings

* **A starting node can split from the cluster (MOD-I210).** In a local run node B sent its
  JOIN at 12:19:32. Node A accepted it and installed a view of two members, but dropped its
  answer: "JGRP000032: no physical address for 625149b7-…, dropping message". Node B gave up
  after four 1 s attempts ("too many JOIN attempts (4): becoming singleton") and formed a
  cluster of its own. Node A then counted node B as a member, and node B dropped node A's
  messages as coming from a non-member, cache invalidations included ("JGRP000011: dropped
  message 2 from non-member"). `MERGE3` merged the two 92 s later. JGroups doesn't reconcile
  caches after a merge, and whatever node B cached in that time keeps its old value until it expires
  (21 600 s for `PortletDefinitionImpl`). This is the portlet-title miss of runs 38095302669,
  38100770775 and 38120174431. JGroups 3.6.20 accepts a late JoinRsp at the start of the next
  attempt (`ClientGmsImpl.joinInternal`, JGRP-687), so more attempts catch the answer that came
  after the fourth. uPortal 5.x (`master`, 5.17.10-SNAPSHOT) has the same `join_timeout="1000"
  max_join_attempts="4"` and JGroups 3.6.20, which makes it an upstream candidate. A real
  network split can still leave stale entries after the merge. Clearing replicated caches on a
  MergeView, which the owner chose (MOD-D54), covers that.
* **The only node of a cluster waits on its own row after a crash.** JDBC_PING 3.6.20 returns every
  `JGROUPSPING` row as a discovery response with its coordinator flag, dead members' rows
  included. Only a clean shutdown (`register_shutdown_hook`) or a coordinator's view change
  (`clear_table_on_view_change`) removes rows, and the table has no age to filter on. So a node
  restarting alone after `kill -9` sends JOINs to its own dead address for about
  `join_timeout` × `max_join_attempts` before it starts on its own.
* **Concurrent first page loads on a fresh portal can hang (MOD-I213).** In runs 38106773735,
  38110056978, 38113631592 and 38120174431 (visual job 114416516552), when two Playwright
  workers opened their first page on a just-started portal at the same moment, one page's load
  event never fired. The visual suite runs on HSQLDB, so this is not the PostgreSQL connection
  problem of MOD-I190/I192. The suite now runs on one worker without retries.
* **The ASYM_ENCRYPT hypothesis was mostly wrong.** `89659be44` logs `ASYM_ENCRYPT` at TRACE.
  It does discard a node's first messages until the node has the secret key, but in every
  split the JOIN timeouts came first, and the merged nodes exchanged keys.
* From reading the code, not yet tested: `LoginAggregationImpl` and the other aggregation
  entities are cached in Hibernate L2 without replication and have no `@Version`. If
  aggregation moves from node A to node B and back within the 10-minute idle time, node A can
  update a stale copy and lose counts.
* `jgroups.xml` reads `jgroups.tcp.bind_port`, while uPortal sets
  `uPortal.cacheManager.jgroups.tcp.bind_port`, so the port setting in `portal.properties` has
  no effect. Nodes on one host still start, through the port range.

## Proposed LOG entries

LOG.md is the coordinator's. Numbers from this workstream's block, MOD-I210 to MOD-I219:

* `MOD-I210` (closed by uPortal `58168e0fe`, JGroups 3.6.20, also in 5.x): a node that starts
  while another is running can fail to join (4 JOIN attempts of 1 s) and form a cluster of its
  own for a minute or more. Cache invalidations from the other node are dropped in that time,
  and what it cached keeps its old value until its TTL (6 hours for portlet definitions). 6 of 20
  starts before the fix, 0 of 20 after. A crashed single server now restarts in about 8.6 s
  instead of 4.3 s.
* `MOD-I211` (closed by uPortal `4cc3ecb1c`): events a node stores in its first 120 s are never
  aggregated when another node's aggregator has passed their time (the event flush waited for
  the task scheduler's initial delay).
* `MOD-I212` (closed by uPortal `134e56ec1`, security): cached permission decisions were still
  used up to 300 s after a grant or revocation, on every node and in existing sessions.
* `MOD-I213`: concurrent first page loads on a just-started portal can hang (HSQLDB, so not
  MOD-I190/I192). Runs 38106773735, 38110056978, 38113631592, 38120174431 (job 114416516552).
* `MOD-I214`: the `uPortal.cacheManager.jgroups.tcp.bind_port` setting does not reach
  `jgroups.xml`.
* `MOD-I215` (candidate, untested): aggregation entities in Hibernate L2 without replication or
  `@Version` can lose counts when aggregation moves between nodes and back.
* `MOD-I216`: one pushed commit message of this workstream (the one that renamed the cluster test
  a required check) quotes a word the uPortal Vale style flags. It was not rewritten.
* Logged by the coordinator from this workstream's report: `MOD-I224`, the layout query of
  uPortal `6c55d9f6a` sorted by `USP.STRUCT_PARM_NM`, an alias the query lacks when the database
  metadata doesn't report outer joins. The layout import then failed on PostgreSQL 18, found by a local
  cluster run at 15:20 UTC and fixed in `95542a6b4`.
* Decisions for the coordinator to number: the two-node cluster test is a required check on every
  push (main leg), with seeded faults nightly. A permission change clears both
  permission-decision caches on every node (whole caches, removals replicated, values never),
  and the JCache provider that replaces Ehcache 2 must keep `clear()` cluster-wide. The owner
  chose to clear replicated caches on a JGroups MergeView (MOD-D54).

## Environment notes

* Until 12:00 UTC no portal ran in this container (Maven Central answered HTTP 429, and Gradle
  was not allowed), so every portal result before then comes from GitHub CI. From MOD-D53 on,
  Gradle ran with a Maven-mirror init script outside the repositories, and `dockerd` started in
  the container.
* `github.com` release downloads and `dl.k6.io` are blocked by the sandbox proxy (403), so k6 runs
  only in CI.
* The runners were saturated. A push run waited up to two hours for runners, and the repeated legs
  moved to local runs.

## What's left

1. Revert the temporary on-push conditions of `9c71a8e` in `integration.yml`. The browsers,
   load and fault legs then run nightly again.
2. The coordinator numbers the decisions above in LOG.md.
3. Read the push runs of uPortal `343c6b395` (CI, DB integration) and of uPortal-start, and the
   Integration run with this uPortal build, for the batch (MOD-D53).
4. Not started: a test for stale aggregation caches (MOD-I215). Node A is frozen with SIGSTOP
   past the server bias so that node B aggregates, then resumes after node B stops, and the
   counts must still match the raw events.
