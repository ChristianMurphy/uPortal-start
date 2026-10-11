# G-index: large-campus workload and index audit

G-index answers one question for the uPortal 6.0 schema: does every index a high-traffic portal
needs exist, and which indexes cost writes without serving a query? It is the `G-index` check of the uPortal 6.0
modernization plan (MOD-D12), and its findings define the 6.0 index set (MOD-D11, MOD-D25).

For one database (PostgreSQL 18 or MariaDB 12.3), `tests/db/gindex/gindex.sh`:

1. starts the database with statement statistics on (`pg_stat_statements` and `auto_explain` on
   PostgreSQL, `performance_schema` on MariaDB);
2. deploys every overlay against it and runs `dataInit`;
3. starts the portal, has the quickstart `student` customize their layout through the layout API
   (a new tab with two columns, a favorite), stops the portal and reads that layout as the template
   for generated users. The student's layout is then reset to the one the Playwright specs
   expect;
4. generates a synthetic campus with a seeded generator and bulk-loads it (`COPY` on PostgreSQL,
   `LOAD DATA` on MariaDB), with foreign keys on, then positions every ID generator and counter
   above the new keys and analyzes the tables;
5. starts the portal and runs the workload: the portal's own start, the whole Playwright suite, the
   browsing and login driver, and the analytics jobs the portal schedules (raw-event aggregation,
   the raw-event and event-session purges and the expired-cookie purge, set to run every ~20 s);
6. audits the captured statements, their executed plans and every index.

```bash
tests/db/gindex/gindex.sh postgres-18                       # 1/100 campus, as on every push
tests/db/gindex/gindex.sh --scale 0.05 --duration 600 mariadb-12.3
tests/db/gindex/gindex.sh --keep postgres-18                # keep the loaded database ...
tests/db/gindex/gindex.sh --reuse --no-suite postgres-18    # ... and re-run workload and audit on it
tests/db/gindex/gindex.sh --reuse --ddl change.sql postgres-18   # try an index change
tests/db/gindex/gindex.sh --reuse --fault drop-index:idx_upp_prefs_id postgres-18   # must fail
```

`--reuse` starts the webapps already deployed in the checkout, and each is built with one vendor's
JDBC driver: after a run on another vendor, run `./gradlew -PdbVendor=<vendor> tomcatDeploy` first.
`gindex.sh --help` lists the options. It needs what `tests/db/harness.sh --full-suite` needs, that is
Docker, Java 11 plus a JDK 21 for Gradle, `npm ci`, Chromium for Playwright, and Python 3 (standard
library only). Everything a run writes is in `build/g-index/<vendor>/`: `load.md` (rows and seconds
per table), `workload.md` (what ran, and how often each analytics job's statements did),
`summary.md` and `findings.json` (the audit), the Playwright and driver logs and, on PostgreSQL,
`plans.jsonl` (every executed plan).

## The synthetic campus

Scale 1 is the large campus of MOD-Q7. `--scale` takes a fraction of it.

| Data | Scale 1 | Per push (0.01) |
| --- | --- | --- |
| Local accounts (`UP_PERSON_DIR`, five attributes each); 80 % students, 8 % faculty, 12 % staff | 100,000 | 1,000 |
| Users who have logged in (`UP_USER`, `UP_USER_PROFILE`); the other 10 % log in for the first time during the workload | 90,000 | 900 |
| Users with a customized layout: the template's DLM rows (own tab, columns, `dlm:positionSet`, favorites), stylesheet preferences and two portlet entities with preferences | 27,000 | 270 |
| Local groups, nested five deep (Everyone, colleges, departments, courses, sections); students in three sections, staff and faculty in a department and their affiliation group | 21,400 | 260 |
| Portlet permissions of the departments | 4,800 | 480 |
| Raw events: 5,000,000 a day for 31 days, in visits of about 35 events (login, three tab renders with their portlets, actions, resources, searches, logouts) with a daily curve | 155 M | 1.47 M |
| Event sessions and portal cookies of the last two days (up to) | 285,000 | 2,700 |
| Aggregations of the last 2 years (login, portlet execution, tab render, portlet layout, search, concurrent users) at the configured intervals, for the aggregated groups | 14 M | 1.8 M |

Everything is a function of `(seed, table, row)`: a table or a part of one can be generated alone
and comes out the same each time. `--now` pins the dataset's present. The default is the current
minute, which gives the analytics jobs fresh events to process. The generator keeps the portal working on the data:
values that uPortal stores through `NullSafeStringColumnMapper` get its `_` prefix, profiles point
at a layout only when the user has one of their own, raw events newer than 20 minutes are left
for the aggregation job (each with its own large object on PostgreSQL, as 5.17 stores them, while older,
already aggregated events share one per event type), and the aggregation status says where the
jobs left off. Aggregations have a row per interval and portlet (or search term). Below scale 0.1 the
number of portlets and terms shrinks with the scale, since a smaller campus has as many intervals but
fewer portlets in use.

## The checks

| Check | Fails the audit | How |
| --- | --- | --- |
| `seq-scan` | yes | A `Seq Scan` in a plan the workload executed (`auto_explain` with `ANALYZE, BUFFERS`) on a table with at least `--min-rows` rows (1,000). The statement is planned again with sequential scans disabled. Without an index condition on the table in that plan, the finding reports "no usable index" with a suggested index from the scan's filter or join condition. With one, the scan counts only on a table ten times the threshold. |
| `fk-no-index` | yes | A foreign key whose columns are not the leading columns of an index |
| `duplicate-index` | yes | Indexes with the same key columns (a plain index never makes a unique one redundant) |
| `redundant-index` | yes | A plain index whose key columns are a left prefix of another index's |
| `unused-index` | no, reported | `idx_scan = 0` after the workload: removal candidates, marked when they back a constraint |
| `top-total`, `top-mean` | no, reported | The workload's statements with the highest total and mean time |

MariaDB gets the same checks from `performance_schema` (statement digests that ran without an index,
index I/O per index) and `information_schema`. InnoDB creates an index for every foreign key, which
keeps `fk-no-index` empty there. Those indexes show up as redundant when another index covers them.

Only uPortal's own tables (`up_*`) are audited (`audit.py --tables`); the bundled portlets keep
their tables in the same database and their 5.x schema in 6.0 (MOD-D11).

### The allowlist

`tests/db/gindex/allowlist.txt` lists the findings that do not fail the audit, each with a reason:
`<check> <subject glob> [vendor=x] [required] -- <reason>`. The subject is `<table>.<constraint or index>`,
or `<table>@<statement>` for a sequential scan, where the eight hex digits identify one SQL
statement (shown in the summary). They're an md5 of the statement's text in lower case, without
quoting, spacing or the aliases Hibernate numbers (`localaccou0_`, `USER_DIR1_13_0_`, `l1_0`), so a
Hibernate upgrade that renumbers its aliases keeps them. Entries marked `6.0:` are 5.17 gaps that the 6.0 index set
removes. Delete them when that change is merged. A new statement that scans a large table fails the
audit until it is fixed or reviewed into the list, and so do new foreign keys and duplicate indexes
the checks report. The summary lists the entries that didn't match a finding. An entry marked
`required` fails the audit when it doesn't match a finding: the R4 foreign-key checks use it, so their
entries come out when R4's index lands and can't cover a later scan of the same tables.

On GitHub Actions the load, workload and audit tables go to the job summary and every failing
finding becomes an annotation with its suggested DDL.

## CI

`.github/workflows/g-index.yml` builds uPortal from source like `integration.yml` (the branch of
the same name, else its parent branch, else `master`) and runs:

* **every push:** PostgreSQL 18 at scale 0.01 with the whole Playwright suite and four minutes of
  the driver, then, on the same database, the seeded faults (`idx_upp_prefs_id` dropped, a second
  index on `UP_USER (USER_NAME)`), which must fail the audit with those findings;
* **nightly** (and on a manual run with `nightly`): PostgreSQL 18 and MariaDB 12.3 at scale 0.05,
  ten minutes of the driver. A manual run can set any scale.

## Full scale

The whole campus (scale 1) needs a machine with about 16 cores, 64 GB of memory and 200 GB of
disk. 155 million raw events take about 60 GB in PostgreSQL plus their indexes. Generating them
uses about one CPU-hour, split into up to 32 parts that load in parallel. Run it with a longer driver and more users:

```bash
tests/db/gindex/gindex.sh --scale 1 --duration 1800 --concurrency 200 --keep postgres-18
```
