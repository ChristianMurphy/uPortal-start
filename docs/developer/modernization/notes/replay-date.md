# Handoff: replay-date (HTTP replay failures on 2026-11-08)

The branch is `ccr-43ba0785-hzlrj5-replay-date` in uPortal-start, from the integration tip
`d1326f514`. uPortal has no branch of this name. Its runs build the uPortal integration branch,
`498252acd`.

On 2026-11-08 the "Replay against 5.17" job of the HTTP replay failed with the same 12
differences on four topic branches: runs 42455427011 (`-retry-flakes`), 42455714380
(`-admin-390`), 42456118615 (`-test-users`) and 42458398153 (`-retro-1-fixes`). The tip's last
replay, run 38775913401 on 2026-10-15, passed. Runs 42455427011 and 42456118615 built the same
uPortal commit as that run, `498252acd`, and `-retry-flakes` (`d0a90ccec`) differs from the tip
by one spec and one note. Without this fix, the next replay on the tip fails the same way.

## The 12 differences

From the `replay-report` artifacts of runs 42455427011 and 38775913401 (`build/replay/report.md`
and `actual.json`). The other three runs report the same 12.

| Exchange | Roles | Difference | Cause |
| --- | --- | --- | --- |
| `crawl GET /uPortal/health-check?detail=ALL` | guest, student, staff, faculty, admin | `$.Time.Current Time: "{http-date}" -> "Sun, 8 Nov 2026 06:43:24 GMT"` | 1 |
| `crawl GET /uPortal/api/entities/person/admin.json` | student, staff, faculty, admin | `$.jsonEntityBean.principalString: "14.admin" -> "13.admin"` | 2 |
| `crawl GET /uPortal/api/permissions/principals.json?q=adm` | admin | `principalString` of admin-lo, admin and tenant-admin-lo, `14.` -> `13.` | 2 |
| `suite GET /uPortal/api/entities.json?q=admin&entityType[]=PERSON&entityType[]=GROUP` | admin | the same three `principalString` values | 2 |
| `suite GET /uPortal/api/entities.json?q=student&entityType[]=PERSON&entityType[]=GROUP` | admin | `principalString` `14.student` -> `13.student` | 2 |

The entity searches also show `typeAndIdHash` lines (`"group_local__{id}" ->
"group_local_2e_20"`, `"person_admin__lo" -> "person_admin_2d_lo"`). Those are registered
(`entity-type-and-id-hash-escapes`, uPortal a939af93). The registry excuses a body only when an
entry explains every changed line, and no entry explains the `principalString` lines. So the
whole body counted as unexplained, and the entry's use count fell from 5 to 2 (1570 intended
differences on 2026-10-15, 1567 today).

Comparing the two runs' `actual.json` (same uPortal build) also shows the group id in
`typeAndIdHash` (`group_local_2e_11` -> `group_local_2e_20`) and the order of the Permissions
manager's owner cards. The replay already masks both, and they aren't among the 12.

## Cause 1: the health check's date on days 1 to 9

`HealthCheckController.getTime()` (uPortal-health) writes the time with
`DateTimeFormatter.RFC_1123_DATE_TIME.format(ZonedDateTime.now())`. That formatter writes the day
of the month without a leading zero. RFC 1123 allows one or two digits there, and RFC 9110's
IMF-fixdate, which header fields must use, doesn't.

* Both sides print it. The method is the same in v5.17.9 (`b44ad0f56`) and at `498252acd`, and
  `javap -c` of the released `uPortal-health-5.17.9.jar` shows the `RFC_1123_DATE_TIME` field.
  On JDK 11.0.32 and 21.0.12 here, it formats 2026-11-08 06:43:24 UTC as `Sun, 8 Nov 2026
  06:43:24 GMT` and 2026-10-15 as `Thu, 15 Oct 2026 06:43:24 GMT`. It's no product difference.
* `HTTP_DATE` in `tests/replay/lib.mjs` wanted `\d{2}`. The recording (2026-10-11) and every
  replay up to 2026-10-15 ran on days 10 to 15, so the mask never saw a one-digit day. Today's
  runs were the first replays on day 1 to 9 of a month.
* The portal's header dates keep two digits. Each of today's `actual.json` files holds 1149
  masked `{http-date}` values (633 Last-Modified and 516 Expires headers), and the only unmasked
  HTTP dates are the five health check times.

Fix (`8873f3992`): in JSON strings, an RFC 1123 date with a one-digit or two-digit day becomes
`{http-date}`. Header values keep `HTTP_DATE`, so a header that loses the leading zero of its day
still shows.

## Cause 2: a new runner image changed the IPerson entity type id

A principal key is the entity type id, a dot and the key (`14.admin`). uPortal gives each entity
type the next counter value as `dataInit` imports `data/base/entity-type/*.xml`
(`EntityTypes.addEntityTypeIfNecessary`). `JaxbPortalDataHandlerService` finds the files with
`ConcurrentDirectoryScanner`, which uses `File.listFiles`, so the order is the order the file
system lists the files, and the import runs on a thread pool. `data/base/entity-type` holds the
same files on uPortal-start `master` (5.17.9) and on the tip.

The id doesn't depend on the date or on the uPortal build. It changed with the runner image:

| Run | Date | Runner image | First quickstart file `dataInit` ignores | `principalString` |
| --- | --- | --- | --- | --- |
| 38107388398 (recording, 5.17.9) | 2026-10-11 | ubuntu24/20261004.327.1 | `news-reader/apereo.pnd.xml`, then `sfn-wotd`, `sfn-movie-news` | `14.admin` |
| 38740348227, 38746204309 | 2026-10-15 | ubuntu24/20261004.327.1 | the same order | passed |
| 38772862205, 38775913401 | 2026-10-15 | ubuntu24/20261012.334.1 | the same order | `14.admin` (38775913401) |
| 42455427011, 42455714380, 42456118615, 42458398153 | 2026-11-08 | ubuntu24/20261101.360.1 | `calendar/Lunar_Phases.pcd.xml`, then `announcements/`, then `news-reader/` in another order | `13.admin` |

The third column is the order of the "No IPortalDataType configured" warnings in each job's
`Initialize portal` log, which follows the listing order of `data/quickstart`. It's the same in
every run on one image and changed at image 20261101. On ext4 a directory lists in the order of
its file name hashes, and the hash seed belongs to the file system, so a new image can list the
same checkout in a new order.

Other changes outside the repositories between the two dates: setup-java resolved Java 21 (the
Gradle daemon) as 21.0.13+9 instead of 21.0.12+1. Java 11, which runs `dataInit` and the portal,
stayed 11.0.32+1. A JDK doesn't change a directory's listing order, and the four runs of
2026-11-08 ran in two regions (centralus and westus2) with the same result. I didn't look for
dependencies resolved by a version range: the listing order explains the id, and `dataInit`
imported the same six entity types in every run.

The replay already treats entity type ids as generated ids (`docs/http-replay.md`, "Generated
ids", and "Unreported changes"), and `STRING_MASKS` masks the type in group keys
(`{type}.local.`, `{type}.pags.`). A person's key has no service to match on, so the mask missed
it. Nothing here is a 6.0 change: the uPortal build that passed on 2026-10-15 gives `13.admin` on
the new image. A 5.17.9 recording on the new image would show whether 5.17 gives 13 there too. I
didn't record one, because 5.17.9 imports the same files with the same code.

Fix (`bfb199661`): the leading entity type id of every `principalString` value becomes `{type}`.
A principal key in another form (`PERSON.admin`) or for another user still shows.

## Re-evaluating saved runs (`3622a184e`)

`replay --actual` re-evaluated a saved run with the current registry, but compared the saved
responses as their run had masked them. A mask fix couldn't be checked against a CI result:
with both masks in place, run 42455427011 still showed all 12 differences. `--actual` now passes
the saved responses through `renormalise`, as the recording already is.

## Evidence

Replay rule checks, `node --test tests/replay/evaluate.check.mjs` (Node 22.22.0):

* Before the masks, the three new checks gave 14 passes and 2 failures. The health check case
  failed with `$.Time.Current Time: "{http-date}" -> "Sun, 8 Nov 2026 06:43:24 GMT"` and the
  principal key case with `$.jsonEntityBean.principalString: "14.admin" -> "13.admin"`, the
  lines CI reported. The header case passed, because header dates were strict before and still
  are.
* After: 16 of 16 pass. `node tests/replay/evaluate.check.mjs` exits 0.

Saved results, each with the `UPGRADING-6.0.md` of the uPortal commit its run built:

```sh
node tests/replay/replay.mjs replay --origin http://localhost:1 \
  --actual <run>/build/replay/actual.json --upgrading UPGRADING-<uPortal commit>.md \
  --report <dir>/report.md
```

| Run | uPortal built | Tip code (`d1326f514`) | This branch |
| --- | --- | --- | --- |
| 42455427011 | `498252acd` | exit 1, 12 unexplained, 1567 intended | exit 0, 0 unexplained, 1570 intended |
| 42456118615 | `498252acd` | exit 1, 12 unexplained, 1567 intended | exit 0, 0 unexplained, 1570 intended |
| 42455714380 | `6961c5f27` | exit 1, 12 unexplained, 1567 intended | exit 0, 0 unexplained, 1570 intended |
| 42458398153 | `425884690` | exit 1, 12 unexplained, 1567 intended | exit 0, 0 unexplained, 1570 intended |
| 38775913401 (tip, green) | `498252acd` | exit 0, 0 unexplained, 1570 intended | exit 0, 0 unexplained, 1570 intended |

`npm run lint` passes (0 errors, 41 warnings, none in `tests/replay`). `vale.sh docs` passes on
`docs/http-replay.md` and this note.

No portal ran for this topic.

## Push runs

Push of `f8f10f9ba` (the new branch, so the replay ran). The `Build uPortal` job's annotation
says it built the uPortal integration branch at `498252acd` (the build of run 42457215984,
reused), because uPortal has no `-replay-date` branch.

* HTTP replay 42461119467: passed. "Replay rules" (job 128670422457, Node 24) passed 16 of 16,
  with the three new checks. "Replay against 5.17" (job 128670532617) ran on runner image
  ubuntu24/20261101.360.1 on 2026-11-08, so it met both causes. Its `dataInit` listed
  `calendar/Lunar_Phases.pcd.xml` first, as the failing runs did. It reported 0 unexplained
  differences, 1570 intended differences applied (`entity-type-and-id-hash-escapes` 5 times), 0
  unexplained matrix cells and 0 unexplained security changes. Its `actual.json` holds
  `"Current Time": "{http-date}"` five times and `"principalString": "{type}.admin"` six times.
* CI 42461119496 and G-index 42461119525 passed. Integration 42461119502 and Migration
  equivalence 42461119548 were still running when this note was written. This branch doesn't
  change what they test.

## Left open

* `RFC_1123_DATE_TIME` writes an offset (`+0100`) in place of `GMT` when the JVM's zone isn't
  UTC. CI runs in UTC. A local replay on a machine in another zone would report the health
  check's time. The fix doesn't change that.
* uPortal's generated ids (users, groups, portlets, entity types) depend on the file system's
  listing order, in 5.17 and in 6.0. Sorting the files in `ConcurrentDirectoryScanner` would
  make them the same on every machine. That's a product change for the owner to decide, and the
  replay doesn't need it.

## Proposed LOG rows

| ID | Area | Issue | Status |
| --- | --- | --- | --- |
| MOD-I? | Tests | HTTP replay: the mask for HTTP dates wanted a two-digit day. The health check writes its time with java.time's `RFC_1123_DATE_TIME`, which writes `Sun, 8 Nov 2026` on days 1 to 9, in 5.17.9 and in 6.0 alike. The replay failed on five health check requests on 2026-11-08 (runs 42455427011, 42455714380, 42456118615, 42458398153). | **Fixed** (uPortal-start `8873f3992`): a JSON string's RFC 1123 date may have a one-digit day. Header dates keep IMF-fixdate (`notes/replay-date.md`). |
| MOD-I? | Tests | HTTP replay: runner image ubuntu24/20261101.360 lists uPortal-start's data files in another order, and `dataInit` gave the IPerson entity type the id 13 in place of 14 with the same uPortal build. The replay didn't mask the type in person principal keys (`14.admin`), and seven exchanges failed on 2026-11-08 (the same runs). | **Fixed** (uPortal-start `bfb199661`): the type of every `principalString` is masked. `replay --actual` applies the current masks to a saved run (`3622a184e`) (`notes/replay-date.md`). |
