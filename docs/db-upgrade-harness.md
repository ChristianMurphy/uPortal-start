# Database upgrade harness

The harness answers one question for every supported database: does this uPortal build create
exactly the same schema, and back its generated IDs with exactly the same database objects, as
uPortal 5.17 did? A "yes" on every vendor is what lets an existing production database upgrade in
place without manual SQL. It is the `G-db` gate of the uPortal 6.0 modernization plan.

For each vendor, the harness:

1. starts a throwaway database container (or uses one that is already running);
2. deploys uPortal with that vendor's JDBC driver and points `global.properties` at the database;
3. runs `dataInit` (schema creation plus the base and quickstart data);
4. takes a snapshot of the schema and of every ID generator;
5. compares the snapshot with the recorded baseline in `tests/db/snapshots/<baseline>/<vendor>/`.

## Running it

You need Docker, Java 11 for the portal plus a JDK 21 for Gradle (see "Prerequisites" in `README.md`),
and a `gradle.properties` (copy `gradle.properties.example`).

```bash
tests/db/harness.sh postgres-16                       # one vendor
tests/db/harness.sh hsqldb postgres-16 mysql-8.4 mariadb-10.6 mariadb-11.4 sqlserver-2022 oracle-23
tests/db/harness.sh --portal postgres-16              # also start the portal and run the API specs
tests/db/harness.sh --full-suite postgres-16          # every overlay and every Playwright spec
tests/db/harness.sh postgres-16 -- -PtomcatHttpPort=8180 -PtomcatShutdownPort=8105 -PhsqlPort=8987
```

Arguments after `--` go to every Gradle call, so give a checkout that runs next to another portal
its own ports there. Options:

| Option | Effect |
| --- | --- |
| `--record` | Write the snapshots as the baseline instead of comparing with it (needs `--baseline`) |
| `--baseline X` | Use `tests/db/snapshots/X` (default: see "Choosing the baseline") |
| `--external` | The database is already running (CI service container); start no container |
| `--keep` | Leave the container running afterwards |
| `--skip-init` | Do not run `dataInit`; snapshot the database as it is |
| `--no-deploy` | Reuse the Tomcat and uPortal already deployed for this vendor |
| `--portal` | Also deploy CAS, start Tomcat against the database and run `tests/api` (needs `npm ci`) |
| `--full-suite` | Like `--portal`, but deploy every overlay, create the portlets' tables after the snapshot, and run the whole Playwright suite (also needs `npx playwright install chromium`) |

Each container is named `uportal-dbh-<vendor>` and maps the vendor's `host.port` (15xxx).
The `hsqldb` vendor uses the bundled HSQLDB on `hsqlPort` and **deletes `.gradle/hsqldb` first**,
like any `dataInit` would wipe it. Everything a run produces is in `build/db-harness/<vendor>/`,
including `harness.log` and, after a comparison, `drift-report.txt`.

`.github/workflows/db-harness.yml` runs the same script with `--portal` for every vendor.
PostgreSQL, SQL Server and Oracle run as GitHub Actions service containers (`--external`). MySQL
and MariaDB need a server option (`lower_case_table_names=1`, see their vendor files) that a
service container cannot be given, so the script starts those containers itself.

`.github/workflows/integration.yml` does the same against uPortal built from source instead of
the released `uPortalVersion`: it builds the uPortal branch of the same name (or `master`, or the
repository and ref given to a manual run) and installs it into `~/.m2`. It then runs the whole
Playwright suite on HSQLDB, the harness with `--portal` on every vendor, and the harness with
`--full-suite` on PostgreSQL 16 and MariaDB 11.4. On GitHub Actions the harness also shows a
failed vendor's drift report and failed specs as annotations on the run.

With `--full-suite` the snapshot is taken right after uPortal's `dataInit`, as with the other
options, so it covers uPortal's schema only. The portlets' own `dataInit` tasks (Announcements,
Calendar, News Reader, Simple Content) run afterwards, because the bundled portlets keep their
tables in the same database.

### Using the Gradle tasks directly

`-PdbVendor=<name>` selects `tests/db/vendors/<name>.properties`. With it set, the vendor's JDBC
driver is added to the overlays' `jdbc` configuration, and `tomcatConfig` (run by `tomcatInstall`)
appends the vendor's connection settings to `.gradle/tomcat/portal/global.properties`. The CAS
overlay, which checks passwords against `UP_PERSON_DIR` itself (`deployerConfigContext.xml`), is
built against the same database; without `-PdbVendor` it keeps using the bundled HSQLDB. A portal
that is moved off HSQLDB without the harness needs the CAS data source changed by hand (see "How
To Start the Embedded Database" in `README.md`).
`-PdbHost`, `-PdbPort`, `-PdbUrl`, `-PdbUser` and `-PdbPassword` override the defaults, also as
`ORG_GRADLE_PROJECT_dbPassword` and so on. The same switch runs a whole portal against a database:

```bash
docker run -d --name pg -p 15432:5432 -e POSTGRES_DB=uportal -e POSTGRES_USER=uportal \
    -e POSTGRES_PASSWORD=uportal postgres:16-alpine
./gradlew -PdbVendor=postgres-16 tomcatInstall :overlays:uPortal:tomcatDeploy \
    dbWait dbSetup :overlays:uPortal:dataInit dbSnapshot dbVerify
./gradlew -PdbVendor=postgres-16 tomcatStart
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
so deploy uPortal before taking a snapshot. The code lives in
`buildSrc/src/main/groovy/org/apereo/portal/start/db/`.

## The snapshot files

Every file has one complete fact per line, sorted, in `[section]` blocks. Lines starting with `#`
(database and driver versions, the dialect) are informational and are not compared.

* `schema.txt` lists tables, columns (type, size, nullability, default, auto-increment), primary
  keys, unique constraints, foreign keys (with their rules), check constraints, indexes, sequences
  (increment, bounds, cache and current value), the row count of every table, and every row of
  every generator table (`UP_SEQUENCE`, `hibernate_sequences`, and any table with a `next_val`
  column). Names that the database invents for itself, such as `SYS_C0012345` on Oracle,
  `SYS_IDX_10093` on HSQLDB or `PK__UP_USER__1234ABCD` on SQL Server, are shown as
  `<db-generated>`. They are not chosen by uPortal and would otherwise change on every run.
* `schema-normalized.txt` holds the same facts, with identifiers upper-cased and constraint and
  index names removed. A foreign key is then identified by its table, columns and target.
* `generators.txt` has one line for each of the 51 entities with a generated ID. Each line gives
  the generator definitions the entity declares (49 declare both a `@SequenceGenerator` and a
  `@TableGenerator` under one name), the object that actually backs the ID in the database, and
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

Zero drift means all four match the baseline. Column order is not compared: Hibernate 6.2+
orders columns differently in new tables, and the order does not matter to an existing database.
A rerun on unchanged code must show zero drift.

### Sequence values

Sequence values are compared exactly, because a changed value has caught a real change in how
IDs are allocated: the `UP_SEQUENCE` counters of 5.17.9 and 5.17.10-SNAPSHOT differ (MOD-I72, see
"5.17 reference results").

Oracle is the exception. The snapshot reads `LAST_NUMBER`, the high-water mark of the sequence's
cache, and Oracle sizes that cache by how fast the sequence is used, so the value changes from run
to run of the same build: `UP_PORTLET_DEF_PARAM_SEQ` read 1201, 546 and 931 in three runs, with
403 rows and a `max(id)` of 403 each time. `oracle-23.properties` therefore sets
`verify.sequenceValues=invariant`. `dbVerify` then leaves sequence values out of the comparison
and checks two rules on this run's `generators.txt` instead:

* every sequence that backs an ID is above `max(id)` of each table it serves, so the next ID it
  hands out is not taken;
* its increment equals the `allocationSize` of the mapping that names it.

A broken rule counts as `GENERATORS` drift and is listed in the report. The rest is still compared
exactly: the sequence definitions (increment, bounds, cache), row counts and `max(id)`. A vendor
file without the key uses `verify.sequenceValues=exact`.

## Choosing the baseline

Without `--baseline` (or `-PdbBaseline` for the Gradle tasks), the harness compares with
`tests/db/snapshots/<major.minor.patch of uPortalVersion>` when that directory exists, and with
`5.17` otherwise. `uPortalVersion=5.17.9` therefore uses `tests/db/snapshots/5.17.9` once it is
recorded, while `5.17.10-SNAPSHOT` (no `5.17.10` directory) still uses `5.17`. The
`HARNESS_BASELINE` environment variable sets the default for `--baseline`; `db-harness.yml` fills
it from its `baseline` input, which is empty unless a manual run sets it.

### Recording a baseline in CI

SQL Server and Oracle do not fit next to a portal in a small container, so record new baselines
on GitHub Actions instead of locally:

1. Point the run at the uPortal to record: `uPortalVersion` in `gradle.properties.example` for
   `db-harness.yml`, or the uPortal branch for `integration.yml`.
2. Run the workflow (a push, or "Run workflow" for `db-harness.yml`). Every vendor's job uploads
   `build/db-harness/<vendor>/` as an artifact, and it holds the snapshot whether or not the
   comparison passed.
3. Download the artifacts and copy `schema.txt`, `schema-normalized.txt`, `generators.txt` and,
   for PostgreSQL, `lob-report.txt` from each `build/db-harness/<vendor>/` into
   `tests/db/snapshots/<version>/<vendor>/`, e.g. `tests/db/snapshots/5.17.9/postgres-16/`.
   These are the files `dbRecord` (`--record`) would copy.
4. Commit them, and push again: the next run picks the new directory by itself and has to show
   zero drift on every vendor before the baseline counts as reproduced.

Never re-record `5.17`; a new uPortal version or an intentional schema change gets a new
directory.

## How later phases use it

* **Fresh-install check, every persistence change (P1 to P7).** Point `uPortalVersion` at the
  new build, run the harness for every vendor, and require zero drift against `5.17`. A change
  that is meant to change the schema records a new baseline in its own directory (for example
  `--record --baseline 6.0-p2`) in the same PR, with the drift report in the PR description.
  Never re-record `5.17`.
* **Expected name drift.** Hibernate 5 names foreign keys and unique keys differently from 4.3.
  If a phase cannot reproduce the 4.3 names, the report shows `STRUCTURE: no drift` and
  `NAMES: DRIFT, n renamed`, with every rename listed, so a reviewer can see that nothing else
  moved.
* **In-place upgrade (from P2-2).** Create the database with the old build and keep it:
  `tests/db/harness.sh --keep postgres-16 -- -PuPortalVersion=<5.17.x>`. Start the new build on
  that database without `dataInit`; it must start and pass the API specs:
  `tests/db/harness.sh --external --skip-init --keep --portal postgres-16 -- -PuPortalVersion=<new>`.
  Then snapshot the database the new code has run against:
  `tests/db/harness.sh --external --skip-init postgres-16 -- -PuPortalVersion=<new>`.
  `STRUCTURE` and `NAMES` must show no drift. `DATA` and `GENERATORS` move, because the portal
  wrote rows. The harness does not insert one row per entity yet. Add that when the generator
  mappings change (P2-3, P6-1).

## 5.17 reference results

Recorded with uPortal 5.17.10-SNAPSHOT (Hibernate 4.3.11) and the quickstart data, then
reproduced with zero drift by a second fresh run on every vendor.

uPortal never sets `hibernate.dialect`. It picks its dialect from the JDBC metadata, first with
`PortalDialectResolver` and then with Hibernate's `StandardDialectResolver`. The
`hibernate.dialect` in the vendor files is used only by the bundled portlets. The dialect therefore
depends on the server version that the driver reports, and so on the driver:

| Vendor | JDBC driver | Dialect uPortal uses | Generated IDs (49 + 2 UUID) are backed by |
| --- | --- | --- | --- |
| `hsqldb` 2.5.1 | hsqldb 2.5.1 | `HSQLDialect` (standard) | 49 sequences |
| `postgres-16` | pgjdbc 42.7.11 | `PostgreSQL81Dialect` (standard: Hibernate 4.3 only knows PostgreSQL 8 and 9, so 10+ falls through to 8.1) | 49 sequences |
| `mysql-8.4` | MySQL Connector/J 8.4.0 | `MySQL5Dialect` (standard; `PortalDialectResolver` only handles MySQL 5) | 49 one-row tables `up_*_seq (next_val)` |
| `mariadb-10.6` | MySQL Connector/J 8.4.0 | `MySQL5InnoDBCompressedDialect` (`PortalDialectResolver`: MariaDB 10 announces itself as `5.5.5-10.6`); every entity and legacy table is `ROW_FORMAT=COMPRESSED` | 49 one-row tables |
| `mariadb-11.4` | MariaDB Connector/J 3.5.6, `useMysqlMetadata=true` | `MySQL5Dialect` (standard) | 49 one-row tables |
| `sqlserver-2022` | mssql-jdbc 13.4.0 | `SQLServer2005Dialect` (`PortalDialectResolver`) | 49 one-row tables `UP_*_SEQ (next_val)` |
| `oracle-23` (Free 23.26) | ojdbc11 23.9 | `Oracle12ForceClobDialect` (`PortalDialectResolver`); `varchar` columns longer than 4000 become `CLOB` | 49 sequences |

Released uPortal 5.17.9 (Hibernate 4.2.21) compared with this baseline on PostgreSQL shows
`STRUCTURE`, `NAMES`: no drift, and `DATA`, `GENERATORS`: drift. Every table, column, constraint
and constraint name is the same. Only generator values differ: the `UP_SEQUENCE` counters stand at
110 instead of 60 (the counter store moved from `POOLED` to `POOLED_LO` with Hibernate 4.3), and
`UP_PORTLET_PREF_SEQ` at 131 instead of 121. 5.17.9 also picks `PostgreSQL82Dialect` where
5.17.10-SNAPSHOT picks `PostgreSQL81Dialect`. Until uPortal-start's `uPortalVersion` moves to a release with
Hibernate 4.3, the CI workflow, which builds `gradle.properties.example`, reports this drift.

On every vendor the sequence definition wins over the `@TableGenerator` that 49 entities also
declare: no `hibernate_sequences` table exists anywhere, so those `@TableGenerator`s are dead.
Where the dialect has no sequences (MySQL, MariaDB, SQL Server), Hibernate emulates each sequence
with a table of the sequence's name. Where real sequences exist, every sequence increment equals
the mapping's `allocationSize`. The two UUID ids (`PortletList`, `PortletListItem`) have no database object.

Setup requirements the harness found, which existing adopters must already meet:

* MySQL and MariaDB on Linux need `lower_case_table_names=1`. uPortal's import scripts use
  `up_group` while the tables are created as `UP_GROUP`, and with case-sensitive names the base
  data import fails ("Table 'uportal.up_group' doesn't exist"). Table names are then stored in
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
