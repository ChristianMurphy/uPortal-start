# Handoff: tip-reds-4 (the red tip after landing 4)

The branch is `ccr-43ba0785-hzlrj5-tip-reds-4` in uPortal-start and in uPortal. It covers the two
red jobs of Integration run 42485157612 on the integration tips after landing 4 (uPortal-start
`9c20dbaf6`, uPortal `0cf02679f`):

| Job | Failure | Cause | Fix |
| --- | --- | --- | --- |
| Cluster: two nodes, 128746222923 | `failover-takeover`: node B "did not take" the aggregation lock within 148 s | The check read `UP_MUTEX.SERVER_ID` once a second, and uPortal clears that column when a lock is released. Node B took the lock 62.8 s after node A's last update, inside the bounds, and released it 861 ms later, between two reads | uPortal-start, `test(cluster)`: the check reads the node that locked it last |
| Playwright: mariadb-12.3, 128746222969 | `tests/api/portlet-list.spec.ts:401` passed only on a retry: the admin's page answered 500 when the spec read its CSRF token | A portal bug that doesn't depend on the database. Every page render copies the skin's head elements from one cached DOM fragment, and the JDK's DOM isn't safe to read from two threads. A render read `null` for an element and failed in `respondr.xsl`'s `skinResources` | uPortal, `fix(web)`: each render gets its own copy |

Landing 4's changes caused neither failure. The cluster check could miss a takeover since it was
written (2026-10-10), and the render race is in code that landing 4 didn't touch
(`ResourcesElementsXsltcHelper` and resource-server-utils 1.5.3).

## 1. Cluster: `failover-takeover`

### History

Integration runs on `ccr-43ba0785-hzlrj5*` from 2026-10-10 to 2026-11-08 (352 runs, read with
`gh api .../workflows/380569713/runs` and each run's jobs): 43 "Cluster: two nodes" jobs reached
`failover-takeover`. It passed in 42 and failed once, in this run on 2026-11-08 at 13:28 UTC. The
first run with the check was 38110056978 on 2026-10-11. In the passing runs node B took the lock
60.1 s to 66.8 s after node A's last update.

### Timeline of run 42485157612

From both nodes' portal logs (`ClusterLockServiceImpl` at `TRACE`), the job log and the
artifact's results, all times UTC on 2026-11-08:

| Time | Node | What happened |
| --- | --- | --- |
| 13:39:55.863 | A | Locks `AGGREGATION_LOCK`. Its run waits on the test's table lock on `UP_EVENT_AGGR_STATUS`, and its lock thread updates the row every second |
| 13:39:56 to 13:41:30 | B | Tries every 7 s and skips: "db lock last run less than 6650ms ago" (node A's updates) |
| 13:41:31.116 | A | Last lock update (`last_update` 1794145291116) |
| 13:41:31.856 | A | `kill -9` |
| 13:41:37.9 to 13:41:58.9 | B | Skips: "on a server other than node-b" (the 28 s server bias) |
| 13:42:05.9 to 13:42:26.9 | B | "failed to acquire db lock": the lock isn't abandoned yet (60 s) |
| 13:42:33.945 | B | "Unlocking abandoned ClusterMutex [... serverId=node-a_36ss ... lastUpdate=13:41:31.116Z ...]" |
| 13:42:33.968 | B | Acquires the lock, 62.85 s after node A's last update, aggregates the events of 13:39:26 to 13:42:29 |
| 13:42:34.829 | B | Releases it after 861 ms |
| 13:42:34.832 to .839 | B | Holds it again for 7 ms (the step that closes old aggregations) |
| 13:42:47.9 onwards | B | Holds it every 7 s for 4 ms to 10 ms |
| 13:43:59.5 | test | `failover-takeover: FAIL`, 148 s after node A's last update |
| 13:44:00 to 13:44:12 | test | `failover-jobs-once`, `events-aggregated` and `no-overlap` (91 runs) pass |

uPortal did what the check expects: node B took the abandoned lock after 60 s and before 148 s,
and aggregated every event once.

### Cause

`check_failover` read `server_id` from `UP_MUTEX` once a second (a `docker exec psql`, then
`sleep 1`) and waited for `node-b`. `ClusterMutex.unlock()` moves `SERVER_ID` to
`PREV_SERVER_ID` and sets it to null. The column names node B only while it holds the lock.
Node B held it for 861 ms and then for a few milliseconds every 7 s. No read fell inside.

In the passing runs the test saw node B 0.17 s to 1.09 s after it took the lock (8 runs whose
artifacts were read: the time from "acquired db lock" to node B's next test login). The reads
come about 1.1 s apart, so the check depended on node B's first run being longer than that. The
aggregation runs of this job's runner were the fastest of the 9 runs compared: node A's last run
before the failover lasted 0.80 s here, and 0.94 s to 1.67 s in the 8 passing runs. Node B's
first run after the takeover was 0.86 s, shorter than a read's interval.

### Landing 4's cluster test change

* `permission-rounds` runs before `split-heal` and adds about 20 s. It shifts when the failover
  starts against the 7 s aggregation period, as any change in timing does. Where the reads fall
  inside node B's run was always random.
* The `net.sf.ehcache.distribution.jgroups` `DEBUG` lines add 707 lines to node B's log (4127 in
  all). Node B's first run after the takeover logged 12 of them. They don't make a run shorter.
* The order of the checks after `split-heal` didn't change.
* The other Cluster runs on uPortal-start `9c20dbaf6` (42485900437 and 42486476143) and the
  runs on the `-permission-race` branch (42465456850, 42466487884 and 42481094541) passed.

The check could miss a short takeover run from its first version (`339a56b5a`). A fast runner
made it happen.

### Fix

`mutex_row` returns the node that locked the mutex last: `SERVER_ID` while it is locked, else
`PREV_SERVER_ID`, with `LOCK_START`, which `unlock()` keeps. The takeover is found until node B
locks it again, at least 6.65 s later. The same function serves the live-hold check, which now
also sees a node that took the lock from a live holder and gave it back between two reads. The
failure message gives the last row read. `docs/cluster-tests.md` says how the check reads the
row.

### Evidence

The cluster test needs Docker, which this machine doesn't run. The check's code was replayed
instead. `mutex_row`, the takeover loop and the live-hold loop were cut from the tip's
`cluster.sh` and from this branch's, and run against a private PostgreSQL 16 (unix socket only)
with `UP_MUTEX` as the 5.17 schema has it. A second process wrote the row as uPortal does
(`lock()`, `unlock()`, `updateLock()` and the abandoned unlock) on a timeline taken from the
failing run, each trial with a random phase against the reads:

| Scenario | Old check | New check | Expected |
| --- | --- | --- | --- |
| The failing run's writes (861 ms, 7 ms, then 6 ms runs) | missed the takeover in 14 of 40 | missed it in 0 of 40 | PASS |
| The same with a 200 ms first run | missed it in 13 of 20 | 0 of 20 | PASS |
| No node takes the lock | FAIL in 5 of 5 | FAIL in 5 of 5 | FAIL |
| Node B takes the lock 5 s after the last update | FAIL in 10 of 10, 3 of them for the wrong reason ("did not take over") | FAIL in 10 of 10, each "before it counted as abandoned" | FAIL |
| Node B takes a live holder's lock for 300 ms | caught in 10 of 20, then 7 of 20 | caught in 19 of 20, then 20 of 20 | FAIL |

The one live-hold trial the new check missed ran while a Gradle test build loaded the machine.
The second batch printed the row at the end of the loop and caught all 20. The replay's scripts
are in the scratchpad (`tipreds4/replay`), not in the repository.

The `lock-ignored` seeded fault runs only in the nightly set. While node A updates the lock, node
B skips each run ("db lock last run less than 6650ms ago"), also under that fault. After the kill
it takes the lock once the server bias has passed: 28.3 s to 34.7 s after node A's last update in
the fault jobs of runs 38110056978 to 38160754871, which `failover-takeover` reported as "before
it counted as abandoned". That is the replay's case of a takeover after 5 s, which the new check
reports for the right reason in 10 of 10.

## 2. Playwright mariadb-12.3: `portlet-list.spec.ts:401`

### What failed

"PUT ownerUsername regex" signs in as admin, then `createPortletList` posts with the session's
CSRF header. `sessionCsrfHeaders` reads it from the admin's default page, and that `GET` answered
500 at 13:38:21 (first attempt). The retry passed. The portal log has the cause:

```
ERROR [http-nio-8080-exec-7-admin] o.a.p.rendering.xslt.XSLTComponent 2026-11-08 13:38:21,545 - XSLT transformation error
Caused by: java.lang.NullPointerException
	at java.xml/com.sun.org.apache.xalan.internal.xsltc.runtime.BasisLibrary.nodeList2Iterator(BasisLibrary.java:1244)
	at jdk.translet/die.verwandlung.respondr.skinResources()
```

Line 1244 of the JDK 11 class is `node.getNodeType()` on `nodeList.item(i)`: the list said it
had more elements than it returned.

The database plays no part. The portal log has no deadlock, no 1020 or 1213 error and no
collation error near 13:38:21, and the spec's list names end in `Date.now()`. Other specs signed
in as admin in parallel, but the race needs only renders of the same skin at the same moment, by
any users.

### History

* `portlet-list.spec.ts:401` failed or passed only on a retry once in the 278 failed Playwright,
  G-migrate and Browsers jobs of the same 352 runs (their annotations): this job. Earlier
  `portlet-list` failures were other tests (`:213`, `:226`, `:239`, `:246`) in October.
* The `NullPointerException` in `skinResources` is in 3 of the 148 portal logs of the Playwright
  and G-migrate artifacts of 34 runs from 2026-10-15 to 2026-11-08: this job, and run
  38672160727 (`-fix-tip`, 2026-10-15) in Playwright hsqldb (`/api/v4-3/dlm/layout.json`) and
  Playwright postgres-18 (`/f/welcome/normal/render.uP`). So it isn't MariaDB's.

### Cause

`resourcesTemplates.xsl` copies the skin's `<link>` and `<script>` elements into the page with
`xsl:copy-of select="resources:getResourcesXmlFragment(...)"`. With aggregation on,
`ResourcesElementsProviderImpl` (resource-server-utils 1.5.3) builds them once per skin, keeps
the `DocumentFragment` in `xmlResourcesCache` and returns its child list to every request. The
JDK's DOM isn't thread-safe for reads either: `ParentNode.item(int)` and `getLength()` move a
cursor (`fNodeListCache`) that the document keeps for the list. Renders that copy the fragment
at the same moment can get `null` or another element. XSLTC's `nodeList2Iterator` then
throws the `NullPointerException`, and the page answers 500.

### Fix

`ResourcesElementsXsltcHelper.getResourcesXmlFragment` (uPortal-web) takes the shared list's lock,
imports its elements into a new document and returns that copy, which only the caller's render
reads. A page copies about a dozen elements. resource-server-utils could stop sharing the
fragment, an upstream change for that project.

### Evidence

`ResourcesElementsXsltcHelperTest` in uPortal-web, run with
`./gradlew :uPortal-web:test --tests '...ResourcesElementsXsltcHelperTest' --rerun`, JDK 21 and
the module's release 11:

| Code | `testEachCallGetsItsOwnCopyOfTheSkinElements` | `testRendersAtTheSameTimeReadEveryElement` (4 threads, 3 s) |
| --- | --- | --- |
| Integration tip | fails 1 of 1 (the same node) | fails 6 of 6 (a `null` element once, a wrong element five times) |
| This branch | passes 6 of 6 | passes 6 of 6 |
| This branch without the lock (seeded, not committed) | passes | fails 3 of 3 |

A replay with the JDK 11 XSLTC itself (4 threads, a stylesheet with the same `xsl:copy-of`, 80000
transforms) threw the CI log's `NullPointerException` 10 to 18 times in each of 3 runs with the
shared list, and 0 times in 2 runs with the copy. That program isn't in the repository.

A local portal on HSQLDB (ports 8380, 8305 and 8387, through `portal-slot.sh`) with this
branch's uPortal build in a private Maven repository, and the same portal with the tip's
`uPortal-web` jar in its place:

* The guest Welcome page from each jar has the same 24 `<link>` and `<script>` elements in its
  head. Apart from the analytics timings the two pages are equal.
* 3200 guest renders from 8 parallel `curl` loops, each in a new session (so each runs the theme
  transform): 3200 answered 200 with each jar, and neither portal log has the
  `NullPointerException`. On a real page the copy is a small part of a render, and in CI the race
  hit about once in 50 suites, so this count doesn't show the race. It shows the fix renders the
  page under load.
* `portlet-list.spec.ts` and `csrf.spec.ts` with `--repeat-each 3 --workers 4` on this branch's
  build (Chromium 1194, 9874 MB available): 151 passed and 2 passed on a retry,
  `portlet-list.spec.ts:727` and `:853`. Each is a copy of the same test running next to another
  one: `:727` gives the admin's list the reserved name `favorites`, and `:853` compares all of the
  student's lists. Neither had a 500, and CI runs each test once.

Since `dc9f4c90f` (2026-10-11) the session's CSRF token is part of the theme's cache key, so the
first page of every session runs the theme transform and copies the skin's elements. That makes
renders that copy them at the same moment more likely than before.

## Push runs

uPortal `0f9be2274` (the fix) and uPortal-start `f610b6a9d`, pushed in that order. The Integration
run's `Build uPortal` job (128772873946) says "ChristianMurphy/uPortal
ccr-43ba0785-hzlrj5-tip-reds-4 at 0f9be2274". The uPortal-start runs tested the fix. All passed:

| Repository | Workflow | Run |
| --- | --- | --- |
| uPortal | CI | 42494205094 |
| uPortal | DB integration | 42494205167 |
| uPortal | DB copy tool | 42494205063 |
| uPortal-start | Integration | 42494211483 |
| uPortal-start | CI | 42494211488 |
| uPortal-start | HTTP replay | 42494211482 |
| uPortal-start | Migration equivalence | 42494211574 |
| uPortal-start | G-index | 42494211484 |

Integration 42494211483 ran the Cluster job (128773904935), Playwright on HSQLDB (128773904953),
on HSQLDB with CAS (128773904945) and on PostgreSQL 18 (128773904996), the DB harness on
PostgreSQL 18 and the G-migrate pair from MariaDB 11.4 to PostgreSQL 18.

The Cluster job passed every check: `failover-takeover` saw node B 66.4 s after node A's last
update. Its logs show the test saw node B 0.58 s into a first run of 1.39 s, so that run didn't
need the new reading of the row. The replay above is the evidence for the case the old check
missed. A topic push doesn't run Playwright on MariaDB, and the render race doesn't depend on the
database.

## Proposed LOG rows

| ID | Area | Issue | Status |
| --- | --- | --- | --- |
| MOD-I407 | Tests | The cluster test's `failover-takeover` read `UP_MUTEX.SERVER_ID` once a second, and uPortal clears that column when it releases a lock. The check missed a takeover run shorter than the interval between two reads: node B took the aggregation lock 62.8 s after node A's last update and held it for 861 ms, and the check failed after 148 s in Integration 42485157612 (job 128746222923), once in 43 runs since 2026-10-11. | **Fixed** (uPortal-start, `test(cluster): find the takeover by the lock's last holder`): the check reads the node that locked the mutex last (`PREV_SERVER_ID` after a release) and its `LOCK_START`. A replay of the failing run's lock writes on PostgreSQL 16 missed the takeover in 14 of 40 trials before, 0 of 40 after (`notes/tip-reds-4.md`). |
| MOD-I408 | Rendering | **500 on a page render under load.** With aggregation on, `ResourcesElementsProviderImpl` (resource-server-utils) returns one cached `DocumentFragment` of a skin's head elements to every request, and the JDK's DOM isn't safe to read from two threads. Renders that copied it at once (`skinResources` in `resourcesTemplates.xsl`) could read `null`, and the render failed with a `NullPointerException` in XSLTC's `nodeList2Iterator`. `portlet-list.spec.ts:401` passed only on a retry in job 128746222969 (run 42485157612), and run 38672160727 had it on HSQLDB and PostgreSQL 18. | **Fixed** (uPortal, `fix(web): give each page render its own copy of the skin elements`): `ResourcesElementsXsltcHelper` returns a copy made under the shared list's lock. `ResourcesElementsXsltcHelperTest` fails 6 of 6 on the old code and passes 6 of 6. Upstream candidate, for resource-server-utils too (`notes/tip-reds-4.md`). |
