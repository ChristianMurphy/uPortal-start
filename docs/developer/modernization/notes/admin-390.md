# Handoff: admin-390 (the Permissions portlet at 390 pixels, MOD-I386)

The branch is `ccr-43ba0785-hzlrj5-admin-390` in both repositories. It fixes the overlap check of
the layout checks (MOD-D52), which reported links in running text as overlapping when they wrap.
It doesn't change the portlet, and it doesn't add a baseline entry.

## The failure

Integration run 38775913145 on the integration tip `d1326f514`, job 116563567769 ("G-migrate:
postgres-16 to postgres-18"), failed `tests/layout/pages.spec.ts:121` ("Layout at 390px ›
admin") on all three attempts:

```text
New layout problems on admin permissionsmanager 390.
spill: #portletContent_ctf#.fl-widget-content.fl-fix.up-portlet-content-wrapper a
  (overlaps #portletContent_ctf#.fl-widget-content.fl-fix.up-portlet-content-wrapper a by 88x16px)
spill: (the same two nodes) by 67x16px
```

The fresh-data Playwright jobs of that run (HSQLDB, PostgreSQL 18, MariaDB 12.3) and the
postgres-15 to MariaDB pair passed the same test.

## Cause

The links on the page don't overlap. The overlap check compared bounding boxes, and a
link that wraps has a bounding box over the links beside it.

The page came from the network log of the failed test's `trace.zip`. I rendered that HTML with its
CSS and scripts from the same log, offline, at 390x844 (Chromium 1194). The Permissions portlet
lists each owner's activities as links in running text (`listOwners.jsp`, `<span
class="link-list">`) in two columns of cards. At 390 pixels a card is about 130 pixels wide, and
19 of the 37 links take two lines. A link that wraps has two line boxes, but its bounding box
covers both lines from edge to edge. The check compared bounding boxes, so a wrapped link
"overlapped" the link that shares one of its lines. The screenshot of that render shows the links
on separate lines, nothing on top of anything. With the old check this render reports one
overlap at 390 (64x17 pixels, local fonts), between "View own attribute" and "View user
attribute", which wrap one after the other.

Why only this pair: the order of the links.

* The data is the same as in the fresh jobs. `tests/db/migrate.sh` fills the source with the build
  under test (`deploy_and_init`, `source-init.log`: "permission-owner: 8 imported"), from the same
  `data/base` files. The source isn't 5.17.9 data.
* `PermissionOwnerImpl.activities` is a `HashSet`, hashed on the activity's fname, and the JSP
  prints it as it iterates. Names in different buckets always come in the same order. Names that
  share a bucket come in the order the database returned their rows, and the query
  (`JpaPermissionOwnerDao.findAllPermissionOwners`) has no `ORDER BY`. The copy tool reads each
  table without `ORDER BY` too (`TableCopier.selectSql`). The target gets the rows in the order
  the source returned them.
* For `UP_USERS`, bucket 9 holds `VIEW_OWN_USER_ATTRIBUTE`, `VIEW_USER` and `EDIT_USER`. On the
  migrated database the page listed "View user, Edit users, View own attribute", so "View own
  attribute" came right before "View user attribute". The data file has "View own attribute" first
  of the three. The other owners' shared buckets kept the file order.
* With "View own attribute" moved back to first in its bucket, the same render passes the old
  check at 390.

I couldn't see the order on a fresh CI database. Playwright keeps a trace only of a test that fails,
and the exports of the migration equivalence job sort the activities by name. I didn't find why the PostgreSQL 16 source returns
`VIEW_OWN_USER_ATTRIBUTE` after the other two. It needs a PostgreSQL portal, and this machine has
no Docker.

The same node came and went in the baseline before: recorded at 390 and 768 pixels (a4e9ddb83),
dropped at 390 because only local fonts showed it (64e14399b), and dropped at 768 (efc04f4e9).
Whether two wrapped links meet depends on fonts, width and order.

## The fix

* uPortal-start `tests/layout/measure.ts` and uPortal
  `uPortal-webcomponents/src/test-support/layout.ts` (the two copies change together):
  `overlapProblems()` compares the boxes of each control's lines (`getClientRects()`, cut to its
  visible box), and reports the largest overlap of over 2 pixels each way. A block element has
  one line box, its border box, so buttons and form fields are measured as before. The new check
  reports a subset of what the old one did, never more.
* `tests/layout/layout-checks.spec.ts` and `layout.browser.test.ts`: a page of five links that
  wrap must pass ("allow links that wrap beside each other"), and a link pulled over the second
  line of a wrapped link must be found ("spill finds a link over the second line of a link that
  wraps").

## Evidence

Local runs used Chromium 1194 (uPortal-start through an untracked config that sets
`executablePath`, Vitest through a symlink tree under the 1248 name) with 12.5 to 15 GB of memory
available.

| Check | Result |
| --- | --- |
| `layout-checks.spec.ts`, old `measure.ts`, new cases | the wrapped links case failed: two overlaps, 89x17 and 46x17 pixels. The pulled link case passed |
| `layout-checks.spec.ts`, new `measure.ts` | 18 passed |
| Same, seeded fault: `linesOverlap()` never reports | 2 failed, the overlap cases only: "Expected value: spill button" and "spill a", "Received array: []" |
| `layout.browser.test.ts`, old `layout.ts`, new cases | 1 failed: the wrapped links case, the same two overlaps |
| `layout.browser.test.ts`, new `layout.ts` | 18 passed |
| Same, seeded fault as above | 2 failed: "expected [] to include 'spill button'" and "'spill a'" |
| Every web component test (`vp test run`) | 50 files, 1530 tests passed |
| `vp check` | passed |
| `npm run lint` in uPortal-start | 0 errors. The `expect-expect` warning on `pages.spec.ts` is on the integration branch too |
| CI page of the failed test, rendered offline, old check | spill at 320 (61x17) and 390 (64x17), none at 768 |
| Same page, new check | no problem in the portlet at 320, 390 or 768 |
| Same page with "View own attribute" first in its bucket, old check | none at 390, one at 320 (local fonts) |

Not run: `pages.spec.ts` against a local portal. The shared tip build in `.m2-tip` failed with 429
from Maven Central, so no portal could start. CI's Playwright jobs on this branch run it.

## CI

The G-migrate postgres-16 to postgres-18 job can't run on this branch without the full matrix.

* A push to a topic branch runs the `workstream` set of `tests/db/migrate/matrix.json`: only
  mariadb-11.4 to postgres-18, without Playwright.
* A manual run of `integration.yml` on a topic branch runs the `push` set, the full matrix, and
  its inputs (`nightly`, `uportal-repository`, `uportal-ref`) can't pick one job. The agent guide
  (section 1) leaves that run to the coordinator. The command:
  `gh workflow run integration.yml -R ChristianMurphy/uPortal-start --ref ccr-43ba0785-hzlrj5-admin-390`

Push runs: RUNS_PLACEHOLDER

## Proposed LOG rows

| ID | Area | Finding | Resolution |
| --- | --- | --- | --- |
| MOD-I386 (update) | Tests | (unchanged) | **Fixed** (uPortal 6961c5f27, uPortal-start de9e7e42b): the overlap check compares each line of a control, not its bounding box. A link that wraps in running text overlapped the links beside it. The order of the Permissions portlet's links on the migrated database put two wrapped links next to each other. `notes/admin-390.md` in uPortal-start. |
| MOD-I? | Portlets | The Permissions portlet lists each owner's activities in `HashSet` order (`PermissionOwnerImpl`). Names that share a hash bucket come in the order the database returns their rows. The order differs between databases and after a copy. Found by MOD-I386. | **Open**, small. Sorting by name changes the markup. The replay then needs an intended difference. |

## Next step

Read the push runs. If a Playwright job prints `layout ... no longer seen` lines, remove those
entries from `tests/layout/baseline.ts`.
