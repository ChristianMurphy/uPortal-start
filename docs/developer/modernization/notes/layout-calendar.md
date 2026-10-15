# Handoff: layout-calendar (the layout checks below the first screen)

The layout checks of MOD-D52 (`tests/layout`) now measure the whole page, not only the first
screen, and the baseline records what they find there. The branch is
`ccr-43ba0785-hzlrj5-layout-calendar` in both repositories. It fixes MOD-I286 and makes
`pages.spec.ts` deterministic. It doesn't fix the layout problems it finds, and it doesn't decide
MOD-I283 (Respondr's body `overflow-x: hidden`), which is the skin owner's.

## Root cause

Search's Integration 38187096335 (hsqldb job 114616166227) and the integration branch's Integration
38204127794 (hsqldb job 114669441371) failed "Layout at 320px" in `pages.spec.ts` for the student.
The 320 failure is a spill of `div.upcal-event-list`: its `.row.day` child has a margin of -7.5px
from `--bs-gutter-x` and reaches 8px past it. At 390, `#file-uploader
div.qq-upload-button.enabled_upload` is 15px taller than its box, which counts as a cut-off and a
spacing problem.

Respondr's `<html>` has `overflow-x: hidden`, so its `overflow-y` computes to `auto`.
`visibleBox()` in `measure.ts` clipped a box at each ancestor whose overflow isn't `visible` on
that axis. `<html>`'s client height is the viewport (568px at 320, 844px at 390), so every box
below the first screen counted as hidden, and no check measured it. On a local portal the
student's welcome page at 320 has the event list at y=623, below that line. In CI the portlets
above it are shorter, so CI measured the list and local runs didn't. The calendar's events came from
the quickstart's US holidays feed on the internet, fetched after load, so the list also changed
between runs.

## The fix

uPortal-start:

* `tests/layout/measure.ts`: `visibleBox()` clips on an axis only where the ancestor hides
  overflow (`hidden` or `clip`, the existing `hides()`). A box that scrolls doesn't hide what is
  below its fold.
* `tests/layout/pages.spec.ts`: `page.route` answers the calendar's resource requests
  (`/p/calendar.<id>/.../*.resource.uP`) with a fixed feed, one all-day event tomorrow. The list
  is the same in every run and doesn't depend on the internet.
* `tests/layout/layout-checks.spec.ts`: a new seeded fault puts a spill below the fold of a box
  that hides `overflow-x` and has a fixed height.
* `tests/layout/baseline.ts`: re-recorded (next section).

uPortal:

* `uPortal-webcomponents/src/test-support/layout.ts`: the same change to `visibleBox()`.
* `layout.browser.test.ts`: the same seeded fault as uPortal-start.

The seeded fault doesn't use `<html>`'s overflow. `page.setContent` in uPortal-start writes a page
without a doctype, and in quirks mode `<html>`'s client height is the content height (2018px in the
fault page), not the viewport. A fault built on `html { overflow-x: hidden }` passed with the old
clip there, and failed only in Vitest. A box that scrolls behaves the same in both modes.

## The baseline

`tests/layout/baseline.ts` went from 241 to 261 entries: 21 new entries on 8 pages, and 1 entry
removed. Run 1 below found them.

| Page | New entries |
| --- | --- |
| student, staff and faculty tab welcome 320 (each) | spill `div.upcal-event-list`, spill `div.portlet-section-body`, cut-off and spacing `#file-uploader div.qq-upload-button.enabled_upload` |
| student, staff and faculty tab welcome 390 (each) | cut-off and spacing `#file-uploader div.qq-upload-button.enabled_upload` |
| admin portlet-admin 320 | spill of `portletsList_wrapper` and of its `div.d-md-flex.justify-content-between.align-items-center` |
| admin tab development 1920 | spill `div.content` of a portlet |

Removed: `admin permissionsmanager 768`, spill of `#portletContent_ctf#... a`.

The earlier version of this note also listed a spill of `#Pluto_#_ctf#_#_search.portlet-section
div.col-sm-#` on `guest login 320`. On the integration tip the branch now merges (uPortal-start
`fork/ccr-43ba0785-hzlrj5`), the local runs don't find it, so it isn't recorded.

The baseline was written by a script outside the repository. It reads the `observed=` JSON of each
failed page and the `no longer seen` lines from the run's output, and sorts the result as the
file does. It reproduced the old file byte for byte before it applied run 1.

## Evidence

Local portal built from uPortal `ccr-43ba0785-hzlrj5-layout-calendar` (`./gradlew install`,
`uPortalVersion=5.17.10-SNAPSHOT`), on ports 9080, 9005 and 9887, with JDK 11.0.29 for the portal.

| Check | Result |
| --- | --- |
| Vitest `layout.browser.test.ts`, with the fix | 16 passed (Chromium 1248, also 1208) |
| Same, seeded with the old clip | 1 failed: "spill finds content wider than its box below the fold of a box that scrolls", `expected [] to include 'spill div'` |
| Vitest, every web component test (`npm run test`) | 50 files and 1528 tests passed. A first run with the portal up lost its browser connection in `up-self-edit-account.model.browser.test.ts`. The rerun passed |
| `vp check` | passed |
| uPortal-start `npm run lint` (`tsc`, type coverage, ESLint) | 0 errors. The `expect-expect` warning on `pages.spec.ts` is on the integration branch too |
| `layout-checks.spec.ts`, with the fix | 16 passed (Chromium 1248) |
| Same, seeded with the old clip in `measure.ts` | 1 failed, the new fault only: `Expected value: "spill div"` |
| `pages.spec.ts` run 1, new clip, old baseline | 8 failed, 22 passed. The 8 are the pages in the table above |
| `pages.spec.ts --repeat-each 5 --retries 0`, new baseline | 150 passed (9.8m), no `no longer seen` lines (Chromium 1208 under the 1248 name) |
| `pages.spec.ts --repeat-each 3 --retries 0`, new baseline, Chromium 1248 | 88 passed and 2 failed. Both failures are browser crashes at 768 (`Page crashed`, `Target crashed`), and no layout problem was reported |
| Same at 768 only, one worker | 13 passed and 2 failed. `chrome-headless-shell` 1248 logged `Received signal 11 SEGV_MAPERR` after loading a staff or faculty tab |
| The integration tip's `tests/layout` at 768, one worker, Chromium 1248 | 7 passed and 8 failed, all crashes. The crash happens without this branch |

Push runs at uPortal `301e49f3a9` and uPortal-start `6ae427a3c`:

* uPortal CI 38673998115, DB integration 38673998129 and DB copy tool 38673998134 passed.
* uPortal-start CI 38674004353, Migration equivalence 38674004357, HTTP replay 38674004404,
  Workflow lint 38674004427 and G-index 38674004403 passed.
* uPortal-start Integration 38674004447 failed in three jobs, each for a cause on the integration
  branch. "Playwright: hsqldb" and "Playwright: postgres-18" failed `rtl-theme.spec.ts:123` in
  both locales, which the `-fix-tip` branch fixes. Both jobs also had a flaky test in
  `reset-my-layout.spec.ts` (line 338 on HSQLDB, line 282 on PostgreSQL), which
  `-mariadb-layout-store` isolates, and HSQLDB had `visual-resource-server.spec.ts:153`. "Cluster:
  two nodes" couldn't download `uportal-maven-local`, which `-fix-tip` fixes. No layout test
  failed.

## Proposed LOG rows

| ID | Area | Finding | Resolution |
| --- | --- | --- | --- |
| MOD-I286 (update) | Tests | (unchanged) | **Fixed** (uPortal `301e49f3a9`, uPortal-start `6ae427a3c`): `visibleBox()` in both copies of the checks clips only where an ancestor hides overflow. `pages.spec.ts` answers the calendar with a fixed feed, and the baseline records 21 new entries on 8 pages. `pages.spec.ts` passed 150 of 150 with `--repeat-each 5`. |
| MOD-I373 | Tests | On this machine, `chrome-headless-shell` 1248 (Playwright 1.64) crashes with SIGSEGV in `pages.spec.ts` at 768 pixels, on the staff and faculty tabs, with one worker too. Chromium 1208 ran the same 150 tests without a crash. The integration tip's specs crash the same way. | **Open.** Watch whether CI's runners crash too. Not caused by the layout checks. |
| MOD-I374 | Tests | `layout-checks.spec.ts` builds its pages with `page.setContent`, which has no doctype, so they render in quirks mode and the portal's pages don't. A fault that depends on `<html>`'s size behaves differently there than in the portal or in Vitest. | **Open.** The new fault avoids it. Whether the fixture pages get `<!doctype html>` is for the test owner. It can change what the other faults measure. |

## What's left

* The 21 new entries are layout problems for the skin and portlet owners to fix. Each fix
  removes its entries (MOD-D52).
* MOD-I283 is still open, for the owner to decide.
