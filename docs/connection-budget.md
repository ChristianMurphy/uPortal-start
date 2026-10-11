# Database connection budget

The portal and every bundled portlet that keeps data open their own connections to the portal
database. Each web application has its own pool, and the pools don't know about each other. When
their sum is larger than the database server allows, the application that asks last gets "too
many clients" (PostgreSQL) or "Too many connections" (MySQL, MariaDB) and fails to start or to
serve a request. In 5.x the pools could hold about 370 connections between them, against
PostgreSQL's default `max_connections` of 100 (MOD-I190).

uPortal-start sizes the pools so that a portal with every bundled portlet opens at most **110**
connections. **Set PostgreSQL's `max_connections` to 150**, which leaves 40 for `psql`, backups,
monitoring and the import and export tools.

Why so many: each page keeps a database connection open while its portlets render, and each portlet
render takes another. With 16 people using the portal at once, `PortalDb` needed 60 connections
before no request had to wait. With the 5.x pool sizes the same load opened 127 connections, so a
5.x portal on PostgreSQL's default of 100 can already run out today. uPortal can hold fewer
connections per page; until it does, the database needs the larger limit.

## What uses connections

| Web application | Pool | Maximum | Set by |
| --- | --- | ---: | --- |
| uPortal | `PortalDb`: layouts, groups, permissions, portlet definitions, accounts | 60 | `tomcat.jdbc.pool.PortalDb.*` |
| uPortal | `RawEventsDb`: writes and purges raw portal events | 5 | `tomcat.jdbc.pool.rawEventsDataSource.*` |
| uPortal | `AggrEventsDb`: the statistics aggregation jobs | 5 | `tomcat.jdbc.pool.aggrEventsDataSource.*` |
| NewsReaderPortlet | `dataSource` | 8 | `tomcat.jdbc.pool.newsReaderDataSource.*` |
| Announcements | `dataSource` (fixed in the portlet) | 10 | `WEB-INF/classes/context/databaseContext.xml` |
| NotificationPortlet | `dataSource` (fixed in the portlet) | 8 | `WEB-INF/classes/context/persistenceContext.xml` |
| SimpleContentPortlet | `dataSource` (fixed in the portlet) | 5 | `WEB-INF/classes/context/baseContext.xml` |
| BookmarksPortlet, CalendarPortlet, FeedbackPortlet | no pool: one connection per request that reads or writes | about 3 each | |
| uPortal cluster discovery (JGroups `JDBC_PING`) | no pool: one short connection per discovery round | 1 | |
| **Total** | | **110** | |

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
| `maxIdle` | idle connections the pool keeps when its idle sweeper is off; uPortal's pools run the sweeper, which closes a connection once it has been idle for `minEvictableIdleTimeMillis` (5 minutes for `PortalDb`, down to `minIdle`) |
| `maxActive` | connections the pool opens at most; a request waits up to `maxWait` milliseconds for one, then fails |

`maxActive` is what counts against the database's limit. After a burst of requests the pool keeps
its connections open for a few minutes, so a portal under steady load holds close to its peak.

## Measured use

Under load, measured with the G-index driver (`tests/db/gindex`, docs/g-index.md): 16 people
browsing and signing in at once for four minutes, on PostgreSQL 18 with `max_connections=300` so
that the database's limit didn't cut the measurement short.

| `PortalDb` `maxActive` | Requests that waited 5 s and failed ("Pool empty") | Median response (ms) | 95th percentile (ms) | Most connections at once |
| --- | ---: | ---: | ---: | ---: |
| 100 (5.x, with every 5.x pool size) | 0 | 617 to 706 | 2,982 to 3,333 | 127 |
| 30 | 215 | 562 | 3,344 | |
| 50 | 39 | 737 | 3,592 | 77 |
| 60 (uPortal-start) | 0 | 644 | 3,723 | 87 |

A failed request still returns its page, with the portlet that couldn't get a connection showing
an error, so only the "Pool empty" count in the portal's log shows it.

With light load, on PostgreSQL 18, with every bundled portlet deployed and the whole Playwright suite running, the
database had 32 client connections at the median and 38 at the peak, with the 5.x pool sizes and
with a smaller budget alike. Tagging each web application's connections (`ApplicationName` in the JDBC
URL) showed where they were:

| Web application | Median | Peak |
| --- | ---: | ---: |
| uPortal (its three pools) | 27 | 27 |
| NotificationPortlet | 2 | 2 |
| SimpleContentPortlet | 2 | 2 |
| Announcements | 1 | 3 |
| NewsReaderPortlet | 1 | 2 |
| BookmarksPortlet, CalendarPortlet | 0 | 1 each |

Nearly all were idle connections kept by the pools between requests.

## Sizing a site

The budget is sized for about 16 people using the portal at once. **If more people use your
portal at once, size `PortalDb` from your own peak** before you go live, and again after the
busiest day of the term. A `maxActive` that is too small for your load makes requests wait for a
connection and then fail.

To read the peak, uPortal registers each of its pools with the JVM's MBean server as
`uPortal:section=DataSource,name=PortalDb` (and `RawEventsDb`, `AggrEventsDb`). Connect with
JConsole, VisualVM or a JMX exporter during your busiest hour and watch:

* `Active`: connections in use right now. Its highest value is your peak.
* `WaitCount`: requests waiting for a connection. Anything above 0 means the pool is too small.
* `Size`: connections open, in use and idle together.

On PostgreSQL, you can also add `?ApplicationName=uPortal` to the JDBC URL in
`portal.home/uPortal.properties` and count `select count(*) from pg_stat_activity where
application_name = 'uPortal' and state <> 'idle'`. A "Pool empty. Unable to fetch a connection"
error in `uPortal.log` means requests have already failed.

Set `maxActive` to about one and a half times the peak `Active`, then work out the database's limit:

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
second on PostgreSQL, from Tomcat's start to the end of the Playwright specs. The vendor fails
when the peak is above the budget of 110 (`HARNESS_CONNECTION_BUDGET` changes it) or above the
server's `max_connections` less 10, whichever is lower. CI runs PostgreSQL with its default of 100,
so there the limit is 90. The counts are in `build/db-harness/<vendor>/connections.txt`. With
`--seeded-pool-fault` the harness then starts the portal again with `PortalDb` alone holding 5
connections fewer than the limit, and fails unless the check catches it.

The G-index workload summary shows the driver's median and 95th percentile response times and the
number of "Pool empty" timeouts in the portal's log.
