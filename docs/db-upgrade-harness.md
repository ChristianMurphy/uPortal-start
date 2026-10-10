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

You need Docker, Java 11 and a `gradle.properties` (copy `gradle.properties.example`).

```bash
tests/db/harness.sh postgres-16                       # one vendor
tests/db/harness.sh hsqldb postgres-16 mysql-8.4 mariadb-10.6 mariadb-11.4 sqlserver-2022 oracle-23
tests/db/harness.sh --portal postgres-16              # also start the portal and run the API specs
tests/db/harness.sh postgres-16 -- -PtomcatHttpPort=8180 -PtomcatShutdownPort=8105 -PhsqlPort=8987
```

Arguments after `--` go to every Gradle call, so give a checkout that runs next to another portal
its own ports there. Options:

| Option | Effect |
| --- | --- |
| `--record` | Write the snapshots as the baseline instead of comparing with it |
| `--baseline X` | Use `tests/db/snapshots/X` (default `5.17`) |
| `--external` | The database is already running (CI service container); start no container |
| `--keep` | Leave the container running afterwards |
| `--skip-init` | Do not run `dataInit`; snapshot the database as it is |
| `--no-deploy` | Reuse the Tomcat and uPortal already deployed for this vendor |
| `--portal` | Also deploy CAS, start Tomcat against the database and run `tests/api` (needs `npm ci`) |

Each container is named `uportal-dbh-<vendor>` and maps the vendor's `host.port` (15xxx).
The `hsqldb` vendor uses the bundled HSQLDB on `hsqlPort` and **deletes `.gradle/hsqldb` first**,
like any `dataInit` would wipe it. Everything a run produces is in `build/db-harness/<vendor>/`,
including `harness.log` and, after a comparison, `drift-report.txt`.

`.github/workflows/db-harness.yml` runs the same script with `--portal` for every vendor.
PostgreSQL, SQL Server and Oracle run as GitHub Actions service containers (`--external`). MySQL
and MariaDB need a server option (`lower_case_table_names=1`, see their vendor files) that a
service container cannot be given, so the script starts those containers itself.

### Using the Gradle tasks directly

`-PdbVendor=<name>` selects `tests/db/vendors/<name>.properties`. With it set, the vendor's JDBC
driver is added to the overlays' `jdbc` configuration, and `tomcatConfig` (run by `tomcatInstall`)
appends the vendor's connection settings to `.gradle/tomcat/portal/global.properties`.
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
