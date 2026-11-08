# Handoff: test-users (specs that change a shared user)

The branch is `ccr-43ba0785-hzlrj5-test-users`, in uPortal-start only. It covers MOD-I378,
MOD-I379, MOD-I380 and the shared-user part of MOD-I385: specs that change what the portal saves
for a user (the layout or the language) while other specs sign in as the same user. It gives each
of those specs a user of its own. It doesn't change uPortal or CalendarPortlet.

## The failures on the tip

uPortal-start Integration 38775913145 on `d1326f514`, which built uPortal `498252acd`:

| Test | Job | What happened |
| --- | --- | --- |
| `visual-resource-server.spec.ts:153` "student home (with portlet thumbnails)" | HSQLDB 116563567542, failed twice, passed on retry 2 | The page was in French. `calendar-portlet: invalid i18n JSON SyntaxError: Bad escaped character in JSON` in the console |
| `favorites.spec.ts:272` "lists a portlet favorited via the Options menu" | G-migrate postgres-16 to postgres-18, 116563567769 | Calendar missing from the Favorites channel right after the test favorited it |
| `background-preference.spec.ts:124` "puts the chosen image behind the page at once" | the same job | `loginViaUrl` as the student got uPortal's error page (HTTP 500) |

### visual-resource-server.spec.ts:153

The screenshot of the failed attempt shows the student's Welcome tab in French ("Bienvenue
Steven Student", "Personnaliser"), with the Calendar's labels in English. The access log of the
job's artifact has `PUT /uPortal/api/v6-0/locale` calls every second from 17:44:07 to 17:44:15,
and the test signed in as the student at 17:44:10. `user-locale.spec.ts` saves French for the
student, and so does `search-web-component.spec.ts` ("speaks the user's language: fr_FR"). The
portal takes the saved language at sign-in, so every spec that signs in as the student during
those tests gets French pages.

In French, CalendarPortlet 2.7.4 breaks: see the proposed LOG row for the product bug. The test
saw the console error and failed. MOD-I379's `user-locale.spec.ts:121` ("keeps the choice at the
next login") has the same cause the other way round: search-web-component.spec.ts sets the
student back to English between the test's two sign-ins.

### background-preference.spec.ts:124

The portal log of the job has, at the time of the 500:

```
uPortal: unhandled exception ... Exception encountered while reading a layout for userId=21,
profileId=64' for URL=/uPortal/Login?userName=student&password=student
Caused by: org.springframework.dao.DuplicateKeyException: ... duplicate key value violates
unique constraint "up_layout_param_pkey"
  at RDBMUserLayoutStore.setUserLayout(RDBMUserLayoutStore.java:1152)
  at RDBMDistributedLayoutStore._getUserLayout(RDBMDistributedLayoutStore.java:1291)
```

A sign-in merges the fragments into the user's layout, and when the merge changes the user's own
part, it saves it (`_getUserLayout`, "Saving PLF due to changes during merge"). In the same
second, `portlet-options.spec.ts` favorited and unfavorited the Calendar as the student
(`POST /api/layout?action=addFavorite&channelId=44` and `removeFavorite`, 17:43:53). Each save
deletes the user's rows in `UP_LAYOUT_STRUCT` and `UP_LAYOUT_PARAM` and inserts them again. On
PostgreSQL two such saves at once collide on the primary key, and the sign-in answers 500. That
part is a uPortal defect: see the proposed LOG row. This branch doesn't change uPortal.

The test's own change, the student's background, isn't the cause. Only this spec reads the
student's background (`portlet-modes.spec.ts` renders the channel as staff). This spec keeps the
student.

### favorites.spec.ts:272

`favorites.spec.ts` favorited the Calendar at 17:43:58 and opened the Favorites channel at 17:44:00.
`GET /api/v6-0/favorites` answered without it. Between 17:43:49 and 17:43:53
`portlet-options.spec.ts` favorited and unfavorited the same Calendar for the same user four
times, and `background-preference.spec.ts` signed in as the student twice. A layout change saved
from a session whose copy of the layout is older than another session's save overwrites that save
(MOD-I364, open). MOD-I380 (3 of 5 rounds with `portlet-options.spec.ts`) and MOD-I379's
`favorites.spec.ts:120` are the same collision.

## Which specs change a user's state

Each row is a spec that changes something the portal saves for a user. "Readers" are the specs
that sign in as the same user in the same run. Playwright runs two spec files in parallel, locally
and on CI, so any of them can overlap. On PostgreSQL each of their sign-ins can also collide with
a layout save (see background-preference above).

| Spec | User | What it changes | Readers in parallel | Decision |
| --- | --- | --- | --- | --- |
| `ux/smoke/user-locale.spec.ts` (signed in) | student | language (French) | every student spec: `visual-resource-server`, `per-role-pages`, `search`, `search-web-component`, `web-components`, `portlet-options`, `favorites`, `background-preference`, `self-edit-account`, `notifications`, `feedback`, `cas-proxy-test`, `groups-manager`, `uportal-auth`, `ux/i18n/pseudo-locales`, `layout/pages`, `api/session-timeout`, `api/popular-portlets-v6-0` | own user |
| `ux/smoke/search-web-component.spec.ts` ("speaks the user's language") | student, and the developer since landing 2 (MOD-I390) | language (Spanish, French) | the student's specs, then the developer's (below) | own user |
| `ux/smoke/favorites.spec.ts` | student | layout (favorites) | the same, and `layout/pages` measures the student's Favorites page | own user |
| `ux/smoke/portlet-options.spec.ts` ("Favorite and unfavorite from the menu") | student | layout (favorites) | the same | own user, for that test |
| `ux/smoke/background-preference.spec.ts` | student (and reads staff) | the background-preference channel's preference | none reads the student's background | keeps the student |
| `ux/admin/groups-manager.spec.ts` | student | membership of a group it creates under Everyone and deletes | no fragment audience or permission names that group | keeps the student |
| `ux/smoke/web-component-channel.spec.ts` | faculty | layout (two Favorites channels on Welcome) | `per-role-pages`, `layout/pages` (measures faculty's tabs), `ux/smoke/session-timeout`, `api/background-preference`, `api/portlet-list` | own user |
| `api/background-preference.spec.ts` | faculty | the background-preference channel's preference | none reads faculty's background | keeps faculty |
| `api/portlet-list.spec.ts` | admin, staff, faculty | portlet lists they own | only this spec reads them | keeps them |
| `ux/smoke/user-locale-component.spec.ts` | staff | language (saves `en_US` only, and the portal refuses `fr_FR` without the token and `xx_YY`) | the portal renders `en_US` without a saved language. The readers get the same pages | keeps staff |
| `ux/portlets/popular-portlets.spec.ts` (retry-flakes) | staff, admin | layout (six portlets on staff's Main Staff Tab, one on admin's Testing tab) | staff: `per-role-pages` (Main Staff Tab portlets), `layout/pages`, `portlet-modes`, `background-preference`, `user-locale-component`, `api/portlet-list`; admin: most admin specs | the other topic's |
| `ux/smoke/session-timeout.spec.ts` (warning in es and fr) | developer | language (Spanish, French) | the other language tests (Reset My Layout UX, the search tests) set their own session's language before they open a page, so they don't see this one's. Their saves can meet, and the locale API then answers 500 (MOD-I391). `api/reset-my-layout` and `pluto-testsuite` check nothing that depends on the language | own user |
| `ux/portlets/pluto-testsuite.spec.ts` (JSR-286 suite) | developer | layout (a tab with two portlets for the length of the describe) | `api/reset-my-layout` resets the developer's layout three times. The Reset My Layout language tests sign in as the developer | open, see below |
| `api/reset-my-layout.spec.ts` (retry-flakes) | developer | layout (adds tabs, resets) | `pluto-testsuite`, the Reset My Layout language tests | the other topic's |
| `ux/smoke/reset-my-layout.spec.ts` (retry-flakes) | riley, developer | riley's layout (reset), the developer's language | riley: none. Developer: `pluto-testsuite` and `api/reset-my-layout`, which check nothing that depends on the language. After this branch it is the only spec that saves the developer's language | the other topic's |
| `ux/portlets/bookmarks.spec.ts` | admin | admin's bookmarks | Bookmarks is on the Welcome fragment, which admins don't get; no other spec opens admin's Bookmarks | keeps admin |
| `ux/admin/permissions-manager.spec.ts` | admin | a permission for admin, removed afterwards | admin is a superuser already | keeps admin |
| `ux/smoke/self-edit-account.spec.ts` (retry-flakes), `self-edit-account-component`, `reset-password`, `forgot-password`, `ux/admin/user-administration` | an account each test imports | attributes, password | none | own users already |
| `ux/i18n/web-components-locale.spec.ts` | `e2e-locale`, which it imports | language | none | own user already |

The guest tests (`rtl-theme`, the guest tests of `user-locale` and `user-locale-component`) change
only their own session.

Some specs change data that isn't a user's: `announcements` (an announcement in Campus Services),
`simple-content` (the content of what-is-uportal, which `portlet-modes.spec.ts` renders),
`portlet-manager`, `import-export` and `pluto-testsuite` (portlet definitions, which
`portlet-modes.spec.ts` lists as expected), and `api/analytics` (statistics that popular portlets
sums). They are outside this topic. MOD-I387 lists `portlet-modes.spec.ts` "what is uPortal" as
passing only on a retry. The retry-flakes topic, which has portlet-modes, may want to check
whether `simple-content` saved new content during that render.

### pluto-testsuite and the developer

`pluto-testsuite.spec.ts` imports its two JSR-286 portlets with the group Portal Developers and
puts them on a tab of the developer's layout. `api/reset-my-layout.spec.ts` resets the developer's
layout after each of its tests, which removes that tab when the two overlap. A user of pluto's
own would have to be a member of Portal Developers. The import can add a member only by replacing
the group's whole list. This branch leaves pluto on the developer. The reset API spec belongs to
the retry-flakes topic, and a user of its own there removes that collision.

The developer stays a user that two specs change the layout of while the Reset My Layout language
tests sign in. On PostgreSQL such a sign-in can get the 500 described above while pluto or the
reset API spec saves the layout. No failure of this kind is in the runs looked at here.

## The fix

`tests/ux/utils/own-users.ts` lists the users of a spec's own: `favorites`, `options`,
`language`, `channel`, `search` and `timeout`. `global-setup.ts` imports each of them once for every worker slot,
named `e2e-<name>-<slot>`, before the first test, and logs each in once, as it does for the
users in `general-config.ts`. A spec calls `ownUser("<name>")` in a hook or test and gets the
account of its worker's slot (`test.info().parallelIndex`). Workers that run in parallel have
different slots and never share an account. That also holds for two copies of a spec
that `--repeat-each` runs on two workers, since Playwright puts the repeat index in the worker
hash. A retry runs in the slot of the worker it replaces and gets the same account, which the
tests set up as they did for the student. The accounts are local accounts in no group, so their
only tab is Welcome (Bookmarks, Calendar, My Drives), which is all these tests use.

The import uses `importNamedAccount()`, which `importLocalAccount()` now calls with its generated
name. global-setup imports the accounts one after another, before any worker starts. The
retry-flakes topic found that imports of new users that overlap deadlock on MariaDB (MOD-I394).
An import in each spec's `beforeAll` would add such overlaps.

This differs from riley (uPortal-start 964c3ea92), a user in the quickstart data. A user in
`data/quickstart` needs the migration equivalence reference recorded again with uPortal 5.17.9,
which needs Maven Central, and new row counts in `intended-changes.txt`. Under `--repeat-each`,
one fixed user per spec would also collide with itself, while the accounts per slot leave the
quickstart data as it is.

| Spec | Now signs in as |
| --- | --- |
| `user-locale.spec.ts`, "signed in" | `e2e-language-<slot>`, Lena |
| `favorites.spec.ts`, both describes | `e2e-favorites-<slot>`, Fay |
| `portlet-options.spec.ts`, "Favorite and unfavorite from the menu send the CSRF token", in a describe of its own | `e2e-options-<slot>`, Olive |
| `web-component-channel.spec.ts` | `e2e-channel-<slot>`, Cora |
| `search-web-component.spec.ts`, the two language tests | `e2e-search-<slot>`, Sol |
| `session-timeout.spec.ts`, the two language tests | `e2e-timeout-<slot>`, Tess |

The people search specs look for "steven", which these names don't contain. The other tests of
these specs still sign in as the student. The integration tip (`a0a125fee`, landing 2) has no
user with these names.

## A second cause in user-locale.spec.ts

The local runs below found a cause of their own in `user-locale.spec.ts`. The language component
saves the choice on Update and then reloads the page (`window.location.reload()` in uPortal's
`up-user-locale.ts`), also when the language stays the same. `chooseLanguage()` returned once the
old page had no portal request in flight. `chooseEnglish()` then found the page in English
already, so the next `page.goto` (the test's selector page, or the sign-out in `afterEach`) started
during the reload, and one of the two navigations ended with `net::ERR_ABORTED`. A trace of a
failed test shows the `PUT /api/v6-0/locale` at 45.242 s, the test's goto at 45.312 s and the
reload's request cancelled at 45.346 s. The commit "wait for the reload after update in the user
locale spec" makes `chooseLanguage()` wait for the page's `load` event after Update.

## Evidence

### Local runs

One portal, uPortal `498252acd` (5.17.10-SNAPSHOT from `/home/user/wt/.m2-tip`) with this branch's
uPortal-start on HSQLDB, ports 8680, 8605 and 8687, JDK 11 for the portal. Chromium 1194, two
workers, `--retries=0`, 9.3 to 13.1 GB of memory available. "Before" ran the tip's specs
(`d1326f514`, a separate worktree) and "after" this branch's, against the same portal.

| Set | Before (tip) | After |
| --- | --- | --- |
| `favorites`, `portlet-options`, `background-preference`, `--repeat-each=5` | 4 failed of 150. `favorites.spec.ts:120` once (the Calendar was still a favorite after the remove). `background-preference.spec.ts` three times (`net::ERR_ABORTED` at the student's sign-in once, and twice its `afterEach` ran out of time after slow sign-ins) | 0 of 150 (`4a57deb8b`) |
| `user-locale` and the student home test of `visual-resource-server`, `--repeat-each=10` | 5 failed of 50, all in `user-locale.spec.ts`. Twice `:121` found English after the sign-in (MOD-I379), three times `net::ERR_ABORTED` | With the own user only (`4a57deb8b`): 9 of 50, all `net::ERR_ABORTED`. With the reload wait (`5a336dbc8`): 1 of 100 in two runs, and `user-locale.spec.ts` 0 of 80 |
| `web-component-channel` and `per-role-pages`, `--repeat-each=5` | 0 of 110 | 0 of 110 |

The one failure after the reload wait was the student home test, the first test after Tomcat
started again. The waffle menu's `fetch` failed while the test left the landing page for the next
one, and the menu logged `TypeError: Failed to fetch`. That has nothing to do with the language,
and the next 99 tests passed.

The student home test passed in the 10 copies before the fix. Locally the French windows of
`user-locale.spec.ts` didn't overlap with it. HSQLDB doesn't show the PostgreSQL 500 at sign-in.

### Push runs

The first push, head `4a57deb8b`, built uPortal `ccr-43ba0785-hzlrj5` at `498252acd` (the
`uPortal under test` annotation of job 128655388564: uPortal has no branch of this name):

| Run | Result |
| --- | --- |
| Integration 42456118686 | Playwright HSQLDB: 510 passed (job 128655530879). Playwright PostgreSQL 18: 509 passed, 1 flaky, `reset-my-layout.spec.ts:289` (job 128655530826). DB harness PostgreSQL 18, G-migrate MariaDB 11.4 to PostgreSQL 18, CAS and Cluster passed |
| CI 42456118596 | passed |
| G-index 42456118687 | passed |
| Migration equivalence 42456118622 | passed |
| HTTP replay 42456118615 | failed, see below |

The PostgreSQL 18 flake is MOD-I390 from retry-flakes, which that push didn't include: the artifact's
access log has `PUT /api/v6-0/locale` and `GET /p/search/max?query=zzqxjv` at 07:08:23
(`search-web-component.spec.ts`, "speaks the user's language: es_ES", still as the student here),
and the student's sign-in of the failed test in the same second, with `locale="es-ES"` on the
element. Landing 2 moved those tests off the student, and this branch has it since the merge.

The HTTP replay failed with the same 10 differences on the retry-flakes (42455427011) and admin-390
(42455714380) branches today. The integration branch's replay passed on 2026-10-15 (38775913401).
The health check's `Current Time` reads `Sun, 8 Nov 2026 06:51:47 GMT` with a one-digit day, which
the reference's `{http-date}` mask doesn't match. Admin's principal string reads `13.admin`, and
5.17 had `14.admin`. This branch doesn't change portal code or data, and the cause is outside it.

`npm run lint` passes. Type coverage is 100 %, and ESLint reports nothing in the changed files.

## Proposed LOG rows

| ID | Area | Issue | Status |
| --- | --- | --- | --- |
| MOD-I? | Portlets | **French users get the Calendar without its labels and a script error.** CalendarPortlet 2.7.4's `calendarNarrowView.jsp` writes the labels of `<calendar-portlet>` as JSON in a `<script type="application/json">`, each with `<spring:message javaScriptEscape='true'/>`. Spring's JavaScript escaping writes an apostrophe as `\'`, which JSON doesn't allow. `messages_fr.properties` has `view.more.events=Voir plus d'évènements`, so for a user whose language is French `JSON.parse` fails at that label: the console shows `calendar-portlet: invalid i18n JSON SyntaxError: Bad escaped character in JSON`, and the element falls back to its English labels. Every French user gets it on every page with the Calendar in narrow view, such as Welcome. `calendarWideView.jsp` has the same pattern, but none of its French labels has an apostrophe today. Found by `visual-resource-server.spec.ts:153` (HSQLDB job 116563567542), when `user-locale.spec.ts` had the shared student in French. Since this topic's test users, no spec puts a shared user in French, and the suite doesn't see it. | **Open**, the owner's choice. (1) An overlay in uPortal-start. `overlays/CalendarPortlet/src/main/resources/i18n/messages_fr.properties` with `’` (U+2019) in place of the apostrophe fixes today's text only. Replacement JSPs that write the labels with JSON escaping fix any label. (2) A CalendarPortlet release that writes the JSON with a JSON encoder. Whether one after 2.7.4 exists couldn't be checked here, since Maven Central answers 429. (3) An upstream report to the CalendarPortlet project with the cause and the JSP lines. A Playwright test that signs in as a French user of its own, opens Welcome and expects an empty console would show the fix. |
| MOD-I? | Layout | **A sign-in answers 500 on PostgreSQL when another session of the same user saves the layout at the same moment.** A sign-in saves the user's layout when the fragment merge changed it (`RDBMDistributedLayoutStore._getUserLayout`). `RDBMUserLayoutStore.setUserLayout` deletes the user's `UP_LAYOUT_STRUCT` and `UP_LAYOUT_PARAM` rows and inserts them again, so two saves at once fail with `duplicate key value violates unique constraint "up_layout_param_pkey"`, and the user gets the error page. Seen in G-migrate job 116563567769 (postgres-16 to postgres-18) at `Login?userName=student` while `portlet-options.spec.ts` favorited and unfavorited as the student. A user with two devices or tabs can hit it. Related to MOD-I330 (unique-key conflicts on `UP_LAYOUT_PARAM`), MOD-I360 (the same saves on MariaDB) and MOD-I364 (an older copy overwrites a newer save). | **Open** (uPortal). The test users of this topic keep the suite's layout changes off shared users, so the suite no longer hits it. |
| MOD-I? | Tests | Specs changed a shared user's language or layout while other specs signed in as that user: `user-locale.spec.ts` (the student's language), `favorites.spec.ts` and `portlet-options.spec.ts` (the student's layout), `web-component-channel.spec.ts` (faculty's layout), and the language tests of `search-web-component.spec.ts` and `session-timeout.spec.ts`, which saved the developer's language next to each other (MOD-I391). Behind MOD-I378, MOD-I379, MOD-I380 and the shared-user part of MOD-I385. | **Fixed** (uPortal-start, `ccr-43ba0785-hzlrj5-test-users`): global-setup imports an account per spec and worker slot, and those specs sign in as it (`notes/test-users.md`). Open: `pluto-testsuite.spec.ts` and `api/reset-my-layout.spec.ts` both change the developer's layout. |
| MOD-I? | Tests | `user-locale.spec.ts` opened the next page while the language component reloaded the page after Update, also when the language stayed the same, and the page load ended with `net::ERR_ABORTED`: 3 of 50 tests on the tip and 9 of 50 with the spec's own user in local runs. | **Fixed** (uPortal-start, `ccr-43ba0785-hzlrj5-test-users`): `chooseLanguage()` waits for the reloaded page. 0 of 80 locally afterwards. |

## Next step

Read the push runs of the second push (head with the reload wait) and add them here.
