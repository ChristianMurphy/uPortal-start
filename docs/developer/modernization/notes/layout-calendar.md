# Handoff: layout-calendar (the layout checks below the first screen)

The layout checks of MOD-D52 (`tests/layout`) failed in CI on pages that pass locally. The
coordinator decided to leave this as a known flake in `pages.spec.ts:98` for the pause. This branch
(`ccr-43ba0785-hzlrj5-layout-calendar`, from `c562f35`) keeps the fix and doesn't land.

## Root cause

Search's Integration 38187096335 (hsqldb job 114616166227) failed "Layout at 320px" and "Layout at
390px" for student, staff and faculty: a spill of `div.upcal-event-list` (its `.row.day` child,
margin -7.5px from `--bs-gutter-x`, reaches 8px past it) at 320, and a cut-off and a spacing
problem on `#file-uploader div.qq-upload-button.enabled_upload` (15px taller than its box) at 390.

Respondr's `<html>` has `overflow-x: hidden`, so its `overflow-y` computes to `auto`.
`visibleBox()` in `measure.ts` clipped a box at each ancestor whose overflow isn't `visible` on
that axis, so `<html>`'s client height, the viewport (568px at 320, 844px at 390), cut off every
box below the first screen. `isShown()` then counted those boxes as hidden, and no check measured
them, on any page at any width. On a local portal the student's welcome page at 320 has the event
list at y=623, below the line; in CI the portlets above it are shorter, and the list is measured.
The calendar's events (the quickstart's US holidays calendar, fetched from Google over the
internet after load) changed the list from run to run as well.

## The fix on this branch

* `measure.ts`: `visibleBox()` clips on an axis only where the ancestor hides overflow
  (`hidden` or `clip`, the existing `hides()`). A box that scrolls doesn't hide what is below its
  fold.
* `pages.spec.ts`: `page.route` answers the calendar's resource requests
  (`/p/calendar.<id>/.../*.resource.uP`) with a fixed feed: one all-day "Columbus Day" tomorrow,
  as CI's trace showed. The list is then the same in every run, and it doesn't depend on the
  internet. With the feed alone, the 6 tests at 320 and 390 pass locally, and CI would still fail,
  because the list's position against the first screen differs.
* uPortal: `uPortal-webcomponents/src/test-support/layout.ts` (lines 155 to 159) has the same
  clip and is meant to change with `measure.ts`. The matching change is the same 2 lines
  (`hides(style.overflowX)` and `hides(style.overflowY)` in its `visibleBox`), and the component
  tests would need a run. It isn't on any uPortal branch.

## The baseline after the fix

Not re-recorded. A local run of all of `pages.spec.ts` (30 tests) with the fix and the feed:
21 passed and 9 failed, on these 23 new entries on 9 pages, and 1 entry is gone. They include
CI's failures.

| Page | New entries |
| --- | --- |
| student, staff and faculty tab welcome 320 (each) | spill `div.upcal-event-list` (8px), spill `div.portlet-section-body` (8px), cut-off and spacing `#file-uploader div.qq-upload-button.enabled_upload` (15px) |
| student, staff and faculty tab welcome 390 (each) | cut-off and spacing `#file-uploader div.qq-upload-button.enabled_upload` (15px) |
| admin portlet-admin 320 | spill of `portletsList_wrapper` (8px) and of its `div.d-md-flex.justify-content-between.align-items-center` (161px) |
| guest login 320 | spill `#Pluto_#_ctf#_#_search.portlet-section div.col-sm-#` (13px) |
| admin tab development 1920 | spill `div.content` of a portlet (227px) |

Gone: admin permissionsmanager 768, spill of `#portletContent_ctf#... a`.

To finish: apply the uPortal change, re-record these pages from the attached "observed" JSON
(`docs/layout-tests.md`), and run `pages.spec.ts` with `--repeat-each 5` at every width.

## Proposed LOG row

| ID | Area | Finding | Resolution |
| --- | --- | --- | --- |
| (coordinator) | Tests | The layout checks (MOD-D52) measured only the first screen of each page, because `<html>`'s `overflow-y` computes to `auto`. The calendar's spill at 320 and the uploader's at 390 showed in CI only. | **Open.** Fix on uPortal-start `ccr-43ba0785-hzlrj5-layout-calendar`, plus the same change in uPortal's web component `layout.ts`, and a new baseline. |
