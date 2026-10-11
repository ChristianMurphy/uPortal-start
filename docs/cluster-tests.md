# Two-node cluster tests

`tests/cluster/cluster.sh` runs two uPortal nodes from one checkout against one PostgreSQL 18
database and checks the things a cluster depends on: cache invalidation between the nodes,
clustered jobs that run on one node at a time, and lock failover when a node is killed. It is the
required cluster check of the uPortal 6.0 modernization (MOD-D29 item 9): the move from Ehcache 2 and
JGroups to JCache (Infinispan, or Valkey through Redisson) and from Hibernate 4.3 to 7 must keep
these checks green.

## The cluster

The nodes use uPortal's default cluster configuration, unchanged:

* **Cache replication:** `ehcache.xml` replicates removals and updates (invalidation, not copies)
  of about 110 caches over JGroups (`properties/jgroups.xml`: TCP, `JDBC_PING` discovery through
  the `JGROUPSPING` table in the shared database, AES encryption, an `AUTH` token).
* **Cluster locks:** each clustered job (raw-event aggregation, event and session purges,
  dimension population, portlet-rating aggregation, portlet-cookie purge) runs inside
  `IClusterLockService.doInTryLock`, which holds a row of `UP_MUTEX`
  (`JpaClusterLockDao`). The holder updates the row every second; another node may take a lock
  that has not been updated for `abandonedLockAge` (60 s). Aggregation also skips a run when the
  lock was used less than 0.95 × its period ago, and on another node for 4 × its period.

Node A is the checkout's own Tomcat (`.gradle/tomcat`, port 8080, with CAS). Node B is a copy of
it in `.gradle/tomcat-b` on port 8180 (shutdown port 8105), without CAS. The tests log in with
`/Login?userName=...`. Each node has its own `portal.home` with
`org.apereo.portal.PortalInfoProvider.serverName` set to `node-a` or `node-b`, which shows in
`UP_MUTEX.SERVER_ID` and `UP_RAW_EVENTS.SERVER_ID`. `tests/cluster/cluster.properties`, appended
to both nodes' `uPortal.properties`, shortens the clustered jobs' periods to about 7 s and the
aggregation delay to 5 s, so the test does not wait minutes for each run. The lock-abandonment age
stays at the default 60 s. The harness also logs `ClusterLockServiceImpl` at `TRACE` and each
JGroups view on both nodes, and starts the checks once both nodes have logged a view of two
members. JGroups writes through java.util.logging, and the harness reads its lines from
Tomcat's `catalina.*` logs and the portal log.

## The checks

| Check | What it does | Bound |
| --- | --- | --- |
| `cluster-join` | Node B joins node A's JGroups cluster when it starts. `tests/cluster/cluster-join.mjs` reads both nodes' Tomcat logs and finds when the two installed the same view of two members, counted from node B's first JGroups line | 30 s |
| `invalidation-portlet` | Node B reads a portlet definition (`/api/portlet/what-is-uportal.json`), node A imports it with a new title (`/api/import`), node B must show the new title | 30 s |
| `invalidation-layout` | Node B loads the student's layout, node A adds a tab to it (`/api/layout?action=addTab`), a new student session on node B must have the tab | 30 s |
| `invalidation-permission` | Both nodes deny the student the Permissions Manager portlet; node A grants SUBSCRIBE on it, and a new student session on node A, then on node B must allow it; node A revokes it, and a new session on node B must be denied again | 330 s (see below) |
| `permission-session` | On each node, a student session denied before the grant must be allowed after it. A session allowed before the revocation must be denied after it. Both are polled before any new student login on that node | 30 s |
| `split-heal` | `iptables` drops the JGroups packets between the nodes (ports 7800 to 7810 on loopback) until each installs a view of one member. Node A imports a new portlet title and grants the student SUBSCRIBE on the Permissions Manager. Node B must still show the old title and deny the student, which shows the split held. The ports are opened again, and once both nodes install a MergeView node B must show the new title and allow its existing student session | 30 s after the merge |
| `jobs-once` | Once node B's scheduled tasks run (120 s after it starts), every test user logs in and renders their layout three times on each node; once the aggregator has read all raw events, each interval's login and portlet-render aggregates (group Everyone) must have grown by exactly the number of raw events | |
| `failover-takeover` | A table lock on `UP_EVENT_AGGR_STATUS` makes the next aggregation run wait inside its cluster lock. The test waits 95 s, past the abandonment age and the server bias, before it kills the holder. The other node must not take the lock in that time. The kill is a `kill -9`, and the table lock is released after it. The other node must take the lock over no sooner than 60 s after the dead node's last update (it is not abandoned before), and no later than 60 s + the 28 s server bias + 60 s | 148 s |
| `failover-jobs-once` | Like `jobs-once`, over events made before the kill (on both nodes) and after it: the survivor aggregates them all, once | |
| `events-aggregated` | At the end of the run, no raw event is still not aggregated although it is older than the aggregator's last event date (the aggregator never reads it again) | |
| `no-overlap` | From both nodes' `TRACE` logs (`tests/cluster/lock-overlap.mjs`): no clustered job held its lock on both nodes at once, over the whole run | |

uPortal caches permission checks on each node (`AuthorizationImpl.PRINCIPAL_HAS_PERMISSION` for
180 s and `AnyUnblockedGrantPermissionPolicy.HAS_UNBLOCKED_GRANT` for 300 s). Since 6.0 a
permission change clears both caches and the removal is replicated. `invalidation-permission`
still allows the old bound of 330 s for new sessions, and `permission-session` holds sessions
that checked the permission before the change to 30 s.

A node that fails to join is split from the cluster. In a local run node B's JOIN timed out
four times (`GMS join_timeout=1000`, `max_join_attempts=4` in uPortal 5's `jgroups.xml`)
because node A did not yet have its address to answer. Node B then formed a cluster of its own, and
dropped node A's messages as coming from a non-member until `MERGE3` merged the two 92 s later.
uPortal 6.0 tries the JOIN 8 times, and `cluster-join` checks the join itself. A network split
has the same effect, and for that uPortal 6.0 empties the replicated caches on each node when
JGroups installs a MergeView, so an entry read during the split is read again from the
database. `split-heal` checks that.

The layout check does not depend on replication: uPortal reads a user's layout from the
database when a session starts and keeps it in the session, so a new session on node B sees the
tab with or without replication (the `replication-off` fault does not make it fail). It guards
that node B does not serve the layout from a stale node-wide copy.

## Known failures

A check listed in `KNOWN_FAILURES` (`tests/cluster/cluster.sh`) fails because of a uPortal
problem this test found. Its failure shows as a warning without failing the run, and a run where
it passes says so. The list is empty: the problems the test found are fixed in uPortal 6.0
(`docs/UPGRADING-6.0.md` in uPortal), and their checks fail the run again:

* `permission-session`: uPortal cached each permission decision per node for up to 300 s and
  kept it after a grant or a revocation. It now clears its decision caches on every permission
  change, and the caches replicate the removal.
* `events-aggregated`: a node wrote its portal events only 120 s after it started, after
  another node's aggregator had passed their time, so they were never aggregated. The event
  queue is now flushed from the start.

## Seeded faults

Each check must fail when the thing it guards is broken. `--fault` starts the cluster with a
seeded fault and passes only if the checks meant to catch it fail:

| Fault | Seeded by | Must fail |
| --- | --- | --- |
| `replication-off` | `org.apereo.portal.ehcache.filename=ehcache-no-jgroups.xml` (uPortal's own non-clustered cache file) | `invalidation-portlet`, `invalidation-permission` |
| `lock-ignored` | `org.apereo.portal.concurrency.locking.ClusterLockDao.abandonedLockAge=PT0S`: a held lock counts as abandoned at once | `failover-takeover` |
| (fixture) | `tests/cluster/fixtures/overlap-*.log`: two node logs where the aggregation job runs on both at once, checked before each run | `no-overlap` |
| `event-flush-delayed` | `org.apereo.portal.events.handlers.db.PortalEventDaoQueuingEventHandler.flushInitialDelay=PT120S`: events are written 120 s after start, as in uPortal 5 | `events-aggregated` |
| `join-gives-up` | Node B's `jgroups.xml` with `join_timeout="1" max_join_attempts="1"`: node B gives up on its JOIN at once and forms a cluster of its own | `cluster-join` |
| `merge-clear-off` | `org.apereo.portal.cache.clearReplicatedCachesOnMerge=false`: the nodes keep their replicated caches when JGroups merges them | `split-heal` |

`lock-ignored` makes node B take a lock node A still holds, but in runs 38110056978 to 38120174431
node B rarely ran the job while node A was inside it, so `no-overlap` failed under it only once in
three runs. The overlap check is instead shown to work on the fixture logs. `permission-session`
has no fault in the matrix: removing the cache clear from uPortal was shown once to make it fail
(see the handoff note), and `AuthorizationImplCacheTest` in uPortal guards the clear since.

## Running it

You need Docker, Node.js, curl, Java 11 for the portal and a JDK 21 for Gradle (see
"Prerequisites" in `README.md`), a `gradle.properties`, and about 4 GB of free memory.
`split-heal` also needs `iptables`. The script runs it directly as root, and through
`sudo -n` otherwise, which works on GitHub's runners.

```bash
tests/cluster/cluster.sh                          # deploy, start both nodes, run every check
tests/cluster/cluster.sh --fault replication-off  # a seeded fault must be caught
tests/cluster/cluster.sh --keep                   # leave the nodes and the database running
tests/cluster/cluster.sh --no-deploy              # reuse them (after --keep)
tests/cluster/cluster.sh --join-starts 20         # start node B 20 times, count the joins
tests/cluster/cluster.sh --lone-restarts 10       # crash and restart node A alone 10 times
```

`--join-starts` skips the checks. It starts node A, then starts and stops node B N times, and writes
each start's `cluster-join` outcome to `build/cluster/join-starts.txt`. `--lone-restarts` starts
node A alone, then kills it with `kill -9` and starts it again N times. JDBC_PING returns the row
the killed node left in `JGROUPSPING` as a coordinator. The restarted node sends JOINs to that dead
address until it gives up after `join_timeout` × `max_join_attempts`.
`build/cluster/lone-restarts.txt` has the wait of each restart, which a longer join setting adds to
every single-server restart after a crash.

Arguments after `--` are passed to every Gradle call, and results are in `build/cluster/results.txt`, with
both nodes' logs in `build/cluster/logs-a` and `logs-b`; on GitHub Actions failed checks also
become annotations and the results a job summary.

`.github/workflows/integration.yml` runs the test (job `cluster`) on every push against uPortal
built from source, and nightly also with each seeded fault.
