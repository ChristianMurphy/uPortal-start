# Query-count budgets

`tests/query-budget/run.sh` counts the SQL statements uPortal runs for each of a set of key
requests and compares them with the budgets in `tests/query-budget/budgets.json`. It catches the
N+1 queries and lost fetch joins that a Hibernate upgrade (4.3 → 5.2 → 6 → 7) commonly brings,
which no functional test notices until a portal is slow under load (MOD-D29).

## How statements are counted

Only the deployed test portal changes; the overlay, the WAR and every production setting stay as
they are, and the next `tomcatDeploy` or `portalInit` removes the instrumentation. The script:

1. copies [p6spy](https://github.com/p6spy/p6spy) 3.9.1 (pinned by SHA-256) into
   `.gradle/tomcat/webapps/uPortal/WEB-INF/lib` and adds a `spy.properties` that logs each
   executed statement through slf4j;
2. points uPortal's connection (`hibernate.connection.driver_class` and `.url` in
   `${portal.home}/uPortal.properties`, which the portlets do not read) at p6spy's driver, which
   wraps the real one;
3. logs those statements to `logs/portal/sql.log` as `<time>|<thread>|<category>|<sql>`;
4. starts Tomcat and runs `tests/query-budget/query-budget.mjs`.

A request's statements are the ones its Tomcat thread (`http-nio-*`) and the portlet threads it
starts (`uP-PortletExec-*`) log while it runs. Background jobs (event flushing, aggregation and
the other scheduled tasks on `uP-TaskExec-*`, `uP-TaskSched-*` and `uP-LockExec-*`) and JGroups
are not counted. Plain JDBC (the layout, group and permission stores) is counted as well as
Hibernate's statements.

Each request is made three times in a row: `first` is the count of the first time and `warm` the
count of the third, once the caches are filled. The requests always run in the same order after a
warm-up request, so `first` is repeatable too.

## Budgets and tolerance

A count may exceed its budget by 10 %, and at least by 2 statements; more fails. A count below
80 % of its budget, less 2, is reported as a note so the budget can be lowered (a ratchet).

| Request | Path |
| --- | --- |
| `guest-welcome` | `f/welcome/normal/render.uP` as guest |
| `guest-search` | `api/v5-0/portal/search?q=cartoon` |
| `student-login`, `admin-login` | `Login?userName=...`, landing on the home page (a new session each time) |
| `student-home`, `admin-home` | the home page |
| `student-layout-json` | `api/v4-3/dlm/layout.json` |
| `student-portlet-registry` | `api/v4-3/dlm/portletRegistry.json` |
| `student-portlet-list` | `api/portlet-list/` |
| `student-maximized-portlet` | `p/what-is-uportal/max/render.uP` |
| `admin-portlet-manager`, `admin-groups-manager` | the admin portlets, maximised |
| `admin-permission-assignments` | `api/permissionAssignments?owner=UP_ERROR_CHAN&activity=VIEW` |
| `admin-people-search` | `api/v5-0/portal/search?q=steven&type=people` |

## Running it

```bash
./gradlew portalInit                 # Tomcat stopped, HSQLDB running
tests/query-budget/run.sh            # compare with budgets.json
tests/query-budget/run.sh --record   # write the observed counts to budgets.json
```

Results are in `build/query-budget/results.txt`, with the statement log next to them. A change
that is meant to add statements updates `budgets.json` in the same commit, with the reason in
the commit message. `.github/workflows/integration.yml` runs the check (job `query-budgets`) on
every push to the integration branch and nightly, against uPortal built from source; a failure
prints the observed counts as JSON, in the format of `budgets.json`.
