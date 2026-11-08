# Handoff: portlet-modes-flake (NewsReader renders of one user at once)

The branch is `ccr-43ba0785-hzlrj5-portlet-modes-flake`, in uPortal-start only, from
`origin/ccr-43ba0785-hzlrj5` at `88542e157`. uPortal tip under test: `2cdbc62e5`. It doesn't change
uPortal or NewsReaderPortlet.

## The failure on the tip

uPortal-start Integration 42507870441 on `88542e157`, started manually, failed one job, G-migrate:
postgres-15 to mariadb-12.3 (job 128815050922). The target suite ran 514 tests on 2 workers. 504
passed, 9 were skipped, and `portlet-modes.spec.ts:330` ("movie-news: edit, help, view", step
"edit, maximised") passed only on its retry. `failOnFlakyTests` counts that as a failure. The first
attempt found uPortal's error portlet in the `movie-news` wrapper.

## Cause

Both workers rendered NewsReader portlets as staff in the same second, and NewsReaderPortlet 5.1.5
fails when one user's sessions do that.

* The spec runs its tests on both workers (`mode: "parallel"`, MOD-I341). Each test renders one
  portlet in its modes, and `userFor()` signed in as staff for every portlet of Everyone. The 13
  NewsReader portlets are such portlets, and they are next to each other in the alphabetical list.
  So both workers often rendered a NewsReader portlet as staff at once.
* The access log of the job's artifact has, at 18:23:15, both workers' renders in the same second:
  `GET /uPortal/p/motley-fool/max/render.uP?pCm=edit` and `GET /uPortal/p/movie-news/max/render.uP?pCm=edit`.
  The sign-ins just before them were all `Login?userName=staff`.
* `NewsReaderPortlet.log` of the same artifact, at 18:23:15,964 on thread
  `uP-PortletExec-176-staff-RENDER-[movie-news]`:

  ```
  HibernateSystemException: Illegal attempt to associate a collection with two open sessions
    at org.springframework.orm.hibernate3.HibernateTemplate.saveOrUpdate
    at org.jasig.portlet.newsreader.dao.HibernateNewsStore.storeNewsSet(HibernateNewsStore.java:378)
    at org.jasig.portlet.newsreader.service.SharedNewsSetServiceImpl.getNewsSet(SharedNewsSetServiceImpl.java:130)
    at org.jasig.portlet.newsreader.mvc.portlet.reader.EditNewsPreferencesController.showPreferencesView(EditNewsPreferencesController.java:129)
  Caused by: org.hibernate.HibernateException: Illegal attempt to associate a collection with two open sessions
    at org.hibernate.collection.AbstractPersistentCollection.setCurrentSession
    at org.hibernate.event.def.OnUpdateVisitor.processCollection
    at org.hibernate.event.def.DefaultSaveOrUpdateEventListener.entityIsDetached
  ```

  The motley-fool render in the same second passed. No cascade frame sits between `saveOrUpdate` and
  the failing collection, so the detached entity that both sessions saved is the news set itself.
* The bytecode of NewsReaderPortlet 5.1.5 (`javap` on the WAR in the Gradle cache) shows why two
  portlets share it. `EditNewsPreferencesController.showPreferencesView` asks for the set named by
  the portlet preference `newsSetName`, default `default`. No quickstart portlet definition sets
  it, so every NewsReader portlet of a user uses the set `default`, and each one shows its own feed
  through `Whitelist.regexValues`. `SharedNewsSetServiceImpl.getNewsSet` reads the set through
  `HibernateNewsStore.getNewsSet(userId, name)`, which is `@Cacheable("HibernateNewsStore.newsSetByUserAndName")`.
  It then calls `initNews` and `storeNewsSet` on every request. The cache returns the same Java
  object to every caller, and the method locks only the portlet session's mutex, so the sessions of
  two browsers aren't serialized. Both requests call `saveOrUpdate` on one detached object in their
  own Hibernate sessions, and the second fails while the first is still open.

The other lines in the job's "Exceptions after SEVERE lines" section are unrelated to this test.
The `ConstraintViolationException: could not execute batch` (18:17:16, `portal.log`) is
`PortletListRESTController` refusing a duplicate list name for admin, which the portlet list API
test asks for. The `NoHandlerFoundException` for mode `edit` (18:23:52) is `portlet-cas-test` in
edit mode, an expected render in `EXCEPTIONS` (MOD-I158).

MOD-I387 lists two earlier retry-only tests of this spec on the same pair. "word of the day" is a
NewsReader portlet and fits this cause. No log of that run was checked here. "what is uPortal" is a
SimpleContentPortlet, and this cause doesn't explain it.

## Fix

`portlet-modes.spec.ts` renders NewsReader portlets as a user of its own per worker,
`ownUser("news")` (`e2e-news-<parallelIndex>`, imported by `global-setup.ts` like the users of
MOD-I401). Each worker now renders NewsReader portlets as a different user, with a news set of its
own, and no other spec signs in as those users. Other portlets still render as staff, guest or
admin. The loop compares the signed-in user by name, since `ownUser()` returns a new object on
each call and would otherwise sign in again for each mode.

## Evidence

* CI: the artifact `integration-migrate-postgres-15-to-mariadb-12.3` of run 42507870441,
  downloaded with `gh run download` (access log, `NewsReaderPortlet.log`, `portal.log`, trace).
* `npm run lint` passes: no errors, the same 41 warnings as the integration tip.
* No local portal run. The uPortal tip `2cdbc62e5` wasn't built into a local Maven repository on
  this machine, and building it plus a portal start didn't fit this session. The push run of this
  branch is the evidence for the fix (see the report).

## Proposed LOG rows

| ID | Area | Description | Status |
| --- | --- | --- | --- |
| MOD-I? | Tests | `portlet-modes.spec.ts` rendered all 13 NewsReader portlets as staff on both workers. Renders as staff on both workers at once failed in NewsReaderPortlet (next row): `portlet-modes.spec.ts:330` ("movie-news", edit, maximised) passed only on a retry in Integration 42507870441 (job 128815050922), while the other worker rendered motley-fool in edit mode in the same second. Likely also MOD-I387's "word of the day". | **Fixed** (uPortal-start, `ccr-43ba0785-hzlrj5-portlet-modes-flake`): NewsReader portlets render as the worker's own user, `ownUser("news")` (`notes/portlet-modes-flake.md`). |
| MOD-I? | Portlets | **NewsReader errors when one user has two sessions.** NewsReaderPortlet 5.1.5 keeps one news set per user (`default`) for all its portlets. `HibernateNewsStore.getNewsSet(userId, name)` is `@Cacheable` and returns the same object to every request, and `SharedNewsSetServiceImpl.getNewsSet` saves it on every render under a lock on the portlet session only. When sessions of one user render any NewsReader portlets at the same moment, each calls `saveOrUpdate` on that object, and the second render shows uPortal's error portlet (`HibernateException: Illegal attempt to associate a collection with two open sessions`). Users see it when they're signed in on two devices or browsers. Not checked: whether two NewsReader portlets on one page of one session can collide too (uPortal renders them on parallel threads). | **Open**, for the owner (NewsReaderPortlet). A fix in the portlet would copy the cached set or reload it in the saving session before `saveOrUpdate`. uPortal-start's tests avoid it (row above). |
