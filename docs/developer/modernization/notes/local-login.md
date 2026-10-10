# Handoff: local login by default, CAS 8 opt-in (P1-13 / WS10)

Branch `ccr-43ba0785-hzlrj5-local-login`, in uPortal-start only. It answers MOD-Q3 as recommended.
uPortal's local login is the default, and CAS runs as an opt-in Docker Compose service on CAS 8
that CI keeps exercising.

## What changed

| Commit | Change |
| --- | --- |
| `3b40c81` feat!: | Local login by default. `etc/portal/uPortal.properties` turns the CAS security context off and points Sign In at the login portlet and logout at the guest page. `global.properties` leaves the CAS server unset. The CAS 3.6 overlay (`overlays/cas`) and its nine version properties are gone. `tests/db/harness.sh --portal` stops deploying CAS. |
| `965cb5c` feat: | `-PauthMode=cas` (`gradle/tasks/auth.gradle`). With it, `tomcatConfig` appends `etc/cas/{global,uPortal}.properties` to `portal.home`, with `cas.protocol/server/context` split from `casServerUrl`. `casStart` and `casStop` run `docker/cas/compose.yaml`. `overridesContext.xml` turns on `casTicketUserInfoService`. `playwrightRun` passes `AUTH_MODE` and `CAS_BASE_URL`. |
| `f6510a3` test(e2e): | Helpers drive the login form of either mode. The auth spec covers both modes, and `cas-proxy-test.spec.ts` is new. |
| `9122724` ci: | A `playwright-cas` job in CI and in Integration. It runs the auth and proxy specs against CAS, then stops CAS and requires the auth spec to fail. |
| `e273bbe` docs: | `docs/authentication.md` and the README section "How To Choose How Users Sign In". `[skip ci]` |
| `9aa091c` fix: | Sign In URL `/uPortal/p/login?refUrl=`, so guest deep links get the login form instead of HTTP 400 (finding 1). Adds a deep-link spec and corrects the local wrong-password assertion (finding 2). |
| `7d08d0e` merge | The integration branch with its light CI profile and commit-message check. It takes the integration branch's CI.yml, which drops this branch's CI copy of the CAS job. The README keeps the new SQL Server note and drops the CAS data source warning. |
| `d79c291` ci(prototype): | The coordinator's CI capacity rule (MOD-D30). The CAS job and its seeded fault now run once per push, in Integration only. |

uPortal itself is unchanged. Everything here is uPortal-start configuration. The proposed uPortal
follow-ups are under findings, and the `UPGRADING-6.0.md` text is at the end of this note. This
session could read uPortal but had no push access to it.

### CAS version and image

* Docker Hub `apereo/cas` tags, checked on 2026-10-10, have no `v` prefix (REPORT.md says
  `apereo/cas:v8.0.x`). The newest stable tag is `8.0.2`, after `8.0.1.2`, `8.0.1.1`, `8.0.1` and
  `8.0.0`. The 7.3 line is at `7.3.8.3`, and `8.1.0-RC2` is the next release candidate.
* This branch uses **`apereo/cas:8.0.2`**, pinned by its index digest
  `sha256:5dce4fe37976bfed0ba5f4dd5c77eeda047d60b5608d3c5388fed7cce53796a9` (amd64 and arm64).
  The image runs Zulu 25 and starts in about 17 s.
* The stock image already has the static (`accept`) user store and the embedded JSON service
  registry (`cas.service-registry.core.init-from-json=true` with
  `cas.service-registry.json.location=file:/etc/cas/services`). The branch doesn't need an Initializr
  overlay.
* `docker/cas/config/cas.properties` sets plain HTTP on `casHttpPort` (8090), `cas.tgc.secure=false`,
  the four quickstart users, `cas.logout.follow-service-redirects=true`, and
  `cas.http-client.allow-local-urls=true` for the localhost PGT callbacks. One service,
  `^https?://localhost(:[0-9]+)?/.*`, has a regex proxy policy over the same pattern.
* The container uses host networking, so CAS can call the portal's PGT callback on localhost.
  Docker Desktop needs host networking turned on, as `docs/authentication.md` says.

## Gate results

The account's runners were saturated during this session, and the runs on the later commits were
still queued when it ended. Fill these in when the head runs finish.

| Run | Commit | Result |
| --- | --- | --- |
| CI 38088674821 | `9122724` | `Playwright E2E tests: CAS` (job 114320426287) passed on the first attempt, including the CAS-down seeded fault step. The local-login `Playwright E2E tests` job failed on the wrong-password assertion that `9aa091c` corrects, and the same failure reproduced locally. The build matrix (ubuntu temurin, zulu and corretto, windows, macos) passed. |
| CI 38091969001 | `9aa091c` | Queued for over an hour, then superseded. |
| Integration 38088674826 and 38091969031 | `9122724` and `9aa091c` | Superseded while queued. |
| CI 38094563179, Integration 38094563208 | `d79c291` | Pending. The light profile runs Playwright on HSQLDB with local login, `Playwright: hsqldb, CAS` with the seeded fault, the harness and Playwright on PostgreSQL 18, and one G-migrate pair. MariaDB 12.3 and the other harness vendors run after the merge into the integration branch. |

Local runs in the sandbox used Tomcat 9.0.122, JDK 11, uPortal 5.17.9, HSQLDB and Chromium 1194.

* Local login, whole suite, with the configured `retries: 2`. **126 passed and 2 failed.** Both
  failures are web-proxy specs that fetch `http://example.com/`, which the sandbox blocks
  (known since MOD-D17). The 126 passed on their first try.
* CAS mode with `retries=0`, running `tests/ux/auth` (4), `cas-proxy-test.spec.ts` (1) and
  `tests/api` (36). **41 passed.** The proxy-ticket portlet reports "Proxy ticket validated". The
  portal got a PGT and a PT for `http://localhost:8080/cas-proxy-test-portlet`, and the portlet
  validated it and obtained its own PT, all over plain HTTP.
* `npm run lint` finds zero errors in the changed files. Its 8 errors are in
  `tests/db/migrate/matrix.mjs` (`no-undef` for `console` and `process`), with the same count on the
  base.
* actionlint and `zizmor --offline` (1.30.1) pass on all workflows.

Helpers pick the mode-specific steps, so the auth and proxy-ticket specs run unchanged in both
modes and none of them is skipped.

## Seeded-fault evidence

All runs used `--retries=0` against a running portal.

| Mode | Fault | Result |
| --- | --- | --- |
| local | the test user's password changed to `student-seeded-fault` in `general-config.ts` | `login, logout, login as different user` **failed** ("You are signed in as Steven Student" not found), and the other 2 passed |
| local | the Sign In URL without `?refUrl=` (this branch's first version) | the deep-link test **failed**, expecting 200 and getting 400 |
| cas | the test user's password changed | `login, logout, login as different user` **failed** on the same assertion |
| cas | a broken service URL, with the registry `serviceId` set to `^https?://localhost:9999/.*` (CAS reloads it live and answers "Application Not Authorized to Use CAS") | all 4 auth tests and the proxy-ticket test **failed** on `toBeVisible` for the CAS form |
| cas | the CAS service down (`casStop`) | all 4 auth tests and the proxy-ticket test **failed** on `toHaveURL` for the CAS login URL |
| cas, in CI | the CAS service down after the passing run | In CI run 38088674821 (job 114320426287) the auth spec failed with CAS stopped, as the step "Seeded fault: the auth spec fails with CAS stopped" requires. Integration's `playwright-cas` job repeats that step on every push. |

The specs also include negative tests for both modes. A wrong password is refused, and a
guest following a link that needs a login gets the login form.

## Findings

1. **A local Sign In URL breaks guest deep links unless it ends in a query parameter.**
   `UrlCanonicalizingFilter` always uses `casRefUrlEncoder` (`CasLoginRefUrlEncoder`), which appends
   `%3FrefUrl%3D<page>`, encoded for a CAS `service`. Pointed at `/uPortal/p/login`, a guest opening
   `/uPortal/p/user-administration` got HTTP 400. uPortal-start works around it with
   `CasLoginUrl=${portal.context}/p/login?refUrl=`. uPortal has `LocalLoginRefUrlEncoder` but never
   wires it. The local login form also posts to `/Login` without the `refUrl`, and after signing in
   the user gets the default page instead of the one they asked for. Upstream fix: choose the encoder by configuration, and carry
   `refUrl` through the login portlet.
2. **A failed local login doesn't tell the user.** `/Login` with a wrong password redirects to the
   guest page. The "Invalid username or password" message appears only when the user opens the
   login form again (session attribute `up_attemptedUserName`). The CAS form shows its error at
   once. The spec asserts the current behaviour. Upstream fix: redirect a failed local login back
   to `/p/login`.
3. **`cas-proxy-test-portlet` never received a proxy ticket before this branch.** uPortal keeps
   `casTicketUserInfoService` commented out in `portletContainerContext.xml`, and uPortal-start
   never set `proxyReceptorUrl` or `proxyCallbackUrl`. On CAS 3.6 the portlet could only show "No
   proxy ticket in UserInfo map". This branch turns both on. The bean is in
   `overridesContext.xml` for both modes and returns an empty map without a CAS session. The new
   spec checks both cases.
4. **The login launcher still has CAS branding.** `login.jsp` uses `id="portalCASLoginLink"`,
   the title "Sign in via CAS" and a "New User?" link to the Apereo CAS page, in both modes. The
   specs keep using the id. This is cosmetic and needs a uPortal change.
5. **The property names point at CAS.** uPortal reads the local Sign In URL from
   `org.apereo.portal.channels.CLogin.CasLoginUrl`. uPortal could add `login.url` and fall back to
   the old name.
6. **jitpack.io and Maven Central 429s slowed local work.** `dataInit` needs
   `com.github.ci-rt:google-visualization-java:release-1.1.3` from jitpack, which the sandbox
   blocks (MOD-I10). The jar went into `~/.m2` from the copy in the uPortal WAR. Central answered
   bursts with 429, and the build needed about 10 retries. The session's permission policy declined
   a local mirror init script. CI was unaffected.
7. **The bundled Playwright browser doesn't match Playwright 1.64.** The container has
   `chromium-1194`, and Playwright 1.64 wants headless shell 1248. Local runs used a scratch config,
   kept out of the repo, that sets `launchOptions.executablePath` to `/opt/pw-browsers/chromium`.
8. **`npm run lint` already fails on the base branch.** ESLint reports 8 `no-undef` errors in
   `tests/db/migrate/matrix.mjs`, which it treats as a browser or TypeScript file. CI has never run
   this lint, and the errors have been there since `matrix.mjs` was added.
9. **REPORT.md's CAS image tag is wrong.** `apereo/cas` tags have no `v` prefix, so the tag is
   `8.0.2` and not `v8.0.2`.

## Proposed LOG entries

* **MOD-D?: uPortal-start defaults to local login, and CAS 8 runs as an opt-in Compose service.**
  It answers MOD-Q3 as recommended, with `authMode=local|cas` and `casServerUrl`. The branch removes
  the CAS 3.6 overlay, which closes the CAS half of MOD-I9, MOD-I36 and MOD-I85. The image is
  `apereo/cas:8.0.2` by digest, with static quickstart users and a JSON registry, and it needs
  zero Initializr code. CI runs the whole suite with local login, and the auth and proxy-ticket
  specs against CAS on every push, with a CAS-down seeded fault. Evidence is in this note.
* **MOD-I?: guest deep links answer 400 with a local Sign In URL** (finding 1). uPortal-start
  works around it. It is an upstream fix candidate.
* **MOD-I?: a failed local login hides its error** (finding 2). It is an upstream candidate.
* **MOD-I?: uPortal-start never enabled proxy tickets** (finding 3). This branch fixes it.
* **MOD-I?: `npm run lint` fails on `tests/db/migrate/matrix.mjs`, and CI never lints** (finding 8).
* Mark MOD-I85 **Closed**, since the CAS data source is gone, and MOD-Q3 **Decided**.
* Correct REPORT.md's `apereo/cas:v8.0.x` to `apereo/cas:8.0.x` (finding 9).

## What is left

* The Integration and CI results on the head commit, pending above.
* The uPortal side needs push access to the uPortal fork. It covers the `UPGRADING-6.0.md` text
  below and the upstream candidates from findings 1, 2, 4 and 5.
* MOD-Q5 retires `cas-proxy-test-portlet`. Until then it runs in both modes.
* In P6 and P7 the portal's own CAS client moves to Apereo cas-client 4.x, and the CAS 8 job is
  where that change gets tested.

## Adopter upgrade notes

* A portal built from uPortal-start now signs users in with uPortal's login form against the portal
  database. Existing local passwords keep working.
* To keep CAS, set `authMode=cas` and `casServerUrl=https://cas.example.edu/cas` in
  `gradle.properties`, then run `tomcatConfig` or `portalInit`. Register `<portal>/uPortal/Login` as
  a CAS service. For proxy tickets, allow proxying to `<portal>/uPortal/CasProxyServlet`. For the
  logout redirect, set `cas.logout.follow-service-redirects=true` on CAS.
* Move any customisations of `overlays/cas` to your CAS server. Drop
  `cas.ticketValidationFilter.encodeServiceUrl=false`, which was a CAS 3.6 workaround. You can
  delete the `cas*Version` properties left in an old `gradle.properties`.
* Moving the portal off HSQLDB now takes one data source change instead of two (MOD-I85).
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
