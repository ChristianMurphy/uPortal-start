# Handoff: local login by default, CAS 8 opt-in (P1-13 / WS10)

Branch: `ccr-43ba0785-hzlrj5-local-login` (uPortal-start only). Answers MOD-Q3 as recommended:
uPortal's local login is the default, and CAS runs as an opt-in Docker Compose service on CAS 8
that CI still exercises.

## What changed

| Commit | Change |
| --- | --- |
| `3b40c81` feat!: | Local login by default: `etc/portal/uPortal.properties` turns the CAS security context off, points Sign In at the login portlet and logout at the guest page; `global.properties` names no CAS server. `overlays/cas` (CAS 3.6) and its nine version properties are removed. `tests/db/harness.sh --portal` no longer deploys CAS. |
| `965cb5c` feat: | `-PauthMode=cas` (`gradle/tasks/auth.gradle`): `tomcatConfig` appends `etc/cas/{global,uPortal}.properties` to `portal.home`, with `cas.protocol/server/context` split from `casServerUrl`. `casStart`/`casStop` run `docker/cas/compose.yaml`. `overridesContext.xml` turns on `casTicketUserInfoService`. `playwrightRun` passes `AUTH_MODE`/`CAS_BASE_URL`. |
| `f6510a3` test(e2e): | Helpers drive the login form of either mode; auth spec rewritten for both modes; new `cas-proxy-test.spec.ts`. |
| `9122724` ci: | CI `playwright-cas` job (auth + proxy specs against CAS, then a CAS-down seeded fault that must fail); Integration `playwright-cas` job on the uPortal build. |
| `e273bbe` docs: | `docs/authentication.md`; README "How To Choose How Users Sign In". `[skip ci]` |
| `9aa091c` fix: | Sign In URL `/uPortal/p/login?refUrl=` so guest deep links don't end in HTTP 400 (finding 1); deep-link spec; local wrong-password assertion (finding 2). |

Nothing changed in uPortal: everything is configuration in uPortal-start. Proposed uPortal follow-ups
are under findings, and the `UPGRADING-6.0.md` text is at the end of this note. (This session could
read uPortal but was not given push access to it.)

### CAS version and image

* Docker Hub `apereo/cas` tags checked on 2026-10-10 (no `v` prefix, unlike REPORT.md's
  `apereo/cas:v8.0.x`): newest stable `8.0.2` (and `8.0.1.2`, `8.0.1.1`, `8.0.1`, `8.0.0`),
  `7.3.8.3` on the 7.3 line, `8.1.0-RC2` as the next release candidate.
* Used: **`apereo/cas:8.0.2`**, pinned by its index digest
  `sha256:5dce4fe37976bfed0ba5f4dd5c77eeda047d60b5608d3c5388fed7cce53796a9` (amd64 and arm64).
  It runs on Zulu 25 inside the image and starts in about 17 s.
* No Initializr overlay was needed: the stock image already has the static (`accept`) user store
  and the embedded JSON service registry (`cas.service-registry.core.init-from-json=true` with
  `cas.service-registry.json.location=file:/etc/cas/services`).
* Configuration (`docker/cas/config/cas.properties`): plain HTTP on `casHttpPort` (8090),
  `cas.tgc.secure=false`, the four quickstart users, `cas.logout.follow-service-redirects=true`, and
  `cas.http-client.allow-local-urls=true` for the localhost PGT callbacks. One service,
  `^https?://localhost(:[0-9]+)?/.*`, with a regex proxy policy over the same pattern.
* The container uses host networking, so CAS can call the portal's PGT callback on localhost.
  Docker Desktop needs host networking turned on; documented.

## Gate results

Fill in when the runs on the head commit finish:

| Run | Commit | Result |
| --- | --- | --- |
| CI 38088674821 | `9122724` | `Playwright E2E tests: CAS` (job 114320426287) **green on first attempt**, including the CAS-down seeded fault step. Local-login `Playwright E2E tests` failed: the wrong-password assertion that `9aa091c` corrects (same failure reproduced locally). Build matrix (ubuntu temurin/zulu/corretto, windows, macos) green. |
| CI 38091969001 | `9aa091c` | _pending_ |
| Integration 38088674826 | `9122724` | _superseded; queued behind runner capacity_ |
| Integration 38091969031 | `9aa091c` | _pending_: Playwright hsqldb (local login), hsqldb + CAS, PostgreSQL 18, MariaDB 12.3, DB harness |

Local runs in the sandbox (Tomcat 9.0.122, JDK 11, uPortal 5.17.9, HSQLDB, Chromium 1194):

* Local login, whole suite (`retries: 2` as configured): **126 passed, 2 failed**. The two failures
  are the web-proxy specs that fetch `http://example.com/`, which the sandbox cannot reach (known
  since MOD-D17). No test needed a retry.
* CAS mode, `retries=0`: `tests/ux/auth` (4), `cas-proxy-test.spec.ts` (1) and `tests/api` (36):
  **41 passed**. The proxy-ticket portlet reports "Proxy ticket validated": the portal got a PGT,
  issued a PT for `http://localhost:8080/cas-proxy-test-portlet`, and the portlet validated it and
  obtained its own PT, all over plain HTTP.
* `npm run lint`: no errors in the changed files. The 8 errors it reports are pre-existing in
  `tests/db/migrate/matrix.mjs` (`no-undef` for `console`/`process`); same count on the base.
* actionlint and `zizmor --offline` (1.30.1): clean on all four workflows.

No spec is skipped. Mode-specific behaviour is chosen inside helpers, so both modes run the same
tests.

## Seeded-fault evidence

All with `--retries=0` against a running portal.

| Mode | Fault | Result |
| --- | --- | --- |
| local | test user's password wrong (`student-seeded-fault` in `general-config.ts`) | `login, logout, login as different user` **failed** ("You are signed in as Steven Student" not found); the other 2 passed |
| local | Sign In URL without `?refUrl=` (the first version of this branch) | new deep-link test **failed**: expected 200, got 400 |
| cas | test user's password wrong | `login, logout, login as different user` **failed** (same assertion) |
| cas | broken service URL: registry `serviceId` changed to `^https?://localhost:9999/.*` (CAS reloads it live; "Application Not Authorized to Use CAS") | all 4 auth tests and the proxy-ticket test **failed** (`toBeVisible` on the CAS form) |
| cas | CAS service down (`casStop`) | all 4 auth tests and the proxy-ticket test **failed** (`toHaveURL` on the CAS login URL) |
| cas, in CI | CAS service down, after the green run | step "Seeded fault: the auth spec fails with CAS stopped" passed, i.e. the spec failed, in CI run 38088674821 job 114320426287; it runs on every push |

The specs also have negative tests of their own that run in both modes: a wrong password is
refused, and a guest following a link that needs a login gets the login form.

## Findings

1. **Local login breaks guest deep links unless the Sign In URL ends in a query parameter.**
   `UrlCanonicalizingFilter` always uses `casRefUrlEncoder` (`CasLoginRefUrlEncoder`), which appends
   `%3FrefUrl%3D<page>` (encoded for a CAS `service`). Pointed at `/uPortal/p/login`, a guest
   opening `/uPortal/p/user-administration` got HTTP 400. uPortal-start works around it with
   `CasLoginUrl=${portal.context}/p/login?refUrl=`. uPortal already has `LocalLoginRefUrlEncoder`
   but never wires it; the local login form also posts to `/Login` without the `refUrl`, so the
   user is not returned to the page after signing in. Upstream fix: choose the encoder by
   configuration, and carry `refUrl` through the login portlet.
2. **A failed local login gives no feedback.** `/Login` with a wrong password redirects to the
   guest page; the "Invalid username or password" message only shows if the user opens the login
   form again (session attribute `up_attemptedUserName`). With CAS the form showed the error. The
   spec asserts the current behaviour. Upstream fix: redirect a failed local login back to
   `/p/login`.
3. **`cas-proxy-test-portlet` never got a proxy ticket before.** uPortal ships
   `casTicketUserInfoService` commented out in `portletContainerContext.xml`, and uPortal-start
   never set `proxyReceptorUrl`/`proxyCallbackUrl`, so on CAS 3.6 the portlet could only have shown
   "No proxy ticket in UserInfo map". This branch turns both on (the bean in `overridesContext.xml`
   for both modes; it adds nothing without a CAS session) and the new spec checks it.
4. **The login launcher is still CAS-branded.** `login.jsp` uses `id="portalCASLoginLink"`, the
   title "Sign in via CAS" and a "New User?" link to the Apereo CAS page, in both modes. The specs
   keep using the id. Cosmetic; a uPortal change.
5. **The property names are CAS-shaped.** The local Sign In URL lives in
   `org.apereo.portal.channels.CLogin.CasLoginUrl`. uPortal could add `login.url` with that as the
   fallback.
6. **jitpack.io and Maven Central 429s slowed local work.** `dataInit` needs
   `com.github.ci-rt:google-visualization-java:release-1.1.3` from jitpack (blocked, MOD-I10); it
   was installed into `~/.m2` from the jar already in the uPortal WAR. Central answered bursts with
   429; the build needed about 10 retries. A local mirror init script was not used (declined by the
   session's permission policy). CI is unaffected.
7. **The bundled Playwright browser does not match Playwright 1.64.** The container has
   `chromium-1194`, Playwright 1.64 wants headless shell 1248. Local runs used a scratch config
   (not committed) that sets `launchOptions.executablePath` to `/opt/pw-browsers/chromium`.
8. **`npm run lint` already fails on the base** (8 `no-undef` errors in
   `tests/db/migrate/matrix.mjs`, which ESLint treats as a browser/TS file). No CI job runs the
   lint, so it went unnoticed.
9. **REPORT.md's CAS image tag is wrong**: `apereo/cas` tags have no `v` prefix (`8.0.2`, not
   `v8.0.2`).

## Proposed LOG entries

* **MOD-D?: local login is the default in uPortal-start; CAS 8 is an opt-in Compose service.**
  Answers MOD-Q3 as recommended. `authMode=local|cas` with `casServerUrl`; the CAS 3.6 overlay is
  removed (closes MOD-I9's CAS half, MOD-I36, MOD-I85). Image `apereo/cas:8.0.2` by digest, static
  quickstart users, JSON registry; no Initializr overlay needed. CI runs the whole suite with
  local login and the auth and proxy-ticket specs against CAS on every push, with a CAS-down
  seeded fault. Evidence: this note.
* **MOD-I?: guest deep links answer 400 with a local Sign In URL** (finding 1). Worked around in
  uPortal-start; upstream fix candidate.
* **MOD-I?: a failed local login shows no error** (finding 2). Upstream candidate.
* **MOD-I?: proxy tickets were never enabled in uPortal-start** (finding 3). Fixed here.
* **MOD-I?: `npm run lint` fails on `tests/db/migrate/matrix.mjs`; no CI job lints** (finding 8).
* Update MOD-I85 to **Closed** (the CAS data source is gone) and MOD-Q3 to **Decided**.
* Correct REPORT.md's `apereo/cas:v8.0.x` to `apereo/cas:8.0.x` (finding 9).

## What is left

* Integration gates on the head commit (pending above).
* The uPortal side: `UPGRADING-6.0.md` text below, and the upstream candidates from findings 1, 2,
  4 and 5. These need push access to the uPortal fork.
* MOD-Q5 retires `cas-proxy-test-portlet`; until then it runs in both modes.
* P6/P7: the portal's own CAS client moves to Apereo cas-client 4.x; the CAS 8 job is where that
  gets tested.

## Adopter upgrade notes

* A portal built from uPortal-start now signs users in with uPortal's login form against the portal
  database. Existing local passwords keep working.
* To keep CAS: set `authMode=cas` and `casServerUrl=https://cas.example.edu/cas` in
  `gradle.properties`, then `tomcatConfig` (or `portalInit`). Register `<portal>/uPortal/Login` as a
  CAS service; for proxy tickets allow proxying to `<portal>/uPortal/CasProxyServlet`; for the
  logout redirect set `cas.logout.follow-service-redirects=true` on CAS.
* Customisations of `overlays/cas` must move to your CAS server. Drop
  `cas.ticketValidationFilter.encodeServiceUrl=false` (a CAS 3.6 workaround). The `cas*Version`
  properties in an old `gradle.properties` are unused and can be deleted.
* Moving the portal off HSQLDB no longer needs a second data source edit for CAS (MOD-I85).
* The development CAS server needs Docker with Compose v2 and host networking.

## Proposed `docs/UPGRADING-6.0.md` section (uPortal)

```markdown
## uPortal-start signs users in locally; CAS is opt-in

uPortal-start no longer deploys a CAS 3.6 server (`overlays/cas`) into the portal's Tomcat.
CAS 3.6 is end of life, runs on Spring 3.2 and the javax Servlet API, and cannot follow the
portal to Tomcat 10.1 and 11. A portal built from uPortal-start now signs users in with
uPortal's own login form (`SimpleSecurityContextFactory`) against the accounts in the portal
database:

* `org.apereo.portal.security.provider.cas.CasAssertionSecurityContextFactory.enabled=false`
* `org.apereo.portal.channels.CLogin.CasLoginUrl=${portal.context}/p/login?refUrl=`
* `logout.redirect=` (empty: back to the guest page)

To keep signing in through CAS, build with `authMode=cas` and `casServerUrl` pointing at your CAS
server (uPortal-start `docs/authentication.md`). Register the portal's `/Login` URL as a CAS
service, and allow proxying to `/CasProxyServlet` if portlets use proxy tickets. CAS 5 and later
take `logout?service=` (not `logout?url=`) and follow it only with
`cas.logout.follow-service-redirects=true`. Drop `cas.ticketValidationFilter.encodeServiceUrl=false`
if you set it for CAS 3.6.

uPortal's defaults in `security.properties` are unchanged: they still point the login and logout
URLs at `${cas.protocol.server.context}`, so a portal not built from uPortal-start keeps its CAS
settings.
```
