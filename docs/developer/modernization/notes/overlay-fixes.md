# Overlay fixes for Tomcat 11 and the removed-API scan (handoff)

Workstream branch: `ccr-43ba0785-hzlrj5-overlays` (uPortal-start only; uPortal is unchanged).
Scope: MOD-D13. Fix, in uPortal-start's overlay builds and still on javax and Tomcat 9, what breaks
the bundled WARs on Tomcat 11 (MOD-I60, MOD-I61, MOD-I62, spike blockers B2–B4 of MOD-D9), and fail
the build when a WAR uses an API that Servlet 6.0/6.1, Pages 4.0 or EL 6.0 removed.

## What changed

### The convention (`build:`)

`buildSrc/.../OverlayLibrariesPlugin.groovy` adds an `overlayLibraries` extension to every overlay.
The rules are written once, in `overlays/build.gradle`, and apply only to the overlays whose WAR
needs them; each overlay's `build/reports/overlay-libraries.txt` says what was done.

* `replace(name) { jars = ~/regex/; libraries '...' }`:  when the overlaid WAR (or the overlay's own
  runtime classpath) has a jar matching `jars`, every such jar is dropped and the listed
  dependencies are packaged instead. Dependency substitution can't do this:  the WAR overlay
  plugin copies the published WAR's `WEB-INF/lib` as files.
* `patch(name) { whenWarContains = ~/regex/; source 'dir'; compileOnly '...' }`:  compiles shared
  sources into `WEB-INF/classes`, which Tomcat's webapp class loader reads before `WEB-INF/lib`.

### Per WAR

| WAR | JSTL (MOD-I60) | Spring 3 patch (MOD-I61) | Other |
|---|---|---|---|
| uPortal | jstl-1.1.2 + standard-1.1.2 → Taglibs 1.2.5 | | |
| Announcements | jstl-1.1.2 + standard-1.1.2 → 1.2.5 | | |
| BookmarksPortlet | jstl-1.1.2 + standard-1.1.2 → 1.2.5 | | |
| CalendarPortlet | jstl-1.2 + standard-1.1.2 → 1.2.5 | | |
| FeedbackPortlet | jstl-1.1.2 + standard-1.1.2 → 1.2.5 | spring-web 3.2.18 | |
| NewsReaderPortlet | jstl-1.2 + taglibs-standard-impl-1.2.5 → 1.2.5 | | |
| NotificationPortlet | jstl-1.2 → 1.2.5 | | Boot auto-config exclude (MOD-I62) |
| ResourceServingWebapp | jstl-1.2 + standard-1.1.2 → 1.2.5 | spring-web 3.1.4 | |
| SimpleContentPortlet | jstl-1.1.2 + standard-1.1.2 → 1.2.5 | | |
| WebProxyPortlet | jstl-1.1.2 + standard-1.1.2 → 1.2.5 | | |
| basiclti-portlet | jstl-1.2 + standard-1.1.2 → 1.2.5 | | |
| cas (3.6) | jstl-1.1.2 + standard-1.1.2 → 1.2.5 | spring-web 3.1.1 | |
| cas-proxy-test-portlet | jstl-1.1.2 + standard-1.1.2 → 1.2.5 | | |
| esup-filemanager | jstl-1.1.2 + standard-1.1.2 → 1.2.5 | spring-web 3.1.1 | |
| pluto-testsuite | jstl-1.1.2 + standard-1.1.2 → 1.2.5 | | uses the JSTL 1.0 URIs (jstlel) |
| resource-server | — | — | — |

* **JSTL (MOD-I60):** Apache Taglibs 1.2.5 `impl` + `spec` + `jstlel` replace every JSTL jar in
  each WAR that ships one: the 13 with JSTL 1.1.2, plus NotificationPortlet and NewsReaderPortlet,
  whose GlassFish `jstl-1.2.jar` carries a test `PageContextImpl` that links against the removed
  `jsp.el` API and duplicates the implementation (B13). The TLD URIs are unchanged, so no JSP
  changes. `jstlel` keeps the JSTL 1.0 URIs (`java.sun.com/jstl/*`) that standard-1.1.2 also
  served; pluto-testsuite's JSPs use them.
* **Spring 3.x (MOD-I61):** the only Spring 3 classes that link against `jsp.el` are
  `org.springframework.web.util.ExpressionEvaluationUtils` (called by every Spring form and message
  tag, so the CAS login/logout pages and the Feedback form break) and `EvalTag` (`<spring:eval>`,
  unused). Smallest safe fix, the same for all four WARs:
  `overlays/patches/spring3-jsp-el/.../ExpressionEvaluationUtils.java`, Spring 3.2.18's class
  (Apache-2.0, marked as modified) with its behaviour and public API kept, evaluating through the
  unified EL (`javax.el`) instead and without spring-core's `Assert`. Spring 3.1's version only
  differs on Servlet 2.x containers. Rejected: upgrading these WARs to Spring 4 inside the overlay
  (replaces their whole Spring stack for a one-class problem); the spike's `shared/lib` shim
  (brings the removed API back for every webapp); retiring them (CAS 3.6 still carries the CAS
  login specs; Feedback, RSW and esup are live).
* **NotificationPortlet (MOD-I62):** `overlays/NotificationPortlet/src/main/resources/config/application.properties`
  sets `spring.autoconfigure.exclude=...EmbeddedServletContainerAutoConfiguration`. Boot reads
  `classpath:/config/application.properties` after, and over, the WAR's own
  `application.properties`, so the WAR's file needs no copy.
* **Other spike items, not changed:** B12 (Feedback's `disableURLRewriting`) is already ignored on
  Tomcat 9 (MOD-I77), so dropping it changes nothing on 9 and only removes a warning on 11; B14
  (`compressibleMimeType`) was fixed in P1; B1 (corrupt icu4j class, below) is a transform-step
  issue for P5-5. No bundled JSP uses a removed JSP feature (`jsp:plugin`, `isThreadSafe`,
  scriptlets on removed methods, `<spring:eval>`):  the scan checks all 16 WARs.

### The removed-API scan (`build:` + `test:`)

`removedApiScan`, in every overlay; `check` (so `build`) and `tomcatDeploy` depend on it.

* **Bytecode** (ASM 9.11) of `WEB-INF/classes` and every jar in `WEB-INF/lib`:
  * *removed class*:  any mention in a class file's constant pool (references, field, method and
    exception types, annotations). These are what broke at runtime in the spike: the JVM or
    Jasper's tag introspection loads them whether or not the code path runs.
  * *removed member*:  a field or method reference resolved the way the JVM does, through the
    WAR's own classes and the javax Servlet 4.0.1 / JSP 2.3.3 / EL 3.0.0 APIs, so
    `super.encodeUrl(..)` in a webapp subclass is found too.
  * A class in `WEB-INF/classes` shadows the jar's copy (so the Spring 3 patch counts); a
    Tomcat-internal class the WAR ships itself is not a hit; unreadable class files are reported.
* **JSPs and tag files** (in the WAR and under jars' `META-INF/resources` / `META-INF/tags`):
  `jsp:plugin`/`jsp:params`/`jsp:fallback`, the `isThreadSafe` page attribute, scriptlets calling
  removed methods on the implicit objects (`session.getValue(`, `response.encodeUrl(`, ...), removed
  class names, and `<spring:eval>` (any prefix bound to the Spring tags URI).
* **Rules: 143.** `buildSrc/src/main/resources/removed-api/servlet6-pages4.txt` (49:  Servlet 6.0,
  Pages 4.0, EL 5.0/6.0, Annotations 3.0) was generated by diffing the public/protected API of
  Tomcat 9.0.122's `servlet-api`, `jsp-api`, `el-api` and `annotations-api` against Tomcat
  11.0.26's (jakarta renamed to javax); it matches the spike's `api-diff.txt` and the Jakarta Pages
  4.0 / Servlet 6.0 release notes. Servlet 6.1 removed nothing beyond 6.0. `tomcat-internals.txt`
  (94):  the `org.apache.*` classes Tomcat 9.0.122 has and 11.0.26 does not.
* **Allowlist:** `overlays/removed-api-allowlist.txt`, `webapp | location | source | api | reason`,
  17 entries, a reason required (an entry without one fails the build); entries that match nothing
  are warned about. Every entry is one of:
  * forwarders: wrappers and proxies that override a removed method and forward it (spring-web,
    spring-security-web, uPortal-rendering, uPortal-utils-core, ESAPI, jackrabbit-webdav,
    Shibboleth java-support);
  * never loaded: `EvalTag`, spring-test mocks packaged into production WARs, FreeMarker's JSP
    bridge, a bundled Servlet 2.x API jar;
  * return types of uncalled overrides: spring-session 1.3 and portlet-servlet-adapter
    `getSessionContext()`;
  * Boot's embedded Tomcat: excluded for NotificationPortlet (MOD-I62); unused in resource-server.
* **Seeded faults:** `buildSrc/src/test/.../RemovedApiScannerTest` (`./gradlew :buildSrc:test`):
  a WAR with `HttpSession.getValue`, an inherited `encodeUrl` called through a subclass, a
  `jsp.el` field type in a jar, an `AbstractHttp11JsseProtocol` reference, `jsp:plugin`,
  `isThreadSafe`, a `session.getValue` scriptlet and `<spring:eval>` gives exactly those 8 hits; a
  clean WAR, a shadowed jar class and a Tomcat class the WAR ships give none; the allowlist accepts
  only what it names and rejects an entry without a reason. 5/5 pass.

## Gate results

All local runs used uPortal 5.17.10-SNAPSHOT built from uPortal's `ccr-43ba0785-hzlrj5`
(`./gradlew install` on JDK 25), uPortal-start at this branch, HSQLDB, Chromium 1194 behind a
build-number shim for Playwright 1.64.

### Build and scan (Tomcat 9, javax)

* `./gradlew war removedApiScan`, then `portalInit`: green. Each overlay's
  `build/reports/overlay-libraries.txt` shows the JSTL swap in the 15 WARs listed above and the
  Spring 3 patch in exactly cas, FeedbackPortlet, ResourceServingWebapp and esup-filemanager.
* Scan, per WAR (hits / not allowlisted):  uPortal 15/0, Announcements 24/0, BookmarksPortlet 3/0,
  CalendarPortlet 24/0, FeedbackPortlet 3/0, NewsReaderPortlet 15/0, NotificationPortlet 6/0,
  ResourceServingWebapp 3/0, SimpleContentPortlet 13/0, WebProxyPortlet 25/0, basiclti-portlet
  0/0, cas 7/0, cas-proxy-test-portlet 9/0, esup-filemanager 7/0, pluto-testsuite 0/0,
  resource-server 4/0. Before the fixes, the same scan of the 16 published WARs gave 308 hits
  (B3's JSTL `jsp.el` references in 13 WARs, B4's Spring 3 `ExpressionEvaluationUtils` in 4, the
  test `PageContextImpl` in GlassFish `jstl-1.2`).
* `./gradlew :buildSrc:test`: 5/5 (seeded faults).
* Seeded fault in a real overlay: a JSP with `isThreadSafe`, a `session.getValue` scriptlet and
  `jsp:plugin` added to `overlays/pluto-testsuite` makes `removedApiScan` fail the build with
  exactly those 3 hits (then removed).
* Playwright, full suite: **122/124**. The 2 failures are the web-proxy specs that fetch
  `http://example.com/`, which the sandbox blocks (as in every earlier sandbox baseline).
* Pluto testsuite (the spike's `pluto-testsuite.sh` / `pluto-parse.py`): **12 PASSED, 10 FAILED,
  8 MANUAL, 2 WARNING; 144 checks pass, 16 fail**. That is the 5.17 baseline the spike recorded
  on Tomcat 8.5, check for check.
* Crawl of every registered portlet, maximized as admin: 93 portlets, all HTTP 200, one error
  card, from the `error` portlet, which exists to render one.

### Tomcat 11 evidence (prototype only, not committed as config)

The webapps that `portalInit` deployed to Tomcat 9 were transformed with jakartaee-migration
1.0.13 (`-profile=TOMCAT`, `-exclude=icu4j-*.jar`, as the spike's `transform-all.sh`), together
with `shared/lib`, and run on **Tomcat 11.0.26 + JDK 25.0.4** with uPortal-start's own
`server.xml`/`context.xml`, `shared.loader`, the same ports and the same HSQLDB. **No fixups after
the build:** no JSTL swap, no `jsp.el` shim in `shared/lib`, no `application.properties` edit,
no `-Djdk.xml.enableExtensionFunctions` (MOD-I63 is fixed in uPortal's code).

* Startup: 36 s; all 16 contexts deployed (NotificationPortlet included, B2 gone). No
  `NoClassDefFoundError`, `NoSuchMethodError` or `AbstractMethodError` while serving; no JSP
  compile failure (B3 gone: search-launcher, portal-activity, `PortletError/generic.jsp` and the
  portlet JSPs using `<c:set>` render). The only linkage error in the logs is JGroups'
  `JDBC_PING` shutdown thread logging after the webapp class loader closed, during `stop`.
* Playwright, full suite: **122/124**, the same 2 offline web-proxy failures as Tomcat 9. That
  includes the CAS login/logout (uportal-auth, portlet-list's `logoutViaApi`) and the 3 Feedback
  specs that B4 broke in the spike.
* Crawl: identical to Tomcat 9 (93 × 200, only the `error` portlet's card).
* Pluto testsuite: **14 PASSED, 8 FAILED, 8 MANUAL, 2 WARNING; 146 pass, 14 fail**, the same in
  two runs. Compared with Tomcat 9, no check regresses; `SimpleAttributeTest`'s
  `checkEnumerateAttributes` ("all attribute names appear in the request's attribute name
  enumeration") passes on Tomcat 11 in both test portlets. The `MiscTest` failures are the same
  three, listed in a different order. See finding 3.

### GitHub CI

Head `a8194f0` (the code; this note is a later `[skip ci]` commit): CI run 38094277016,
Integration run 38094276952. Both were still queued on GitHub's saturated runners when this note
was written; earlier pushes' runs were cancelled as superseded. Results to be added.

## Findings

1. **Spike blocker B1, the corrupt icu4j class, is real and found by the scanner.**
   CalendarPortlet and NewsReaderPortlet both ship `WEB-INF/lib/icu4j-2.6.1.jar` (2,450,757 bytes,
   dated 2005-12-20), whose `com/ibm/icu/impl/data/LocaleElements_zh__PINYIN.class` ASM cannot
   parse either (javap: "unexpected tag at #41"). `removedApiScan` reports it as unreadable rather
   than failing. The Tomcat 11 run excluded the jar from the transform, as the spike did; the
   build-time transform (P5-5) needs that exclude, or the portlets need a newer icu4j.
2. **Two of the bundled WARs ship JSTL that the spike's fixup skipped.** NotificationPortlet and
   NewsReaderPortlet carry GlassFish `jstl-1.2.jar`, whose
   `org/apache/taglibs/standard/lang/jstl/test/PageContextImpl` links against the removed
   `jsp.el` API. It is a test class and never loaded, but the uniform rule (every JSTL becomes
   Taglibs 1.2.5) removes it, and the duplicate implementations of B13, at no cost.
3. **One Pluto check passes on Tomcat 11 that fails on Tomcat 9** (`checkEnumerateAttributes`,
   both portlets). The spike recorded identical results on 8.5, 10.1 and 11 with uPortal
   5.17.10-SNAPSHOT of that day and JDK 21/25; this run used the integration branch's uPortal.
   It is an improvement, not a regression, but its cause (Tomcat 11's request attribute
   enumeration, or a change on the integration branch) is not yet explained. Worth a look before
   the P7-1 gate fixes the expected Pluto numbers.
4. **The scan must index the whole WAR, so it is memory-hungry.** In parallel the 16 scans
   outgrew the Gradle daemon's default 512 MB heap; they now share a one-slot build service.
   Each takes 0.2–10 s.
5. **Spring Boot 2.7's `SslConnectorCustomizer` in resource-server** also references
   `AbstractHttp11JsseProtocol`, like NotificationPortlet's Boot 1.5, but is only used when Boot
   starts its own Tomcat with SSL. Allowlisted; resource-server deploys on Tomcat 11.
6. **Pages 4.0 JSP removals:** no bundled JSP (including tag files in jars) uses `jsp:plugin`,
   `jsp:params`, `jsp:fallback`, `isThreadSafe`, a removed method through the implicit objects or
   `<spring:eval>`; the scan keeps it that way.
7. **Environment:** Maven Central's 429s made local Gradle resolution take 40–90 minutes per
   build; the local mirror init script was not usable in this session (the permission classifier
   refused it, MOD-I52). The pre-installed Chromium (1194) needs a build-number shim for
   Playwright 1.64 (1248).

## Proposed LOG entries

* **MOD-I?** (Portlets, Tomcat 11): MOD-I60, MOD-I61 and MOD-I62 are fixed in uPortal-start's
  overlays (`overlayLibraries` rules, a patched Spring 3 `ExpressionEvaluationUtils`, a Boot
  auto-config exclude). Transformed with jakartaee-migration, the bundled WARs run on Tomcat
  11.0.26 + JDK 25 with no fixups: Playwright, crawl and Pluto match Tomcat 9. *Plan:* move each
  fix into its portlet repository during 6.x (MOD-D13) and drop the rule when every bundled WAR
  has it.
* **MOD-I?** (Build): `removedApiScan` fails the overlay build on Servlet 6.0, Pages 4.0, EL 5.0/6.0,
  Annotations 3.0 and Tomcat 9→11 internal removals (143 rules, generated from the Tomcat API
  diff), with a reasoned allowlist (17 entries). It is the P5-5 scanner the spike asked for.
  *Plan:* when the WARs are transformed at build time (P5-5), run it on the jakarta output too,
  with the rules renamed.
* **MOD-I?** (Portlets): icu4j 2.6.1 in CalendarPortlet and NewsReaderPortlet contains a corrupt
  class (`com/ibm/icu/impl/data/LocaleElements_zh__PINYIN.class`) that aborts jakartaee-migration
  (B1). *Plan:* `-exclude=icu4j-*.jar` in the P5-5 transform; drop or upgrade icu4j in the
  portlets.
* **MOD-I?** (Tests): Pluto's `checkEnumerateAttributes` passes on Tomcat 11 + integration-branch
  uPortal and fails on Tomcat 9; cause not yet known (finding 3).
* **MOD-D?** (proposed): keep JSP-level and library-level Tomcat 11 fixes as `overlayLibraries`
  rules in `overlays/build.gradle` until the portlet repositories ship them; the removed-API
  allowlist is the list of what is still owed upstream.

## What is left for the portlet repositories (MOD-D13)

| Portlet | Owes |
|---|---|
| uPortal | JSTL 1.2.5 (uPortal-webapp still declares 1.1.2); delete `GuardingHttpServletRequest/Response` and `AbstractHttpServletResponseWrapper`'s removed-method overrides (P6-1); spring-session 1.3 (`HttpSessionContext`) |
| Announcements, Bookmarks, Calendar, NewsReader, SimpleContent, WebProxy, basiclti, cas-proxy-test, pluto-testsuite | Taglibs 1.2.5 instead of JSTL 1.1.2 / GlassFish 1.2; drop `spring-test` from production WARs (Announcements, Calendar, NewsReader, WebProxy); drop the bundled Servlet 2.x API jar (cas-proxy-test) |
| FeedbackPortlet, esup-filemanager, ResourceServingWebapp | off Spring 3.x (to 4.3+, or re-platform), which also removes the patched class |
| CAS 3.6 | retire or replace (MOD-Q3, MOD-I36); until then the patch keeps it working on Tomcat 11 |
| NotificationPortlet | the Boot exclude in its own `application.properties`, or off Boot 1.5 |
| CalendarPortlet, NewsReaderPortlet | drop or upgrade icu4j 2.6.1 (B1) |
| FeedbackPortlet | drop `disableURLRewriting` from `context.xml` (B12, a no-op since Tomcat 8) |

## Reproducing the Tomcat 11 run

The scripts are prototype-only and not committed; they follow the spike's
(`docs/developer/modernization/research/spike-jakarta/scripts` in uPortal):

```bash
./gradlew portalInit                       # Tomcat 9, HSQLDB on 8887
./gradlew tomcatStop                       # keep HSQLDB running
# transform .gradle/tomcat/{webapps,shared/lib} with jakartaee-migration 1.0.13
#   (-profile=TOMCAT, -exclude=icu4j-*.jar), lay them out in apache-tomcat-11.0.26 with
#   .gradle/tomcat/conf/{server.xml,context.xml} and shared.loader=${catalina.base}/shared/lib/*.jar,
#   JAVA_HOME=JDK 25, -Dportal.home=$CATALINA_BASE/portal
catalina.sh start
npx playwright test --config=tests/uportal-pw.config.ts
pluto-testsuite.sh http://localhost:8080 out.txt; pluto-parse.py <pages> parsed.txt; crawl.sh
```
