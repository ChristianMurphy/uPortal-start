# Handoff: retry-flakes (tests that passed only on a retry)

The branch is `ccr-43ba0785-hzlrj5-retry-flakes` in uPortal-start. It covers the reset and
self-edit flakes of the integration tip's Integration run 38775913145 (uPortal-start `d1326f514`,
uPortal `498252acd`), the rest of MOD-I385, and MOD-I383 and MOD-I387. uPortal has no branch of
this name. Its runs build the uPortal integration branch.

The causes, two in the tests and two in the portal:

| Failure | Cause | State |
| --- | --- | --- |
| `reset-my-layout.spec.ts:289` (postgres-18 job 116563567668), `:308` (G-migrate jobs 116563567769 and 116563568282) | The search spec saved Spanish and French for the shared student (cause 1) | Fixed on this branch |
| `self-edit-account.spec.ts:256` (MariaDB job 116563567479) | Account imports that overlap deadlock on MariaDB (cause 3) | Portal bug, proposed fix below |
| `reset-my-layout.spec.ts:238` (postgres-18, run 38689486418, MOD-I383) | Staff's sign-in failed in a cache key expression (cause 2) | Portal bug, proposed fix below |
| `self-edit-account-component.spec.ts:255` (HSQLDB job 128653803621 of this branch's run 42455427048) | Workers imported accounts with the same name (cause 4) | Fixed on this branch |

## Cause 1: the search language tests changed the student's language

`search-web-component.spec.ts` has two tests, "speaks the user's language: es_ES" and "fr_FR".
They signed in as the student, saved the locale through `PUT /api/v6-0/locale` and saved
`en_US` again at the end. The portal renders a new session in the user's saved language. A spec
that signed in as the student in those few seconds got Spanish or French pages.

Evidence from run 38775913145 (first attempts, trace and screenshot):

* All three failures signed the student in, and the page then asked for its messages with
  `/api/v6-0/messages?locale=es-ES`. The test waited for an English page, and the page was in
  Spanish. It's the same failure in all three jobs.
* postgres-18, `:289`: the test waited for `locale` to match `/^en/` on `<up-reset-my-layout>`.
  The element had `locale="es-ES"` for the whole 5 s, and the screenshot shows "Reiniciar
  ahora" and "Has accedido como Steven Student".
* G-migrate postgres-16 to postgres-18 and postgres-15 to MariaDB, `:308`: the test waited 30 s
  to focus the "Reset Now" button, and the component offered "Reiniciar ahora". The call log of
  the MariaDB pair also shows a navigation to the guest Welcome page: that was the `afterEach`
  sign-out, which ran while the timed-out `focus` was still pending, and the screenshot was taken
  after it.
* The portal logs show who wrote it. The student's fragments were activated with `es_ES`, then with
  `fr_FR` three seconds later, only once in each job: postgres-18 at 17:40:46 and 17:40:50 (the
  failed test started at 17:40:47), postgres-15 to MariaDB at 17:45:12 and 17:45:15 (test start
  17:45:12), postgres-16 to postgres-18 at 17:46:30 and 17:46:32 (test start 17:46:30). Those
  pairs are the two search tests, which run next to `reset-my-layout.spec.ts` on the other
  worker.

The fix (`dd63f3f46`) moves the two tests to a `describe` that signs in as the developer, the
account the language tests use (`general-config.ts`). The other developer specs are the Reset My
Layout and Session Timeout language tests, which set their own session's language before they
open a page, Pluto's test suite and the Reset My Layout API spec.

The language tests that share the developer can still save its language at the same moment. The
portal then answers 500 to one of them: `RDBMLocaleStore.updateUserLocales` deletes the user's
rows in `UP_USER_LOCALE` and inserts the new ones, and the second insert hits the primary key. The
local runs below saw it once in 60 search tests that shared the student, and not in 180 tests
that shared the developer. A user of its own per worker for each language spec would remove it,
as the `test-users` branch does for `user-locale.spec.ts` with `own-users.ts`. That helper isn't
on the integration branch yet.

`user-locale.spec.ts` saves French for the student too (MOD-I378). That spec belongs to the
`test-users` branch, which gives it a user of its own, so this branch leaves it alone. Once both
are merged, the student's saved language is always English.

The Reset My Layout UX spec's own user, riley, isn't involved: the failing tests are the web
component tests, which sign in as the student.

## Cause 2: a cache key expression fails at random in the portal

uPortal's `EntityTypes.getEntityIDFromType` (uPortal-core) is
`@Cacheable(cacheNames = "org.apereo.portal.EntityTypes.ID_BY_CLASS", key = "#type.Name")`.
Spring evaluates `#type.Name` on every call, with `type` a `Class`, usually `IPerson.class`.
Since the move to Spring 5.3 (uPortal `6e2640a52`), SpEL's `ReflectivePropertyAccessor` passes the
getter it found, `Class.getName()`, through `ClassUtils.getInterfaceMethodIfPossible(method,
IPerson.class)`. That method looks up the interfaces of `IPerson` when its cache returns the very
`Method` object it was given, and `IPerson` extends `java.security.Principal`, which has
`getName()`. SpEL then calls `Principal.getName()` on the `Class` object and fails with
`IllegalArgumentException: object is not an instance of declaring class`.

The cache returns the same object only on the first call in the JVM, and on the first call
after the garbage collector clears its entry, because `interfaceMethodCache` is a
`ConcurrentReferenceHashMap` with soft references. The other calls get an equal copy and work.

`Authentication.authenticate` calls it through
`GroupService`, so a sign-in fails and the login portlet says "Invalid username or password". A
render or a REST call that reads the user's groups answers 500.

Evidence:

* A standalone program with the Spring 5.3.39 jars from the Gradle cache evaluates the key on an
  interface that extends `Principal`, as `IPerson` does, each time with a new
  `StandardEvaluationContext`, as Spring's cache interceptor does:

  ```java
  interface Person extends Principal {}
  Expression key = new SpelExpressionParser().parseExpression("#type.Name");
  StandardEvaluationContext context = new StandardEvaluationContext();
  context.setVariable("type", Person.class);
  key.getValue(context);
  ```

  On Java 11, the first evaluation fails with the portal's exception, the next ones work, and the
  first one after `ClassUtils.interfaceMethodCache` is cleared (through reflection) fails again.
  `#type.getName()` fails the same way on the first call. `#type` never fails. Spring 4.3.30 (the
  5.17 release) and 7.0.9 don't fail.
* Every portal log in the downloaded artifacts has the failure at the first request, the guest
  login of `global-setup.ts`: run 38775913145 (postgres-18, MariaDB, both G-migrate pairs), run
  38689486418 (postgres-18) and this branch's run 42455427048 (HSQLDB, postgres-18). The tests
  don't notice that one.
* Later failures appear in four of those seven logs: run 38775913145 postgres-18 at 17:38:22 (a
  guest render of `/f/welcome/normal/render.uP` answered 500), its postgres-16 to postgres-18 pair
  at 17:45:29 (`/api/v5-1/userinfo` answered 500), run 42455427048 HSQLDB at 06:54:52
  (`/api/v4-3/dlm/layout.json` answered 500), and run 38689486418 postgres-18 at 06:16:07.
* That last one is MOD-I383's `reset-my-layout.spec.ts:238` ("leaves other users' layouts
  alone"). The trace shows `Login?userName=staff` redirected to `/p/login`, whose snapshot says
  "Unable to log in . . . Invalid username or password", and the portal log has `Exception
  authenticating the request` with this cause for staff at that second.

Proposed fix (uPortal-core `EntityTypes.java`): remove `key = "#type.Name"`. Spring's default
key generator then takes the `Class` argument as the key. `CLASS_BY_ID` already uses the default.
`Class` is serializable, and the cache's JGroups invalidation sends keys only. A regression test
can evaluate the method's key through Spring's cache interceptor on a fresh JVM, or call
`getEntityIDFromType(IPerson.class)` first in its own test JVM. Any SpEL expression that calls a
method of `Class` on a class whose interfaces declare a method of the same name fails the same
way. Among uPortal's `@Cacheable` and `@CachePut` keys, this is the only one on a `Class`.

## Cause 3: imports of accounts that overlap deadlock on MariaDB

`self-edit-account.spec.ts:256` failed in its `beforeEach`: the import of its new local account
answered 500 (`importXml`, `local-account-utils.ts:43`). The screenshot is blank, since no page
had loaded. The MariaDB portal log has, at 17:41:14,
`DeadlockLoserDataAccessException ... INSERT INTO UP_USER(USER_ID, USER_DFLT_LAY_ID,
NEXT_STRUCT_ID, USER_NAME)` with `1213-40001: Deadlock found when trying to get lock`, from
`UserImporterExporter.importData`.

The workers imported `selfedit-1792086074590-14` and `selfedit-1792086074595-13` within
milliseconds. `importData` runs `UPDATE UP_USER ... WHERE USER_NAME = ?`, and when no row matches,
`INSERT`. `USER_NAME` has the unique index `UPU_USER_NAME`. Under REPEATABLE READ, InnoDB's
`UPDATE` of a missing key takes a gap lock, and both names fall in the same gap, so each `INSERT`
waits for the other transaction's gap lock. PostgreSQL has no gap locks, and the other Playwright
jobs didn't show it.

Proposed fix (uPortal-io, `UserImporterExporter.importData`): run it under READ COMMITTED, as
MOD-I360 did for the layout store, or insert first and update when the key exists. The same
pattern can deadlock a bulk user import on MariaDB or MySQL, since the import runs files of one
type in parallel threads. It belongs with MOD-I382.

## Cause 4: workers imported accounts with the same name

This branch's first Integration run (42455427048, HSQLDB job 128653803621) had one flaky test,
`self-edit-account-component.spec.ts:255`. Its `beforeEach` failed like `:256` on MariaDB: the
import of `selfedit-1794120895472-11` answered 500. Here the portal log has a unique key violation
on `UPU_USER_NAME` 3 ms after it logged `Imported : selfedit-1794120895472-11.user.xml` for
another request, and a session of another test signed in as that user 100 ms later.

`importLocalAccount` (`tests/ux/utils/local-account-utils.ts`) named each account
`<prefix>-<time>-<n>`, where `n` counts the accounts of one worker. `self-edit-account.spec.ts`
and `self-edit-account-component.spec.ts` run on two workers and import one account per test, so
their counts stay in step. When both imported their nth account in the same millisecond, they
asked for the same user, and the second `INSERT` failed.

The fix (`deb4ac860`) adds the worker's index (`test.info().workerIndex`) to the name. Cause 3 is
separate: on MariaDB the two names differed (`-14` and `-13`).

## What isn't attributed

* MOD-I383's local failures (`popular-portlets.spec.ts:226`, `favorites.spec.ts:314`,
  `self-edit-account.spec.ts:270`, and `:238` with riley's `ERR_ABORTED`) and MOD-I387's
  (`portlet-modes.spec.ts` "what is uPortal" and "word of the day", `reset-my-layout.spec.ts:326`)
  came from the landing 1 local matrix, whose reports aren't on this machine. Cause 1 fits `:326`
  (it starts by clicking "Reset Now" as the student). Cause 2 fits a refused sign-in or a render
  that answers 500, such as `portlet-modes`' status check, but without the reports that's a guess.
* In the postgres-16 to postgres-18 pair, `background-preference.spec.ts:124` (a `test-users`
  spec) failed at the student's sign-in with a 500: `DuplicateKeyException` on
  `up_layout_param_pkey` while the portal read the student's layout (17:43:53). Several specs
  sign in as the student in parallel (MOD-I330, MOD-I364). `favorites.spec.ts:272` in the same
  job wasn't looked at.

## Local evidence

Local portal on uPortal-start ports 8980, 8905 and 8987, HSQLDB, uPortal `498252acd` from the
shared `.m2-tip` build, the portal on JDK 11, Playwright 1.64.0 with Chromium 1194
(`executablePath` in an untracked config). The first `portalInit` got 429 from Maven Central at
06:57 UTC. The second, at 07:12, passed.

Command, run from the worktree with `PORTAL_BASE_URL=http://localhost:8980/uPortal/`:

```sh
npx playwright test -c <local config> tests/ux/smoke/reset-my-layout.spec.ts <search spec> \
  --grep "Reset My Layout web component|Reset My Layout in Spanish and French|speaks the user's language" \
  --repeat-each 30 --retries 0 --workers 4
```

| Run | Search spec | Memory available | Result |
| --- | --- | --- | --- |
| Before, 07:17 | the integration tip's (student) | 11062 MB | 17 failed, 223 passed |
| After, 07:28 | this branch's (developer) | 11482 MB | 1 failed, 239 passed |
| After, 07:40, with the Session Timeout language tests | this branch's (developer) | 11997 MB | 2 failed, 298 passed |

* Before: 15 of the 120 reset web component tests failed (`:289` 5 times, `:308` 6, `:326` 2 and
  `:345` 2), all with Spanish or French on the page. Two of the 60 search tests failed too. One
  got a 500 from `PUT /api/v6-0/locale`: two copies saved the student's language at once, and
  `RDBMLocaleStore` hit `DuplicateKeyException` on `UP_USER_LOCALE`. The other didn't find the
  "Personas" tab.
* After: none of the reset web component tests failed for the language. The one failure was
  `browserContext.close: ENOSPC`, when the machine's disk was full.
* After, with `session-timeout.spec.ts --grep "Session timeout warning in"` added, so that 180 of
  the 300 tests sign in as the developer: no locale mix-up and no 500 from the locale API. Two
  developer tests failed. "Session timeout warning in es_ES" didn't see its dialog in the first
  20 s of the run, where each request took about a second. In "speaks fr to a user whose language
  is fr_FR", the developer's Welcome page took 28 s to render. At that moment the portal log has
  the cache key failure of cause 2 in that page's esup-filemanager portlet.
* Cause 4 needs two imports in the same millisecond, and the local runs didn't try to reproduce
  it. The evidence is the CI log above.

## Push runs

First push, uPortal-start `d0a90ccec` (the search fix and this note). Every run built uPortal
`498252acd`, the integration branch, since uPortal has no branch of this name (notice of the
`Build uPortal` jobs).

* Integration 42455427048: failed on one flaky test in the HSQLDB job,
  `self-edit-account-component.spec.ts:255` (cause 4). Playwright postgres-18, HSQLDB with CAS,
  DB harness postgres-18, G-migrate mariadb-11.4 to postgres-18 and Cluster passed. In the
  postgres-18 job, `reset-my-layout.spec.ts` passed on its first run. This push profile doesn't
  run MariaDB Playwright or the postgres-15 and postgres-16 pairs.
* CI 42455427046 and G-index 42455427009 passed.
* HTTP replay 42455427011 failed in "Replay against 5.17" on 12 exchanges that this branch
  doesn't touch. In the health checks, `health-check?detail=ALL` returns
  `Sun, 8 Nov 2026 06:43:24 GMT`, and the replay's `HTTP_DATE` pattern (`tests/replay/lib.mjs`)
  wants a two-digit day, so it fails on days 1 to 9 of every month. The entity type id in
  principal strings came out as `13` where the recording has `14` (`14.admin` against
  `13.admin`). The integration branch's replay 38775913401 passed on 2026-10-15.

Second push, uPortal-start `36279f24e` (adds the account name fix), the same uPortal `498252acd`:

* Integration 42457215984 passed with no flaky test. Its jobs were the Playwright suite on HSQLDB
  (with local login and with CAS) and on postgres-18, the postgres-18 DB harness, G-migrate
  mariadb-11.4 to postgres-18, and Cluster.
* CI 42457216008, G-index 42457216022, Migration equivalence 42457215958 and HTTP replay
  42457215979 passed. HTTP replay skipped "Replay against 5.17", as a topic push does when
  `tests/replay` hasn't changed.

The jobs where the reset and self-edit failures happened (MariaDB Playwright and the postgres-15
and postgres-16 G-migrate pairs) run only in the full matrix, which the coordinator runs when it
merges a batch.

## Proposed LOG rows

| ID | Area | Issue | Status |
| --- | --- | --- | --- |
| MOD-I? | Tests | `search-web-component.spec.ts` saved Spanish and French for the shared student. A spec that signed in as the student meanwhile got Spanish pages: `reset-my-layout.spec.ts:289` and `:308` were flaky in Integration 38775913145 (jobs 116563567668, 116563567769, 116563568282). | **Fixed** (uPortal-start `dd63f3f46`): the language tests sign in as the developer (`notes/retry-flakes.md`). |
| MOD-I? | i18n | `PUT /api/v6-0/locale` answers 500 when two sessions of one user save the language at the same moment: `RDBMLocaleStore.updateUserLocales` deletes, then inserts, and the second insert violates `UP_USER_LOCALE`'s primary key. Seen locally on HSQLDB, once in 60 search tests that shared the student. | **Open**, small. Language tests that share a user can hit it (`notes/retry-flakes.md`). |
| MOD-I? | Security | `EntityTypes.getEntityIDFromType`'s cache key `#type.Name` fails on Spring 5.3 on the first call and after the garbage collector clears an entry of `ClassUtils`' interface method cache: SpEL calls `Principal.getName()` on `IPerson.class`. A sign-in then fails with "Invalid username or password", and a render or REST call answers 500. Spring 4.3 (5.17) doesn't fail. Cause of MOD-I383's `reset-my-layout.spec.ts:238` in run 38689486418. | **Open.** Drop the `key` attribute so the `Class` is the key (`notes/retry-flakes.md`). |
| MOD-I? | Tests | `importLocalAccount` named accounts `<prefix>-<time>-<n>` with a count per worker. The self-edit specs keep their counts in step and could ask for the same user in the same millisecond. The second import answered 500 (unique key on `UPU_USER_NAME`). `self-edit-account-component.spec.ts:255` was flaky in run 42455427048 (job 128653803621). | **Fixed** (uPortal-start `deb4ac860`): the name contains the worker's index (`notes/retry-flakes.md`). |
| MOD-I? | Persistence | Overlapping imports of new users deadlock on MariaDB (1213): `UserImporterExporter.importData` updates, then inserts, under REPEATABLE READ, and InnoDB's gap locks on `UPU_USER_NAME` block both inserts. `self-edit-account.spec.ts:256` was flaky in job 116563567479. | **Open.** Run the import under READ COMMITTED, as MOD-I360 did. Related to MOD-I382. |
