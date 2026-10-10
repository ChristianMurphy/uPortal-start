# Browsers, accessibility and visual snapshots

Three nightly Playwright suites (MOD-D29) on top of the default suite, which runs on Chromium at
1280 × 720 only. Each has its own config and file suffix, so `npx playwright test
--config=tests/uportal-pw.config.ts` does not pick them up. They need a running portal, like
every Playwright spec (see "Playwright end-to-end tests" in `AGENTS.md`).

## Other browsers: `tests/browsers-pw.config.ts`

| Project | Browser | Specs |
| --- | --- | --- |
| `firefox` | Firefox, 1280 × 720 | every spec in `tests/ux` |
| `webkit` | WebKit (Safari), 1280 × 720 | every spec in `tests/ux` |
| `phone` | Chromium as a Pixel 7 (412 × 915, touch) | guest page, authentication, skin |

```bash
npx playwright install firefox webkit
npx playwright test --config=tests/browsers-pw.config.ts --project=firefox
```

## Accessibility ratchet: `tests/a11y-pw.config.ts`

`tests/a11y/key-pages.a11y.ts` runs axe-core (`@axe-core/playwright`, WCAG 2.1 A and AA rules) on
the key pages: the guest welcome page, the home page of each role, the Portlet Manager,
Permissions, Groups and User Administration admin portlets, and a maximised portlet.

`tests/a11y/baseline.ts` records the violations each page has today, by page, rule and node. A
node is axe's CSS selector for the element, with every run of digits replaced by `#`, since
portlet window and layout node ids differ between portals. The test fails on any violation that
is not recorded; recorded violations that have gone are listed in the test's `fixed` annotation,
so the baseline can be tightened.

To record a page (first run, or after a fix or an intended change), copy the `observed=` JSON
from the failure message (CI also shows it as an "a11y observed" annotation) into
`baseline.ts`.

## Visual snapshots: `tests/visual-pw.config.ts`

`tests/visual/key-pages.visual.ts` compares viewport screenshots of the guest page, the student
and admin home pages, the Portlet Manager and a maximised portlet with the images in
`tests/visual/snapshots/<project>/`, on Chromium at 1280 × 720 (`desktop`) and as a Pixel 7
(`phone`). A screenshot may differ in up to 1 % of its pixels (each pixel within a colour
threshold of 0.2) before the test fails. On the dashboards the portlet bodies are masked,
because they show live data; the portal chrome, layout and portlet title bars are compared.

Snapshots depend on the fonts and rendering of the machine, so record them on the CI runner
image (`ubuntu-latest`), not on a workstation. A snapshot that does not exist is written instead
of compared, and the CI job prints every snapshot it wrote into its log as base64. To
re-baseline after an intended change:

```bash
# delete the snapshots that changed, push, and let the nightly "Browsers: visual" job run; then
# save that job's log (GitHub: the job's "Download log archive", or the API) and
tests/visual/fetch-snapshots.sh job.log
git add tests/visual/snapshots
```

On a machine that matches the runner, `npx playwright test --config=tests/visual-pw.config.ts
--update-snapshots` re-records them all directly.

## In CI

`.github/workflows/integration.yml` runs the five suites as the nightly `browsers` job matrix
(`firefox`, `webkit`, `phone`, `a11y`, `visual`) against uPortal built from source, each on its
own portal on HSQLDB. The job summary shows the failures; new snapshots and observed
accessibility violations are printed as described above.
