# Handoff: G-index, the large-campus workload and index audit (MOD-D12)

Workstream branch: `ccr-43ba0785-hzlrj5-gindex` in uPortal-start. uPortal itself is unchanged.
User documentation: [`docs/g-index.md`](../../../g-index.md).

## What was built

| Piece | File | What it does |
| --- | --- | --- |
| Data generator | `tests/db/gindex/generate.py` | Seeded and repeatable: every value is a function of (seed, table, row). Scale runs from 1/100 to the MOD-Q7 campus. It covers accounts and attributes, users and profiles, DLM layouts with fragments and user customizations, stylesheet preferences, portlet entities and preferences, nested local groups, memberships, permissions, event sessions, portal cookies, 31 days of raw events and 2 years of aggregations with their dimensions. It loads with `COPY` (PostgreSQL) or `LOAD DATA` (MariaDB) in parallel parts with foreign keys on, then positions every sequence and `UP_SEQUENCE` counter. |
| Workload driver | `tests/db/gindex/driver.mjs` | Concurrent logins (first logins included), layout renders, tab switches, maximized portlets, searches, portlet-list and layout API calls, logouts and guest visits. It fails on more than 5 % errors. |
| Orchestrator | `tests/db/gindex/gindex.sh` | Starts the database with statement capture and deploys every overlay. After dataInit it has a template user customize a layout through the layout API, then loads the campus. The run ends with the workload and its audit. The workload is the portal start, the whole Playwright suite, the driver, and the analytics jobs (aggregation, the raw-event and event-session purges and the cookie purge, every ~20 s, `purgeDelay=P30D`). `--keep`, `--reuse`, `--ddl` and `--fault` support before/after runs and seeded faults. |
| Audit | `tests/db/gindex/audit.py` | Checks `seq-scan`, `fk-no-index`, `duplicate-index` and `redundant-index`, which fail the run, and reports `unused-index`, `top-total` and `top-mean`. Output: a findings table in the job summary, annotations, `findings.json`. |
| Allowlist | `tests/db/gindex/allowlist.txt` | Reviewed findings, each with a reason. Entries marked `6.0:` give the change below that removes them. |
| Proposed DDL | `tests/db/gindex/proposed-6.0-postgres.sql` | R1 to R5, R8, R9 and R12 to R15 as PostgreSQL DDL, used for the before/after run |
| CI | `.github/workflows/g-index.yml` | Every push: PostgreSQL 18 at 1/100, then seeded faults that must fail the audit. Nightly or on a manual run: PostgreSQL 18 and MariaDB 12.3 at 1/20. |

On PostgreSQL, `auto_explain` logs the plan of every statement the workload executes, with `ANALYZE` and `BUFFERS`, as JSON. The audit plans each `Seq Scan` on a table of 1,000 rows or more again with `GENERIC_PLAN` and `enable_seqscan=off`. If no index condition appears, the finding reports a missing index and suggests DDL from the scan's filter or the join condition above it. If one appears, the planner chose the scan, and that counts only on tables of 10,000 rows or more. `pg_stat_statements` lives in a `gindex` schema, so the audit and the harness see only uPortal's objects. The statement and index statistics are frozen when the workload ends, before the audit runs its own queries.

On MariaDB, the statement digests and per-index I/O come from `performance_schema` and are frozen into a `gindex` database. The audit runs `EXPLAIN` on each digest that ran without an index, with `'1'` for each placeholder, and reports only the tables read with `type ALL`. That removed false positives on joins such as `UP_GROUP` with `UP_GROUP_MEMBERSHIP`.

Only uPortal's `up_*` tables are audited. The bundled portlets keep their 5.x schema (MOD-D11). Their 50 foreign keys without an index appear in `findings.json` with `--tables '*'`.

### Rules the generated data follows

Each rule below came from a portal run that failed on an early load.

* Values mapped through `NullSafeStringColumnMapper` (person attribute values, portlet preference values, layout attribute values) are stored with a `_` prefix.
* A profile's `LAYOUT_ID` is 0 until its user has a layout of their own, and customized users also need their `UP_USER_LAYOUT` row.
* The counter store hands out the block below the stored `UP_SEQUENCE` value. The counters keep one block of margin for that reason.
* The raw events newer than 20 minutes are left for the aggregation job, each with its own large object on PostgreSQL as 5.17 stores them (MOD-I24). Older events share one large object per event type.
* `UP_EVENT_AGGR_STATUS` records where the jobs left off. The aggregator then starts near the present and doesn't walk 31 days of history.

## Scale and load times

| Run | Rows loaded | Load time | Where |
| --- | ---: | ---: | --- |
| PostgreSQL 18, scale 0.01 (1,000 users, 1.47 M raw events, 1.8 M aggregation rows) | 3,238,981 | 189 s | GitHub runner, run 38100597244 |
| PostgreSQL 18, scale 0.05 (5,000 users, 7.1 M raw events, 4.4 M aggregation rows) | 12,103,317 | 525 s | GitHub runner, run 38100597244 |
| MariaDB 12.3, scale 0.01 | 3,285,154 | 73 s | this container |
| PostgreSQL 18, person tables at scale 1 (100,018 accounts, 500,052 attributes) on the 0.01 campus | +600,000 | 25 s | this container, before/after run |

The full campus (scale 1: 100,000 users, 155 M raw events, about 14 M aggregation rows) needs about 16 cores, 64 GB of memory and 200 GB of disk ("Full scale" in `docs/g-index.md`). It was not run here.

Statements captured in CI with the whole Playwright suite (124 passed) and the driver:

* PostgreSQL 0.01: 357 distinct statements, 194,760 executions, 172,982 executed plans.
* PostgreSQL 0.05: 358 statements, 392,837 executions, 355,053 executed plans.
* MariaDB 0.01 in this container, driver only: 280 digests, 454,440 executions.

## Audit results on the 5.17 schema

| Check | PostgreSQL 18 | MariaDB 12.3 |
| --- | --- | --- |
| seq-scan | 26 statements, on `UP_PERSON_ATTR(_VALUES)`, `UP_PERSON_DIR`, `UP_GROUP_MEMBERSHIP`, `UP_GROUP`, `UP_USER`, `UP_PORTLET_ENT`, `UP_PORTAL_COOKIES` and `UP_TIME_DIMENSION` | 17, on the same lookups plus `UP_USER_LAYOUT`, `UP_UNIQUE_STR_SEGMENT__UIDS` and the date dimension |
| fk-no-index | 33 in `up_*` tables, 17 more in the portlets' tables | 0 (InnoDB indexes every foreign key) |
| duplicate-index | 0 | 11 on the 5.17.9 build (uPortal `IDX_*` indexes that repeat an InnoDB foreign-key index), 0 on the integration build |
| redundant-index | 9 | 9 on the integration build, 32 more on 5.17.9 (InnoDB foreign-key indexes that a primary or unique key covers) |
| unused-index (reported) | 100 to 116 by run, about 36 of them back no constraint | 147, of which 45 back no constraint |

All of them are on the allowlist with reasons. The main findings, by cost:

1. The aggregation job's group list is the top statement by total time. `select distinct … from UP_LOGIN_EVENT_AGGR join UP_AGGR_GROUP_MAPPING` (and the same on `UP_CONCURRENT_USER_AGGR`) reads a whole aggregation table on every run. In CI it took 334 ms and 364 ms per call at 1/100 with 2 years of history, and it grows with the history. On PostgreSQL it uses an index-only scan of the `idx_up_*_grp` index that the redundant-index check reports (see the before/after run).
2. Every local-account lookup joins `UP_PERSON_ATTR` on `USER_DIR_ID`, a foreign key without an index. At 100,000 accounts the two login statements take 67 ms and 60 ms, twice per login. Deleting an account also scans the table for the foreign-key check.
3. The groups of a member, read on every login and permission check, filter `UP_GROUP_MEMBERSHIP` by `MEMBER_KEY`. The primary key leads with `GROUP_ID`, so MariaDB reads all of `UP_GROUP` and probes the key (about 3,000 calls in a run), and PostgreSQL scans the membership table. PostgreSQL 18's skip scan hides the problem below 10,000 rows.
4. The people search (`lower(ATTR_VALUE) like '%term%'`) and the attribute-name list scan `UP_PERSON_ATTR(_VALUES)`: 271 ms and 250 ms at 100,000 accounts.
5. `UP_RAW_EVENTS` has six secondary indexes. The workload uses the one on `TIMESTAMP` and none of the other five. The table takes 5 M inserts and 5 M `AGGREGATED` updates a day, and the index on `AGGREGATED` turns every flag update into a non-HOT update.
6. Parents deleted in normal operation have children without an index on the foreign key: portal cookies (hourly purge), unique strings (every closed interval) and portlet definitions and preferences (portlet manager). Each delete scans the child table, and `UP_PORTLET_ENT` is also read by `PORTLET_DEF_ID` directly.
7. Group-name search (`UPPER(GROUP_NAME) = / LIKE UPPER(?)`), user search (`USER_NAME LIKE ?`) and a user's layouts (`UP_USER_LAYOUT` by `USER_ID`, while the key is `(LAYOUT_ID, USER_ID)`) scan their tables.
8. Unused on both vendors:
   * the `*_INTRVL` indexes on every aggregation table (`AGGR_INTERVAL` has 3 or 4 distinct values);
   * six single-column `UP_DATE_DIMENSION` indexes and three on `UP_TIME_DIMENSION` (1,826 and 1,440 rows);
   * four on `UP_ANALYTICS_EVENTS` and four on `UP_RAW_EVENTS`;
   * `IDX_PORTLET_DEF__TITLE` and five single-column `UP_PERMISSION` indexes;
   * the `*_DTIC` indexes (see "What's left").
9. The portal and its portlets used all 100 of PostgreSQL's default connections, and the audit's own connection then failed with "too many clients". The G-index database starts with `max_connections=300`. The 6.0 installation guide should give a connection budget: the portal's pool plus each portlet's. Follow-up (MOD-I190): the 5.x pool maximums add up to about 373 connections (uPortal's three pools 100 each, NewsReader 50, Announcements 10, Notification 8, SimpleContent 5, and Bookmarks, Calendar and Feedback with no pool). With the whole Playwright suite on PostgreSQL 18 the database had 32 connections at the median and 38 at the peak. uPortal held 27 of them, all idle, and each portlet 0 to 3. The suite never came near 100, so connection exhaustion is unlikely to explain MOD-I192. The harness's sampling later confirmed it on a failing run. Integration job 114465740623 (db-connections a720847) lost the Announcements web application with a peak of 32 connections (server limit less 10: 90). Tomcat logged at 13:41:11 SEVERE `listenerStart` "Exception sending context initialized event to listener instance of class [org.springframework.web.context.ContextLoaderListener]" and "Context [/Announcements] startup failed due to previous errors". The cause line wasn't in the job log (tomcat-log-summary.sh prints it since ccr-43ba0785-hzlrj5-tomcat-causes). Under the G-index driver (16 users for 240 s), `PortalDb` decides it:

   | PortalDb maxActive | "Pool empty" | p50 ms | p95 ms | Peak connections |
   | --- | ---: | ---: | ---: | ---: |
   | 100 (5.x, every 5.x pool size) | 0 | 617 to 706 | 2,982 to 3,333 | 127 |
   | 30 | 215 | 562 | 3,344 | |
   | 50 | 39 | 737 | 3,592 | 77 |
   | 60 | 0 | 644 | 3,723 | 87 |

   The 5.x defaults reach 127 connections under this load, so a 5.x portal on PostgreSQL's default of 100 can run out today. A thread dump at 30 showed why: each page keeps a connection open while its portlets render (request threads wait on the portlet workers with the OpenEntityManagerInView session open), and each portlet render opens a transaction to read its cached portlet definition. The driver's first CI p95 is 5,004 ms at 16 users (G-index run 38135046831, 5.x pools, Hibernate 5.2); no earlier CI p95 exists, and its per-step means are within run-to-run spread of the last run before Hibernate 5.2 (38122934235). The owner chose to fix that in uPortal first (MOD-I240 to MOD-I249) and leave the pool defaults as they are until then. docs/connection-budget.md tells sites to set `max_connections` to at least 150 on PostgreSQL or size it from their own peak. The database harness reports each PostgreSQL run's peak, and the G-index summary reports p50, p95 and "Pool empty".

## CI results

| Run | Commit | Result |
| --- | --- | --- |
| 38095359976 | `9daa0c2` | Push job: audit passed, the seeded-fault step failed on a too strict check (fixed in `8097e9e`). PostgreSQL 0.05 passed. MariaDB 0.05 failed and found R12 to R14. |
| 38099973730 | `7ccf893` | All jobs green: PostgreSQL 0.01 with the seeded faults, PostgreSQL 0.05 and MariaDB 0.05. The PostgreSQL seq-scan check didn't read any plans in this run (`-c auto_explain.log_min_duration=-1` on the command line overrode the `ALTER SYSTEM` that turns it on). |
| 38100597244 | `31142c6` | First run with executed plans in CI. MariaDB 0.05 green. PostgreSQL found 4 (0.01) and 15 (0.05) new statements, now reviewed into the allowlist and R15. |
| 38106800664 | `74bb1f7` | Push job on the light profile (MOD-D30): one new finding, a `DELETE` on `UP_UNIQUE_STR_SEGMENT__UIDS` that the audit didn't re-plan. The primary key serves it, and the table had grown after `ANALYZE` (fixed in `d43f914`). |
| 38108477585 | `d43f914` | Green. PostgreSQL 18 at 1/100: 3,242,266 rows in 246 s, 131 Playwright specs passed, 355 statements, 182,553 executions, 161,682 executed plans. The audit passed (0 failing, 51 allowlisted). The seeded-fault run failed the audit with all three expected findings: seq-scan and fk-no-index on `UP_PORTLET_PREF`, duplicate-index on `UP_USER`. |

The audit now fails when its plan log doesn't contain a plan. A capture problem can't pass unnoticed again.

### Seeded-fault evidence

`gindex.sh --reuse --fault drop-index:idx_upp_prefs_id --fault duplicate-index:up_user:user_name postgres-18` drops the index the workload uses for portlet preferences (1,257 scans in a clean run) and adds a second index on `UP_USER (USER_NAME)`. Locally the audit failed with exit status 1 and five findings, each with its DDL:

| Check | Subject | Detail | Suggested DDL |
| --- | --- | --- | --- |
| seq-scan | `up_portlet_pref@4471db74` | 1,241 rows, 161 executions, no usable index (a portlet entity with its preferences) | `CREATE INDEX … ON up_portlet_pref (portlet_prefs_id);` |
| seq-scan | `up_portlet_pref@cf5796ba` | 23 executions, no usable index | same |
| seq-scan | `up_portlet_pref@3fda8768` | 1 execution, no usable index | same |
| fk-no-index | `up_portlet_pref.fk_pgqclxrroe8ed8stf00pt2s93` | `(portlet_prefs_id) -> up_portlet_prefs` | same |
| duplicate-index | `up_user.gx_fault_dup` | covered by `upu_user_name` | `DROP INDEX gx_fault_dup;` |

CI repeats the run after every push job. Its "Seeded faults must fail the audit" step requires the `fk-no-index` and `duplicate-index` findings and reports the `seq-scan` one when the driver loaded portlet preferences. It passed in runs 38099973730 and 38108477585, with the findings as notice annotations.

The before/after run also caught an index change that would have hurt. Dropping the six `idx_up_*_grp` indexes, which each table's unique key covers, turned the aggregation job's `DISTINCT` group query into a full scan of `UP_LOGIN_EVENT_AGGR` and `UP_CONCURRENT_USER_AGGR` (`seq-scan up_login_event_aggr@a3f20bff`, 311 executions). R8 keeps those indexes until R7.

## Before/after: the proposed index set

PostgreSQL 18, the 0.01 campus with the person tables at full scale (100,018 accounts), 8 driver users for 150 s, same seed. "Before" is the 5.17 index set. "After" is `proposed-6.0-postgres.sql` as of `e99e78d` (R1 to R5, R8 without the `grp` drops, R9).

| Statement | Before | After |
| --- | ---: | ---: |
| Local account with attributes, by user name (login) | 67.0 ms × 321 | **0.19 ms** × 375 |
| Local account, distinct, by user name (login) | 59.9 ms × 325 | **0.13 ms** × 378 |
| Attributes of one account (`where USER_DIR_ID=?`) | 35.1 ms | **0.04 ms** |
| `insert into UP_RAW_EVENTS` | 0.036 ms × 31,150 | **0.013 ms** × 27,125 |
| `update UP_RAW_EVENTS set AGGREGATED…` | 0.101 ms × 8,000 | **0.047 ms** × 9,000 |
| Aggregation job, unaggregated events (1 batch) | 305 ms | 84 ms |
| All statements, total database time | 88.1 s | **52.0 s (−41 %)** |
| Driver: mean login request, render included | 1,595 ms | 1,103 ms |
| Driver: requests in 150 s | 3,180 | 3,888 (+22 %) |

With 1,000 accounts the login statements gain about 1 ms. The gain grows with the number of accounts, as the seq-scan finding predicts. R12 was checked by plan only: on MariaDB the member lookup changes from `ALL` on `UP_GROUP` to `ref` on the new index.

## Recommended 6.0 index changes

In 6.0 these become `@Index` declarations generated by Hibernate 7 (MOD-D11), created by the copy tool and recorded in the harness snapshots. The names follow the 6.0 naming rule (placeholders here).

| ID | Change | DDL (PostgreSQL, the same columns on every vendor) | Evidence |
| --- | --- | --- | --- |
| R1 | Index the local-account join key | `CREATE INDEX up_person_attr_user_dir_idx ON up_person_attr (user_dir_id);` | seq-scan, fk-no-index; login lookups 350× faster |
| R2 | Index portlet entities by definition and preferences | `… ON up_portlet_ent (portlet_def_id);` `… ON up_portlet_ent (portlet_prefs_id);` | fk-no-index, seq-scan in the portlet manager and its deletes |
| R3 | Index portlet cookies by portal cookie | `… ON up_portlet_cookies (portalcookie_portal_cookie_id);` | fk-no-index, hourly purge |
| R4 | Index the unique-string references | `… ON up_login_event_aggr (unique_strings_id);` `… ON up_concurrent_user_aggr (unique_strings_id);` `… ON up_unique_str_segment (unique_str_id);` | fk-no-index, every closed interval |
| R5 | Index definition parameters and lifecycle | `… ON up_portlet_def_param (portlet_def_id);` `… ON up_portlet_lifecycle (portlet_def_id);` | fk-no-index, loads by definition |
| R6 | People search and the attribute list | PostgreSQL: `CREATE EXTENSION pg_trgm; CREATE INDEX … ON up_person_attr_values USING gin (lower(attr_value) gin_trgm_ops);` Every vendor: `… ON up_person_attr (attr_name);` | seq-scan, 271 ms and 250 ms at 100,000 accounts; not measured yet |
| R7 | Code change: the aggregation job's group list | Read `UP_AGGR_GROUP_MAPPING` (or `EXISTS` per mapping) in place of `select distinct mapping from UP_*_AGGR join UP_AGGR_GROUP_MAPPING` | top-total; then R8 can drop the `grp` indexes |
| R8 | Drop covered indexes | `DROP INDEX idx_up_plt_exec_aggr_dti, idx_up_tab_rend_aggr_dti, idx_message__code;` and, after R7, the six `idx_up_*_grp` | redundant-index; the `grp` drops wait for R7 |
| R9 | Drop the raw-event indexes nothing reads | `DROP INDEX idx_up_raw_events_session_id, idx_up_raw_events_server_id, idx_up_raw_events_user_name, idx_up_raw_events_err_aggr, idx_up_raw_events_aggregated;` | unused-index; insert −64 %, aggregation update −53 % |
| R10 | MariaDB and MySQL: avoid InnoDB duplicates | Create primary and unique keys and declared indexes before the foreign keys, and don't declare an `IDX_*` index on a column InnoDB already indexes for a foreign key | 43 findings on the 5.17.9 build, none on the integration build; keep the check |
| R11 | Drop low-value indexes, after the reporting check below | the `*_intrvl` indexes, `idx_up_dd_*` (6), `idx_up_td_*` (3), the four `UP_ANALYTICS_EVENTS` single-column indexes, `idx_portlet_def__title` | unused-index on both vendors |
| R12 | Index group membership by member | `CREATE INDEX up_group_membership_member_idx ON up_group_membership (member_key, member_service, member_is_group);` | seq-scan on both vendors, every login |
| R13 | Case-insensitive group-name search | PostgreSQL: `… ON up_group (upper(group_name) text_pattern_ops);`. MariaDB's case-insensitive collation makes `UPPER` unnecessary there (a code change). | seq-scan, groups manager |
| R14 | Index a user's layouts by user | `… ON up_user_layout (user_id);` | seq-scan on MariaDB |
| R15 | User search by name prefix | PostgreSQL: `… ON up_user (user_name text_pattern_ops);` | seq-scan, user administration |

Time partitioning is recommended for `UP_RAW_EVENTS` (daily), `UP_EVENT_SESSION` (daily) and the aggregation tables (monthly). The raw-event purge is one `DELETE … WHERE TIMESTAMP < ?`. At full scale it removes 5 M rows a day, and on MariaDB it already averages 32 ms per run at 1/100. With partitions it becomes a partition drop, and old aggregations can be pruned. The copy tool can already load a partitioned PostgreSQL table through its parent (MOD-D28).

BRIN on `UP_RAW_EVENTS (TIMESTAMP)` helps only together with partitioning. Raw events arrive in time order, so a BRIN index would be tiny. The portal also runs `min(TIMESTAMP)` and `max(TIMESTAMP)`, which a BRIN index can't answer, so keep a btree per partition.

A partial index for unaggregated events doesn't help. The aggregator binds the flag values as parameters (`AGGREGATED is null or AGGREGATED=$4`), and PostgreSQL proves a partial-index predicate for a generic plan only from literal values. The `TIMESTAMP` btree already serves the query's range.

`INCLUDE` has no candidate yet. After R1 the login lookups are index scans over a few rows. Revisit it when the reporting queries are part of the workload.

## What's left

* The reporting queries (statistics portlet) aren't in the workload yet. Until they are, keep the `*_DTIC` and `*_DTI` indexes and `idx_up_search_req_trm` (R11 leaves them out), and keep the `UP_PERMISSION` single-column indexes until the permissions-manager plans are reviewed.
* Measure R6 (trigram), R7 (a uPortal code change), R12 to R15 and partitioning at scale, then run scale 1 on real hardware.
* Several MariaDB digests were too long to `EXPLAIN` (`max_digest_length=4096`), and those findings list every large table in the statement. Re-check `UP_UNIQUE_STR_SEGMENT__UIDS` and the cookie-purge delete at full scale.
* Workload overlap with the cluster workstream (`-cluster`). Its k6 or Gatling scenario follows the same journeys as `driver.mjs`, and both can use the generated users (`gx000001` onward, password `student`). Pointed at a database loaded by `gindex.sh --keep`, the cluster scenario's statements would also be audited by `audit.py`.
* Sandbox limits, local only:
  * `jitpack.io` is blocked by the egress policy (HTTP 403 on CONNECT), so uPortal couldn't be built from source here. Local runs used the released 5.17.9 WAR, with the same 5.17 schema. CI builds the integration branch.
  * `google-visualization-java` was installed into `~/.m2` from the jar inside the 5.17.9 WAR.
  * Maven Central and Docker Hub answered HTTP 429. A local Gradle init script points at Google's Central mirror, and Docker uses `mirror.gcr.io`.
  * The preinstalled Chromium build doesn't match Playwright 1.64, so local runs ran the API specs and the driver only. CI runs all 124 specs.
* `tests/db/migrate/matrix.mjs` fails `npm run lint:eslint` (Node globals), as it did before this branch. `driver.mjs` declares its globals.

## Proposed LOG entries

* **MOD-D? G-index (MOD-D12) delivered.** It covers the generator, driver, audit, allowlist and CI described above. Every push runs PostgreSQL 18 at 1/100 with seeded faults, and the nightly runs PostgreSQL 18 and MariaDB 12.3 at 1/20. The 6.0 index set is R1 to R15 in `notes/g-index.md`, where R7 is a code change. At 100,000 accounts the proposed DDL cut database time by 41 % and login lookups by 350×.
* **MOD-I? The local-account login reads all of `UP_PERSON_ATTR`.** `USER_DIR_ID` has no index, so at 100,000 accounts each login spends about 130 ms in two lookups. R1 fixes it. It is also a 5.17.x upstream candidate, since it adds an index only.
* **MOD-I? The aggregation job's `DISTINCT` group query reads whole aggregation tables every minute** (`getAggregatedGroupMappings`). It is the top statement by total time and grows with history. Fix: R7, then R8.
* **MOD-I? The groups-of-a-member lookup has no index on `MEMBER_KEY`** and runs on every login and permission check. Fix: R12.
* **MOD-I? `UP_RAW_EVENTS` has five unused indexes**, one on the `AGGREGATED` flag that is updated 5 M times a day. Fix: R9, −53 % to −64 % per statement.
* **MOD-I? Foreign keys without an index on parents that are purged or deleted**: cookies, unique strings, portlet entities. Fix: R2 to R4.
* **MOD-I? The 5.17.9 MariaDB schema has 43 duplicate or covered InnoDB foreign-key indexes.** The integration build has none of them. Fix: R10.
* **MOD-I? The portal and its portlets use all 100 default PostgreSQL connections.** Document a connection budget for 6.0.
