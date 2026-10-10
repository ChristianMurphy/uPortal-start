# Handoff: G-index, the large-campus workload and index audit (MOD-D12)

Workstream branch: `ccr-43ba0785-hzlrj5-gindex` (uPortal-start only; uPortal is unchanged).
User documentation: [`docs/g-index.md`](../../../g-index.md).

## What was built

| Piece | File | What it does |
| --- | --- | --- |
| Data generator | `tests/db/gindex/generate.py` | Seeded and repeatable: every value is a function of (seed, table, row). It is configurable from 1/100 up to the MOD-Q7 campus. It covers accounts and attributes, users and profiles, DLM layouts with fragments and user customizations, stylesheet preferences, portlet entities and preferences, nested local groups and memberships, permissions, event sessions, portal cookies, 31 days of raw events and 2 years of aggregations with their dimensions. Data is loaded with `COPY` (PostgreSQL) or `LOAD DATA` (MariaDB) in parallel parts, with foreign keys on, then every sequence and `UP_SEQUENCE` counter is positioned. |
| Workload driver | `tests/db/gindex/driver.mjs` | Concurrent logins (first logins included), layout renders, tab switches, maximized portlets, searches, portlet-list and layout API calls, logouts and guest visits. It fails on more than 5 % errors. |
| Orchestrator | `tests/db/gindex/gindex.sh` | Starts the database with statement capture on, deploys every overlay and runs dataInit. A template user customizes a layout through the layout API, then the campus is generated and loaded. The workload is the portal start, the whole Playwright suite, the driver and the analytics jobs (aggregation, the raw-event and event-session purges, the cookie purge; every ~20 s, `purgeDelay=P30D`). The run ends with the audit. `--keep`, `--reuse`, `--ddl` and `--fault` are for before/after runs and seeded faults. |
| Audit | `tests/db/gindex/audit.py` | Checks: `seq-scan`, `fk-no-index`, `duplicate-index` and `redundant-index` fail the gate; `unused-index`, `top-total` and `top-mean` are reported. Output: a findings table in the job summary, annotations, `findings.json`. |
| Allowlist | `tests/db/gindex/allowlist.txt` | 51 reviewed entries, each with a reason; `6.0:` entries name the change below that removes them |
| Proposed DDL | `tests/db/gindex/proposed-6.0-postgres.sql` | R1–R5, R8 and R9 as PostgreSQL DDL, used for the before/after run |
| CI | `.github/workflows/g-index.yml` | Every push: PostgreSQL 18 at 1/100, then seeded faults that must fail. Nightly: PostgreSQL 18 and MariaDB 12.3 at 1/20. |

How the checks work on PostgreSQL:

* **Plans.** `auto_explain` logs the executed plan of every statement during the workload (`ANALYZE, BUFFERS`, JSON).
* **Re-planning.** A `Seq Scan` on a table of 1,000 rows or more is planned again with `GENERIC_PLAN` and `enable_seqscan=off`.
  * If no index condition appears, it is a missing index. The finding suggests DDL from the scan's filter or the join condition above it.
  * If one does appear, the planner chose the scan. That only counts on tables of 10,000 rows or more.
* **Statement stats.** `pg_stat_statements` lives in its own `gindex` schema, so the audit and the harness see only uPortal's objects. The statement and index statistics are frozen when the workload ends, before the audit runs its own queries.

On MariaDB:

* **Digests and index use.** Statement digests and per-index I/O come from `performance_schema` and are frozen into a `gindex` database.
* **Locating scans.** A digest that used no index is `EXPLAIN`ed with `'1'` for each placeholder. Only the tables read with `type ALL` are reported. This removed false positives on joins such as `UP_GROUP` × `UP_GROUP_MEMBERSHIP`.
* **Scope.** Only uPortal's `up_*` tables are audited. The bundled portlets' tables keep their 5.x schema (MOD-D11), but their 50 foreign keys without an index are listed in `findings.json` when `--tables '*'` is used.

### How the generated data stays valid

Each of these came from a failed portal run on the first loads:

* **Prefixed values.** Values mapped through `NullSafeStringColumnMapper` are stored with a `_` prefix. This applies to person attribute values, portlet preference values and layout attribute values.
* **Profiles.** A profile's `LAYOUT_ID` is 0 until its user owns a layout. Customized users also need their `UP_USER_LAYOUT` row.
* **Counters.** The counter store hands out the block *below* the stored `UP_SEQUENCE` value, so counters keep one block of margin.
* **Raw events.** The aggregation job reads raw events newer than 20 minutes. On PostgreSQL each of these gets its own large object, as 5.17 stores them (MOD-I24). Older events share one large object per event type.
* **Aggregation status.** `UP_EVENT_AGGR_STATUS` says where the jobs left off, so the aggregator doesn't walk 31 days of history.

## Scale reached and load times

| Run | Rows loaded | Load time | Where |
| --- | ---: | ---: | --- |
| PostgreSQL 18, scale 0.01 (1,000 users, 1.47 M raw events, 1.8 M aggregation rows) | 3,280,693 | 194 s | this container (4 vCPU) |
| MariaDB 12.3, scale 0.01 | 3,285,154 | 73 s | this container |
| PostgreSQL 18, person tables at scale 1 (100,018 accounts, 500,052 attributes) on the 0.01 campus | +600,000 | 25 s | this container, before/after run |
| PostgreSQL 18 and MariaDB 12.3, scale 0.05 | see CI | see CI | GitHub runner (nightly set) |

The full campus (scale 1: 100,000 users, 155 M raw events, about 14 M aggregation rows) is documented in `docs/g-index.md`, "Full scale". It needs about 16 cores, 64 GB of memory and 200 GB of disk. It was not run here.

Statements captured with the driver alone (2.5 to 4 minutes):
* PostgreSQL: 180 to 215 distinct statements, 56,000 to 94,000 executions, 54,000 to 88,000 executed plans.
* MariaDB: 280 digests, 454,000 executions.

CI adds the whole Playwright suite (124 specs).

## Audit results (5.17 schema)

PostgreSQL 18, scale 0.01, driver workload:

| Check | Findings | Failing | Allowlisted |
| --- | ---: | ---: | ---: |
| seq-scan (executed plans, tables ≥ 1,000 rows) | 5 statements, all on `UP_PERSON_ATTR`/`_VALUES` | 0 | 5 |
| fk-no-index | 33 (`up_*`), plus 17 in portlet tables | 0 | 33 |
| duplicate-index | 0 | 0 | 0 |
| redundant-index | 9 | 0 | 9 |
| unused-index (report) | 116, of which 39 back no constraint | | |

MariaDB 12.3, scale 0.01, driver workload:

| Check | Findings | Failing | Allowlisted |
| --- | ---: | ---: | ---: |
| seq-scan (`type ALL`) | 8 | 0 | 8 |
| fk-no-index | 0 (InnoDB indexes every foreign key) | 0 | 0 |
| duplicate-index | 11 | 0 | 11 |
| redundant-index | 32 (InnoDB's foreign-key indexes covered by a primary or unique key) | 0 | 32 |
| unused-index (report) | 147, of which 45 back no constraint | | |

### Main findings

1. **Login reads all of `UP_PERSON_ATTR`.** Every local-account lookup joins `UP_PERSON_ATTR` on `USER_DIR_ID`, which has no index. That column is a foreign key.
   * At 100,000 accounts the two login statements take 67 ms and 60 ms each, and run twice per login.
   * They are the 2nd and 3rd statements by total time.
2. **The aggregation job's group list is the top statement by total time on PostgreSQL.** It is `select distinct … from UP_LOGIN_EVENT_AGGR join UP_AGGR_GROUP_MAPPING`, and the same on `UP_CONCURRENT_USER_AGGR`.
   * It reads a whole aggregation table every run: 104 ms and 116 ms mean at 1/100, 2 years of history.
   * It is linear in history, so it costs about 100× more at full scale.
   * On PostgreSQL it only survives as an index-only scan of the "redundant" `idx_up_*_grp` index (see the before/after).
3. **People search** (`lower(ATTR_VALUE) like '%term%'`) and the attribute-name list scan `UP_PERSON_ATTR(_VALUES)`: 271 ms and 250 ms at 100,000 accounts.
4. **`UP_RAW_EVENTS` has six secondary indexes; only `TIMESTAMP` is ever used.** The table takes 5 M inserts and 5 M `AGGREGATED` updates a day. Indexing `AGGREGATED` prevents HOT updates.
5. **Foreign keys whose parent rows are deleted in normal operation have no index.** The purge or delete then scans the child table:
   * the cookie purge, on `UP_PORTLET_COOKIES`;
   * closing an interval, which deletes its `UP_UNIQUE_STR` rows, on `UP_LOGIN_EVENT_AGGR` and `UP_CONCURRENT_USER_AGGR`;
   * deleting a portlet or its preferences, on `UP_PORTLET_ENT`.
6. **MariaDB carries 43 extra indexes.** InnoDB created its own index for each foreign key whose covering key didn't exist yet (32, covered by the primary or a unique key). uPortal's `IDX_*` indexes duplicate them (11).
7. **Unused in the workload, on both vendors:**
   * `*_INTRVL` (`AGGR_INTERVAL`, 3–4 distinct values) on every aggregation table;
   * six single-column `UP_DATE_DIMENSION` indexes and three `UP_TIME_DIMENSION` ones (tables of 1,826 and 1,440 rows);
   * four `UP_ANALYTICS_EVENTS` and four `UP_RAW_EVENTS` indexes;
   * `IDX_PORTLET_DEF__TITLE`;
   * five single-column `UP_PERMISSION` indexes;
   * `*_DTIC` (see "Not covered yet").
8. **Operations.** The portal and its portlets use all 100 of PostgreSQL's default connections. The audit's own connection failed with "too many clients" until the G-index database started with `max_connections=300`. 6.0's installation guide should give a connection budget (portal pool plus each portlet's).

## Gate results

| Run | Result |
| --- | --- |
| Local, PostgreSQL 18, 0.01, driver | audit passes (0 failing, 47 allowlisted) |
| Local, MariaDB 12.3, 0.01, driver | audit passes (0 failing, 51 allowlisted) |
| Local, seeded faults on PostgreSQL | fails as required (below) |
| CI per-push set | `RUN_PUSH` (G-index workflow) |
| CI nightly set, proven once on push | `RUN_NIGHTLY` |
| Workflow lint | `RUN_LINT` |

### Seeded-fault evidence

`gindex.sh --reuse --fault drop-index:idx_upp_prefs_id --fault duplicate-index:up_user:user_name postgres-18`
drops the index the workload uses for portlet preferences (1,257 scans in a clean run) and adds a
second index on `UP_USER (USER_NAME)`. The audit failed with exit status 1 and five findings, each
with its DDL:

| Check | Subject | Detail | Suggested DDL |
| --- | --- | --- | --- |
| seq-scan | `up_portlet_pref@4471db74` | 1,241 rows, 161 executions, no usable index (portlet entity with its preferences) | `CREATE INDEX … ON up_portlet_pref (portlet_prefs_id);` |
| seq-scan | `up_portlet_pref@cf5796ba` | 23 executions, no usable index | same |
| seq-scan | `up_portlet_pref@3fda8768` | 1 execution, no usable index | same |
| fk-no-index | `up_portlet_pref.fk_pgqclxrroe8ed8stf00pt2s93` | `(portlet_prefs_id) -> up_portlet_prefs` | same |
| duplicate-index | `up_user.gx_fault_dup` | covered by `upu_user_name` | `DROP INDEX gx_fault_dup;` |

CI repeats this on every push. The "Seeded faults must fail the audit" step fails unless all three kinds of finding appear without an allowlist entry. Its annotations are notices, not errors.

The before/after run also caught a fault nobody seeded. Dropping the six `idx_up_*_grp` indexes, which are covered by each table's unique key, made the aggregation job's `DISTINCT` group query a full scan of `UP_LOGIN_EVENT_AGGR` and `UP_CONCURRENT_USER_AGGR`. The gate failed on it (`seq-scan up_login_event_aggr@a3f20bff`, 311 executions). R8 was changed to keep those indexes until R7.

## Before/after: the proposed index set

PostgreSQL 18, 0.01 campus with the person tables at full scale (100,018 accounts), 8 driver users for 150 s, same seed. "Before" is the 5.17 index set; "after" is `tests/db/gindex/proposed-6.0-postgres.sql` (R1–R5, R8 without the `grp` drops, R9).

| Statement | Before | After |
| --- | ---: | ---: |
| Local account with attributes, by user name (login) | 67.0 ms × 321 | **0.19 ms** × 375 |
| Local account, distinct, by user name (login) | 59.9 ms × 325 | **0.13 ms** × 378 |
| Attributes of one account (`where USER_DIR_ID=?`) | 35.1 ms | **0.04 ms** |
| `insert into UP_RAW_EVENTS` | 0.036 ms × 31,150 | **0.013 ms** × 27,125 |
| `update UP_RAW_EVENTS set AGGREGATED…` | 0.101 ms × 8,000 | **0.047 ms** × 9,000 |
| Aggregation job, unaggregated events (1 batch) | 305 ms | 84 ms |
| All statements, total database time | 88.1 s | **52.0 s (−41 %)** |
| Driver: mean login request (render included) | 1,595 ms | 1,103 ms |
| Driver: requests in 150 s | 3,180 | 3,888 (+22 %) |

At scale 0.01 with 1,000 accounts the login statements gain little: about 1 ms either way. The win grows with the number of accounts, as the seq-scan finding predicts.

## Recommended 6.0 index changes

In 6.0 these become `@Index` declarations generated by Hibernate 7 (MOD-D11), created by the copy tool and snapshotted by the harness. Names follow the 6.0 naming rule (placeholders here).

| ID | Change | DDL (PostgreSQL; the same columns on every vendor) | Evidence |
| --- | --- | --- | --- |
| R1 | Index the local-account join key | `CREATE INDEX up_person_attr_user_dir_idx ON up_person_attr (user_dir_id);` | seq-scan ×4, fk-no-index; 350× faster login lookups |
| R2 | Index portlet entities by definition and preferences | `CREATE INDEX up_portlet_ent_def_idx ON up_portlet_ent (portlet_def_id);` `CREATE INDEX up_portlet_ent_prefs_idx ON up_portlet_ent (portlet_prefs_id);` | fk-no-index; parent deletes scan a user-scale table |
| R3 | Index portlet cookies by portal cookie | `CREATE INDEX up_portlet_cookies_portal_idx ON up_portlet_cookies (portalcookie_portal_cookie_id);` | fk-no-index; hourly purge deletes portal cookies |
| R4 | Index unique-string references | `CREATE INDEX … ON up_login_event_aggr (unique_strings_id);` `… ON up_concurrent_user_aggr (unique_strings_id);` `… ON up_unique_str_segment (unique_str_id);` | fk-no-index; every closed interval deletes its unique strings |
| R5 | Index definition parameters and lifecycle | `… ON up_portlet_def_param (portlet_def_id);` `… ON up_portlet_lifecycle (portlet_def_id);` | fk-no-index; collection loads by definition |
| R6 | People search and the attribute list | PostgreSQL: `CREATE EXTENSION pg_trgm; CREATE INDEX up_person_attr_values_trgm_idx ON up_person_attr_values USING gin (lower(attr_value) gin_trgm_ops);` and, every vendor: `CREATE INDEX up_person_attr_name_idx ON up_person_attr (attr_name);` | seq-scan; 271 ms and 250 ms at 100,000 accounts. Not measured yet. |
| R7 | Code, not DDL: the aggregation job's group list | Replace `select distinct mapping from UP_*_AGGR join UP_AGGR_GROUP_MAPPING` with a read of `UP_AGGR_GROUP_MAPPING` (or `EXISTS` per mapping) | top-total, 104–116 ms mean, linear in history; then R8 can drop the `grp` indexes |
| R8 | Drop covered indexes | `DROP INDEX idx_up_plt_exec_aggr_dti, idx_up_tab_rend_aggr_dti, idx_message__code;` and, after R7, the six `idx_up_*_grp` | redundant-index; the `grp` drops are blocked by the G-index finding above |
| R9 | Drop the raw-event indexes nothing uses | `DROP INDEX idx_up_raw_events_session_id, idx_up_raw_events_server_id, idx_up_raw_events_user_name, idx_up_raw_events_err_aggr, idx_up_raw_events_aggregated;` | unused-index; insert −64 %, aggregation update −53 % |
| R10 | MariaDB/MySQL: no InnoDB-created duplicates | Create primary and unique keys and declared indexes before the foreign keys, and don't declare `IDX_*` indexes on foreign-key columns InnoDB already indexes | 32 redundant and 11 duplicate on MariaDB |
| R11 | Drop low-value indexes (after the reporting check below) | `*_intrvl` on the six aggregation tables; `idx_up_dd_*` (6) and `idx_up_td_*` (3) on the dimensions; the four `UP_ANALYTICS_EVENTS` single-column indexes; `idx_portlet_def__title` | unused-index on both vendors; low selectivity or tiny tables |

### BRIN, INCLUDE, partial indexes and time partitioning (MOD-D25)

* **Time partitioning: recommended** for `UP_RAW_EVENTS` (daily), `UP_EVENT_SESSION` (daily) and the aggregation tables (monthly).
  * The raw-event purge is a single `DELETE … WHERE TIMESTAMP < ?`. At full scale it removes 5 M rows a day; on MariaDB it already averages 32 ms per run at 1/100.
  * With partitions it becomes a partition drop. Aggregation history becomes prunable.
  * The copy tool can already load a partitioned PostgreSQL table through its parent (MOD-D28).
* **BRIN:** for `UP_RAW_EVENTS (TIMESTAMP)` only together with partitioning.
  * Raw events are appended in time order, so BRIN would be tiny.
  * The portal also runs `min(TIMESTAMP)` and `max(TIMESTAMP)`, which BRIN cannot answer. Keep the btree (one small one per partition), or BRIN plus partition bounds.
* **Partial index for unaggregated events: not recommended.** The aggregator binds the flag values as parameters (`AGGREGATED is null or AGGREGATED=$4`), so a generic plan cannot prove a partial predicate. The `TIMESTAMP` btree already serves the query's range.
* **INCLUDE: no candidate yet.** After R1 the login lookups are index scans on small row sets. Revisit when the reporting workload is in (below).

## What's left

* **First CI runs.** `RUN_PUSH` and `RUN_NIGHTLY` were queued behind other workstreams' runs when this note was written. Their results are the gate evidence for the whole-Playwright-suite workload; local runs used the driver only.
* **Reporting in the workload.** The workload has no statistics-portlet or reporting queries yet. Until it does, `*_DTIC`, `*_DTI` and `idx_up_search_req_trm` stay (R11 excludes them), and the `UP_PERMISSION` single-column indexes stay until the permissions-manager specs' plans are reviewed in CI.
* **Unmeasured changes.** Measure R6 (trigram) and R7 (a uPortal code change), and measure partitioning at scale.
* **Full scale.** Run scale 1 on real hardware.
* **Workload overlap with the cluster workstream (`-cluster`).**
  * Its k6/Gatling scenario and `driver.mjs` cover the same journeys.
  * They could share the user list: generated users `gx000001`…, password `student`, from `generate.py plan`.
  * The cluster scenario could run against a G-index-loaded database (`gindex.sh --keep`, then point the cluster at it), and its statements would then be audited by `audit.py`.
* **Blocked in this sandbox.**
  * `jitpack.io` is blocked by the egress policy (HTTP 403 on CONNECT), so uPortal could not be built from source here. Local runs used the released 5.17.9 WAR (same 5.17 schema). CI builds the integration branch.
  * `dataInit` needs `google-visualization-java` from jitpack. Locally it was installed into `~/.m2` from the jar bundled in the 5.17.9 WAR.
  * Maven Central and Docker Hub answered with HTTP 429. Local-only fixes: a Gradle init script pointing to Google's Central mirror, and Docker's `mirror.gcr.io`.
* **Lint gap.** `npm run lint:eslint` also reports `tests/db/migrate/matrix.mjs` (missing Node globals), which predates this branch. `driver.mjs` declares its globals.

## Proposed LOG entries

* **MOD-D? — G-index gate (MOD-D12) delivered.**
  * Generator, driver, audit, allowlist and CI as above.
  * PostgreSQL 18 per push at 1/100 with seeded faults; PostgreSQL 18 and MariaDB 12.3 nightly at 1/20.
  * The 6.0 index set is R1–R11 in `notes/g-index.md`, with R7 a code change.
  * Before/after at 100,000 accounts: −41 % database time, login lookups 350× faster.
* **MOD-I? — Local-account login reads all of `UP_PERSON_ATTR`.** `USER_DIR_ID` has no index; at 100,000 accounts each login spends about 130 ms in two lookups. Fix: R1 (also a 5.17.x upstream candidate: an index only, no schema drift in behaviour).
* **MOD-I? — Aggregation job's `DISTINCT` group query reads whole aggregation tables every minute** (`getAggregatedGroupMappings`). It is linear in history and the top statement by total time. Fix: R7, then R8.
* **MOD-I? — `UP_RAW_EVENTS` carries five unused indexes.** One of them is on the updated `AGGREGATED` flag, so 5 M updates a day can't be HOT. Fix: R9 (−53 % to −64 % per statement).
* **MOD-I? — Foreign keys without indexes on purged or deleted parents.** Affects cookies, unique strings and portlet entities (R2–R4).
* **MOD-I? — MariaDB/MySQL schemas carry 43 InnoDB-created duplicate or covered foreign-key indexes** (R10).
* **MOD-I? — The portal plus its portlets use all 100 default PostgreSQL connections.** Document a connection budget for 6.0.
