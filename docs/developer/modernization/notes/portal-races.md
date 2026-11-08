# Portal races on the red tip (MOD-I391, MOD-I392, MOD-I394)

Branch `ccr-43ba0785-hzlrj5-portal-races` in uPortal and in uPortal-start. uPortal has the three
fixes, one commit each, on the integration tip `1d485034e`, and three commits from the review. uPortal-start has only this note, on
`a0a125fee`. Its push runs build the uPortal branch of the same name, so the Integration run
tests the fixes in the portal.

| Item | Cause | Fix (uPortal) | Test |
| --- | --- | --- | --- |
| MOD-I392 | `EntityTypes.getEntityIDFromType` cached under the SpEL key `#type.Name`. Spring 5.3's SpEL calls `Principal.getName()` on `IPerson.class` whenever the interface method cache of `ClassUtils` misses | `fix(core): key the entity type id cache by the class` | `EntityTypesCacheTest` (uPortal-core) |
| MOD-I394 | `UserImporterExporter.importData` updates, then inserts, under REPEATABLE READ. InnoDB's gap locks on `UPU_USER_NAME` deadlock two imports of new names | `fix(io): import users under read committed` | `UserImporterExporterConcurrencyTest` (uPortal-webapp) |
| MOD-I391 | `RDBMLocaleStore.updateUserLocales` deletes, then inserts. Saves of one user that both delete before either inserts collide | `fix(i18n): save one user's language from two sessions in turn` | `RDBMLocaleStoreConcurrencyTest` (uPortal-webapp) |
| Item 4, not fixed | `RDBMUserLayoutStore.setUserLayout` has the same delete-then-insert race as MOD-I391. On PostgreSQL the second save fails on `up_layout_param_pkey` | Proposed below | Reproduced locally, not committed |

Apart from the 500s that go away, the portal sends the same responses as before. Neither the
replay registry nor the specs change.

## MOD-I392: the cache key of the entity type ids

`EntityTypes.getEntityIDFromType(Class)` had `@Cacheable(cacheNames = "...ID_BY_CLASS", key =
"#type.Name")`. Spring's cache interceptor evaluates the key on every call, with a new evaluation
context each time. For `#type.Name`, SpEL's `ReflectivePropertyAccessor` finds `Class.getName()`
and passes it through `ClassUtils.getInterfaceMethodIfPossible(method, IPerson.class)`. That
method looks the getter up in `ClassUtils.interfaceMethodCache`. When the cache returns the very
`Method` object it was given, which happens on a miss, it searches the interfaces of
`IPerson.class` and returns `Principal.getName()`. SpEL calls that on the `Class` object, and
Java throws `IllegalArgumentException: object is not an instance of declaring class`. The cache
holds soft references. It misses on the first call in a JVM and again after the garbage
collector clears the entry.

Evidence:

* The standalone program of the retry-flakes branch
  (`scratchpad/retry/spel/src/Repro.java`), run here again on Java 11: with the Spring 5.3.39
  jars, the first evaluation fails with the portal's exception, the next ones work, and the
  first one after the cache is emptied fails again. With Spring 4.3.30 (the 5.17 release) every
  evaluation works, and `ClassUtils` has no such cache.
* The portal logs of uPortal-start Integration run 38775913145 (artifacts downloaded to
  `/home/user/wt/uPortal-races-ci/keep`): the MariaDB 12.3 Playwright job has the failure once,
  at 17:29:12 in the guest login of `global-setup.ts`. The postgres-16 to postgres-18 G-migrate
  job has it at 17:34:22 (guest login) and at 17:45:29 (a request that answered 500). The stack
  runs from `Authentication.authenticate` through `PortalEventFactoryImpl.publishLoginEvent`,
  `GroupService.getGroupMember` and `RDBMEntityStore.newInstance` to the cache proxy of
  `EntityTypes.getEntityIDFromType`.
* `EntityTypesCacheTest` builds `EntityTypes` behind Spring's cache proxy (`@EnableCaching`
  with a `ConcurrentMapCacheManager`), empties the interface method cache through reflection, and
  calls `getEntityIDFromType(IPerson.class)`. On the old key it failed with
  `SpelEvaluationException` EL1021E caused by `IllegalArgumentException: object is not an
  instance of declaring class`. On the new code both of its tests pass, and so do the 85 tests
  of uPortal-core.

The landing 2 tip run, Integration 42463431999 (uPortal `1d485034e`, uPortal-start
`a0a125fee`), had three tests that passed only on a retry. Their portal logs have the same
exception, each at the request the test saw fail, after the first one at the guest login of
`global-setup.ts`:

| Job | Test | Request that failed, portal log |
| --- | --- | --- |
| 128678268222, G-migrate postgres-15 to MariaDB 12.3 | `portlet-modes.spec.ts:330`, word-of-the-day "help, maximised" (a 500) | 08:58:26, `/p/word-of-the-day.ctf2/max/render.uP?pCm=help`: the theme's `XalanAuthorizationHelperBean.hasPermission` calls `GroupService.getEntity`, then the cache proxy of `getEntityIDFromType` |
| 128678268220, G-migrate postgres-16 to postgres-18 | `portlet-modes.spec.ts:330`, whos-online "config, maximised" (console errors) | 08:54:38, `/api/v5-1/userinfo` answered 500 from `IdTokenFactory.createUserInfo` through `GroupService.getGroupMember`. The console error the test reported is that 500 |
| 128678268241, Playwright HSQLDB | `per-role-pages.spec.ts:38`, "Testing tab has test portlets" (element not found) | 08:55:42, `/f/testing/normal/render.uP`: the same theme permission check, and the tab didn't render |

The fix explains all three. The second test that passed only on a retry in the postgres-16 to
postgres-18 job, `user-locale.spec.ts:82` (`page.goto: net::ERR_ABORTED` on
`/p/user-locales-selector`, then on `/Logout`), has no matching error in the portal log and
isn't explained by these fixes. The MariaDB pair's other one, `visual-resource-server.spec.ts:153`,
is MOD-I378.

The fix removes the `key` attribute. Spring's default key generator then uses the `Class`
argument itself, as `CLASS_BY_ID` already does with its `Integer`. `deleteEntityType` evicts all
entries of the three caches, which doesn't depend on the key, and no other code reads or evicts
`ID_BY_CLASS`. The cache replicates by invalidation over JGroups, which sends the key, and a
`Class` is serializable. During a rolling upgrade, a 6.0 node and an older node send keys of
different types, and an invalidation from one doesn't remove the other's entry. Entity type ids
don't change after `dataInit`, and the entries expire after 8 hours.

The search for the same fault covered every `@Cacheable`, `@CachePut` and `@CacheEvict` key in
uPortal, the `#{...}` expressions in the Spring XML, the `@PreAuthorize`, `@PostAuthorize` and
`@PostFilter` expressions, the expressions of the Web Flow definitions and the SpEL services'
callers. The other keys and expressions read properties of objects (`#person.ID`,
`authentication.name`), where the interface method belongs to the object's own class and works,
or static fields through `T(...)`, which SpEL reads as fields. None reads a property of a
`Class` object or calls one of its methods. `EntityTypes` was the only instance.

## MOD-I394: imports of new users deadlock on MariaDB

`importData` runs `UPDATE UP_USER ... WHERE USER_NAME = ?`, and when no row matched,
`INSERT INTO UP_USER`. Under REPEATABLE READ, InnoDB's default, the update of a name that isn't
there locks the gap of the unique index `UPU_USER_NAME` where it would go. A second import of
another new name in the same gap gets the same lock, since gap locks don't conflict with each
other. Each insert then waits for the other import's gap lock, and InnoDB rolls one import back
with error 1213.

Evidence:

* Job 116563567479 (Playwright on MariaDB 12.3) of run 38775913145: the portal log has
  `DeadlockLoserDataAccessException` on `INSERT INTO UP_USER(USER_ID, USER_DFLT_LAY_ID,
  NEXT_STRUCT_ID, USER_NAME)` with `1213-40001: Deadlock found when trying to get lock` at
  17:41:14, in the `/api/import` request of `self-edit-account.spec.ts:256`'s `beforeEach`.
* `UserImporterExporterConcurrencyTest` builds the importer behind the portal's transaction
  advisor (`sharedJpaTestContext.xml`) with a mocked counter store, which the import calls
  between its update and its insert. The test stops import A there, lets import B reach the same
  point, then lets A go on. Both names fall between two existing users.

| Database | Old code | New code |
| --- | --- | --- |
| MariaDB 10.11.14, local | fails: `DeadlockLoserDataAccessException` on `INSERT INTO UP_USER`, 1213 | passes |
| PostgreSQL 16, local | not run (no gap locks) | passes |
| HSQLDB with MVCC transactions | passes | passes |

The fix runs `importData` under READ COMMITTED (`@Transactional(isolation =
Isolation.READ_COMMITTED)`), as MOD-I360 and MOD-I362 did for the layout store and the counter
store. InnoDB then takes no gap lock for the update. The import has no outer transaction in the
portal, `/api/import` and the batch import alike. One that joins an outer transaction keeps the
outer one's isolation.

## MOD-I391: two saves of one user's language

`updateUserLocales` deletes the user's rows in `UP_USER_LOCALE` and inserts the new ones. Two
sessions of one user that save at once can both delete before either inserts. With the same
locale twice, the second insert violates the primary key `(USER_ID, LOCALE)`, and
`PUT /api/v6-0/locale` answers 500. With two different locales, PostgreSQL keeps both rows, and
the user's language is the first in alphabetical order, not the one saved last.

The fix locks the user's `UP_USER` row first, with an update that sets `USER_DFLT_LAY_ID` to its
own value. A second save of the same user waits there until the first commits, then deletes the
rows the first one wrote and inserts its own. The store's transactions also run under READ
COMMITTED, as the layout store's do. The second save then reads the committed rows whatever
isolation the database defaults to. `RDBMUserIdentityStore.removePortalUID` deletes `UP_USER`
before `UP_USER_LOCALE`, the same order, and no caller of `updateUserLocales` runs inside an
outer transaction.

`RDBMLocaleStoreConcurrencyTest` stops save A before its insert and starts save B. After B has
had two seconds to finish, A goes on. B is the later save.

| Test | Database | Old code | New code |
| --- | --- | --- | --- |
| `testSameLocaleSavedTwiceAtOnce` | HSQLDB, MVCC | fails: `DuplicateKeyException` on the primary key of `UP_USER_LOCALE` | passes |
| `testSameLocaleSavedTwiceAtOnce` | PostgreSQL 16 | fails: duplicate key on `up_user_locale_pkey` | passes |
| `testSameLocaleSavedTwiceAtOnce` | MariaDB 10.11 | fails: deadlock 1213 | passes |
| `testLaterSaveReplacesTheEarlierOne` | HSQLDB, MVCC | passes | passes |
| `testLaterSaveReplacesTheEarlierOne` | PostgreSQL 16 | fails: `[es_ES, fr_FR]` where `[es_ES]` was expected | passes |
| `testLaterSaveReplacesTheEarlierOne` | MariaDB 10.11 | passes | passes |

On MariaDB 10.11 with `innodb_snapshot_isolation=ON` (the default from 11.6), two `mariadb`
client sessions that run the new statements showed that the lock alone works under REPEATABLE
READ as well. READ COMMITTED keeps the result independent of when MariaDB opens a read view.

`@CachePut` on `updateUserLocales` writes the locale cache after the commit. A save that commits
second writes the cache second as well, unless its thread is delayed for longer than the second
save's statements take, and the fix leaves that as it was.

## Review follow-ups

The oss-review of `d14ccded9` found nothing blocking. These commits answer its findings:

* `test(io): check that the user import runs under read committed`. The import test passed on
  HSQLDB with or without READ COMMITTED, and default CI runs only HSQLDB. Its connections now
  default to SERIALIZABLE, and the mocked counter store reads the isolation of the connection
  bound to each import's transaction. With the isolation removed from `importData`, the test fails
  on HSQLDB with `expected:<[2, 2]> but was:<[8, 8]>`.
* `test(i18n): check that locale saves run under read committed`. The locale test now records the
  isolation of every statement's connection under the same SERIALIZABLE default. With the READ
  COMMITTED line removed from `RDBMLocaleStore`, the two concurrency tests fail on HSQLDB with a
  serialization failure of save B, and `testUserWithoutUserRowStillSaves` fails with
  `expected:<2> but was:<8>`.
* `fix(i18n): warn when a locale save finds no user row to lock`. A session whose user id has no
  `UP_USER` row, such as after `DistributedLayoutManager` recreates a user for a corrupted layout
  or after the shell's `deleteUser`, has no row to lock. The store now logs a warning and saves as
  before. `testUserWithoutUserRowStillSaves` covers that save.

uPortal-webapp's 469 tests pass on HSQLDB. `spotlessCheck` and `spotbugsMain` pass, and
`check-freeze-store.py` reports that no rule grew.

## Item 4: background-preference.spec.ts:124 on postgres-16 to postgres-18

In job 116563567769 of run 38775913145, `background-preference.spec.ts:124` failed at the
student's sign-in with a 500 at 17:43:53. The portal log has `DuplicateKeyException` on
`up_layout_param_pkey`, key `(21, 1, 22, dlm:origin)`, from `RDBMUserLayoutStore.setUserLayout`,
called by `RDBMDistributedLayoutStore._getUserLayout` (the save of the merged layout) during
`DistributedLayoutManager.afterPropertiesSet`. The student's request threads `exec-1`, `exec-3`
and `exec-10` were active in those two seconds.

`setUserLayout` deletes the user's `UP_LAYOUT_PARAM` and `UP_LAYOUT_STRUCT` rows and inserts the
new layout, the same pattern as MOD-I391. On PostgreSQL under READ COMMITTED, save B's delete
waits for the rows save A deleted. When A commits, B skips those rows and doesn't see the rows A
inserted, since they aren't in B's snapshot. B's insert of the same keys then fails. It is the
PostgreSQL side of the overlap that MOD-I360 fixed for MariaDB. MOD-I360's
`testLayoutSavedBetweenReadAndWrite` lets B commit before A deletes, and it doesn't cover a delete
that starts before the other save commits. MOD-I363 (stale reloads, fixed) and MOD-I364 (whole
layout copies that overwrite another session's save, open) are about which layout remains. Here
the second save fails.

A temporary test in `RDBMUserLayoutStoreConcurrencyTest`, not committed, stopped save A before
its first insert while save B ran in a thread. On a local PostgreSQL 16, B failed with
`DuplicateKeyException ... up_layout_param_pkey`, the CI error. On HSQLDB with MVCC it passed.

Proposed fix: the same lock as MOD-I391, an update of the user's `UP_USER` row at the start of
`setUserLayout`'s transaction. The layout store already runs under READ COMMITTED. It isn't in
this branch, for two reasons:

* `testLayoutSavedBetweenReadAndWrite` stops A after its first read and runs B on the test
  thread. With the lock, B waits for A, and A waits for the test thread. That test has to run B
  in a thread of its own, which changes MOD-I360's test.
* All saves of a user, sign-ins included, then wait for each other. `importLayout` and the
  `channelsAdded` saves already update `UP_USER` inside the same transaction, and no caller
  wraps `setUserLayout` in an outer transaction that later calls the `REQUIRES_NEW`
  `getNextStructId`. A second reader should check that review before the sign-in path changes.

## Commands

The uPortal worktree is `/home/user/wt/uPortal-races`. Gradle runs on JDK 21 with
`--offline --no-daemon`. The local databases ran on port 8187, which this topic was given for
HSQLDB, one at a time and while no portal ran: MariaDB 10.11.14 from Ubuntu's packages, extracted
without installing (`dpkg -x`) and started with `--innodb-snapshot-isolation=ON`, then the
system's PostgreSQL 16 with a data directory of its own. Both are stopped and their files
removed.

```sh
./gradlew --offline --no-daemon :uPortal-webapp:test --rerun \
  -Duportal.test.db.driver=org.mariadb.jdbc.Driver \
  "-Duportal.test.db.url=jdbc:mariadb://127.0.0.1:8187/uportal?useMysqlMetadata=true" \
  -Duportal.test.db.username=uportal -Duportal.test.db.password=uportal \
  --tests org.apereo.portal.io.xml.user.UserImporterExporterConcurrencyTest \
  --tests org.apereo.portal.i18n.RDBMLocaleStoreConcurrencyTest
```

For the old code, the main source file of each fix was restored from the integration tip, and
the tests were run again.

## Runs

The first push, uPortal `d14ccded9` and uPortal-start `bef518c67`, met an outage of the Gradle
distribution download on GitHub's runners from 08:47 UTC on 2026-11-08: the Gradle wrapper of
uPortal and of uPortal-start timed out after 10 s on `services.gradle.org`, and Vale's download
from GitHub releases answered 504. Every failed job below stopped at one of those downloads,
before any test ran. Each run was started again at 08:50 and at 09:30, and the uPortal runs
and the Integration run a last time at 10:13, when other branches' downloads worked again for a
while.

| Run | Attempts | Result |
| --- | --- | --- |
| uPortal CI 42464372528 | 4 | the build job and Commit messages failed on the downloads in each attempt. Prose (Vale) passed |
| uPortal DB copy tool 42464372525 | 2 | passed |
| uPortal DB integration 42464377318, started by hand | 4 | uPortal-webapp's tests, the three new ones included, passed on MySQL 9.7 in attempt 2 and on PostgreSQL 18 in attempt 4, with 468 tests and no failure in each. MariaDB 12.3, SQL Server 2025 and Oracle 23 failed on the Gradle download in every attempt |
| uPortal-start Integration 42464381026 | 4 | Build uPortal built uPortal `d14ccded9` from this branch (notice of the job), and Cluster passed. The Playwright, DB harness and G-migrate jobs failed on the Gradle download in every attempt |
| uPortal-start CI 42464381060, HTTP replay 42464381028, Migration equivalence 42464381035, G-index 42464381063 | 2 or 3 | failed on the downloads |

The G-index job of attempt 2 also showed that `tests/db/gindex/gindex.sh` reports "deploy and
dataInit ... ok" when that phase's Gradle run failed. Its `deploy.log` ends with the download
timeout, and the next phase failed on the missing Tomcat.

The downloads worked again by 10:49. The second push, uPortal `285e7a7bc` with the review
commits and uPortal-start with this note, started new runs, and DB integration 42473494660 was
started by hand on uPortal `285e7a7bc`.

| Run | Attempts | Result |
| --- | --- | --- |
| uPortal CI 42473478227 | 1 | passed |
| uPortal DB integration 42473494660, started by hand | 1 | passed. uPortal-webapp's 469 tests, the new ones included, pass on PostgreSQL 18, MariaDB 12.3, MySQL 9.7, SQL Server 2025 and Oracle 23. The canaries for MySQL 26 and PostgreSQL 19 passed, and the one for MariaDB 13 failed on the Gradle download. The push run 42473478229 was cancelled by this one, as they share a group |
| uPortal DB copy tool 42473478292 | 2 | passed. Attempt 1 failed on the Gradle download |
| uPortal-start Integration 42473540480 | 2 | passed. Build uPortal built uPortal `285e7a7bc` from this branch (notice of the job). Playwright on HSQLDB and on postgres-18 passed 512 tests each, with no test that passed only on a retry. Playwright with CAS, the postgres-18 DB harness and Cluster passed in attempt 1. G-migrate mariadb-11.4 to postgres-18 failed on the Gradle download in attempt 1 and passed in attempt 2 |
| uPortal-start CI 42473540558 | 1 | passed |
| uPortal-start HTTP replay 42473540536 | 1 | passed. "Replay against 5.17" was skipped, as on every topic push that doesn't change `tests/replay`. Apart from the 500s, the fixes leave every response as it was |
| uPortal-start Migration equivalence 42473540463 | 2 | passed. Attempt 1 failed on the Gradle download |
| uPortal-start G-index 42473540482 | 2 | passed. Attempt 1 failed on the Gradle download |

The MariaDB Playwright job and the postgres-15 and postgres-16 G-migrate pairs, where the red
tip's failures were, run only in the full matrix of a batch.

## Proposed LOG rows

The coordinator gave MOD-I391, MOD-I392 and MOD-I394 at landing 2. These rows replace their
"Open" resolutions. Item 4 needs a new number.

| ID | Area | Issue | Status |
| --- | --- | --- | --- |
| MOD-I391 | i18n | `PUT /api/v6-0/locale` answers 500 when two sessions of one user save the language at the same moment: `RDBMLocaleStore.updateUserLocales` deletes, then inserts, and the second insert violates `UP_USER_LOCALE`'s primary key. With two different locales PostgreSQL keeps both rows. | **Fixed** (uPortal `fix(i18n): save one user's language from two sessions in turn`): a save locks the user's `UP_USER` row first and runs under READ COMMITTED. `RDBMLocaleStoreConcurrencyTest` fails on the old code on HSQLDB, PostgreSQL 16 and MariaDB 10.11, and on HSQLDB without the READ COMMITTED line. A user id without an `UP_USER` row logs a warning and saves as before (`notes/portal-races.md`). |
| MOD-I392 | Security | `EntityTypes.getEntityIDFromType`'s cache key `#type.Name` fails on Spring 5.3 on the first call and after the garbage collector clears an entry of `ClassUtils`' interface method cache: SpEL calls `Principal.getName()` on `IPerson.class`. A sign-in then fails with "Invalid username or password", and a render or REST call answers 500. Cause of MOD-I383's `reset-my-layout.spec.ts:238`, and of the three tests that passed only on a retry in landing 2's tip run 42463431999 (jobs 128678268222, 128678268220, 128678268241). | **Fixed** (uPortal `fix(core): key the entity type id cache by the class`): the `Class` is the key. `EntityTypesCacheTest` fails on the old key. No other key or expression in uPortal has the fault. |
| MOD-I394 | Persistence | Overlapping imports of new users deadlock on MariaDB (1213): `UserImporterExporter.importData` updates, then inserts, under REPEATABLE READ, and InnoDB's gap locks on `UPU_USER_NAME` block both inserts. `self-edit-account.spec.ts:256` was flaky in job 116563567479. | **Fixed** (uPortal `fix(io): import users under read committed`): the import runs under READ COMMITTED. `UserImporterExporterConcurrencyTest` fails on the old code on MariaDB 10.11 with 1213, and on every database, HSQLDB included, when the import doesn't ask for READ COMMITTED. |
| MOD-I399 | Layout | Saves of one user's layout that overlap fail on PostgreSQL with `DuplicateKeyException` on `up_layout_param_pkey`: `setUserLayout` deletes, then inserts, and the second save's delete doesn't see the rows the first one committed. Parallel sign-ins of one user each save the merged layout. `background-preference.spec.ts:124` failed at the student's sign-in in job 116563567769 (run 38775913145). Reproduced on a local PostgreSQL 16. | **Open.** Lock the user's `UP_USER` row at the start of the save, as MOD-I391 does. MOD-I360's test needs to run its second save in a thread (`notes/portal-races.md`). |
