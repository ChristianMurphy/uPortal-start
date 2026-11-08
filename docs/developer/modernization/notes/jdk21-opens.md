# Module opens for the portal on JDK 21 (P4-2, commits 1 and 2)

Branch `ccr-43ba0785-hzlrj5-jdk21-opens`, in uPortal-start only. uPortal is unchanged, so the
push runs build the uPortal integration branch.

The branch makes uPortal-start's JVMs work on JDK 21 while the portal still runs on JDK 11. The
data tools that Gradle forks get `--add-opens` for `java.lang` and `java.util`. Tomcat's
`setenv.sh` adds the `java.lang` opens for `daemon.sh`. Both options also work on JDK 11. The
runtime switch to JDK 21 (P4-2 commits 3 to 7) comes later.

## Commits

| Commit | Change |
| --- | --- |
| `build: open java.lang and java.util to the portal's data tools` | `build.gradle` defines `portalJvmArgs`. `PortalShellInvoker` and every `ant.java` call in the Announcements, CalendarPortlet, NewsReaderPortlet and SimpleContentPortlet overlays pass it as `jvmarg` |
| `build: add the module opens to tomcat's setenv scripts` | `etc/tomcat/bin/setenv.sh` adds the `java.lang` opens to `CATALINA_OPTS`, for `daemon.sh` (jsvc). `setenv.bat` is unchanged, for the reasons below |

## Measurement 1: data steps on JDK 21 at the integration tip

Setup: uPortal `47d6333e2c` (Hibernate 5.2.18, javassist 3.30.2-GA, Spring 5.3.39), installed as
5.17.10-SNAPSHOT into a private Maven repository. uPortal-start `644875432` with
`uPortalVersion=5.17.10-SNAPSHOT`. `JAVA_HOME` is Temurin 21.0.12, which `portalJava` uses for
HSQLDB and every forked tool.

Command: `./gradlew --no-daemon --no-parallel --continue -PquietImport portalInit`.

| Step | JDK 21, no opens | Exception |
| --- | --- | --- |
| uPortal `dataInit` | passes | none |
| SimpleContentPortlet schema | passes | none |
| CalendarPortlet schema | logs `Javassist Enhancement failed` for 3 entities and goes on, because its `ant.java` has `failonerror: false` | `InaccessibleObjectException: Unable to make protected final java.lang.Class java.lang.ClassLoader.defineClass(...)` from `javassist.util.proxy.FactoryHelper.toClass2` (Hibernate 3) |
| CalendarPortlet import | fails | `InaccessibleObjectException: Unable to make private java.lang.String(char[],int,int,java.lang.Void) accessible` from the Groovy script engine of the Cernunnos import script |
| NewsReaderPortlet schema and import | same as CalendarPortlet | same |
| Announcements import | fails | `defineClass` again, from `org.springframework.cglib.core.ReflectUtils.defineClass` through `CglibAopProxy` |

With `java.lang` opened, the CalendarPortlet and NewsReaderPortlet imports fail next on
`Unable to make java.util.HashSet(int,float,boolean) accessible`, from the same Groovy engine. So
the data tools need both packages. The first measurement hid this, because the `java.lang`
failure came first.

Tomcat 9.0.122's `catalina.sh` adds `JDK_JAVA_OPTIONS` opens for `java.lang`, `java.lang.invoke`,
`java.lang.reflect`, `java.io`, `java.util`, `java.util.concurrent` and
`java.rmi/sun.rmi.transport`. `catalina.bat` adds the same list. `daemon.sh` reads `setenv.sh`
but doesn't add any opens. jsvc starts the JVM through JNI, which doesn't read `JDK_JAVA_OPTIONS`. The
Windows service (`service.bat`, procrun) isn't in the tar.gz that uPortal-start installs, so this
branch didn't check it. Procrun doesn't read `setenv.bat`, so `setenv.bat` can't help it.

## Measurement 2: released uPortal 5.17.9 on JDK 21

The reference jobs start 5.17.9 in two ways. The replay job checks out uPortal-start `master`
(`2a519ad7f`, with Gradle 6.9.4 and Tomcat 8.5.100). The equivalence job deploys 5.17.9 through the
current uPortal-start (`-PuPortalVersion=5.17.9`, Tomcat 9.0.122).

| Run | Result |
| --- | --- |
| `master`, `./gradlew help` on JDK 21 | fails. `Could not compile settings file ... Unsupported class file major version 65`. Gradle 6.9.4 can't run on JDK 21 |
| `master`, Gradle and the data tools on JDK 11 (`-Dorg.gradle.java.home`), Tomcat on JDK 21 (`JAVA_HOME`) | `portalInit` passes on 11. Tomcat 8.5.100 starts on 21.0.12 in 27.5 s, and the guest page renders 7 portlets. No `InaccessibleObjectException` in any log, because Tomcat 8.5.100's `catalina.sh` opens `java.lang`, `java.io`, `java.util`, `java.util.concurrent` and `java.rmi/sun.rmi.transport` |
| current uPortal-start with 5.17.9, JDK 21, no opens | uPortal `dataInit` fails: `Cannot load configuration class: org.apereo.portal.context.persondir.PersonDirectoryConfiguration`, caused by `defineClass` from Spring 4.3's `ConfigurationClassEnhancer`. Calendar, NewsReader and Announcements fail as in measurement 1. SimpleContentPortlet passes |
| current uPortal-start with 5.17.9, JDK 21, both opens (commit 1) | `portalInit` passes. Tomcat starts in 28.1 s, and the guest page renders 7 portlets. No `InaccessibleObjectException` in any log |

So with commit 1, the equivalence job's 5.17.9 side can run on JDK 21. The replay job's
reference can't run on JDK 21 alone, because its Gradle 6.9.4 needs JDK 16 or earlier. It can run
its Tomcat on 21 if Gradle and the data tools stay on 11. Another way is a newer reference
checkout. That choice belongs to commit 4.

The first reference probe hung for about an hour. Its earlier run had left a Tomcat running,
because `master` hardcodes port 8080 in `verifyTomcatState`, and this branch's port changes for
the probe missed that line. `tomcatStop` then reported that Tomcat wasn't running. That Tomcat
reconnected to the new HSQLDB and held locks, and the schema tools of the next `portalInit`
waited on them. SIGTERM didn't stop it, because its JGroups `JDBC_PING` shutdown hook waited on
the same database. The probe went on after a SIGKILL of that PID, and its NewsReaderPortlet import
then failed on the closed connection. The run before it, without the leftover Tomcat, passed.
JDK 21 didn't cause the hang.

## Commit 2: which launchers need `setenv`

The portal from the integration tip, with commit 1, started through `daemon.sh run` with a jsvc
built from Tomcat's `commons-daemon-native.tar.gz` (commons-daemon 1.6.1), on JDK 21:

| `setenv.sh` | Result |
| --- | --- |
| unchanged | Announcements, NewsReaderPortlet and NotificationPortlet fail to start (`CodeGenerationException ... InaccessibleObjectException ... defineClass` from Spring's cglib). `calendar.log` has the same exception |
| with `java.lang` | every webapp starts. The guest page renders 7 portlets and the student page 5. No `InaccessibleObjectException` in any log |
| with `java.lang` and `java.util` | same as `java.lang` alone |

uPortal-start no longer deploys the CAS 3.6 server, which needed `java.util` (spike B10), so
`setenv.sh` adds `java.lang` only. With `catalina.sh`, the option appears twice, and the JVM
accepts that.

`setenv.bat` isn't changed. `catalina.bat` already adds the opens, and procrun doesn't read
`setenv.bat`.

## Seeded fault

On JDK 21, with `portalJvmArgs = []` in the working tree and the portal from the integration tip
deployed, `./gradlew --continue dataInit` fails. `:overlays:CalendarPortlet:dataInit`,
`:overlays:NewsReaderPortlet:dataInit` and `:overlays:Announcements:dataInit` fail, with 13
`InaccessibleObjectException: Unable to make protected final java.lang.Class
java.lang.ClassLoader.defineClass` lines and 4 for `private java.lang.String`. After
`git checkout -- build.gradle`, the same command passes (exit 0). The fault wasn't committed.

## Verification

* JDK 21: `portalInit` passes, Tomcat starts, and the guest page renders 7 portlets, at the
  integration tip and with 5.17.9.
* JDK 11: `portalInit` passes at the integration tip with commit 1. Tomcat starts and renders the
  guest page.
* Commit 2, `catalina.sh` on JDK 11 and 21 and `daemon.sh` on JDK 21: see the results below.

| Launcher | JDK | Result |
| --- | --- | --- |
| `catalina.sh` through `tomcatStart` | 11.0.29 | starts in 52.2 s. The guest page renders 7 portlets |
| `catalina.sh` through `tomcatStart` | 21.0.12 | starts in 33.1 s. The guest page renders 7 portlets |
| `daemon.sh run` (jsvc) | 21.0.12 | starts in 36.3 s. The guest page renders 7 portlets and the student page 5 |

The logs of these runs have no `InaccessibleObjectException`. `:buildSrc:test` passes.

## Since mid-October: the merge of 2026-11-08

The branch was written on 2026-10-15 at uPortal-start `644875432` and wasn't merged. On
2026-11-08 the integration branch was merged into it twice: `4f3c51353` (tip `09ccc9cbb`, 62
commits) and `77c918f17` (tip `9c20dbaf6`, landing 4). Neither merge had a conflict, and
`git show --remerge-diff` of each is empty. uPortal moved from `47d6333e2c` to `0cf02679f` without
a change to its dependency versions.

| Landed change | Effect on this branch |
| --- | --- |
| Gradle wrapper retries and the cache fix (MOD-I397, MOD-I398) | The branch changes `build.gradle`, three overlay build files and `buildSrc`, so its first push runs have no Gradle cache entry and download the distribution, with the new retries. Nothing else |
| test-users, the replay masks, the layout and locale fixes, permission-race | They change specs, the replay, uPortal's Java code and the cluster test. Their diffs don't touch the files of this branch, add a forked JVM or start Tomcat another way |
| Forked JVMs on the tip | The same nine `ant.java` calls and `PortalShellInvoker` as in October. `dbMigrate` (the copy tool) runs on the JDK 21 toolchain and doesn't load the portlets' cglib or javassist. HSQLDB runs on `portalJava` and doesn't need the opens |
| CI | The jobs of `CI.yml`, `integration.yml`, `db-harness.yml`, `g-index.yml`, `migration-equivalence.yml` and `replay.yml` that start a portal list 11 last in `setup-java`, so `JAVA_HOME` (Tomcat, HSQLDB and the data tools) is 11, and Gradle runs on 21 |

### Measurement 3: the data tools at the new tips

uPortal `4b5d266ad` (the uPortal tip `0cf02679f` with landing batch 1, which doesn't change Java
runtime code), installed as 5.17.10-SNAPSHOT into a private Maven repository. This branch at
`77c918f17`, HSQLDB, ports 8680, 8605 and 8687. "Without" is `portalJvmArgs = []` in the working
tree, put back with `git checkout -- build.gradle` after each run.

| Run | JDK | Result | `InaccessibleObjectException` | JVM warnings |
| --- | --- | --- | --- | --- |
| `portalInit --continue`, without | 21.0.12 | fails: `:overlays:Announcements:dataInit`, `:overlays:CalendarPortlet:dataInit`, `:overlays:NewsReaderPortlet:dataInit` | 33 lines: 13 `defineClass`, 4 `String(char[],int,int,Void)` and their repeats | none |
| `dataInit`, with | 21.0.12 | passes | 0 | none |
| `dataInit`, without | 11.0.32 | passes | 0 | 7 JVMs print "An illegal reflective access operation has occurred", from javassist `defineClass` (Calendar and NewsReader schema), Groovy's `String` constructor (Calendar and NewsReader imports), Spring 4.3's `ReflectionUtils` to `MethodHandles$Lookup` (2) and dom4j to a Xerces class (1) |
| `dataInit`, with | 11.0.32 | passes | 0 | 3 JVMs, from Spring 4.3's `ReflectionUtils` (2) and dom4j (1) |

So both opens are needed on JDK 21, and they are enough for every data step. On JDK 11, which CI
runs, the steps passed before and pass now. The opens remove four of the seven warning blocks.
The other three come from `java.lang.invoke` and the JDK's Xerces, which the branch doesn't open,
and those calls don't fail on JDK 21. "JVM warnings" counts `WARNING:` lines without Hibernate's
`Failed Query Report` lines, which the schema drop of an empty database writes on both JDKs.

### Tomcat at the new tips

The data from the `dataInit` runs above, Tomcat 9.0.122. `wait-for-portlets.sh` checks that every
portlet webapp registered its portlets. The student page counts `up-portlet-wrapper` elements in
the header and the content.

| Launcher | JDK | `setenv.sh` | Result |
| --- | --- | --- | --- |
| `catalina.sh` (`tomcatStart`) | 21.0.12 | this branch | answers after about 50 s, every webapp registers, the student page has 19 portlets. No `InaccessibleObjectException` in any log |
| `daemon.sh start` (jsvc 1.6.1 built from Tomcat's `commons-daemon-native.tar.gz`) | 21.0.12 | this branch | the same, after about 35 s |
| `daemon.sh start` | 21.0.12 | without the opens line | Announcements and NewsReaderPortlet fail to start ("Exception sending context initialized event", `ExceptionInInitializerError` from Spring's AOP proxy, `Cannot load configuration class: NewsReaderBeans`). NotificationPortlet doesn't register its portlets, and the student page loses Emergency Alert (18). `InaccessibleObjectException` in 7 logs |
| `catalina.sh` (`tomcatStart`) | 11.0.32 | this branch | answers after about 50 s, every webapp registers, 19 portlets. Tomcat logs `--add-opens=java.base/java.lang=ALL-UNNAMED` twice, from `JDK_JAVA_OPTIONS` and from `CATALINA_OPTS`, and the JVM takes both. One illegal reflective access warning, from dom4j in BookmarksPortlet to a Xerces class, which the opens don't cover |

On JDK 11, which CI runs, the `setenv.sh` line repeats an option that `catalina.sh` already
passes and changes nothing else. `:buildSrc:test` passes (11 tests).

Measurement 2 (released 5.17.9) and the seeded fault of October weren't repeated. The run without
`portalJvmArgs` above is that fault again, on the new tips.

### CI

Push runs of `381a17128`. They built uPortal `ccr-43ba0785-hzlrj5` at `0cf02679f`, since uPortal
has no branch of this name (the `uPortal under test` annotation of each `Build uPortal` job). CI
runs the portal and the data tools on JDK 11.

| Workflow | Run | Result |
| --- | --- | --- |
| Integration | 42488124359 | passed. Playwright on HSQLDB 512 passed (job 128755229380), on PostgreSQL 18 512 passed (128755229476), on HSQLDB with CAS passed. Cluster, DB harness on PostgreSQL 18 and G-migrate MariaDB 11.4 to PostgreSQL 18 passed |
| CI | 42488124486 | passed, with the lint job |
| HTTP replay | 42488124366 | passed. "Replay against 5.17" ran, because the merge brought changes to `tests/replay` |
| Migration equivalence | 42488124445 | passed. Its 5.17.9 side runs this branch's data tools on JDK 11 |
| G-index | 42488124430 | passed (G-index on PostgreSQL 18, job 128754828560) |
| Workflow lint | 42488124376 | passed |

The CI job "ubuntu-latest with Java temurin version 11" runs `dataInit` with `-i`. Its log has 3
"An illegal reflective access operation has occurred" blocks on this branch (job 128754374830)
and 7 on the integration tip `9c20dbaf6` (job 128745328118, run 42485157594), as in the local
JDK 11 runs. Neither log has an `InaccessibleObjectException`.

## Next step

None on this branch. The coordinator reviews it against the tip.

## Proposed LOG rows (MOD-I365 to MOD-I369)

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| MOD-I365 | JDK 21 | At the integration tip (Hibernate 5.2.18, javassist 3.30.2, Spring 5.3), uPortal's `dataInit` and SimpleContentPortlet pass on JDK 21 without opens. The CalendarPortlet, NewsReaderPortlet and Announcements data steps fail with `InaccessibleObjectException`, because Hibernate 3's javassist and Spring's cglib call `ClassLoader.defineClass`, and the Cernunnos scripts' Groovy engine opens `String` and `HashSet` constructors. The Calendar and NewsReader schema steps hide their failure (`failonerror: false`) | **Fixed** (uPortal-start, commit 1): `portalJvmArgs` opens `java.lang` and `java.util` to every forked data tool. Measured again on 2026-11-08 at uPortal `0cf02679f`: without them the three data steps fail on JDK 21, with them every step passes. On JDK 11 they remove four of seven illegal reflective access warnings |
| MOD-I366 | JDK 21 | Released uPortal 5.17.9's `dataInit` fails on JDK 21 without the `java.lang` opens (Spring 4.3's `ConfigurationClassEnhancer`). 5.17.9 with commit 1 imports its data and its portal starts on JDK 21 and Tomcat 9.0.122, so the equivalence job's 5.17.9 side can move to 21 | **Fixed** by commit 1. The workflow change belongs to P4-2 commit 4 |
| MOD-I367 | CI | The replay job's reference, uPortal-start `master`, uses Gradle 6.9.4, which can't run on JDK 21 (`Unsupported class file major version 65`). Its Tomcat 8.5.100 runs 5.17.9 on JDK 21 when Gradle and the data tools stay on JDK 11 | **Open**: decide for P4-2 commit 4. Either two JDKs in that job (11 for Gradle, 21 as `JAVA_HOME`) or a newer reference checkout |
| MOD-I368 | Tomcat | Tomcat 9's `daemon.sh` (jsvc) reads `setenv.sh` but doesn't add any module opens, and jsvc ignores `JDK_JAVA_OPTIONS`. On JDK 21, Announcements, NewsReaderPortlet and NotificationPortlet then fail to start. `catalina.sh` and `catalina.bat` add the opens | **Fixed** (uPortal-start, commit 2): `setenv.sh` adds the `java.lang` opens. `setenv.bat` isn't changed, because procrun doesn't read it |
| MOD-I369 | Process | A local probe of `master` hung for an hour. A stop that checked the wrong port left a Tomcat running, and its HSQLDB locks blocked the next `portalInit`. SIGTERM didn't stop that Tomcat (JGroups `JDBC_PING` shutdown hook). Changing the ports of an old checkout must cover `verifyTomcatState` too, and a probe should check that its ports are free before `portalInit` | **Lesson** |
