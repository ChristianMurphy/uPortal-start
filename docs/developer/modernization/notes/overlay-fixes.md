# Overlay fixes for Tomcat 11 and the removed-API scan (handoff)

Workstream branch: `ccr-43ba0785-hzlrj5-overlays`, in uPortal-start only. uPortal is unchanged.

Scope (MOD-D13): fix what breaks the bundled WARs on Tomcat 11 in uPortal-start's overlay builds,
while they are still javax and run on Tomcat 9. That covers MOD-I60, MOD-I61 and MOD-I62, the
spike blockers B2 to B4 of MOD-D9. Then fail the build when a WAR uses an API that Servlet 6.0/6.1,
Pages 4.0 or EL 6.0 removed.

## What changed

### The convention (`build:`)

`buildSrc/.../OverlayLibrariesPlugin.groovy` adds an `overlayLibraries` extension to every overlay.
The rules are written once, in `overlays/build.gradle`, and apply only to the overlays whose WAR
needs them. Each overlay's `build/reports/overlay-libraries.txt` says what was done.

* `replace(name) { jars = ~/regex/; libraries '...' }`:  when the overlaid WAR (or the overlay's own
  runtime classpath) has a jar matching `jars`, every such jar is dropped and the listed
  dependencies are packaged instead. Dependency substitution can't do this, because the WAR
  overlay plugin copies the published WAR's `WEB-INF/lib` as files.
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
| resource-server | | | |

**JSTL (MOD-I60).** Apache Taglibs 1.2.5 `impl`, `spec` and `jstlel` replace every JSTL jar in each
WAR that packages one. That is the 13 WARs with JSTL 1.1.2, plus NotificationPortlet and
NewsReaderPortlet. Their GlassFish `jstl-1.2.jar` contains a test `PageContextImpl` that links
against the removed `jsp.el` API, and NewsReader also had two JSTL libraries side by side (B13).
The TLD URIs stay the same, so the JSPs don't change. `jstlel` keeps the JSTL 1.0 URIs
(`java.sun.com/jstl/*`) that standard-1.1.2 also served. pluto-testsuite's JSPs use them.

**Spring 3.x (MOD-I61).** Only two Spring 3 classes link against `jsp.el`.

* `org.springframework.web.util.ExpressionEvaluationUtils` is called by every Spring form and
  message tag. Loading it fails on Tomcat 11, and with it the CAS login and logout pages and the
  Feedback form.
* `EvalTag` backs `<spring:eval>`, which no bundled JSP uses.

The fix is the same for all four WARs. `overlays/patches/spring3-jsp-el/.../ExpressionEvaluationUtils.java`
is Spring 3.2.18's class (Apache-2.0, marked as modified). It keeps the behaviour and the public
API, evaluates through the unified EL (`javax.el`), and drops spring-core's `Assert`. Spring 3.1's
version differs only on Servlet 2.x containers.

Alternatives considered and rejected:

* upgrading these WARs to Spring 4 inside the overlay, which replaces their whole Spring stack for
  a one-class problem;
* the spike's jar in `shared/lib` that restores the removed `jsp.el` classes, which brings the
  removed API back for every webapp;
* retiring them. CAS 3.6 still serves the CAS login specs, and Feedback, RSW and esup are in use.

**NotificationPortlet (MOD-I62).** `overlays/NotificationPortlet/src/main/resources/config/application.properties`
sets `spring.autoconfigure.exclude=...EmbeddedServletContainerAutoConfiguration`. Boot reads
`classpath:/config/application.properties` after the WAR's own `application.properties` and gives
it precedence. The WAR's file stays as published.

**Other spike items, left as they were.**

* B12, Feedback's `disableURLRewriting`, is already ignored on Tomcat 9 (MOD-I77). Dropping it
  would only remove a startup warning on 11.
* B14, `compressibleMimeType`, was fixed in P1.
* B1, the corrupt icu4j class (finding 1), belongs to the transform step of P5-5.
* The scan checks all 16 WARs for the JSP features Pages 4.0 removed. None of the bundled JSPs
  uses `jsp:plugin`, `isThreadSafe`, a removed method through the implicit objects or
  `<spring:eval>`.

### The removed-API scan (`build:` and `test:`)

`RemovedApiScanPlugin` adds a `removedApiScan` task to each of the 16 overlays. `check` (and so `build`) and `tomcatDeploy` depend on it.

**Bytecode.** ASM 9.11 reads `WEB-INF/classes` and every jar in `WEB-INF/lib`.

* *Removed class.* Any mention in a class file's constant pool counts: references, field, method
  and exception types, annotations. These are what broke at runtime in the spike. The JVM or
  Jasper's tag introspection loads them whether or not the code path runs.
* *Removed member.* A field or method reference is resolved the way the JVM does it, through the
  WAR's own classes and the javax Servlet 4.0.1, JSP 2.3.3 and EL 3.0.0 APIs. A call to
  `super.encodeUrl(..)` in a webapp subclass is found too.
* A class in `WEB-INF/classes` hides the jar's copy, so the Spring 3 patch counts. A Tomcat-internal
  class that the WAR packages itself is not a hit. Class files ASM cannot read are reported.

**JSPs and tag files**, in the WAR and under jars' `META-INF/resources` or `META-INF/tags`:
`jsp:plugin`, `jsp:params` and `jsp:fallback`, the `isThreadSafe` page attribute, scriptlets
calling removed methods on the implicit objects (`session.getValue(`, `response.encodeUrl(`),
removed class names, and `<spring:eval>` under any prefix bound to the Spring tags URI.

**Rules: 143.**

* `buildSrc/src/main/resources/removed-api/servlet6-pages4.txt` holds 49 rules for Servlet 6.0,
  Pages 4.0, EL 5.0 and 6.0, and Annotations 3.0. They come from a diff of the public and protected
  API of Tomcat 9.0.122's `servlet-api`, `jsp-api`, `el-api` and `annotations-api` against Tomcat
  11.0.26's, with jakarta renamed to javax. The list matches the spike's `api-diff.txt` and the
  Jakarta Pages 4.0 and Servlet 6.0 release notes. Servlet 6.1 doesn't remove anything beyond Servlet 6.0's list.
* `tomcat-internals.txt` holds 94 rules, the `org.apache.*` classes that Tomcat 9.0.122 has and
  11.0.26 lacks.

**Allowlist.** `overlays/removed-api-allowlist.txt`, one entry per line as
`webapp | location | source | api | reason`, has 17 entries. An entry without a reason fails the
build, and the build warns about an entry for one webapp that matches none of its hits. Each entry
falls in one of these groups.

* Forwarders. Wrappers and proxies that override a removed method and pass it on: spring-web,
  spring-security-web, uPortal-rendering, uPortal-utils-core, ESAPI, jackrabbit-webdav and
  Shibboleth java-support.
* Never loaded. `EvalTag`, spring-test mocks packaged into production WARs, FreeMarker's support
  for JSP taglibs in templates, and a bundled Servlet 2.x API jar.
* Return types of overrides that nothing calls. spring-session 1.3's and portlet-servlet-adapter's
  `getSessionContext()`.
* Boot's embedded Tomcat. NotificationPortlet excludes it (MOD-I62) and resource-server never
  starts it.

**Seeded faults.** `buildSrc/src/test/.../RemovedApiScannerTest` runs with `./gradlew :buildSrc:test`,
and CI's Build step runs it. One seeded WAR contains eight uses and must give exactly eight hits:

* `HttpSession.getValue` called from a class;
* an inherited `encodeUrl` called through a subclass;
* a `jsp.el` field type in a jar;
* an `AbstractHttp11JsseProtocol` reference;
* `jsp:plugin`, `isThreadSafe`, a `session.getValue` scriptlet and `<spring:eval>` in JSPs.

A clean WAR, a hidden jar class and a Tomcat class packaged by the WAR give none. The allowlist
accepts only what it names and refuses an entry without a reason. All 5 tests pass.

## Results of the required checks

All local runs used uPortal 5.17.10-SNAPSHOT built from uPortal's `ccr-43ba0785-hzlrj5`
(`./gradlew install` on JDK 25), uPortal-start at this branch, and HSQLDB. Playwright 1.64 drove
the preinstalled Chromium 1194 through a directory of links that gives it the build number 1248.

### Build and scan (Tomcat 9, javax)

* `./gradlew war removedApiScan`, then `portalInit`, pass. Each overlay's
  `build/reports/overlay-libraries.txt` shows the JSTL swap in the 15 WARs listed above. The
  Spring 3 patch went into cas, FeedbackPortlet, ResourceServingWebapp and esup-filemanager and
  nowhere else.
* Before the fixes, the same scan of the 16 published WARs gave 308 hits. They include B3's JSTL
  `jsp.el` references in 13 WARs, B4's Spring 3 `ExpressionEvaluationUtils` in 4, and the test
  `PageContextImpl` in GlassFish `jstl-1.2`. After the fixes, every hit is allowlisted.

| WAR | hits | not allowlisted |
|---|---|---|
| uPortal | 15 | 0 |
| Announcements | 24 | 0 |
| BookmarksPortlet | 3 | 0 |
| CalendarPortlet | 24 | 0 |
| FeedbackPortlet | 3 | 0 |
| NewsReaderPortlet | 15 | 0 |
| NotificationPortlet | 6 | 0 |
| ResourceServingWebapp | 3 | 0 |
| SimpleContentPortlet | 13 | 0 |
| WebProxyPortlet | 25 | 0 |
| basiclti-portlet | 0 | 0 |
| cas | 7 | 0 |
| cas-proxy-test-portlet | 9 | 0 |
| esup-filemanager | 7 | 0 |
| pluto-testsuite | 0 | 0 |
| resource-server | 4 | 0 |

* `./gradlew :buildSrc:test` passes all 5 seeded-fault tests.
* Seeded fault in a real overlay. A JSP added to `overlays/pluto-testsuite` with `isThreadSafe`, a
  `session.getValue` scriptlet and `jsp:plugin` makes `removedApiScan` fail the build with exactly
  those hits. The JSP was removed afterwards.
* Playwright, full suite: 122 of 124 pass. The 2 failures are the web-proxy specs that fetch
  `http://example.com/`, which the sandbox blocks, as in every earlier sandbox baseline.
* Pluto testsuite, with the spike's `pluto-testsuite.sh` and `pluto-parse.py`: 144 checks pass and
  16 fail, check for check the 5.17 baseline the spike recorded on Tomcat 8.5. The per-test counts
  are in the table under the Tomcat 11 results.
* Crawl of every registered portlet, maximized as admin: all 93 return HTTP 200. The `error`
  portlet shows the only error card, which is its purpose.

### Tomcat 11 evidence (prototype only, not committed as config)

The webapps that `portalInit` deployed to Tomcat 9 were transformed with jakartaee-migration 1.0.13
(`-profile=TOMCAT`, `-exclude=icu4j-*.jar`, as in the spike's `transform-all.sh`), together with
`shared/lib`. They ran on Tomcat 11.0.26 with JDK 25.0.4, using uPortal-start's own `server.xml`
and `context.xml`, a `shared.loader`, the same ports and the same HSQLDB.

The run used the WARs exactly as the build produced them. It had none of the spike's fixups (JSTL swap, a jar
restoring the removed `jsp.el` classes, `application.properties` edit) and did without `-Djdk.xml.enableExtensionFunctions`, since
uPortal's code fixes MOD-I63.

* Startup took 36 s and all 16 contexts deployed, NotificationPortlet included (B2 is gone).
* While serving, the logs show neither `NoClassDefFoundError` nor `NoSuchMethodError` nor
  `AbstractMethodError`, and every JSP compiles. B3 is gone: search-launcher, portal-activity,
  `PortletError/generic.jsp` and the portlet JSPs using `<c:set>` render. The one linkage error in
  the logs comes from JGroups' `JDBC_PING` shutdown thread logging after the webapp class loader
  closed, during `stop`.
* Playwright, full suite: 122 of 124 pass, with the same 2 offline web-proxy failures as on Tomcat 9.
  The passing specs include the CAS login and logout (uportal-auth, portlet-list's `logoutViaApi`)
  and the Feedback specs that B4 broke in the spike.
* The crawl is identical to Tomcat 9.
* Pluto testsuite: 146 checks pass and 14 fail, the same in two runs. No check regresses from
  Tomcat 9. `SimpleAttributeTest`'s `checkEnumerateAttributes` ("all attribute names appear in the
  request's attribute name enumeration") passes on Tomcat 11 in both test portlets. The `MiscTest`
  failures are the same three, listed in another order. See finding 3.

| Pluto testsuite | Tomcat 9 | Tomcat 11 |
|---|---|---|
| tests passed | 12 | 14 |
| tests failed | 10 | 8 |
| manual | 8 | 8 |
| warning | 2 | 2 |
| checks passed | 144 | 146 |
| checks failed | 16 | 14 |

### GitHub CI

Code head `a8194f0`, before this note's `[skip ci]` commits: CI run 38094277016 and Integration
run 38094276952. Both were still queued on GitHub's saturated runners when this note was written.
GitHub cancelled the earlier pushes' runs as superseded. Results to be added.

## Findings

1. **Spike blocker B1, the corrupt icu4j class, is real and the scanner finds it.**
   CalendarPortlet and NewsReaderPortlet both package `WEB-INF/lib/icu4j-2.6.1.jar` (2,450,757
   bytes, dated 2005-12-20). ASM cannot parse its `com/ibm/icu/impl/data/LocaleElements_zh__PINYIN.class`
   either (javap reports "unexpected tag at #41"). `removedApiScan` lists it as unreadable and
   carries on. The Tomcat 11 run excluded the jar from the transform, as the spike did. The
   build-time transform (P5-5) needs that exclude, or the portlets need a newer icu4j.
2. **Two bundled WARs have JSTL that the spike's fixup skipped.** NotificationPortlet and
   NewsReaderPortlet package GlassFish `jstl-1.2.jar`. Its
   `org/apache/taglibs/standard/lang/jstl/test/PageContextImpl` links against the removed `jsp.el`
   API. It is a test class and never loaded. The uniform rule (every JSTL becomes Taglibs 1.2.5)
   removes it and the duplicate libraries of B13 as well.
3. **One Pluto check passes on Tomcat 11 and fails on Tomcat 9** (`checkEnumerateAttributes`, both
   portlets). The spike recorded identical results on 8.5, 10.1 and 11, using that day's uPortal
   5.17.10-SNAPSHOT and JDK 21 or 25. This run used the integration branch's uPortal. The change
   goes in the right direction. Its cause is still open. It may be Tomcat 11's request attribute
   enumeration, or a change on the integration branch. Settle it before the P7-1 required checks fix the expected Pluto
   numbers.
4. **The scan indexes the whole WAR and needs memory.** Run in parallel, the 16 scans outgrew the
   Gradle daemon's default 512 MB heap. They now share a build service with one slot. Each scan
   takes between 0.2 and 10 s.
5. **Spring Boot 2.7's `SslConnectorCustomizer` in resource-server** also references
   `AbstractHttp11JsseProtocol`, like NotificationPortlet's Boot 1.5. Boot only uses it when it
   starts its own Tomcat with SSL. It is allowlisted, and resource-server deploys on Tomcat 11.
6. **Environment.** Maven Central's 429 responses made each local Gradle build take between 40 and
   90 minutes. The local mirror init script was not usable in this session, because the permission
   classifier refused it (MOD-I52). The preinstalled Chromium (1194) needs a directory of links that
   presents it as build 1248 to Playwright 1.64.

## Proposed LOG entries

* **MOD-I?** (Portlets, Tomcat 11). MOD-I60, MOD-I61 and MOD-I62 are fixed in uPortal-start's
  overlays: `overlayLibraries` rules, a patched Spring 3 `ExpressionEvaluationUtils` and a Boot
  auto-config exclude. Transformed with jakartaee-migration, the bundled WARs run on Tomcat 11.0.26
  with JDK 25 without further fixups, and Playwright, the crawl and Pluto match Tomcat 9. *Plan:*
  move each fix into its portlet repository during 6.x (MOD-D13), and drop a rule once every
  bundled WAR has the fix.
* **MOD-I?** (Build). `removedApiScan` fails the overlay build on the Servlet 6.0, Pages 4.0,
  EL 5.0 and 6.0, Annotations 3.0 and Tomcat 9 to 11 internal removals. Its 143 rules come from the
  Tomcat API diff, and its allowlist holds 17 entries, each with a reason. It is the P5-5 scanner
  the spike asked for. *Plan:* once P5-5 transforms the WARs at build time, run it on the jakarta
  output too, with the rules renamed.
* **MOD-I?** (Portlets). icu4j 2.6.1 in CalendarPortlet and NewsReaderPortlet contains a corrupt
  class (`com/ibm/icu/impl/data/LocaleElements_zh__PINYIN.class`) that aborts jakartaee-migration
  (B1). *Plan:* `-exclude=icu4j-*.jar` in the P5-5 transform, and drop or upgrade icu4j in the
  portlets.
* **MOD-I?** (Tests). Pluto's `checkEnumerateAttributes` passes on Tomcat 11 with the integration
  branch's uPortal and fails on Tomcat 9. The cause is open (finding 3).
* **MOD-D?** (proposed). Keep JSP-level and library-level Tomcat 11 fixes as `overlayLibraries`
  rules in `overlays/build.gradle` until the portlet repositories release them. The removed-API
  allowlist is the list of what is still owed upstream.

## What is left for the portlet repositories (MOD-D13)

| Portlet | Owes |
|---|---|
| uPortal | JSTL 1.2.5, since uPortal-webapp still declares 1.1.2. The P6-1 removal of the removed-method overrides in `GuardingHttpServletRequest/Response` and `AbstractHttpServletResponseWrapper`. An upgrade from spring-session 1.3 (`HttpSessionContext`). |
| Announcements, Bookmarks, Calendar, NewsReader, SimpleContent, WebProxy, basiclti, cas-proxy-test, pluto-testsuite | Taglibs 1.2.5 instead of JSTL 1.1.2 or GlassFish 1.2. Removing `spring-test` from the production WARs of Announcements, Calendar, NewsReader and WebProxy. Removing the bundled Servlet 2.x API jar from cas-proxy-test. |
| FeedbackPortlet, esup-filemanager, ResourceServingWebapp | A move off Spring 3.x (to 4.3 or later, or a new platform), which also makes the patched class unnecessary |
| CAS 3.6 | Retirement or replacement (MOD-Q3, MOD-I36). Until then the patch keeps it working on Tomcat 11. |
| NotificationPortlet | The Boot exclude in its own `application.properties`, or a move off Boot 1.5 |
| CalendarPortlet, NewsReaderPortlet | Dropping or upgrading icu4j 2.6.1 (B1) |
| FeedbackPortlet | Dropping `disableURLRewriting` from `context.xml` (B12, ignored since Tomcat 8) |

## Reproducing the Tomcat 11 run

The scripts are prototype-only and not committed. They follow the spike's scripts in uPortal's
`docs/developer/modernization/research/spike-jakarta/scripts`.

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
