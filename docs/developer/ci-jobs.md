# Which CI jobs run

This page lists what each uPortal-start workflow runs for each kind of push. The rules for
workstream branches (`ccr-43ba0785-hzlrj5-<topic>`) are prototype only (MOD-D30, MOD-D55,
MOD-I306) and go before upstreaming. A staging branch (`ccr-43ba0785-hzlrj5-landing-<n>`) counts
as the integration branch. So does a manual run on any branch, except in `Migration equivalence`,
which gives a manual run on a workstream branch the workstream set. The nightly run is the schedule or a manual run with `nightly` ticked. `CI` has no
schedule. Its nightly set runs only from a manual run.

| Workflow | Push to a workstream branch | Integration branch, staging branch, manual run | Nightly |
| --- | --- | --- | --- |
| `CI` | Linux with Temurin, one cell | Linux, Windows and macOS with Temurin | Those, plus Linux with Zulu and Corretto |
| `Integration` | The uPortal build, Playwright on HSQLDB (local login, and the auth specs with CAS), the harness and Playwright on PostgreSQL 18, the two-node cluster, the query budgets, one G-migrate pair | Everything on the left, the harness on every 6.0 database, Playwright on MariaDB 12.3, the small G-migrate set | Also MySQL 9.7 and the wide G-migrate set |
| `G-index` | Only when the push changes persistence, SQL, schema, data files or G-index itself (see below) | PostgreSQL 18 at scale 0.01, then the seeded faults | PostgreSQL 18 and MariaDB 12.3 at scale 0.05 |
| `Migration equivalence` | PostgreSQL 18 in place and one copy | HSQLDB, PostgreSQL 18 and MariaDB 12.3 in place, two copies | Every runtime server in place, a copy from and into every vendor |
| `HTTP replay` | Only when the push changes `tests/replay` or the workflow | Every push | Not scheduled |

The `CI` workflow's `commits`, `prose` and `lint` jobs run on every push. `lint` runs
`npm run lint`: tsc, type coverage and ESLint over the tests.

## Staging branches and the staging check

The coordinator pushes a landing to `ccr-43ba0785-hzlrj5-landing-<n>` in uPortal and then in
uPortal-start, before it reaches the integration branch. The runs there build the uPortal branch
of the same name and run the jobs of the integration branch.

`CI`, `Integration`, `G-index`, `Migration equivalence` and `HTTP replay` start with the
`Staging check` job, which runs `.github/scripts/staged.sh check`. On a push to the integration
branch or to a staging branch it looks for an earlier pass of the workflow's slow jobs on the same
files. The slow jobs are the platform cells of `CI`, and in
the other workflows the uPortal build and every job after it. When they passed, they are skipped,
and the job's notice annotation gives the run that passed. On any other branch or event the job
doesn't look anything up.

The last job of such a run, `Record the pass for this tree`, uploads the marker that the check
looks for. It runs when every slow job passed. The marker is an artifact named
`staged-<workflow>-<key>`, kept for 30 days. The key is the SHA-256 of `git ls-tree -r` of the
commit, without the Markdown files under `docs/developer/modernization` and
`.claude/modernization`. In the workflows that build uPortal, the key also covers the uPortal
commit that `choose-uportal.sh` chose, with the same files left out. A marker counts when a push
run of the same workflow file uploaded it, in this repository, on the integration branch or a
staging branch.

The slow jobs run when the lookup fails: GitHub doesn't answer, the files can't be listed, or
no uPortal commit was chosen. The marker isn't written when the build job chose another uPortal
commit than the check did, which happens when uPortal's branch moves between the two jobs.
`.github/scripts/staged.test.sh` checks the key and the lookup with a table of examples. The
design and its limits are in uPortal's `docs/developer/modernization/notes/ci-prelanding.md`.

## Which uPortal a run tests

The workflows that build uPortal from source (`Integration`, `G-index`, `Migration equivalence` and
`HTTP replay`) run `.github/scripts/choose-uportal.sh`. It takes the `uportal-ref` of a manual run,
else uPortal's branch with the name of this branch, else uPortal's `ccr-43ba0785-hzlrj5`, else
`master`. It doesn't try shorter versions of the branch name. The job summary and a notice
annotation give the repository, ref and commit that were chosen, and the last step of the
`Build uPortal` job prints them again, so the last lines of its log show which uPortal ran. The
checkout uses that commit. `.github/scripts/choose-uportal.test.sh` checks the order with a table of examples.

## One build of each uPortal commit

`Integration`, `G-index`, `Migration equivalence` and `HTTP replay` often build the same uPortal
commit, minutes apart. Each `Build uPortal` job uploads its build as the artifact
`uportal-m2-<commit>`, with the repository and commit written in `uportal-build.txt`.
Before it builds, `.github/scripts/find-uportal-build.sh` looks for that artifact from an earlier
push, manual or scheduled run of this repository (never a fork or a pull request). When it finds
one, the job downloads it, checks the repository and commit in `uportal-build.txt` against the
chosen ones and uploads that build again for its own jobs. It builds when anything is missing or
doesn't match. A notice annotation and the last lines of the log say which run's build was
reused. The build itself has no Gradle cache, and a branch's cache stores uPortal-start's own entry
alone. `.github/scripts/find-uportal-build.test.sh` checks the choice with a table of examples,
and the workflow lint job runs it.

## G-index on a workstream push

The `Build uPortal` job of `g-index.yml` compares the branch with `origin/ccr-43ba0785-hzlrj5` in
uPortal-start and, if uPortal has a branch of the same name, in uPortal. The paths that count are in
`.github/scripts/gindex-changes.sh`: in uPortal-start `tests/db`, `data`, the G-index workflow and
script, the Gradle tasks and build files that `gindex.sh` uses, and the settings of the portal and
Tomcat; in uPortal SQL, Hibernate and JPA mappings and configuration, the DAOs, the RDBM stores,
the aggregation of events, import and export, and the data source and cache contexts.

The job summary and a notice annotation list the files that matched, or say
`no matching changes, G-index skipped`, and the last step of that job prints a one-line report.
Then the uPortal build and the G-index job are skipped. When the script can't fetch a branch or tell,
G-index runs. `.github/scripts/gindex-changes.test.sh` checks the rule with a table of example
pushes, and the workflow lint job runs it.

## Workflow lint

`Workflow lint` runs on a push that changes `.github`. Besides zizmor and actionlint, it runs the
tests of the scripts in `.github/scripts`: `gindex-changes.test.sh`, `choose-uportal.test.sh`,
`wait-for-portlets.test.sh`, `find-uportal-build.test.sh`, `check-uportal-downloads.test.sh`,
`check-placeholders.test.sh` and `staged.test.sh`. It also runs `check-uportal-downloads.py` on the workflows (MOD-I371).
That check fails when a job downloads the uPortal build under a name other than
`needs.uportal.outputs.artifact`, or `steps.reuse.outputs.artifact` in the `uportal` job.

## Time per phase

The database scripts print the time of each phase. `ci-logs.md` describes the lines.
