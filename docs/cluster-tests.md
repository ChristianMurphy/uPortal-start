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
JGroups view to `logs/jgroups/portal.jgroups.log` on both nodes, and starts the checks once both
nodes have logged a view of two members.

## The checks

| Check | What it does | Bound |
| --- | --- | --- |
| `invalidation-portlet` | Node B reads a portlet definition (`/api/portlet/what-is-uportal.json`), node A imports it with a new title (`/api/import`), node B must show the new title | 30 s |
| `invalidation-layout` | Node B loads the student's layout, node A adds a tab to it (`/api/layout?action=addTab`), a new student session on node B must have the tab | 30 s |
| `invalidation-permission` | Both nodes deny the student the Permissions Manager portlet; node A grants SUBSCRIBE on it, and node A, then node B must allow it; node A revokes it, and node B must deny it again | 330 s (see below) |
| `jobs-once` | Once node B's scheduled tasks run (120 s after it starts), every test user logs in and renders their layout three times on each node; once the aggregator has read all raw events, each interval's login and portlet-render aggregates (group Everyone) must have grown by exactly the number of raw events | |
| `failover-takeover` | A table lock on `UP_EVENT_AGGR_STATUS` makes the next aggregation run wait inside its cluster lock; the node holding the lock is killed (`kill -9`), the table lock released. The other node must take the lock over no sooner than 60 s after the dead node's last update (it is not abandoned before), and no later than 60 s + the 28 s server bias + 60 s | 148 s |
| `failover-jobs-once` | Like `jobs-once`, over events made before the kill (on both nodes) and after it: the survivor aggregates them all, once | |
| `events-aggregated` | At the end of the run, no raw event is still not aggregated although it is older than the aggregator's last event date (the aggregator never reads it again) | |
| `no-overlap` | From both nodes' `TRACE` logs (`tests/cluster/lock-overlap.mjs`): no clustered job held its lock on both nodes at once, over the whole run | |

Permissions are the exception to replication: uPortal caches permission checks on each node and
does not replicate those caches (`AuthorizationImpl.PRINCIPAL_HAS_PERMISSION` for 180 s and
`AnyUnblockedGrantPermissionPolicy.HAS_UNBLOCKED_GRANT` for 300 s). A permission revoked on one
node is still granted on the others until those entries expire. The check allows that bound
and, when it fails, reports what a new session on the node gets.

The layout check does not depend on replication: uPortal reads a user's layout from the
database when a session starts and keeps it in the session, so a new session on node B sees the
tab with or without replication (the `replication-off` fault does not make it fail). It guards
that node B does not serve the layout from a stale node-wide copy.

## Known failures

The checks in `KNOWN_FAILURES` (`tests/cluster/cluster.sh`) fail because of uPortal problems
this test found. Their failure shows as a warning without failing the run. When one of them
passes, the run says so, and its entry can go once uPortal is fixed.

* `invalidation-permission`: once a node has checked a permission, a grant or revocation made
  through the Permissions Manager does not reach that node's checks within 330 s.
* `events-aggregated`: a node queues its events in memory and stores them only once its
  scheduled tasks run, 120 s after it starts. If another node's aggregator has passed their
  time by then, those events are never aggregated. Every node restart in a running cluster
  loses the events of its first minutes from the statistics.

## Seeded faults

Each check must fail when the thing it guards is broken. `--fault` starts the cluster with a
seeded fault and passes only if the checks meant to catch it fail:

| Fault | Seeded by | Must fail |
| --- | --- | --- |
| `replication-off` | `org.apereo.portal.ehcache.filename=ehcache-no-jgroups.xml` (uPortal's own non-clustered cache file) | `invalidation-portlet` |
| `lock-ignored` | `org.apereo.portal.concurrency.locking.ClusterLockDao.abandonedLockAge=PT0S`: a held lock counts as abandoned at once | `failover-takeover`, `no-overlap` |

## Running it

You need Docker, Node.js, curl, Java 11 for the portal and a JDK 21 for Gradle (see
"Prerequisites" in `README.md`), a `gradle.properties`, and about 4 GB of free memory.

```bash
tests/cluster/cluster.sh                          # deploy, start both nodes, run every check
tests/cluster/cluster.sh --fault replication-off  # a seeded fault must be caught
tests/cluster/cluster.sh --keep                   # leave the nodes and the database running
tests/cluster/cluster.sh --no-deploy              # reuse them (after --keep)
```

Arguments after `--` are passed to every Gradle call, and results are in `build/cluster/results.txt`, with
both nodes' logs in `build/cluster/logs-a` and `logs-b`; on GitHub Actions failed checks also
become annotations and the results a job summary.

`.github/workflows/integration.yml` runs the test (job `cluster`) on every push against uPortal
built from source, and nightly also with each seeded fault.
