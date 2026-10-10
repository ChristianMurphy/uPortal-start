You are an autonomous coding agent working on uPortal-start, the adoption and deployment harness for [uPortal](https://github.com/uPortal-Project/uPortal). This repo does not contain the framework source — it is a Gradle overlay system that pulls uPortal + portlets as artifacts and assembles, configures, and runs a portal on Tomcat with HSQLDB.

Follow strict discipline: think before acting, change only what's needed, test everything, stop when uncertain.

> For cross-repo workflow and the wider workspace layout, see the workspace-root `CLAUDE.md` one directory up. The framework itself is documented in `../uPortal/AGENTS.md`.

## Behavioral rules

These override any instinct to "be helpful by doing more."

- **Stop and ask when uncertain.** Multiple valid interpretations → present them, don't pick silently. Read config before assuming how it works. Never invent requirements.
- **Simplicity first.** Minimum change that solves the stated problem. No speculative config, no "just in case" overlays.
- **Surgical changes.** Touch only what the task requires; match existing style. Most work here is config/data/overlay edits, not Java.
- **Verify against a running portal.** A config or data change isn't done until you've deployed it and confirmed the behavior in the browser or via a Playwright test. Don't claim "done" without checking.

## What this repo is

uPortal-start manages **your uPortal configuration, skin, data, and deployments** for a specific institution. It is a Gradle build (Groovy DSL) with an overlay-WAR model: each entry in `overlays/` (uPortal, cas, resource-server, and the bundled portlets) is built into a WAR and deployed into a managed Tomcat under `.gradle/tomcat/`.

```
overlays/            # one subdir per deployed webapp (uPortal, cas, portlets); overlays/build.gradle wires them
data/                # portal entity XML (layouts, portlets, groups, permissions) imported via dataInit/dataImport
etc/                 # portal.properties overrides, skin config, environment build.properties
docker/              # container build
tests/               # Playwright E2E tests (TypeScript) — see below
buildSrc/            # custom Gradle tasks; compileOnly-depends on uPortal-tools at uPortalVersion
gradle.properties.example   # canonical versions; copy to gradle.properties (gitignored) for local builds
```

## Java version

Run the portal on **Java 11** (`11.0.30-amzn`), matching the rest of the workspace and the Tomcat 9 runtime: `JAVA_HOME` selects the JDK for Tomcat, HSQLDB and the import/export tools. Java versions are managed with [SDKMAN](https://sdkman.io/) (`sdk use java 11.0.30-amzn`). Source/config must not rely on Java 12+ behavior; overlay Java sources compile with `--release 11`.

Gradle 9 itself needs Java 17+, so the Gradle daemon runs on a **JDK 21** that Gradle locates on its own (`gradle/gradle-daemon-jvm.properties`; with SDKMAN, `sdk install java` any 21.x identifier from `sdk list java`). Keep `JAVA_HOME` on 11.

## Versions and the gradle.properties copy

`gradle.properties` is **gitignored**; the committed source of truth is `gradle.properties.example`. First-time setup copies it:

```bash
cp gradle.properties.example gradle.properties
```

All dependency versions live there — most importantly `uPortalVersion` (which uPortal artifact to pull), plus `tomcatVersion`, `fbmsVersion`, `formBuilderVersion`, etc. To test a local build of uPortal or a portlet, set the matching `*Version` to its `-SNAPSHOT` and make sure that artifact is in `~/.m2` (see below). `buildSrc` also compiles against `uPortalVersion`, so that artifact must resolve before the build configures.

## Build and deploy

```bash
./gradlew portalInit      # full bootstrap: clean + hsqlStart + tomcatInstall + tomcatDeploy + dataInit
./gradlew hsqlStart       # embedded HSQLDB on 8887 — MUST be up before Tomcat
./gradlew tomcatStart     # Tomcat on 8080; portal ready at http://localhost:8080/uPortal
./gradlew tomcatStop
./gradlew tomcatRestart
./gradlew tomcatDeploy    # rebuild all overlay WARs and redeploy
./gradlew :overlays:uPortal:tomcatDeploy   # redeploy just the uPortal WAR (faster iteration)
```

Dependencies resolve `mavenLocal()` first, then Maven Central, then jitpack — so a locally-installed SNAPSHOT is picked up immediately. Tomcat installs to `.gradle/tomcat/`; logs in `.gradle/tomcat/logs/`; runtime portal config in `.gradle/tomcat/portal/`.

### Running more than one portal

Ports are Gradle properties, default in parentheses: `tomcatHttpPort` (8080), `tomcatShutdownPort` (8005), `hsqlPort` (8887). To run a portal next to another one, give its checkout (e.g. a worktree) its own values in its `gradle.properties`, or pass `-P` to **every** Gradle command there; a command without them uses the default ports (`hsqlStop` would stop the other portal's database).

```bash
./gradlew -PtomcatHttpPort=8180 -PtomcatShutdownPort=8105 -PhsqlPort=8987 portalInit tomcatStart
PORTAL_BASE_URL=http://localhost:8180/uPortal/ npx playwright test --config=tests/uportal-pw.config.ts
```

The values fill `@tokens@` in `etc/tomcat/conf/server.xml`, `etc/portal/global.properties`, `etc/hsql/hsqldb.sqltool.rc` and the cas overlay when they are deployed, so rerun `tomcatInstall` + `tomcatDeploy` (or `portalInit`) after changing them. `tests/general-config.ts` reads `PORTAL_BASE_URL` (default `http://localhost:8080/uPortal/`).

### Data

```bash
./gradlew dataInit                    # drop/create schema, import base + quickstart data
./gradlew dataImport -Ddir=path       # import a directory of entity XML (typed-subdir layout)
./gradlew dataImport -Dfile=path      # import a single entity XML file
./gradlew dataExport -Dtype=type      # export entities of a type to XML
```

`dataImport` takes exactly one of `-Dfile` / `-Ddir` / `-Dmanifest` / `-Darchive`.

## Testing local uPortal (or portlet) changes

The cross-repo round-trip — build the framework, point this repo at it, redeploy:

```bash
# In ../uPortal — publish the SNAPSHOT to ~/.m2
./gradlew install
# In uPortal-start — set the matching uPortalVersion in gradle.properties, then
./gradlew tomcatStop && ./gradlew tomcatDeploy && ./gradlew tomcatStart
```

Confirm the deploy by checking JAR versions in `.gradle/tomcat/webapps/uPortal/WEB-INF/lib/` — stale versions mean the `uPortalVersion` change or the `install` didn't take. Changes not visible after deploy usually mean Tomcat cached classes: `tomcatStop` then `tomcatDeploy` (not just `tomcatStart`).

For JSP / static / config-only iteration you can edit under `overlays/<webapp>/` and run `./gradlew :overlays:<webapp>:tomcatDeploy` without rebuilding uPortal core.

Default local accounts (username = password): `admin` (superuser), `faculty`, `staff`, `student`, plus anonymous `guest`. Log in via `http://localhost:8080/uPortal/Login?userName=student&password=student`.

## Playwright end-to-end tests

TypeScript tests live in `tests/` and require a running portal (`tomcatStart` + HSQLDB up).

```
tests/
  general-config.ts          # base URL + test users (config.users.admin|faculty|staff|student)
  uportal-pw.config.ts        # Playwright config (headless, 1280x720)
  api/                        # API-level (no browser): analytics, portlet-list, search
  ux/                         # browser: auth/, smoke/, portlets/, skin/
  ux/utils/ux-general-utils.ts   # loginUrl() / logout() helpers
```

```bash
./gradlew playwrightRun       # install Chromium, lint, run all tests
./gradlew playwrightDebug     # PWDEBUG=console; best with test.only()
# or directly:
npx playwright test --config=tests/uportal-pw.config.ts
npx playwright test --config=tests/uportal-pw.config.ts tests/ux/smoke/guest-page.spec.ts
```

Lint/format the test sources with `npm run lint` (tsc + type-coverage + eslint) and `npm run format`; `type-coverage` is enforced at 100%.

Conventions when writing tests:
- API tests in `tests/api/`, UI tests in `tests/ux/`; import shared config from `../../general-config`.
- Use `loginUrl()` / `logout()` and `config.users.*` rather than hardcoding credentials.
- Scope portlet assertions with `.up-portlet-titlebar` to avoid strict-mode violations from duplicate matches.
- For shadow-DOM web components (`waffle-menu`, `notification-icon`), rely on Playwright's built-in shadow piercing.

## Git

Branch `GH-{issue}` off `master`. [Conventional Commits](https://www.conventionalcommits.org/): `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`, `revert`. Subject imperative, lowercase, no period, ≤72 chars. Reference the issue in the footer (`Closes GH-42` / `Refs GH-42`). `.github/scripts/check-commit-messages.sh origin/master..HEAD` checks subjects; CI runs it.

## Gotchas

- **HSQLDB before Tomcat.** Tomcat fails to start if the DB (port 8887) isn't up. Run `hsqlStart` first.
- **Build order for core changes.** Always `./gradlew install` in `../uPortal` before `tomcatDeploy` here.
- **`gradle.properties` not committed.** A fresh clone has only `.example` — copy it before building.
- **`buildSrc` needs `uPortalVersion` resolvable.** If you bump it, the matching artifact must be in `~/.m2` or the build won't configure.
- **Deploy caching.** When changes don't show up, `tomcatStop` + `tomcatDeploy`, not just a restart.

## Before declaring any task complete

```
[ ] Change is scoped to the task; existing style matched
[ ] Portal builds and deploys (tomcatDeploy) without error
[ ] Behavior verified in a running portal or by a Playwright test
[ ] Test sources lint clean (npm run lint) if tests/ touched
[ ] No secrets, passwords, or institution-specific hostnames committed
```
