# Database upgrade harness

The harness answers one question for every supported database: does this uPortal build create
exactly the same schema, and back its generated IDs with exactly the same database objects, as
uPortal 5.17 did? A "yes" on every vendor is what lets an existing production database upgrade in
place without manual SQL. It is the `G-db` required check of the uPortal 6.0 modernization plan.

For each vendor, the harness:

1. starts a throwaway database container (or uses one that is already running);
2. deploys uPortal with that vendor's JDBC driver and points `global.properties` at the database;
3. runs `dataInit` (schema creation plus the base and quickstart data);
4. takes a snapshot of the schema and of every ID generator;
5. compares the snapshot with the recorded baseline in `tests/db/snapshots/<baseline>/<vendor>/`.

## Which databases

uPortal 6.0 runs on, and is tuned for, current database servers (MOD-D25). Older servers stay in
the plan only as **migration sources**: 5.17 runs on them, and the copy migration (`dbMigrate`,
below) reads them and writes a current server. Each column below names files in
`tests/db/vendors`.

| Vendor | 6.0 runtime: the minimum version | Migration sources (5.17) |
| --- | --- | --- |
| PostgreSQL | 18 (`postgres-18`) | 14, 15, 16 (`postgres-14`, `postgres-15`, `postgres-16`) |
| MySQL | 9.7 LTS (`mysql-9.7`) | 8.0, 8.4 (`mysql-8.0`, `mysql-8.4`) |
| MariaDB | 12.3 LTS (`mariadb-12.3`) | 10.6, 10.11, 11.4 (`mariadb-10.6`, `mariadb-10.11`, `mariadb-11.4`) |
| SQL Server | 2025 (`sqlserver-2025`) | 2019, 2022 (`sqlserver-2019`, `sqlserver-2022`) |
| Oracle | Free 23.26 (`oracle-23`) | XE 21 (`oracle-xe-21`), the closest freely available stand-in for 19c |
| HSQLDB | 2.7.4, development only (`hsqldb`) | 2.5.1, 2.7.4 (`hsqldb-2.5.1`, `hsqldb`) |

* The harness (this check, `G-db`) runs on the six runtime databases.
* The copy-migration check (`G-migrate`, see "Copy migration in CI") copies used 5.17 databases on
  the migration sources into the runtime databases.
* uPortal's own `db-integration.yml` runs its JPA/DAO tests on the five runtime servers on every
  push, and nightly on the next releases (PostgreSQL 19 beta, MySQL 26 Innovation, MariaDB 13) as
  canaries that are allowed to fail.

The vendor file pins each image as `name:tag@sha256:digest`. Renovate moves digests and
patch versions; a new release series is a change to this table, with its own baseline.

## Running it

You need Docker, Java 11 for the portal plus a JDK 21 for Gradle (see "Prerequisites" in `README.md`),
and a `gradle.properties` (copy `gradle.properties.example`).

```bash
tests/db/harness.sh postgres-18                       # one vendor
tests/db/harness.sh hsqldb postgres-18 mysql-9.7 mariadb-12.3 sqlserver-2025 oracle-23
tests/db/harness.sh --portal postgres-18              # also start the portal and run the API specs
tests/db/harness.sh --full-suite postgres-18          # every overlay and every Playwright spec
tests/db/harness.sh postgres-18 -- -PtomcatHttpPort=8180 -PtomcatShutdownPort=8105 -PhsqlPort=8987
```

Arguments after `--` go to every Gradle call, so give a checkout that runs next to another portal
its own ports there. Options:

| Option | Effect |
| --- | --- |
| `--record` | Write the snapshots as the baseline instead of comparing with it (needs `--baseline`) |
| `--baseline X` | Use `tests/db/snapshots/X` (default: see "Choosing the baseline") |
| `--external` | The database is already running (CI service container); don't start a container |
| `--keep` | Leave the container running afterwards |
| `--skip-init` | Do not run `dataInit`; snapshot the database as it is |
| `--no-deploy` | Reuse the Tomcat and uPortal already deployed for this vendor |
| `--portal` | Also start Tomcat against the database and run `tests/api` (needs `npm ci`) |
| `--full-suite` | Like `--portal`, but deploy every overlay, create the portlets' tables after the snapshot, and run the whole Playwright suite (also needs `npx playwright install chromium`) |

Each container is named `uportal-dbh-<vendor>` and maps the vendor's `host.port` (15xxx).
The `hsqldb` vendor uses the bundled HSQLDB on `hsqlPort` and **deletes `.gradle/hsqldb` first**,
like any `dataInit` would wipe it (`hsqldb-2.5.1` does the same with its own port and directory,
from its `gradle.args`). Everything a run produces is in `build/db-harness/<vendor>/`, including
`harness.log` and, after a comparison, `drift-report.txt`.

`.github/workflows/integration.yml` runs the harness against uPortal built from source: it
builds the uPortal branch of the same name (or `master`, or the repository and ref given to a
manual run) and installs it into `~/.m2`. On every push it then runs the whole Playwright suite on
HSQLDB, the harness with `--portal` on the six runtime databases, the harness with `--full-suite`
on PostgreSQL 18 and MariaDB 12.3 (nightly on MySQL 9.7 as well), and the G-migrate pairs. The
scripts start every database themselves from its vendor file; MySQL and MariaDB need a server
option (`lower_case_table_names=1`) that a service container cannot be given. On GitHub Actions
the harness also shows a failed vendor's drift report and failed specs as annotations on the run.
In the prototype, a workstream branch (`ccr-43ba0785-hzlrj5-<topic>`, MOD-D30) runs a light profile
instead, with the uPortal build, Playwright on HSQLDB, the harness and Playwright on PostgreSQL 18,
and one G-migrate pair.

`.github/workflows/db-harness.yml` checks the released `uPortalVersion` on master, on the servers
the 5.17 baselines were first recorded on (PostgreSQL 16, MySQL 8.4, MariaDB 10.6 and 11.4, SQL
Server 2022, Oracle Free 23.26 and HSQLDB). PostgreSQL, SQL Server and Oracle run there as GitHub
Actions service containers (`--external`).

With `--full-suite` the snapshot is taken right after uPortal's `dataInit`, as with the other
options, so it covers uPortal's schema only. The portlets' own `dataInit` tasks (Announcements,
Calendar, News Reader, Simple Content) run afterwards, because the bundled portlets keep their
tables in the same database.

### Using the Gradle tasks directly

`-PdbVendor=<name>` selects `tests/db/vendors/<name>.properties`. With it set, the vendor's JDBC
driver is added to the overlays' `jdbc` configuration, and `tomcatConfig` (run by `tomcatInstall`)
appends the vendor's connection settings to `.gradle/tomcat/portal/global.properties`. Users sign
in with uPortal's local login, which checks passwords in that same database
([authentication.md](authentication.md)).
`-PdbHost`, `-PdbPort`, `-PdbUrl`, `-PdbUser` and `-PdbPassword` override the defaults, also as
`ORG_GRADLE_PROJECT_dbPassword` and so on. The same switch runs a whole portal against a database:

```bash
docker run -d --name pg -p 15418:5432 -e POSTGRES_DB=uportal -e POSTGRES_USER=uportal \
    -e POSTGRES_PASSWORD=uportal postgres:18-alpine
./gradlew -PdbVendor=postgres-18 tomcatInstall :overlays:uPortal:tomcatDeploy \
    dbWait dbSetup :overlays:uPortal:dataInit dbSnapshot dbVerify
./gradlew -PdbVendor=postgres-18 tomcatStart
```

| Task | What it does |
| --- | --- |
| `dbWait` | Retries a JDBC connection until the database accepts it (`-PdbWaitSeconds`, default 300) |
| `dbSetup` | Runs the vendor's `setup.sql.N` statements, such as `CREATE DATABASE` on SQL Server |
| `dbSnapshot` | Writes `schema.txt`, `schema-normalized.txt` and `generators.txt` |
| `dbVerify` | Compares them with the baseline and fails on any drift |
| `dbRecord` | Copies them into the baseline directory |
| `dbLobReport` | PostgreSQL only: which columns hold large-object OIDs, and what `vacuumlo` would delete |

`dbSnapshot` reads the entity classes of the deployed uPortal (`.gradle/tomcat/webapps/uPortal`),
so deploy uPortal before taking a snapshot. The code is in
`buildSrc/src/main/groovy/org/apereo/portal/start/db/`.

## The snapshot files

Each file has one complete fact per line, sorted, in `[section]` blocks. Lines starting with `#`
(database and driver versions, the dialect) are informational and are not compared.

* `schema.txt` lists tables, columns (type, size, nullability, default, auto-increment), primary
  keys, unique constraints, foreign keys (with their rules), check constraints, indexes, sequences
  (increment, bounds, cache and current value), the row count of every table, and every row of
  every generator table (`UP_SEQUENCE`, `hibernate_sequences`, and any table with a `next_val`
  column). Names that the database invents for itself, such as `SYS_C0012345` on Oracle,
  `SYS_IDX_10093` on HSQLDB or `PK__UP_USER__1234ABCD` on SQL Server, are shown as
  `<db-generated>`. They are not chosen by uPortal and would otherwise change on every run.
* `schema-normalized.txt` has the same facts, with identifiers upper-cased and constraint and
  index names removed. A foreign key is then identified by its table, columns and target.
* `generators.txt` has one line for each of the 51 entities with a generated ID. Each line gives
  the generator definitions the entity declares (in 5.17, 49 declare both a `@SequenceGenerator`
  and a `@TableGenerator` under one name; see "Removed generator definitions"), the object that actually backs the ID in the database, and
  that object's increment and current value, next to the table's row count and `max(id)`. The
  file also has a per-vendor summary and the `UP_SEQUENCE` counters.
* `lob-report.txt` (PostgreSQL) lists every `text` and `oid` column, how many of its values are
  OIDs of live large objects, and how many large objects `vacuumlo` would delete.

## What "zero drift" means

`dbVerify` compares each file as a set of lines and reports four things separately:

| Report line | Compares | Drift means |
| --- | --- | --- |
| `STRUCTURE` | `schema-normalized.txt` | A table, column (type, size, nullability, default), key, constraint, index or sequence definition changed |
| `DATA` | `schema-normalized.txt` | Only row counts, sequence values or generator-table rows changed |
| `NAMES` | `schema.txt` | The same constraint or index exists under another name; each rename is listed |
| `GENERATORS` | `generators.txt` | An ID is backed by a different object, increment or value |

Zero drift means all four match the baseline. Column order is not compared, because Hibernate 6.2+
orders columns differently in new tables and the order does not matter to an existing database.
A rerun on unchanged code must not show any drift.

`DATA` counts rows and compares no values. `docs/migration-equivalence.md` describes the check that
compares the data itself: 5.17 and the build under test export the same database with `dataExport`.

### Sequence values

Sequence values are compared exactly, because a changed value has caught a real change in how
IDs are allocated: the `UP_SEQUENCE` counters of 5.17.9 and 5.17.10-SNAPSHOT differ (MOD-I72, see
"5.17 reference results").

Oracle is the exception. The snapshot reads `LAST_NUMBER`, the high-water mark of the sequence's
cache. Because Oracle sizes that cache by how fast the sequence is used, the value changes from run
to run of the same build: `UP_PORTLET_DEF_PARAM_SEQ` read 1201, 546 and 931 in three runs, with
403 rows and a `max(id)` of 403 each time. So `oracle-23.properties` sets
`verify.sequenceValues=invariant`. `dbVerify` then leaves sequence values out of the comparison
and checks two rules on this run's `generators.txt` instead:

* every sequence that backs an ID is above `max(id)` of each table it serves, so the next ID it
  hands out is not taken;
* its increment equals the `allocationSize` of the mapping that names it.

A broken rule counts as `GENERATORS` drift and is listed in the report. The rest is still compared
exactly: the sequence definitions (increment, bounds, cache), row counts and `max(id)`. A vendor
file without the key uses `verify.sequenceValues=exact`.

### Intended data changes

A change to uPortal-start's data changes the rows of a fresh database. Publishing Favorites as a
Web Component channel adds one `UP_PORTLET_TYPE` row and two `UP_PORTLET_DEF_PARAM` rows
(MOD-I134). The 5.17 baselines keep what 5.17 produced, because every upgrade check compares with
them. The change goes in `tests/db/snapshots/<baseline>/intended-changes.txt`, one table per line:

```text
# <TABLE> rows <+n|-n> <MOD reference>
UP_PORTLET_TYPE rows +1 MOD-I134
UP_PORTLET_DEF_PARAM rows +2 MOD-I134
```

`dbVerify` reads the file next to the vendor directories of its baseline and applies it to every
vendor before comparing:

* It adds each delta to the table's row count in the baseline, in `[row counts]` and on the
  table's `generators.txt` line.
* It masks the current value of every generator that serves a listed table (its sequence,
  generator table or generator-table row) and the table's `max(id)`, in both snapshots. These move
  with the new rows by amounts that depend on each database's sequence semantics and caches. In
  their place, each of those generators must show a value of at least `max(id)` in this run.

The report lists every entry after the four drift lines, as in
`~ UP_PORTLET_TYPE rows +1 (MOD-I134): baseline 9, expected 10, this run 10: found`. On GitHub
Actions the harness shows the found entries as a notice on the job.

The rest of the comparison is unchanged. A row added to a table that isn't listed still fails as
`DATA` drift. A listed change that the run doesn't show fails too: the table's row count then
differs from the adjusted baseline, and its entry reads `NOT FOUND`. A malformed line, a table
listed twice or a table missing from the baseline also fails `dbVerify`. Remove an entry once a
new baseline directory is recorded from data that has the change.

### Removed generator definitions

`generators.txt` lists the generator definitions each entity declares (`declared=`), next to the
object that actually allocates its IDs (`backing=`). When uPortal removes a definition that never
allocated IDs, the same file lists it:

```text
# generators declared -table(<TABLE>) <MOD reference>
generators declared -table(hibernate_sequences) MOD-D33
```

Hibernate 5.2 (P2-3) removed the 49 `@TableGenerator` definitions in `hibernate_sequences`, each
under the name of the entity's `@SequenceGenerator`. Hibernate always used the sequence definition, and no
database ever had a `hibernate_sequences` table (MOD-D33, ADR 0006). `dbVerify` drops the
`table(hibernate_sequences[...],alloc=n)` parts from the baseline's `declared=` text and compares
the rest of each line exactly: the backing object, its increment and value, the row count and
`max(id)`. The entry is listed in the report like an intended data change. It reads `NOT FOUND`,
and fails the run, when this run still declares such definitions or when the baseline backs any ID
with that table, because removing a definition that allocated IDs is a real change.

## Choosing the baseline

Without `--baseline` (or `-PdbBaseline` for the Gradle tasks), the harness compares with
`tests/db/snapshots/<major.minor.patch of uPortalVersion>` when that directory exists, and with
`5.17` otherwise. So `uPortalVersion=5.17.9` uses `tests/db/snapshots/5.17.9` once it is
recorded, while `5.17.10-SNAPSHOT` (no `5.17.10` directory) still uses `5.17`. The
`HARNESS_BASELINE` environment variable sets the default for `--baseline`; `db-harness.yml` fills
it from its `baseline` input, which is empty unless a manual run sets it.

### Recording a baseline in CI

SQL Server and Oracle do not fit next to a portal in a small container, so record new baselines
on GitHub Actions instead of locally. On GitHub Actions the harness attaches the snapshot files
(as a base64 `tar.gz`) to the job as notice annotations titled `snapshot of <vendor>` whenever it
records (`--record`) or doesn't find a baseline to compare with, and annotations can be read
wherever the GitHub API can, even where artifacts cannot be downloaded:

1. Point the run at the uPortal to record: `uPortalVersion` in `gradle.properties.example` for
   `db-harness.yml`, or the uPortal branch for `integration.yml`.
2. Run the harness for the vendor with `--record --baseline <directory>` (or simply without a
   baseline for it), on a push or a manual run.
3. `tests/db/fetch-ci-snapshot.sh <owner/repo> <run id> <directory> [<vendor>...]` reads the
   annotations and writes `schema.txt`, `schema-normalized.txt`, `generators.txt` and, for
   PostgreSQL, `lob-report.txt` into `tests/db/snapshots/<directory>/<vendor>/`, the files
   `dbRecord` would write. When two jobs of the run snapshot the same vendor, it checks that the
   two are identical. It never overwrites a recorded file.
4. Commit them, and push again: the next run compares with the new files by itself and has to show
   zero drift on a fresh database before the baseline counts as reproduced.

Never re-record a baseline; a new uPortal version or an intentional schema change gets a new
directory, and a new database server a new vendor directory. `dbRecord` refuses to overwrite a
recorded baseline unless `-PdbRecordReplace` is given. The one exception so far is a database
server that uPortal-start itself bundles, when the upgrade changes nothing but names: `hsqldb` was
re-recorded when uPortal-start moved from HSQLDB 2.5.1 to 2.7.4 (MOD-I83, see "5.17 reference
results").

## How later phases use it

* **Fresh-install check, every persistence change (P1 to P7).** Point `uPortalVersion` at the
  new build, run the harness for every vendor, and treat any drift against `5.17` as a failure. A
  change that is meant to change the schema records a new baseline in its own directory (e.g.
  `--record --baseline 6.0-p2`) in the same PR, with the drift report in the PR description.
  Never re-record `5.17`.
* **Expected name drift.** Hibernate 5 names foreign keys and unique keys differently from 4.3.
  If a phase cannot reproduce the 4.3 names, the report shows `STRUCTURE: no drift` and
  `NAMES: DRIFT, n renamed`, with every rename listed, so a reviewer can see that nothing else
  moved.
* **In-place upgrade (from P2-2).** Create the database with the old build and keep it:
  `tests/db/harness.sh --keep postgres-18 -- -PuPortalVersion=<5.17.x>`. Start the new build on
  that database without `dataInit`; it must start and pass the API specs:
  `tests/db/harness.sh --external --skip-init --keep --portal postgres-18 -- -PuPortalVersion=<new>`.
  Then snapshot the database the new code has run against:
  `tests/db/harness.sh --external --skip-init postgres-18 -- -PuPortalVersion=<new>`.
  `STRUCTURE` and `NAMES` must not drift. `DATA` and `GENERATORS` move, because the portal
  wrote rows. The harness does not insert one row per entity yet. Add that when the generator
  mappings change (P2-3, P6-1).

## Copy migration (`dbMigrate`)

uPortal 6.0 upgrades by copying (MOD-D11, MOD-D25): uPortal's copy tool reads a whole uPortal
database, typically on an old server, and writes it into an empty uPortal schema on a current
server of the same or another vendor, positions every ID generator and verifies every table. The
source is only read. Version 0 copies 5.17 to 5.17. The 6.0 schema changes plug in as mapping rules.

The tool is a standalone Spring Boot 4 / Spring Batch 6 command-line application built by uPortal
(`org.jasig.portal:uPortal-db-migrate:<version>:exec`, Java 21). `dbMigrate` runs that executable
jar on the JDK 21 that Gradle itself uses, with the two vendors' JDBC drivers on its
`loader.path`. Outside uPortal-start it runs the same way:
`java -Dloader.path=postgresql.jar,mariadb-java-client.jar -jar uPortal-db-migrate-<version>-exec.jar --help`.

```bash
# The target schema: deploy for the target vendor, dataInit, and start the portal once, because
# Bookmarks, Feedback and Notification create their tables on first start, not in dataInit
./gradlew -PdbVendor=mariadb-12.3 tomcatInstall tomcatDeploy dbWait dataInit tomcatStart
./gradlew -PdbVendor=mariadb-12.3 tomcatStop
# Copy (dataInit's rows are deleted first), then verify; the report is in build/db-migrate/
./gradlew dbMigrate -PsourceDbVendor=postgres-16 -PtargetDbVendor=mariadb-12.3 -PdbMigrateClearTarget
```

`-PsourceDbVendor` and `-PtargetDbVendor` name files in `tests/db/vendors`, and `-PsourceDbHost`,
`-PsourceDbPort`, `-PsourceDbUrl`, `-PsourceDbUser`, `-PsourceDbPassword` (and the same for
`targetDb`) override their settings, like `-PdbHost` and so on do for `-PdbVendor`. The task passes
the credentials to the tool in files under `build/db-migrate/`, never on the command line.

| Property | Tool option | Effect |
| --- | --- | --- |
| `-PdbMigrateClearTarget` | `--clear-target` | Delete the rows of every target table the copy loads (needed after `dataInit`) |
| `-PskipRawEvents` | `--skip-raw-events` | Do not copy `UP_RAW_EVENTS` (raw event history) |
| `-PdbMigrateDryRun` | `--dry-run` | Plan, check and count rows only; don't write anything |
| `-PdbMigrateVerifyOnly` | `--verify-only` | Compare a copied target with its source again |
| `-PdbMigrateArgs='...'` | anything | e.g. `--include`, `--exclude`, `--batch-size`, `--threads`, `--missing-lob skip-row` |
| `-PdbMigrateHeap`, `-PdbMigrateVersion` | | JVM heap (default `512m`); tool version (default `uPortalVersion`) |

What the tool does, in order (exit status 0 only when everything matched):

1. **Plan.** Tables and columns are matched by name, case-insensitively, within the configured
   schema. A source table or column without a target fails the plan (exit status 2, nothing
   written) unless a rule excludes, skips or renames it; so does a NOT NULL target column that
   nothing fills. The PostgreSQL checks run here too: `text` columns that hold large-object OIDs
   must be declared (`lob-oid`), and OIDs whose large object is gone (`vacuumlo`, MOD-I24) fail the
   plan unless `--missing-lob skip-row`.
2. **Copy** as a Spring Batch job: one chunk-oriented step per table (a JDBC cursor reader with a
   fetch size, a batched JDBC writer, one target transaction per chunk), the tables of one
   foreign-key level in parallel (`--threads`), level after level, with constraints left on.
   Self-references and cycles are broken at nullable foreign keys, loaded in a second pass. Timestamps are read and written as wall-clock values, so the JVM
   time zone cannot shift them; a lower-precision target column (MySQL/MariaDB `DATETIME`, SQL
   Server `datetime`) gets truncated values, and the report lists those columns. PostgreSQL large
   objects are resolved on the server (`lo_get`) and, on a PostgreSQL target, created again with
   their OID in the `text` column, as 5.17 expects.
3. **Generators.** Every sequence or one-row `*_SEQ` table ends up at or above
   `max(id) + allocationSize` of the columns it serves (safe under Hibernate's pooled optimizers),
   and never below the source generator's own position. uPortal's mapping comes from its entity
   annotations; the bundled portlets' from `tests/db/migrate/uportal-start-portlets.rules`.
   `UP_SEQUENCE` is copied as data. MySQL has no sequences, so on MySQL (and on MariaDB, SQL
   Server under 5.17) the generators are the one-row `*_SEQ` tables, positioned the same way.
4. **Verify.** Per table, both databases are read again and compared by row count and an
   order-independent hash of normalized values (numbers without scale, booleans, timestamps as
   instants at the lower precision, LOB contents, CHAR without padding).

Reference runs (uPortal 5.17.10-SNAPSHOT, 2026-10-10; each target created by `dataInit` plus one
portal start, then copied with `-PdbMigrateClearTarget`; every table and generator verified):

| Source (old server) | Target (current server) | Tables / rows | Copy + verify | Full Playwright suite on the target |
| --- | --- | --- | --- | --- |
| PostgreSQL 16, after a full Playwright run | MariaDB 12.3 | 114 / 14,619 (7,712 raw events in large objects) | 10.8 s + 1.6 s | 120 passed, 2 failed (web proxy, offline sandbox) |
| MariaDB 11.4, after a full Playwright run | PostgreSQL 18 | 114 / 24,853 | 10.0 s + 2.9 s | 120 passed, 2 failed (web proxy) |
| HSQLDB 2.7.4, after the API and smoke specs | PostgreSQL 18 (schema-only copy) | 114 / 9,765 | 7.7 s + 3.5 s | not run |
| PostgreSQL 16, 1,000,000 synthetic raw events | MariaDB 12.3 | 1 / 1,000,000 | 148.5 s + 108.6 s, at most 94 MiB heap | not run |

### Copy migration in CI (G-migrate)

`tests/db/migrate.sh [--playwright] <source> <target>` checks one pair the way an adopter
upgrades:

1. It starts both databases.
2. It fills the source like a used 5.17 portal: every overlay is deployed for the source,
   `dataInit` runs on the old server, and the portal is started once to run the Playwright API
   specs. That leaves events, portlet lists and the tables that Bookmarks, Feedback and
   Notification create on their first start.
3. It prepares the target: deploy, `dataInit`, and one portal start (MOD-I92).
4. `./gradlew dbMigrate -PsourceDbVendor=<source> -PtargetDbVendor=<target> -PdbMigrateClearTarget`
   must exit with 0: every table copied and verified, every generator positioned.
5. With `--playwright`, the whole Playwright suite then runs on the migrated portal.

The script prints how long each step took and, on GitHub Actions, annotates the first failure.
The pairs live in `tests/db/migrate/matrix.json`, and `tests/db/migrate/matrix.mjs` turns them into
the `integration.yml` job matrix, failing when a set misses its rules:

* **Every push:** the six pairs listed in `matrix.json`: four upgrades within a vendor from its
  newest source (PostgreSQL 16 → 18, MySQL 8.4 → 9.7, SQL Server 2022 → 2025, Oracle XE 21 → Free
  23.26) and two across vendors (MariaDB 11.4 → PostgreSQL 18, PostgreSQL 15 → MariaDB 12.3). The
  whole Playwright suite runs after PostgreSQL 16 → 18 and PostgreSQL 15 → MariaDB 12.3.
* **Workstream branches** (prototype only, MOD-D30): the one cross-vendor pair listed under
  `workstream` (MariaDB 11.4 → PostgreSQL 18).
* **Nightly** (the schedule, or a manual run with `nightly`): every (source vendor, target vendor)
  pair once, 36 in all. The versions of each source vendor alternate, so every source version is
  read at least once, and every target is written six times. The whole Playwright suite runs on
  each target once, after a copy from another vendor.

CI results (uPortal 5.17.10-SNAPSHOT built from source, 2026-10-10). Nightly run 38087260340 copied
and verified all 36 pairs. Each source held about 3,200 rows in 114 tables. The copy took 1 to 4 s
and verification under 2 s. A job takes 10 to 20 minutes, almost all of it deploying the portal
twice and filling both databases. The whole Playwright suite passed on migrated PostgreSQL 18,
MySQL 9.7, MariaDB 12.3, SQL Server 2025, Oracle Free 23.26 and HSQLDB portals. The first runs found
three bugs, all fixed:

* Parallel data tasks deadlocked on SQL Server (MOD-I107).
* The Feedback portlet had no usable SQL Server dialect (MOD-I108, see `portlet.<file>.<key>` in
  `hsqldb.properties`).
* Verification of SQL Server `datetime` values copied into whole seconds (MOD-I109).

`hsqldb-2.5.1` reads a database that HSQLDB 2.5.1, which uPortal-start bundled before 2.7.4,
created. HSQLDB 2.7.4 can open such files but converts them when it does so. A migration source
should only be read. So the vendor file runs uPortal-start's own HSQLDB server at 2.5.1, on its own
port and in its own directory. An adopter serves an existing 2.5.1 database the same way:

```bash
./gradlew -PhsqldbVersion=2.5.1 -PhsqlPort=15925 -PhsqlDatabaseDir=<directory> hsqlStart
./gradlew dbMigrate -PsourceDbVendor=hsqldb-2.5.1 -PtargetDbVendor=postgres-18 -PdbMigrateClearTarget
```

## 5.17 reference results

Recorded with uPortal 5.17.10-SNAPSHOT (Hibernate 4.3.11) and the quickstart data, then
reproduced with zero drift by a second fresh run on every vendor.

The baselines of the 6.0 runtime servers PostgreSQL 18.6, MySQL 9.7.2, MariaDB 12.3.3 and SQL
Server 2025 were recorded in CI (MOD-D25) from the same code. Apart from their version headers they
equal those of PostgreSQL 16, MySQL 8.4, MariaDB 11.4 and SQL Server 2022 line for line: 5.17
creates the same schema, names and generators on the newer servers, with the same dialects.

The `hsqldb` baseline was first recorded on HSQLDB 2.5.1 and re-recorded on 2.7.4, the version
uPortal-start now bundles. Compared with the 2.5.1 recording, `STRUCTURE`, `DATA` and `GENERATORS`
do not drift, and `NAMES` shows 111 renames, all of them indexes that back a constraint: 2.5.1
named them itself (`SYS_IDX_*`, shown as `<db-generated>`), while 2.7.4 gives them the name of
their constraint (67 foreign keys, 42 Hibernate `UK_*` unique keys, `UPET_NAME_UNQ` and
`UPU_USER_NAME`).

uPortal never sets `hibernate.dialect`. It picks its dialect from the JDBC metadata, first with
`PortalDialectResolver` and then with Hibernate's `StandardDialectResolver`. The
`hibernate.dialect` in the vendor files is used only by the bundled portlets. The dialect
depends on the server version that the driver reports, and so on the driver:

| Vendor | JDBC driver | Dialect uPortal uses | Generated IDs (49 + 2 UUID) are backed by |
| --- | --- | --- | --- |
| `hsqldb` 2.7.4 | hsqldb 2.7.4 | `HSQLDialect` (standard) | 49 sequences |
| `postgres-16`, `postgres-18` | pgjdbc 42.7.11 | `PostgreSQL81Dialect` (standard, since Hibernate 4.3 only knows PostgreSQL 8 and 9 and resolves 10+ to 8.1) | 49 sequences |
| `mysql-8.4`, `mysql-9.7` | MySQL Connector/J 8.4.0 | `MySQL5Dialect` (standard; `PortalDialectResolver` only handles MySQL 5) | 49 one-row tables `up_*_seq (next_val)` |
| `mariadb-10.6` | MySQL Connector/J 8.4.0 | `MySQL5InnoDBCompressedDialect` (`PortalDialectResolver`, because MariaDB 10 reports its version as `5.5.5-10.6`); every entity and legacy table is `ROW_FORMAT=COMPRESSED` | 49 one-row tables |
| `mariadb-11.4`, `mariadb-12.3` | MariaDB Connector/J 3.5.6, `useMysqlMetadata=true` | `MySQL5Dialect` (standard) | 49 one-row tables |
| `sqlserver-2022`, `sqlserver-2025` | mssql-jdbc 13.4.0 | `SQLServer2005Dialect` (`PortalDialectResolver`) | 49 one-row tables `UP_*_SEQ (next_val)` |
| `oracle-23` (Free 23.26) | ojdbc11 23.9 | `Oracle12ForceClobDialect` (`PortalDialectResolver`); `varchar` columns longer than 4000 become `CLOB` | 49 sequences |

Released uPortal 5.17.9 (Hibernate 4.2.21) compared with this baseline on PostgreSQL shows
`STRUCTURE`, `NAMES`: no drift, and `DATA`, `GENERATORS`: drift. Every table, column, constraint
and constraint name is the same. Only generator values differ: the `UP_SEQUENCE` counters stand at
110 instead of 60 (the counter store moved from `POOLED` to `POOLED_LO` with Hibernate 4.3), and
`UP_PORTLET_PREF_SEQ` at 131 instead of 121. 5.17.9 also picks `PostgreSQL82Dialect` where
5.17.10-SNAPSHOT picks `PostgreSQL81Dialect`. Until uPortal-start's `uPortalVersion` moves to a release with
Hibernate 4.3, the CI workflow, which builds `gradle.properties.example`, reports this drift.

On every vendor the sequence definition takes precedence over the `@TableGenerator` that 49
entities also declare: no `hibernate_sequences` table exists anywhere, so those `@TableGenerator`s are dead.
Where the dialect has no sequences (MySQL, MariaDB, SQL Server), Hibernate emulates each sequence
with a table of the sequence's name. Where real sequences exist, every sequence increment equals
the mapping's `allocationSize`. The two UUID ids (`PortletList`, `PortletListItem`) have no database object.

Setup requirements the harness found, which existing adopters must already meet:

* MySQL and MariaDB on Linux need `lower_case_table_names=1`. uPortal's import scripts use
  `up_group` while the tables are created as `UP_GROUP`, and with case-sensitive names the import of
  the base data fails ("Table 'uportal.up_group' doesn't exist"). Table names are then stored in
  lower case.
* MariaDB Connector/J needs `useMysqlMetadata=true`. Without it the driver reports the product
  `MariaDB`, Hibernate 4.3 cannot pick a dialect ("Unable to determine Dialect to use
  [name=MariaDB, majorVersion=11]"), and `dataInit` fails.

PostgreSQL large objects (MOD-I24): `UP_RAW_EVENTS.EVENT_DATA` and `UP_ANALYTICS_EVENTS.EVENT_DATA`
are `@Lob String` fields mapped to `text` columns, and Hibernate 4.3 writes their values as large
objects whose OIDs it stores in the `text` column. Right after `dataInit` both are empty
(`lob-report.txt`). After one portal start plus the API specs (`--portal`), `UP_RAW_EVENTS` held
720 such OIDs (670 in a second run), no `oid` or `lo` column referenced them, and `vacuumlo -n`
reported "Would remove 720 large objects": every stored raw event would lose its data. `PREF_VALUE` and
`PREF_NAME` are `varchar(100000)` on PostgreSQL, because of their `@Type(StringType)` override,
and so are not affected today.
