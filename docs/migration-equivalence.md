# Migration equivalence

The database upgrade harness (`docs/db-upgrade-harness.md`) compares schemas, ID generators and
row counts, and the copy tool compares row hashes. Neither shows whether the new code reads the
rows back as the same data. MOD-I120 passed both: under Hibernate 5.2, map keys lost their `_`
prefix, and upgraded portals lost their tab external IDs.

The migration-equivalence check (`tests/db/equivalence.sh`, MOD-D29 item 1) compares data. uPortal
5.17 writes the data, the build under test reads it, and both export everything with
`dataExport`. The export of the build under test must be identical to 5.17's.

```bash
tests/db/equivalence.sh in-place postgres-18              # upgrade in place
tests/db/equivalence.sh copy postgres-16 mariadb-12.3     # upgrade by copying (dbMigrate)
tests/db/equivalence.sh in-place hsqldb -- -PtomcatHttpPort=8180 -PtomcatShutdownPort=8105 -PhsqlPort=8987
```

The vendor names are the files in `tests/db/vendors`. Every vendor but HSQLDB needs Docker.

## Steps of a run

1. uPortal 5.17.9 (`OLD_UPORTAL_VERSION`) creates the database with `dataInit`, which imports the
   quickstart data.
2. 5.17.9 imports the fixture (`tests/db/equivalence/fixture`), starts the portal once and exports
   all 14 uPortal data types and News Reader's predefined feeds. The 14 types are `user`,
   `group-membership`, `pags-group`, `permission-owner`, `permission-set`, `portlet-definition`,
   `portlet-type`, `fragment-definition`, `fragment-layout`, `layout`, `profile`,
   `stylesheet-descriptor`, `entity-type` and `event-aggregation`.
3. That export, masked, must equal the reference in `tests/db/equivalence/reference`.
4. 5.17.9 exports a second time. The first export writes a default profile for each user without
   one (MOD-I154), so the second export is the one that shows the database the build under test
   will read.
5. The build under test (`uPortalVersion`, or `NEW_UPORTAL_VERSION`) reads the data:
   * **In place:** it is deployed on the same database without `dataInit` and starts once.
   * **Copy:** it creates the target database with `dataInit`, `dbMigrate` copies the 5.17 database
     into it, and it starts once on the copy.
6. The build under test exports everything. Its export must equal 5.17's second export with
   nothing masked.

Only uPortal and News Reader are deployed. The other bundled portlets keep their data in tables
that `dataExport` does not cover. The copy tool's row hashes cover those tables.

## The fixture

The fixture adds what the quickstart data lacks. Each fixture file starts with a comment that says
what it covers.

* Unicode in every kind of name and value, in Latin-1, Latin Extended, CJK, Cyrillic and emoji
  outside the Basic Multilingual Plane, and a username with accents.
* XML special characters, a tab, leading and trailing spaces, and empty values.
* Values at their column limits: a 254-character attribute, a 2000-character parameter and a
  6000-character preference.
* Multi-valued attributes and preferences with repeated values, in a set order.
* Groups nested three levels deep with a PAGS group inside, PAGS test groups, and a permission
  owner of its own with granted and denied permissions.
* Lifecycle entries with milliseconds.
* A fragment with DLM restrictions.
* A layout that a user customised on 5.17, with a renamed fragment tab, one fragment portlet
  removed and one moved, a tab of the user's own and a favorite.

The import drops the `<user>` subscriber of a portlet definition (MOD-I155), so the reference has
none.

## Normalisation and masks

`./gradlew dataExportNormalize` (`buildSrc/.../db/DataExportNormalizer.groovy`) prints each
exported entity in one canonical form. Each element goes on its own line with its attributes
sorted, namespace prefixes are fixed, and whitespace between elements is dropped. Text is kept
exactly, with tabs and line breaks written as `\t` and `\n`. The code lists each of the following
changes with its reason.

* **Sorting** applies only where the database doesn't keep an order: group members, permission targets,
  a portlet's categories, groups, permissions and parameters, PAGS test groups, tests and members,
  permission owner activities, and layout structure attributes. Layout nodes, preference values
  and attribute values keep their order, because uPortal stores it.
* **Timestamps with an offset** are printed as the same instant in UTC. uPortal prints an
  `xs:dateTime` with the offset of the JVM's zone, and a run in another zone than UTC must still
  match the reference, which was recorded in UTC.
* **One mask** applies, and only in the comparison with the reference. `dataInit` stamps a
  PUBLISHED lifecycle entry (user `system`) on each portlet definition that has no
  `<lifecycle>`. Its date is the time the job ran.

The comparison of the two exports of one run masks nothing. A copy into a server that keeps less
time precision loses fractional seconds: MySQL and MariaDB `DATETIME` under 5.17, and SQL Server
`datetime` (MOD-I95). For those copies both sides compare timestamps in whole seconds
(`-PwholeSeconds`), and the run's summary says so.

## One reference for every vendor

5.17.9 recorded the reference once, on HSQLDB. If 5.17 itself stores the fixture differently on a
vendor, record that difference exactly in `tests/db/equivalence/vendors/<vendor>.diff`, or in
`<family>.diff` for every version of a vendor (`mysql`, `mariadb`). The 5.17 export on that vendor
must then differ from the reference by exactly that diff. The build under test must still match
the 5.17 export on its own vendor exactly.

On HSQLDB and PostgreSQL 18, 5.17's export equals the reference. On MySQL and MariaDB, 5.17's
schema stores timestamps as `DATETIME` without fractional seconds (MOD-I95), so the 5.17 export
loses the milliseconds of four values: three lifecycle entries and one `lastPasswordChange`.
`vendors/mysql.diff` and `vendors/mariadb.diff` record exactly that. On SQL Server, 5.17 stores them
as `datetime`, in steps of 1/300 s: the one value in the reference that isn't on such a step,
feedback-admin's PUBLISHED date, comes back 2 ms later. `vendors/sqlserver.diff` records that.

## SQL Server: the fixture in windows-1252

uPortal 5.17 creates `varchar` columns. On SQL Server's default collation they keep only the
windows-1252 code page, and 5.17 stores other characters as `?` (MOD-I196). It then can't find a row
again by such a name: the import of `PAGS Fixture Child 🌱` stops because the group it just
inserted isn't found under that name. A UTF-8 collation doesn't help, because `varchar(n)` then
counts bytes and the fixture's longest values no longer fit. So no 5.17 site on SQL Server holds the
fixture as it is.

When the 5.17 side of a run is SQL Server (in place, or the source of a copy), `equivalence.sh`
converts the fixture and the reference with `tests/db/equivalence/code_page.py` before it starts.
The same function, `to_code_page`, converts both. Each character outside windows-1252 becomes one
`_`, whether it is in a file's text or a file name, and so does a numeric character reference to
one. It leaves text already in windows-1252 unchanged. It writes `_` rather than SQL Server's `?`
because 5.17 names exported files after group names, and `?` is not allowed in a GitHub Actions
artifact. Both comparisons are exact: 5.17's export must equal the converted reference, and the
export of the build under test must equal 5.17's. A copy into SQL Server uses the fixture unchanged,
so it shows whether 6.0 on SQL Server keeps text outside windows-1252.

The conversion changes these fixture fields:

| Fixture file | Fields |
| --- | --- |
| `news-reader/fixture-unicode.pnd.xml` | `name`, `predefinedRoles/role` |
| `uportal/fragment-definition/fixture-lo.fragment-definition.xml` | the audience's `attribute/@name` |
| `uportal/fragment-layout/fixture-lo.fragment-layout.xml` | a tab's `folder/@name` |
| `uportal/group_membership/Equipe_Unicode.group-membership.xml` | `children/group` |
| `uportal/group_membership/Fixture_Category.group-membership.xml` | `name` |
| `uportal/group_membership/Fixture_Root.group-membership.xml` | `name`, `description` |
| `uportal/group_membership/Research_Group_CJK.group-membership.xml` | `name`, `description` |
| `uportal/layout/fixture-zoe.layout.xml` | a tab's `folder/@name` |
| `uportal/pags-group/PAGS_Fixture.pags-group.xml` | `members/member-name`, two `test-value`s |
| `uportal/pags-group/PAGS_Fixture_Child.pags-group.xml` | `name` |
| `uportal/permission_owner/FIXTURE_OWNER.permission-owner.xml` | `desc`, `activity/desc` |
| `uportal/permission_set/Equipe_Unicode__BROWSE__UP_PORTLET_SUBSCRIBE.permission-set.xml` | `target/group` |
| `uportal/permission_set/Fixture_Root__FIXTURE_ACT__FIXTURE_OWNER.permission-set.xml` | `principal/group`, `target/literal` |
| `uportal/permission_set/Research_Group_CJK__MAX_INACTIVE__UP_SYSTEM.permission-set.xml` | `principal/group` |
| `uportal/portlet-definition/fixture-rich-content.portlet-definition.xml` | `title`, `name`, `desc`, `category`, `parameter/description`, `permissions/permission/group`, `portlet-preference/name`, `portlet-preference/value` |
| `uportal/user/fixture-zoe.user.xml` | the `sn`, `displayName` and `title` values |
| `uportal/user/jose.mueller.user.xml` | the `displayName` value |

`python3 -B -m unittest discover -s tests/db/equivalence -p 'test_*.py'` tests the conversion. The
plan job of `migration-equivalence.yml` runs it.

## Oracle: no 5.17 export

uPortal 5.17's `dataExport` fails for every layout profile on Oracle (MOD-I200). Its
`export-profile.crn` passes the profile's ids to Java methods that take a `long` or an `int`, and
Oracle returns its `NUMBER` columns as `BigDecimal`, which Groovy doesn't convert. 6.0 converts
them, but 5.17's export on Oracle can't be the comparison. When the 5.17 side of a run is Oracle
(in place, or the source of a copy), `equivalence.sh` skips 5.17's export. The export of the build
under test, masked like the reference, must then equal the reference, apart from
`vendors/oracle.diff` if 5.17 stores the fixture differently on Oracle.

## Reading a failure

Each comparison writes a report in `build/db-equivalence/<run>/`. `reference-report.txt` compares
the reference with this run's 5.17 export. `equivalence-report.txt` compares the 5.17 export (`-`
lines) with the export of the build under test (`+` lines). A report starts with
`RESULT: EQUIVALENT` or `RESULT: DIFFERENT`, lists the `MISSING`, `EXTRA` and `CHANGED` files and
then shows a unified diff of each. On GitHub Actions the reports go to the job summary, and their
first lines become annotations on the run.

If only the reference report fails, the fixture, 5.17 or the database server changed. The build
under test did not.

## Re-recording

* Re-record **the reference** only with uPortal 5.17 code, after a change to the fixture or to
  the quickstart data. Run `tests/db/equivalence.sh --record in-place hsqldb` and commit
  `tests/db/equivalence/reference` with the change. The script refuses `--record` for any other
  `OLD_UPORTAL_VERSION`. Then re-record the vendor diffs from the reports of the next nightly run.
* To re-record **the customised layout** (`fixture/uportal/layout/fixture-zoe.layout.xml`), import
  the fixture into a 5.17 portal and log in as `fixture-zoe` (password `student`). Repeat the layout API calls
  that the file's header lists, then export the layout with
  `./gradlew :overlays:uPortal:dataExport -Dtype=layout -Dsysid=fixture-zoe`.

## CI

`.github/workflows/migration-equivalence.yml` runs the check on uPortal built from source, the
same way `integration.yml` builds it. `tests/db/equivalence/matrix.json` lists the sets and
`tests/db/equivalence/matrix.mjs` turns them into job matrices. The servers come from
`tests/db/migrate/matrix.json`.

* **Push set** (a manual run without `nightly`, and every push to a `ccr-*` branch in this
  prototype, MOD-I74): in place on HSQLDB, PostgreSQL 18 and MariaDB 12.3. Copies from PostgreSQL 16
  to MariaDB 12.3 and from MariaDB 11.4 to PostgreSQL 18.
* **Workstream branches** (prototype only, MOD-D30): in place on PostgreSQL 18 and the copy from
  MariaDB 11.4 to PostgreSQL 18.
* **Nightly:** in place on every 6.0 runtime server, and one copy per vendor from its oldest source
  into the next vendor's runtime server. Each vendor is copied from once and into once.

Results so far. Locally, in place on HSQLDB with 5.17.9 and 5.17.10-SNAPSHOT built from the
integration branch: 5.17's export equals the reference in 264 files, and the build under test's
export equals 5.17's in 271 files (18 minutes). On CI, workstream run 38106407734 passed in place on
PostgreSQL 18 and the copy from MariaDB 11.4 to PostgreSQL 18.

## Faults the check caught

Each fault was seeded locally, after an in-place HSQLDB run passed, on a copy of the database that
run left. Each one changed stored rows the way a faulty upgrade or copy would. The build under test
then exported again and was compared with that run's 5.17 export. The database was restored
afterwards.

| Fault | SQL | Report |
| --- | --- | --- |
| Map keys as Hibernate 5.2 read them (MOD-I120) | `update UP_SS_USER_PREF_LAY_ATTR_VAL set ATTR_NAME = '_' \|\| ATTR_NAME` | 12 of 271 files changed, 11 fragment layouts and the customised user layout, each showing `externalId` turned into `_externalId` |
| A portlet parameter changed by the upgrade | `update UP_PORTLET_DEF_PARAM set PARAM_VAL = 'changed by the upgrade' where PARAM_NAME = 'configuration-json'` | 1 file changed, the fixture portlet's `configuration-json` value |
| A text value cut by the copy | `update UP_PERSON_ATTR_VALUES set ATTR_VALUE = substring(..., 1, 200) where ATTR_VALUE like '%Ünïcødé%'` | 1 file changed, `fixture-zoe`'s 254-character description cut to 200 characters |

Each report started with `RESULT: DIFFERENT` and showed the changed lines.
