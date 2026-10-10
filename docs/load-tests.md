# Load baseline

`tests/load/portal.js` is a [k6](https://k6.io) scenario that puts a steady load on a portal and
compares response times and error rates with the stored baseline in `tests/load/baseline.json`
(MOD-D29). It shows when a phase of the migration makes the portal slower under concurrent use,
which neither the functional suites nor the query budgets (`docs/query-budgets.md`) measure.

## The scenario

After a 30 s warm-up (2 users on the guest page, not measured), three groups of virtual users run
together for 3 minutes:

| Scenario | Users | Each iteration |
| --- | --- | --- |
| `guest` | 5 | the guest welcome page, then 1 s think time |
| `login` | 3 | a new session: `Login?userName=...` (lands on the home page, rendering its portlets), 1 s, `Logout`, 1 s |
| `portlet` | 2 | logged in once, then a maximised portlet (`p/what-is-uportal/max/render.uP`), 1 s |

The users are the four quickstart accounts. That is about 10 concurrent users, which one GitHub
runner (4 vCPUs, 16 GB) sustains with k6, Tomcat (512 MB heap, the uPortal-start default) and
PostgreSQL 18 on the same machine. `SCALE` multiplies the user counts, `DURATION` sets the length.

## Baseline and tolerance

For each scenario `baseline.json` holds the p50 and p95 response time (ms) and the error rate.
The run fails (k6 thresholds) when a scenario's p50 exceeds 1.5 × its baseline + 50 ms, its p95
exceeds 1.5 × its baseline + 100 ms, or more than 1 % of its requests fail. The margins are wide
because shared CI runners vary from run to run; the check catches a phase that makes requests
markedly slower, not a few per cent. The summary (`build/load/summary.txt`, the job summary)
prints the observed values as `observed={...}`, in the format of `baseline.json`; record a new
baseline by copying it there, with the reason in the commit message.

```bash
./gradlew portalInit tomcatStart
mkdir -p build/load && k6 run tests/load/portal.js
k6 run -e SCALE=4 -e DURATION=10m tests/load/portal.js
```

`.github/workflows/integration.yml` runs it nightly (job `load`) on PostgreSQL 18 against uPortal
built from source. k6 comes from Grafana's signed apt repository.

## Scaling to a large campus (MOD-Q7)

MOD-Q7 sizes "high traffic" as about 100k users, 5k concurrent sessions, 5M raw events a day,
30 days of raw events and 2 years of aggregations. A CI runner cannot produce that load, and its
numbers do not transfer to production hardware; the same scenario scales on a dedicated rig:

* **Portal:** two or more uPortal nodes behind a load balancer with sticky sessions, clustered as
  in `docs/cluster-tests.md`, each with a production heap (4–8 GB), on PostgreSQL 18 on its own
  host, with the 6.0 index set (MOD-D12).
* **Users:** generate 100k accounts with `./gradlew perfGenTestData`
  (`data.test.perf.max.users=100000`, see `gradle/tasks/perf.gradle`), import them, and change
  `USERS` in the scenario to read the generated population file through a k6 `SharedArray`, so
  logins spread over many accounts and layouts.
* **Load generators:** k6 on separate machines (or the k6 operator on Kubernetes). 5k concurrent
  sessions with about 30 s of think time between page views is roughly 170 page views a second;
  set `SCALE` and the think times to that mix (most traffic is logged-in home pages and portlet
  renders, logins peak at the start of classes).
* **Data volume:** run against a database that already holds 30 days of raw events and two years
  of aggregations (the G-index generator, MOD-D12), so the aggregation and purge jobs work at
  realistic sizes while the load runs.
* **What to record:** p50/p95/p99 per scenario, error rate, CPU and heap of each node, database
  CPU, connections and slow statements (`pg_stat_statements`), and cluster-lock and cache-replication
  traffic. Keep those results as the large-campus baseline next to this file, and rerun at each
  phase boundary instead of nightly.
