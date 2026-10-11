# Database connections

The portal and every bundled portlet that keeps data open their own connections to the portal
database. Each web application has its own pool, and the pools don't know about each other. When
their sum is larger than the database server allows, the application that asks last gets "too
many clients" (PostgreSQL) or "Too many connections" (MySQL, MariaDB) and fails to start or to
serve a request (MOD-I190).

**Under load the portal needs more connections than PostgreSQL's default `max_connections` of
100.** With 16 people using the portal at once, the default pools opened 127 connections. Set
`max_connections` to at least 150 for a portal on PostgreSQL, or size it from your own peak as
described below.

Why so many: each page keeps a database connection open while its portlets render, and each
portlet render takes another. uPortal can keep fewer connections open per page (MOD-I240 to MOD-I249);
uPortal-start will set a connection budget once it does.

## What uses connections

| Web application | Pool | Maximum | Set by |
| --- | --- | ---: | --- |
| uPortal | `PortalDb`: layouts, groups, permissions, portlet definitions, accounts | 100 | `tomcat.jdbc.pool.PortalDb.*` |
| uPortal | `RawEventsDb`: writes and purges raw portal events | 100 | `tomcat.jdbc.pool.rawEventsDataSource.*` |
| uPortal | `AggrEventsDb`: the statistics aggregation jobs | 100 | `tomcat.jdbc.pool.aggrEventsDataSource.*` |
| NewsReaderPortlet | `dataSource` | 50 | `tomcat.jdbc.pool.newsReaderDataSource.*` |
| Announcements | `dataSource` (fixed in the portlet) | 10 | `WEB-INF/classes/context/databaseContext.xml` |
| NotificationPortlet | `dataSource` (fixed in the portlet) | 8 | `WEB-INF/classes/context/persistenceContext.xml` |
| SimpleContentPortlet | `dataSource` (fixed in the portlet) | 5 | `WEB-INF/classes/context/baseContext.xml` |
| BookmarksPortlet, CalendarPortlet, FeedbackPortlet | no pool: one connection per request that reads or writes | | |
| uPortal cluster discovery (JGroups `JDBC_PING`) | no pool: one short connection per discovery round | | |

The maximums add up to about 373. The pools alone never stop a portal from asking for more than the
database allows. The other bundled web applications (resource-server, ResourceServingWebapp,
WebProxyPortlet, basiclti-portlet, esup-filemanager, cas-proxy-test-portlet, pluto-testsuite) don't
use the database.

Command-line tools such as `dataImport`, `dataExport` and `dbMigrate` run in their own JVM with
their own pools while the portal is running. Count them against the database's limit too.

## The settings

A pool's sizes can be set in `etc/portal/global.properties`, which every web application reads from
`portal.home`. A setting in an application's own file (`portal.home/uPortal.properties` and the like)
or a JVM system property (`-Dtomcat.jdbc.pool.PortalDb.maxActive=80` in `CATALINA_OPTS`) overrides
it without a rebuild.

| Property suffix | What it controls |
| --- | --- |
| `initialSize` | connections opened when the pool starts |
| `minIdle` | idle connections the pool keeps open between requests |
| `maxIdle` | idle connections the pool keeps when its idle sweeper is off; uPortal's pools run the sweeper, which closes a connection once it has been idle for `minEvictableIdleTimeMillis` (5 minutes for `PortalDb`, down to `minIdle`) |
| `maxActive` | connections the pool opens at most; a request waits up to `maxWait` milliseconds for one, then fails |

After a burst of requests a pool keeps its connections open for a few minutes, so a portal under
steady load holds close to its peak.

## Measured use

Under load, measured with the G-index driver (`tests/db/gindex`, docs/g-index.md): 16 people
browsing and signing in at once for four minutes, on PostgreSQL 18 with `max_connections=300` so
that the database's limit didn't cut the measurement short. The rows below 100 set only `PortalDb`
smaller.

| `PortalDb` `maxActive` | Requests that waited 5 s and failed ("Pool empty") | Median response (ms) | 95th percentile (ms) | Most connections at once |
| --- | ---: | ---: | ---: | ---: |
| 100 (the default) | 0 | 617 to 706 | 2,982 to 3,333 | 127 |
| 30 | 215 | 562 | 3,344 | |
| 50 | 39 | 737 | 3,592 | 77 |
| 60 | 0 | 644 | 3,723 | 87 |

A request that can't get a connection still returns its page, with an error in the portlet that
failed, so only the "Pool empty" count in the portal's log shows it.

With light load (the whole Playwright suite, on PostgreSQL 18) the database had 32 client
connections at the median and 38 at the peak. Tagging each web application's connections
(`ApplicationName` in the JDBC URL) showed where they were:

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

Size the database's limit from your own peak before you go live, and again after the busiest day of
the term.

uPortal registers each of its pools with the JVM's MBean server as
`uPortal:section=DataSource,name=PortalDb` (and `RawEventsDb`, `AggrEventsDb`). Connect with
JConsole, VisualVM or a JMX exporter during your busiest hour and watch:

* `Active`: connections in use right now. Its highest value is your peak.
* `WaitCount`: requests waiting for a connection. Anything above 0 means the pool is too small.
* `Size`: connections open, in use and idle together.

On PostgreSQL you can also count them on the server: add `?ApplicationName=uPortal` to the JDBC URL
in `portal.home/uPortal.properties` and run `select count(*) from pg_stat_activity where
application_name = 'uPortal'`. Without the tag, `select count(*) from pg_stat_activity where
backend_type = 'client backend'` counts every application's connections. A "Pool empty. Unable to
fetch a connection" error in `uPortal.log` means requests have already failed.

Then:

1. Add up the peaks of every web application, and the tools you run alongside the portal.
2. Multiply it by the number of portal nodes that share the database.
3. Set the database's limit (`max_connections` on PostgreSQL and MySQL/MariaDB, `PROCESSES` and
   `SESSIONS` on Oracle, user connections on SQL Server) to about one and a half times that sum,
   plus room for administrators and monitoring, and give the server the memory that many
   connections need. On PostgreSQL each connection is a process that takes several megabytes.
4. To cap a pool below the database's limit, set its `maxActive`, but not below one and a half times
   its peak `Active`: requests then wait for a connection and fail. A connection pooler such as
   PgBouncer in transaction mode lets many portal nodes share fewer server connections.

## Test reports

`tests/db/harness.sh --portal` and `--full-suite` count the database's client connections every
second on PostgreSQL, from Tomcat's start to the end of the Playwright specs, write them to
`build/db-harness/<vendor>/connections.txt` and print the peak. A peak above the server's
`max_connections` less 10 becomes a warning on the run.

The G-index workload summary shows the driver's median and 95th percentile response times and the
number of "Pool empty" timeouts in the portal's log.
