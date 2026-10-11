# Layout tests at standard screen sizes

The specs in `tests/layout` check that the portal's pages fit the standard screen sizes
(MOD-D52). They run in the default suite (`npx playwright test --config=tests/uportal-pw.config.ts`)
and need a running portal, like every Playwright spec (see "Playwright end-to-end tests" in
`AGENTS.md`).

## What is checked

`tests/layout/measure.ts` measures element boxes in the browser, including inside the open shadow
roots of web components. It compares no screenshots. The checks:

| Check | Fails when |
| --- | --- |
| `scroll` | the page is wider than the screen. It scrolls sideways, or the part past the edge is cut off because the body hides overflow, as Respondr's does. |
| `cut-off` | a box that hides overflow has more content than it shows. An ellipsis is allowed when the element or an ancestor has the full text in its `title`. |
| `spill` | an element's in-flow children or text reach past its sides, or two controls overlap where both show. |
| `wrap` | from 768 pixels wide, a button, tab, menu item, table header, label or badge takes more than one line. From 1024 pixels, the tab bar takes more than one row. |
| `collapse` | a portlet, region, column or component with content is less than 8 pixels high, or, in a page column, less than 40 pixels wide. Also a column with portlets narrower than 240 pixels, or an image drawn out of its proportions. |
| `spacing` | `cut-off` fails once the WCAG 1.4.12 text spacing is applied: line height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em. |

Elements that show to nobody are left out: `display: none`, `visibility: hidden`, transparent,
clipped away by an ancestor that hides overflow, or 1 pixel or less. So are elements meant only
for screen readers, the ones clipped as Bootstrap's `visually-hidden` does or moved off the page.
A control counts for overlaps only if it is the topmost element at one of five points of its box.
To hit-test controls below the first screen, the check scrolls the page to them and back.

Before measuring, the helper waits for web fonts and until the page stops changing: the number of
elements and the page size stay the same for four checks 250 milliseconds apart.

## Pages and sizes

`tests/layout/pages.spec.ts` signs in as each quickstart user and measures every tab in the tab
bar, plus:

* for the guest, the login page (`p/login`);
* for the student, Favorites and Popular Portlets maximized (the web component channels);
* for the admin, Portlet Manager, Permissions, Groups and User Administration.

It does this at widths of 320, 390, 768, 1024, 1366 and 1920 pixels, each with a height that
goes with it, in Chromium. Each width is a `test.describe` with its own `test.use({ viewport })`,
so the browser projects in `uportal-pw.config.ts` stay as they are. WebKit and Firefox at 390 and
1366 pixels come once the browser projects are in that config.

`tests/layout/layout-checks.spec.ts` tests the checks themselves on small pages without the
portal: each check finds nothing on a page that fits, and finds a seeded fault.

uPortal's web components run the same checks in their own browser tests, at container widths of
280, 400, 800 and 1200 pixels (uPortal `uPortal-webcomponents/src/test-support/layout.ts`). The
two copies of the checks have to change together.

## The baseline

`tests/layout/baseline.ts` records the problems the pages have today, by
`"<visitor> <page> <width>"`, check and node. The node is the element's id. An element without
an id is written as the nearest id above it followed by its own tag and first three classes.
Inside a shadow root, the host's node and `>>>` come first.
Every run of digits becomes `#`, because layout node ids differ between portals. An id with
digits also gets its classes, which hold a portlet's fname. State classes (`active`, `show`,
`first`, `last`, `fl-tabs-active` and the like) are left out.

A problem that the baseline doesn't record fails the test. Each page is measured even after an
earlier page failed, so one run reports them all. A recorded problem that has gone is listed in
the test's `fixed` annotation.

The baseline only shrinks. A fix removes its entries in the same commit, and a change that adds
a problem fixes it instead of recording it. To re-record a page after a fix, copy its `observed`
attachment (or the `observed=` JSON in the failure message) into `baseline.ts`. Keep the list
sorted.
