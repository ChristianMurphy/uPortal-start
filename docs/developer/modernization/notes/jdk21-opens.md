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

## Proposed LOG rows (MOD-I365 to MOD-I369)

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| MOD-I365 | JDK 21 | At the integration tip (Hibernate 5.2.18, javassist 3.30.2, Spring 5.3), uPortal's `dataInit` and SimpleContentPortlet pass on JDK 21 without opens. The CalendarPortlet, NewsReaderPortlet and Announcements data steps fail with `InaccessibleObjectException`, because Hibernate 3's javassist and Spring's cglib call `ClassLoader.defineClass`, and the Cernunnos scripts' Groovy engine opens `String` and `HashSet` constructors. The Calendar and NewsReader schema steps hide their failure (`failonerror: false`) | **Fixed** (uPortal-start, commit 1): `portalJvmArgs` opens `java.lang` and `java.util` to every forked data tool |
| MOD-I366 | JDK 21 | Released uPortal 5.17.9's `dataInit` fails on JDK 21 without the `java.lang` opens (Spring 4.3's `ConfigurationClassEnhancer`). 5.17.9 with commit 1 imports its data and its portal starts on JDK 21 and Tomcat 9.0.122, so the equivalence job's 5.17.9 side can move to 21 | **Fixed** by commit 1. The workflow change belongs to P4-2 commit 4 |
| MOD-I367 | CI | The replay job's reference, uPortal-start `master`, uses Gradle 6.9.4, which can't run on JDK 21 (`Unsupported class file major version 65`). Its Tomcat 8.5.100 runs 5.17.9 on JDK 21 when Gradle and the data tools stay on JDK 11 | **Open**: decide for P4-2 commit 4. Either two JDKs in that job (11 for Gradle, 21 as `JAVA_HOME`) or a newer reference checkout |
| MOD-I368 | Tomcat | Tomcat 9's `daemon.sh` (jsvc) reads `setenv.sh` but doesn't add any module opens, and jsvc ignores `JDK_JAVA_OPTIONS`. On JDK 21, Announcements, NewsReaderPortlet and NotificationPortlet then fail to start. `catalina.sh` and `catalina.bat` add the opens | **Fixed** (uPortal-start, commit 2): `setenv.sh` adds the `java.lang` opens. `setenv.bat` isn't changed, because procrun doesn't read it |
| MOD-I369 | Process | A local probe of `master` hung for an hour. A stop that checked the wrong port left a Tomcat running, and its HSQLDB locks blocked the next `portalInit`. SIGTERM didn't stop that Tomcat (JGroups `JDBC_PING` shutdown hook). Changing the ports of an old checkout must cover `verifyTomcatState` too, and a probe should check that its ports are free before `portalInit` | **Lesson** |
