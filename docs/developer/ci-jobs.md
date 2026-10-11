# Which CI jobs run

This page lists what each uPortal-start workflow runs for each kind of push. The rules for
workstream branches (`ccr-43ba0785-hzlrj5-<topic>`) are prototype only (MOD-D30, MOD-D55,
MOD-I306) and go before upstreaming. A manual run on any branch counts as the integration branch
here, except in `Migration equivalence`, which gives a manual run on a workstream branch the
workstream set. The nightly run is the schedule or a manual run with `nightly` ticked.

| Workflow | Push to a workstream branch | Integration branch, manual run | Nightly |
| --- | --- | --- | --- |
| `CI` | Linux with Temurin, one cell | Linux, Windows and macOS with Temurin | Those, plus Linux with Zulu and Corretto |
| `Integration` | The uPortal build, Playwright on HSQLDB (local login, and the auth specs with CAS), the harness and Playwright on PostgreSQL 18, one G-migrate pair | Everything on the left, the harness on every 6.0 database, Playwright on MariaDB 12.3, the small G-migrate set | Also MySQL 9.7 and the wide G-migrate set |
| `G-index` | Only when the push changes persistence, SQL, schema, data files or G-index itself (see below) | PostgreSQL 18 at scale 0.01, then the seeded faults | PostgreSQL 18 and MariaDB 12.3 at scale 0.05 |
| `Migration equivalence` | PostgreSQL 18 in place and one copy | HSQLDB, PostgreSQL 18 and MariaDB 12.3 in place, two copies | Every runtime server in place, a copy from and into every vendor |
| `HTTP replay` | Only when the push changes `tests/replay` or the workflow | Every push | Not scheduled |

The `CI` workflow's `commits` and `prose` jobs run on every push.

## G-index on a workstream push

The first job of `g-index.yml` compares the branch with `origin/ccr-43ba0785-hzlrj5` in
uPortal-start and, if uPortal has a branch of the same name, in uPortal. The paths that count are in
`.github/scripts/gindex-changes.sh`: in uPortal-start `tests/db`, `data`, the G-index workflow and
script, the Gradle tasks and build files that `gindex.sh` uses, and the settings of the portal and
Tomcat; in uPortal SQL, Hibernate and JPA mappings and configuration, the DAOs, the RDBM stores,
the aggregation of events, import and export, and the data source and cache contexts.

The job summary lists the files that matched, or says `no matching changes, G-index skipped`. Then
the uPortal build and the G-index job are skipped. When the script can't fetch a branch or tell,
G-index runs. `.github/scripts/gindex-changes.test.sh` checks the rule with a table of example
pushes, and the workflow lint job runs it.

## Time per phase

The database scripts print the time of each phase. `ci-logs.md` describes the lines.
