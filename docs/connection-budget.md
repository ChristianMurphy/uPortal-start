# Database connection budget

The portal and every bundled portlet that keeps data open their own connections to the portal
database. Each web application has its own pool, and the pools don't know about each other. When
their sum is larger than the database server allows, the application that asks last gets "too
many clients" (PostgreSQL) or "Too many connections" (MySQL, MariaDB) and fails to start or to
serve a request. In 5.x the pools could hold about 370 connections between them, against
PostgreSQL's default `max_connections` of 100 (MOD-I190).

uPortal-start sizes the pools so that a portal with every bundled portlet opens at most **80**
connections. That leaves 20 of PostgreSQL's default 100 for `psql`, backups, monitoring and the
import and export tools.

## What uses connections

| Web application | Pool | Maximum | Set by |
| --- | --- | ---: | --- |
| uPortal | `PortalDb`: layouts, groups, permissions, portlet definitions, accounts | 30 | `tomcat.jdbc.pool.PortalDb.*` |
| uPortal | `RawEventsDb`: writes and purges raw portal events | 5 | `tomcat.jdbc.pool.rawEventsDataSource.*` |
| uPortal | `AggrEventsDb`: the statistics aggregation jobs | 5 | `tomcat.jdbc.pool.aggrEventsDataSource.*` |
| NewsReaderPortlet | `dataSource` | 8 | `tomcat.jdbc.pool.newsReaderDataSource.*` |
| Announcements | `dataSource` (fixed in the portlet) | 10 | `WEB-INF/classes/context/databaseContext.xml` |
| NotificationPortlet | `dataSource` (fixed in the portlet) | 8 | `WEB-INF/classes/context/persistenceContext.xml` |
| SimpleContentPortlet | `dataSource` (fixed in the portlet) | 5 | `WEB-INF/classes/context/baseContext.xml` |
| BookmarksPortlet, CalendarPortlet, FeedbackPortlet | no pool: one connection per request that reads or writes | about 3 each | |
| uPortal cluster discovery (JGroups `JDBC_PING`) | no pool: one short connection per discovery round | 1 | |
| **Total** | | **80** | |

The other bundled web applications (resource-server, ResourceServingWebapp, WebProxyPortlet,
basiclti-portlet, esup-filemanager, cas-proxy-test-portlet, pluto-testsuite) don't use the
database.

Command-line tools such as `dataImport`, `dataExport` and `dbMigrate` run in their own JVM with
their own pools while the portal is running. Count them against the headroom.

## The settings

The pool sizes are in `etc/portal/global.properties`, which every web application reads from
`portal.home`. A setting in an application's own file (`portal.home/uPortal.properties` and the like)
or a JVM system property (`-Dtomcat.jdbc.pool.PortalDb.maxActive=40` in `CATALINA_OPTS`) overrides
it without a rebuild.

Each pool takes four sizes:

| Property suffix | What it controls |
| --- | --- |
| `initialSize` | connections opened when the pool starts |
| `minIdle` | idle connections the pool keeps open between requests |
| `maxIdle` | idle connections above which a returned connection is closed |
| `maxActive` | connections the pool opens at most; a request waits up to `maxWait` milliseconds for one, then fails |

`maxActive` is what counts against the database's limit. Keep `maxIdle` below it so that a burst
of requests doesn't hold its connections afterwards.

## Sizing a site

1. Add up `maxActive` of every pool, the unpooled portlets and the tools you run alongside the
   portal (the table above). That is the portal's budget.
2. Multiply it by the number of portal nodes that share the database.
3. Set the database's limit (`max_connections` on PostgreSQL and MySQL/MariaDB, `PROCESSES` and
   `SESSIONS` on Oracle, user connections on SQL Server) to that sum plus room for administrators
   and monitoring, and give the server the memory that many connections need. On PostgreSQL each
   connection is a process that takes several megabytes.
4. If `PortalDb` runs out under load (requests wait, then fail with a "Pool empty" timeout), raise
   its `maxActive` and the database limit together. A connection pooler such as PgBouncer in
   transaction mode lets many portal nodes share fewer server connections.

## The check

`tests/db/harness.sh --portal` and `--full-suite` count the database's client connections every
second on PostgreSQL, from Tomcat's start to the end of the Playwright specs, and fail the vendor
when the peak is above 80 (`HARNESS_CONNECTION_BUDGET` changes it). The counts are in
`build/db-harness/<vendor>/connections.txt`. With `--seeded-pool-fault` the harness then starts the
portal again with `PortalDb` holding 75 connections, and fails unless the check catches it.
