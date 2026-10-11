# HTTP differential replay and security matrix

The replay answers one question for every change to uPortal or its stack: does the portal still
answer every request the way uPortal 5.17 did? It records what 5.17 answers once and keeps the
normalised answers as fixtures in `tests/replay/fixtures/5.17/`. Later builds are compared with
them. A difference fails the check unless it is listed, with its reason, in
`tests/replay/intended-differences.json`. This is item 2 (HTTP differential replay) and item 8
(security matrix) of MOD-D29 in uPortal's `docs/developer/modernization/LOG.md`.

It is aimed at changes that the Playwright suite can miss because the page still works:

* Spring 6 drops suffix pattern matching (`/api/groups.json`) and trailing-slash matching
  (`/api/groups/`), and changes how path variables with dots are read;
* Jackson 3 changes defaults such as date formats and property order;
* Tomcat 10.1 and 11 change cookie attributes, URL parsing and error pages;
* Spring Security 5 to 7 change CSRF, security headers, the HTTP firewall and session handling.

## What is requested

The replay sends each request as each quickstart role, in a fixed order, on a portal that `dataInit` has just
filled (the state matters, so the recorder and the replayer both reset the portal first):

| Role | Account |
| --- | --- |
| guest | none (anonymous session) |
| student | `student` |
| staff | `staff` |
| faculty | `faculty` |
| admin | `admin` (Portal Administrators) |

The requests come from two sources.

1. **The route crawl** (`tests/replay/routes.json`). Its routes come from uPortal's servlet-side
   controller mappings, plus the portal URL syntax. uPortal has 34 servlet controller classes, and
   33 are deployed in the webapp (`SoffitRendererController` is not). They are spread over 7
   dispatcher servlets: `/api/*`, `/api/analytics`, `/Login` and `/Logout`, `/health-check`,
   `/f/*` `/p/*` `*.uP` `/index.jsp`, `/layout.json` and `/s/*`. The crawl includes:
   * the read routes of every controller, with real values from the quickstart data, and unknown
     values (`does-not-exist`);
   * path-matching variants: trailing slashes, `.json` and `.xml` suffixes, a dot in the last path
     variable, a path without its required trailing slash;
   * URL parsing cases: a doubled slash, `;` path parameters, encoded dot segments and slashes,
     and a malformed escape;
   * hidden resources (`WEB-INF`, `META-INF`) and static resources;
   * every bundled portlet that does not fetch content from the internet, in the `max` and
     `exclusive` window states, plus one that does not exist;
   * the CSRF probes, which run last. These are state-changing endpoints called without a token,
     from another origin, or with an unusual method. They use unknown ids and empty or invalid
     bodies, so they don't change anything on 5.17.
2. **The Playwright suite**. When the reference is recorded, the whole suite runs against 5.17 with a
   network trace (`tests/replay/suite-pw.config.mjs`). `tests/replay/harvest.mjs` then lists every
   request it made to the portal's host, with the role that was logged in at the time, the
   `Accept`, `X-Requested-With` and `Content-Type` headers, and the number of tests that made it.
   The GET and HEAD requests are replayed. The others are listed under `mutations` in
   `suite-requests.json` as the suite's state-changing endpoints; they are not replayed, because
   what they do depends on the state the suite built up. Login and logout requests and requests
   with a CAS ticket in them are left out, because the security checks cover login.

## What is compared

For each request:

| Part | Compared as |
| --- | --- |
| Status | exactly |
| Redirect target | `Location`, made relative to the portal host |
| Headers | `Content-Type` with its charset, `Content-Encoding`, `Cache-Control`, `Pragma`, `Expires`, `Last-Modified` and `ETag` (shape only), `Vary`, `Allow`, `WWW-Authenticate`, the CORS headers, and the security headers (`X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Strict-Transport-Security`, `Content-Security-Policy`, `Referrer-Policy`, `Permissions-Policy`, and the `Cross-Origin-*` headers) |
| Cookies | the name of each `Set-Cookie`, whether its value is empty, and its attributes (`Path`, `HttpOnly`, `Secure`, `SameSite`, `Max-Age`, whether `Expires` is set) |
| JSON bodies | parsed, keys sorted, volatile values masked |
| HTML bodies | an outline: one line per element that has an id, a landmark tag (`form`, `input`, headings, `nav` and so on), a stylesheet or external script, or a portal class (`up-*`, `portlet`, `region` and so on); with its classes, `name`, `type`, `method`, `action`, `href` and `src` (path and parameter names only), and the text of titles, headings and buttons |
| Other bodies | a hash and the length rounded up to 64 bytes |

### Masks

The values below differ between two runs of the same build, so they are replaced before the
comparison. `tests/replay/lib.mjs` gives the reason for each one:

* session ids (`JSESSIONID`, `;jsessionid=`), which are random per session;
* CAS tickets (`ST-`, `TGT-`, `LT-` and so on) and CAS login-flow execution keys, which are random
  and single-use;
* UUIDs, which are generated;
* the host and port of the portal, also inside other URLs, which become `{origin}`;
* jQuery's `_=<time>` cache-busting parameter;
* transient portlet subscribe ids (`search.ctf1`), which count up in the order portlets render on
  parallel threads;
* the names of aggregated skin resources, which are hashes of their content;
* dates and times. In JSON strings, headers and HTML, every digit becomes 9, so a changed format
  still shows. HTTP dates become `{http-date}`. JSON numbers between the years 2000 and 2100 in
  milliseconds become `{epoch-ms:number}`, so a switch from numbers to strings still shows;
* `ETag` values, which hash the body or the size and modification time of a deployed file. The
  tag's length and whether it is weak are compared;
* the signed token from `/api/v5-1/userinfo`, whose header and claims are compared without its
  times and signature;
* the health checks' response times and memory figures, and the session key;
* arrays that 5.17 builds from hash sets (groups, permission assignments, entity search results,
  marketplace entries, portlet lists), which are sorted first;
* two values that 5.17 itself returns differently from run to run: the marketplace's random
  sample of related portlets (only its size is compared), and permission target names (see the
  findings in `docs/developer/modernization/notes/http-replay.md`);
* cookie values, which are never stored.

Generated database ids, layout node ids and portlet window ids are deterministic on a freshly
initialised portal. The replay compares them. A change in how ids are generated, such as a
different Hibernate ID generator, shows up as a difference.

When recording, the 5.17 portal replays its own recording against itself after another reset. That
self-check must pass. When it fails, a value needs a mask.

## Security checks

* **Security matrix** (`fixtures/5.17/security-matrix.md` and `.json`): for every crawled route and
  every role, the status and its auth outcome (`allowed`, `redirect-to-login`, `redirect`,
  `unauthorized`, `forbidden`, `not-found`, `method-not-allowed`, `client-error`, `server-error`).
  The replay checks each cell. A changed cell is unexplained unless the registry lists the status
  difference for that request.
* **Local accounts**: every local account with a password in the 5.17 data (`admin`, `student`,
  `staff`, `faculty`, `developer`, all stored as uPortal's salted `(MD5)` hash) must still log in
  with its password and be refused with a wrong one. This is checked both through uPortal's own
  `/uPortal/Login` and through the CAS login form.
* **Session cookie**: the attributes of the cookies the portal sets when a user logs in.
* **CSRF**: the status and outcome of every CSRF probe. On 5.17, `PortalCsrfSecurityRequestMatcher`
  exempts `/api.*`, `/Login.*` and `/Logout.*`, so CSRF is enforced only on portal POSTs such as
  portlet actions. A change in either direction (an endpoint that now refuses a request without a
  token, or one that no longer does) fails until it is registered as intended.
* **Security header snapshot**: the security headers and cookies of representative pages, for
  guest and admin.

## Intended differences

`tests/replay/intended-differences.json` lists the differences that are reviewed and intended.
Each entry matches requests by `path` (a glob in which `*` matches anything), and optionally by
`roles`, `method` and `set` (`crawl` or `suite`). It matches one kind of difference by `field`:
`status`, `location`, `header:<name>`, `cookie:<name>`, `body`, or a glob of these. Optional
`from` and `to` values must match exactly, so a later change of the new value is reported again.
An entry with `security` instead of `path` matches a change in the security checks by its path,
such as `logins.admin.cas.password` or `csrf.*`. Each entry has a `reason` and a `log`
reference:

```json
{
    "id": "portlet-list-duplicate-name",
    "path": "/uPortal/api/portlet-list/*",
    "method": "POST",
    "field": "status",
    "from": 500,
    "to": 400,
    "reason": "A duplicate name was hidden behind a 500 by SQLNextExceptionLoggerAspect; it is a 400 now",
    "log": "MOD-I97"
}
```

The report lists the entries that didn't match anything, so stale entries can be removed.

## Running it

You need a portal that `dataInit` has just filled, and Node.js (`npm ci`).

```bash
./gradlew portalInit tomcatStart                  # or: tests/replay/portal.sh reset .
node tests/replay/replay.mjs replay --origin http://localhost:8080
```

The report goes to `build/replay/report.md` (and to the job summary on GitHub Actions, with an
error annotation for every unexplained difference). `build/replay/actual.json` holds everything
the replay saw. The exit status is 1 when there are unexplained differences. A replay takes a few
minutes. Requests run one after another, because some of them change state that later ones see
(who is online, say).

`tests/replay/portal.sh reset <checkout> [gradle args]` stops Tomcat, runs `dataInit`, starts
Tomcat and waits for the portal. Run it before every replay, because a replay changes state (it
logs users in, and the Playwright requests render portlets).

## Recording the reference

The reference is uPortal-start `master`: the released uPortal 5.17 (`uPortalVersion` in its
`gradle.properties.example`) on Tomcat 8.5, Gradle 6.9.4 and Java 11. Recording is never run
implicitly. To re-record, do either of these:

* run the **HTTP replay** workflow by hand with `record` checked (this needs the workflow on the
  default branch); check `commit` too to have the run commit the fixtures to the branch;
* push a commit whose message contains `[replay-record]`, or `[replay-record commit]` to have the
  fixtures committed to the pushed branch by the workflow (never to the default branch).

The record job:

1. checks out `master` (or `reference-ref`) next to this checkout, and runs `portalInit` and
   `tomcatStart` there;
2. runs this checkout's whole Playwright suite against it with network traces, and harvests the
   requests;
3. resets that portal, then records the crawl, the suite's requests and the security checks into
   `tests/replay/fixtures/5.17/`;
4. resets it again and replays the recording against it (the self-check, whose report is
   kept as `self-check.md`);
5. uploads the fixtures as the `replay-fixtures-5.17` artifact.

Re-record after changing `routes.json` or a normaliser in `lib.mjs` (then bump
`NORMALISER_VERSION`; a replay refuses fixtures from another version), or when the Playwright
suite gains specs whose requests should be covered. Review the fixture diff like code: a
recording replaces the reference.

To record locally against a 5.17 portal of your own (uPortal-start `master` on port
8080):

```bash
npx playwright test --config=tests/replay/suite-pw.config.mjs   # with PORTAL_BASE_URL if not 8080
node tests/replay/harvest.mjs build/replay/suite-results build/replay/suite-requests.json http://localhost:8080
tests/replay/portal.sh reset ../uPortal-start-master
node tests/replay/replay.mjs record --origin http://localhost:8080 --suite build/replay/suite-requests.json
```

## Route sources

The crawl was built from a survey of every `@RequestMapping` (and `@GetMapping`, `@PostMapping`
and so on) on uPortal's servlet-side controllers, the servlet mappings in `web.xml`, and the
dispatcher contexts in `uPortal-webapp/src/main/resources/properties/contexts/servlet/`. These details
matter when you extend it:

* `/api/*` is a `DispatcherServlet` with `<mvc:annotation-driven/>` and Spring 4.3's defaults:
  suffix pattern matching and trailing-slash matching are on, and nothing in uPortal configures
  them.
* `/api/analytics` and `/api/analytics/level` are exact mappings of a separate dispatcher, so
  `/api/analytics/` goes to the `/api/*` dispatcher instead.
* Spring Security has no URL rules (`intercept-url pattern="**"` without `access`).
  Authorization happens in the controllers and through `@PreAuthorize`, `@PostAuthorize` and
  `@PostFilter`, so the matrix has one cell per route and role.
* `GET /api/updatePermission` writes through a GET, so the CSRF matcher never sees it.
