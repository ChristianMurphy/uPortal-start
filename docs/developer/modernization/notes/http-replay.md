# Handoff: HTTP differential replay and security matrix

Workstream branch `ccr-43ba0785-hzlrj5-http-replay` (uPortal-start only, uPortal unchanged).
MOD-D29 items 2 and 8. The full description of the tool is in `docs/http-replay.md`.

## What was built

* `tests/replay/lib.mjs`: an HTTP session with a cookie jar, local and CAS login, and the
  normalisers. Responses become host-neutral fixtures. Session ids, CAS tickets, UUIDs, times,
  body-derived ETags and a few values that 5.17 itself varies are masked, each with its reason in
  a comment. JSON is compared with sorted keys and HTML as an outline of its elements.
* `tests/replay/routes.json`: the route crawl. It has 146 routes from the 33 deployed servlet
  controllers and the portal URL syntax, including trailing-slash, suffix, dotted path variable
  and URL parsing variants. It adds 67 portlets in the `max` and `exclusive` states and 24 CSRF
  probes, which run last and change nothing on 5.17.
* `tests/replay/harvest.mjs` and `suite-pw.config.mjs` list the requests the whole Playwright
  suite makes, by role, from its network traces.
* `tests/replay/replay.mjs`:
  * `record` writes the fixtures, the security matrix (`security-matrix.md`) and the security
    checks.
  * `replay` compares a portal with them and applies `intended-differences.json`. It writes a
    Markdown report to the job summary and one error annotation per unexplained difference.
  * `--actual` re-evaluates a saved run without a portal.
* `tests/replay/portal.sh reset` gives each run the state of a fresh `portalInit`. It empties
  HSQLDB, runs `dataInit` (which also redeploys every overlay) and starts Tomcat.
* `.github/workflows/replay.yml` has two jobs.
  * `replay` runs on every push. It builds uPortal from source as `integration.yml` does and
    replays against the 5.17 fixtures. On workstream branches it runs only when the push changes
    `tests/replay` or the workflow, and newer pushes cancel older runs (MOD-D30).
  * `record` runs only when asked. It records from uPortal-start `master` (released 5.17.9,
    Tomcat 8.5, Gradle 6.9.4) after a `workflow_dispatch` with `record`, or after a push whose
    message contains `[replay-record]`. With `commit`, the fixtures are committed back to the
    branch.
* `eslint.config.js` declares Node globals for `.mjs` files. This also fixes `npm run lint`,
  which failed on `tests/db/migrate/matrix.mjs`.

## Coverage

| | Count |
| --- | --- |
| Roles | guest, student, staff, faculty, admin (plus `developer` in the login checks) |
| Crawl requests per run | 1386 (146 routes and 134 portlet pages, as each role) |
| Playwright suite requests replayed | 1007 distinct GET and HEAD requests from 124 tests in the CI recording (1003 locally). Another 428 state-changing requests (25 endpoints) are listed but not replayed |
| Security matrix | 277 routes, each for all 5 roles |
| Local accounts checked | 5, each through `/uPortal/Login` and the CAS form, with the right and a wrong password |
| Header snapshot | 9 representative pages for guest and admin |
| Intended-difference registry entries | 5 |

## Results

Gradle 6.9.4 cannot be downloaded in this sandbox (`downloads.gradle.org` answers 403), so
`master` itself could not run here. Locally the reference was a stand-in, this branch's
uPortal-start with released uPortal 5.17.9 on Tomcat 8.5.100. The current build was uPortal
`ccr-43ba0785-hzlrj5` (5.17.10-SNAPSHOT) on Tomcat 9.0.122.

* **Self-check**: the stand-in replayed against its own recording after a reset shows no
  differences in 2389 exchanges. Neither do the matrix, the logins, CSRF or the headers.
* **Current build against 5.17.9**: 253 exchanges differ, and all of them fall into the 5
  registered classes below. No regression was found.
  * Tomcat's error page names its version, 8.5.100 or 9.0.122 (163 exchanges).
  * JSON error responses say `charset=UTF-8` instead of `ISO-8859-1` (62). The same uPortal
    webapp still says ISO-8859-1 on Tomcat 8.5, so this comes with Tomcat 9.
  * `/api/session.json` reports the built version (20).
  * `portal-analytics.js` has the dropdown fix f301239691 (5).
  * The vendored Portlet MVC's exception class appears in an action redirect (3).
* **Reference recorded from real `master`** in CI run 38096550769. It ran uPortal-start `master`
  with uPortal 5.17.9 on Tomcat 8.5, Gradle 6.9.4 and Java 11. The run committed the fixtures as
  6532d3e: 2393 exchanges (1386 crawl, 1007 suite requests) and 277 matrix routes. Its self-check
  (the reference replayed against its own recording after a reset) passes.
* **First CI replay against that recording** (run 38100658549) failed, for two reasons:
  * Generated ids differ between machines (finding 12). The stand-in and the current build had
    run on the same machine, which hid this. Locally, the current build against the real
    recording showed 581 unexplained exchanges. Resolving layout node ids per run, masking the
    other generated ids and comparing id-ordered lists without their order brought that to 130.
    Of these, 8 come from the PAGS 500 page recorded as binary and 6 from suite requests that are
    no longer replayed, and both go away with a new recording (normaliser version 2). The rest were ids inside class names, masked since.
  * Newer uPortal integration commits changed two behaviours (finding 13), now registered.

### Seeded faults

Each fault was applied to the deployed current build after `dataInit` and before Tomcat started.
The replay then ran against the stand-in's recording. The faults stay out of the branch. Without
a fault, the same procedure passes, with 253 registered differences.

| Fault | What it imitates | Result |
| --- | --- | --- |
| `<mvc:path-matching suffix-pattern="false" trailing-slash="false"/>` on `/api` | Spring 6 defaults | **fails**: 28 exchanges and 22 matrix cells. `GET /api/session.json/` and `/api/v4-3/dlm/layout.json/` change from 200 to 405 for every role. `/api/v5-0/people/me.json` and `/people/admin.smith` change from 200 to 404 |
| `useHttpOnly="false"` in uPortal's `META-INF/context.xml` and `<http-only>false</http-only>` in its `web.xml` | the container no longer marking the session cookie HttpOnly | **fails**: 3 exchanges and 2 security checks. The login cookie and the header snapshot lose `httponly` on `JSESSIONID` |
| `@JsonFormat` removed from `PortletList.updatedOn` (rebuilt jar) | a Jackson date default change | **fails**: 4 exchanges. `$[0].updatedOn` changes from `"9999-99-99 99:99:99 +0000"` to `{epoch-ms:number}` in both the crawl and the suite requests |
| method security off on `/api` (`global-method-security` commented out) | an admin route opened to guests | **fails**: 36 exchanges, 35 matrix cells and the CSRF table. `GET /api/permissions/owners.json` changes from 403 to 200 for guest, student, staff and faculty |

## Findings

1. **5.17 names permission targets ambiguously.** `PermissionsListController` (`/api/permissionAssignments`)
   looks a target's name up by its number. A group (`local.25`) and a portlet (`PORTLET_ID.25`)
   with the same number can get each other's name, and the name each gets differs from run to run.
   The replay masks `targetName` there.
2. **The JSON error charset changed with Tomcat 9.** It was ISO-8859-1 and is now UTF-8. This is
   registered as intended, and UTF-8 matches the bodies.
3. **5.17 shows the Tomcat version on its error pages.** This leaks server information. Tomcat's
   `ErrorReportValve showServerInfo="false"` would hide it. It is not changed here.
4. **A portlet action that fails puts the exception message into the redirect URL**
   (`pP_actionException=...NoHandlerFoundException: ...`). 5.17 does this too.
5. **`dataInit` alone breaks NotificationPortlet.** It recreates uPortal's tables but keeps the
   portlets' own. On the next start NotificationPortlet fails on its existing foreign key
   (`FKT4WKLCI6TDVVOYEJL8TBHG6GE`), and the emergency alert answers 503. A fresh `portalInit` is
   not affected. The replay's reset empties HSQLDB to avoid it. Developers who run `dataInit` on a
   used portal hit the same problem.
6. **HttpOnly is set in three places.** uPortal's `META-INF/context.xml` (`useHttpOnly="true"`)
   wins over `WEB-INF/web.xml` and Tomcat's `conf/context.xml`. The Tomcat 10.1/11 move has to
   keep the webapp's own setting. Changing the other two did not change the session cookie.
7. **Suffix pattern matching hides a wrong user.** On 5.17, `/api/v5-0/people/admin.smith`
   returns `admin`, because Spring 4.3 cuts the path variable at the dot. Spring 6 changes this
   to 404, which the replay reports. It then needs a registry entry or a fix.
8. **`/api` has no CSRF protection.** This is 5.17 behaviour, and the replay records it.
   `PortalCsrfSecurityRequestMatcher` exempts every `/api` path, so state-changing `/api`
   requests (layout changes, portlet lists, imports, deletes) don't need a token, and
   `GET /api/updatePermission` writes through a GET. The CSRF probes record this. A Spring
   Security upgrade that enables CSRF on `/api` fails the replay until it is registered.
9. **5.17 answers 500 to a portlet-list POST without a name** (`{}`), where 400 is expected.
10. **A page render during portlet start-up breaks the emergency alert until a restart.** Pluto
    initialises NotificationPortlet's portlets on a timer 3 to 20 seconds after Tomcat starts, and
    a render of `emergency-alert` before that makes Tomcat mark the `EmergencyAlert` servlet
    unavailable (503) until the next restart. A readiness probe on `/uPortal/` can trigger it,
    which `integration.yml` and `CI.yml` also use before the Playwright suite. The replay now
    probes `/uPortal/health-check` and waits 30 seconds before its first render.
11. **Some responses vary by design.** The marketplace's related portlets are a random sample,
    and several `/api` lists come from hash sets. The replay sorts or masks them, and the comments
    in `lib.mjs` say which.
12. **5.17 assigns generated ids differently on every machine.** `JaxbPortalDataHandlerService`
    imports the files of one entity type in parallel, in the order `ConcurrentDirectoryScanner`
    lists them from the file system. User, group, portlet, portlet type and entity type ids, the
    user part of layout node ids (`u26l1n210` on one machine, `u22l1n210` on another), and every
    list that 5.17 orders by them (fragments in the page, categories, portlet lists) differ between
    two fresh installs with the same data. An id in a bookmarked URL or an external integration is
    not portable between installs. For the replay, generated ids are masked, layout node ids in
    recorded URLs are resolved per run from the role's `layout.json` and welcome page, and lists of
    objects are compared without their order. The replay does not detect changes to how ids are
    generated, and it compares fewer orderings.
13. **The replay caught two changes on the uPortal integration branch.** uPortal 3127a82ab9 maps
    servlet controllers with `RequestMappingHandlerMapping`, so an unmapped GET under `/api` answers
    404 where 5.17 answered 405 with `Allow: POST` (from `PortalController`'s `/**` mapping that the
    `/api` dispatcher also loads). uPortal bcc1d9139d removes the spring-js `ResourceServlet`, so
    `/uPortal/resources/*` answers 404. Both are registered as intended and need a WS6 review.

## Proposed LOG entries

* `MOD-D?`: HTTP differential replay and security matrix (MOD-D29 items 2 and 8). The replay runs
  on every push against fixtures recorded from uPortal-start `master` (5.17.9). Differences
  fail unless `tests/replay/intended-differences.json` lists them with a reason and a log
  reference. Recording runs only on request (`[replay-record]` or `workflow_dispatch`).
* `MOD-I?` (Persistence/API): 5.17's `/api/permissionAssignments` gives a target the name of
  another entity with the same number (finding 1). Upstream candidate.
* `MOD-I?` (uPortal-start): `dataInit` on a used portal breaks NotificationPortlet (finding 5).
* `MOD-I?` (Security): the Tomcat error pages show the server version (finding 3), and failed
  portlet actions put exception messages into URLs (finding 4). Both are 5.17 behaviour and
  candidates for hardening.
* `MOD-I?` (Spring 6 heads-up): suffix pattern matching and trailing-slash matching (finding 7
  and the path-matching fault) change at least 22 matrix cells. WS6 should decide per route
  whether to keep the old URLs.
* `MOD-I?` (API): a portlet-list POST without a name answers 500 (finding 9).
* `MOD-I?` (Persistence): generated ids depend on the machine because the data import runs in
  parallel over an unsorted directory listing (finding 12). Upstream candidate (sort the listing,
  or import one type in one thread).
* `MOD-I?` (Web): unmapped `/api` GETs answer 404 instead of 405, and `/resources/*` is gone
  (finding 13). WS6 to confirm both are intended.
* `MOD-I?` (Tests): readiness probes that render `/uPortal/` can break NotificationPortlet's
  emergency alert for the whole run (finding 10). The Playwright jobs could probe
  `/uPortal/health-check` instead.

## What's left

State on 2026-10-11, for resuming from the branch alone:

* **Running**: the HTTP replay run for the commit that adds this text re-records the reference
  from `master` with normaliser version 2 and commits it to this branch
  (`test(e2e): record the 5.17 http replay fixtures`). Run 38104156826 was replaced by it before it
  started.
  Until that commit is on the branch, the replay job refuses the version 1 fixtures, as designed.
* **Next step**: after the fixture commit, push a commit that touches `tests/replay` (the
  registry entries for finding 13 and the commit job's rebase are waiting locally for that). The
  replay job then runs against the new recording. Register or mask what it shows, with reasons,
  until it passes, and put its run ID here.
* **Seeded faults** were run against the stand-in recording with the masks before finding 12.
  After the replay passes in CI, rerun them locally against the real recording (the fault script
  is described in "Seeded faults" above).
* Not covered yet: browsers other than Chromium, other databases (the replay runs on HSQLDB only),
  portlet resource URLs other than those the suite requests, and the 428 state-changing suite
  requests (only the CSRF probes replay state changes).
