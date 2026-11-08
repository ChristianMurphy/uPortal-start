# Handoff: gradle-download (wrapper download timeouts on 2026-11-08)

The branch is `ccr-43ba0785-hzlrj5-gradle-download` in uPortal-start, from the integration tip
`a0a125fee`. uPortal has no branch of this name. Its runs build the uPortal integration branch.

On the tip's push runs of 2026-11-08, four jobs failed before any test ran. Each one's first
`./gradlew` call downloaded `gradle-9.8.1-bin.zip`, and the wrapper gave up after 10 s:
`Downloading from https://services.gradle.org/distributions/gradle-9.8.1-bin.zip failed: timeout
(10000ms)`, caused by `java.net.SocketTimeoutException: Read timed out` in
`HttpURLConnection.getResponseCode`. The server accepted the connection and didn't send a
response header within 10 s.

`https://services.gradle.org/distributions/gradle-9.8.1-bin.zip` answers with a 307 redirect to
`https://github.com/gradle/gradle-distributions/releases/download/v9.8.1/gradle-9.8.1-bin.zip`
(Cloudflare, checked with a HEAD request). So each download is a GitHub release download. On
this branch's first push, an hour later, most of them got HTTP 504, and the first 504 of a job
often took 13 to 15 s (see "Push runs"). With a 10 s read timeout, such a 504 is the
`timeout (10000ms)` of the tip's runs. The tip's logs don't say which host stalled, so this is
likely and not proven.

## The failed jobs

| Job | Run, attempt | Workflow step | Script step and first Gradle call | Gradle home | Download started, failed (UTC) |
| --- | --- | --- | --- | --- | --- |
| Cluster: two nodes, 128678268197 | Integration 42463431999, 1 | Deploy two nodes on PostgreSQL 18 and run the cluster checks | `tests/cluster/cluster.sh`: `./gradlew -PdbVendor=postgres-18 tomcatInstall tomcatDeploy dbWait dbSetup dataInit` | `/home/runner/.gradle` | 08:44:25.8, 08:44:37.5 |
| DB harness: postgres-18, 128678268366 | Integration 42463431999, 1 | Start the database, dataInit, snapshot, compare, then run the API specs | `tests/db/harness.sh --portal`, "Gradle: deploy, dataInit, snapshot, verify": `./gradlew -PdbVendor=postgres-18 tomcatInstall :overlays:uPortal:tomcatDeploy dbWait dbSetup ...` | `/home/runner/.gradle` | 08:44:54.0, 08:45:06.1 |
| In place: mariadb-12.3, 128678296645 | Migration equivalence 42463431964, 1 | 5.17.9 writes, the build under test reads on the same database | `tests/db/equivalence.sh in-place`, "5.17 on mariadb-12.3: deploy, dataInit": `./gradlew -PdbVendor=mariadb-12.3 -PuPortalVersion=5.17.9 tomcatInstall ...` | `/home/runner/.gradle` | 08:44:58.8, 08:45:10.7 |
| Copy: mariadb-11.4 to postgres-18 in America/New_York, 128678296666 | Migration equivalence 42463431964, 1 | 5.17.9 writes the source, dbMigrate copies it, the build under test reads the copy | `tests/db/equivalence.sh copy`, "5.17 on mariadb-11.4: deploy, dataInit": `./gradlew -PdbVendor=mariadb-11.4 -PuPortalVersion=5.17.9 tomcatInstall ...` | `/home/runner/.gradle` | 08:45:11.5, 08:45:25.3 |

The job IDs 128687549269 (DB harness: postgres-18) and 128687542690 (Copy) belong to attempt 2
of the two runs, and those jobs didn't run again. Each has the start and end times, the runner
name and the log (byte for byte) of its attempt 1 job. Attempt 2 ran only Cluster
(128687513159) and In place: mariadb-12.3 (128687541531), at 09:18. Both passed, and neither
downloaded the distribution. They restored the Gradle cache `setup-java-Linux-x64-gradle-c1c34fb9...`
("Entry restored: exact match found") and printed `Welcome to Gradle 9.8.1!` without a
download. So each job failed once, and no job failed twice.

## The cause

The places the brief listed don't apply:

* **A Gradle home per job.** None. The `gradle_user_home` variable in the workflows is the home
  that setup-gradle sets, and the step only appends `org.gradle.java.installations.fromEnv` to
  its `gradle.properties`. Every failing step ran with `GRADLE_USER_HOME: /home/runner/.gradle`
  (the step's `env` in the log).
* **A second checkout.** None. The "5.17 on ..." phase of `tests/db/equivalence.sh` runs this
  checkout's wrapper with `-PuPortalVersion=5.17.9`. Only the `Build uPortal` jobs use another
  wrapper, uPortal's (see "Exposure").
* **Scripts with another Gradle home.** `tests/db/lib.sh`, `harness.sh`, `equivalence.sh`,
  `migrate.sh`, `tests/cluster/cluster.sh` and `tests/query-budget/run.sh` call `./gradlew` in
  the checkout, without `-g`, `--gradle-user-home` or `GRADLE_USER_HOME`.

The cause is an empty Gradle cache. The basic provider of setup-gradle is the cache of
actions/setup-java. It saves `~/.gradle/caches` and `~/.gradle/wrapper`, the distribution
included, under one key per hash of the build files (`**/*.gradle*`,
`**/gradle-wrapper.properties`, version catalogs), and restores only that exact key. Each of the
28 jobs of the five push runs of `a0a125fee` that use this cache logged `Basic caching did not
find an entry to restore`, and each downloaded the distribution. So did the 4 `Build uPortal`
jobs, which have no cache.

The key wasn't new. The build files didn't change between `d1326f514` and `a0a125fee`, and on
2026-10-15 "Playwright: mariadb-12.3" (job 116563567479, run 38775913145) saved the same key.
The integration branch then had no push for 24 days. GitHub removes a cache entry that no run
reads for 7 days, and a branch can read only its own entries and the default branch's. The
caches API (`repos/.../actions/caches`) answers 403 through this sandbox's proxy, so the removal
itself isn't visible here. On 2026-11-08 "Playwright: mariadb-12.3" (job 128678268139) saved
the key again at 08:50:32, and the 09:18 jobs restored it.

A branch starts without a cache entry on:

* its first push (a topic branch can't read the integration branch's entries);
* the first push after a change to a build file or to `gradle-wrapper.properties`;
* any push more than 7 days after the last one, or after an entry was removed because the
  repository reached its 10 GB limit.

Both of the integration branch's last two tip pushes started this way (2026-10-15 and
2026-11-08).

## Exposure

Every job that runs `./gradlew` downloads the distribution when its branch has no cache entry.
That's every Gradle job in these workflows:

| Workflow | Topic push | Tip push, or a manual run | Nightly | Also, with uPortal's wrapper |
| --- | --- | --- | --- | --- |
| `integration.yml` | 6 | 18 | 59 | Build uPortal |
| `migration-equivalence.yml` | 2 | 5 | 12 | Build uPortal |
| `db-harness.yml` | doesn't run | doesn't run (7 on master pushes, pull requests and manual runs) | doesn't run | none |

A topic push of `integration.yml` runs the two Playwright jobs on HSQLDB, Playwright and the
harness on PostgreSQL 18, one G-migrate pair and Cluster. A tip push adds five harness vendors,
Playwright on MariaDB 12.3, five more G-migrate pairs and Query budgets. The nightly set has 36
G-migrate pairs, 6 Cluster runs, Playwright on MySQL 9.7, 4 Browsers jobs and Load.

CI (3 platform builds), HTTP replay (Replay against 5.17) and G-index (1 job) have the same
exposure. On the push of `a0a125fee`, 32 jobs downloaded the distribution between 08:33:36 and
08:45:15. The logs of 31 show it (G-index keeps only the task lines of its Gradle output):

| Downloads started | Time from `Downloading` to `Welcome to Gradle` | Result |
| --- | --- | --- |
| 26, from 08:33:36 to 08:42:46 | 3.6 s to 13.9 s (download, unzip and daemon start) | passed |
| 4, from 08:44:25 to 08:45:11 | 11.7 s to 13.8 s, then the timeout | failed |
| 1, at 08:45:15 (G-migrate: sqlserver-2022 to sqlserver-2025) | 5.4 s | passed |

The `Build uPortal` jobs of Integration, Migration equivalence, HTTP replay and G-index run
uPortal's wrapper, which has the same `networkTimeout=10000` and `retries=0`. They set
`cache-disabled: true` (MOD-I348), so they download the distribution whenever they build, which
is when no earlier build of the same uPortal commit exists (MOD-I342). The four of them
downloaded it at 08:33 on that push. uPortal-start can't change that file. See "Left open".

## The fix

`gradle/wrapper/gradle-wrapper.properties`:

* `networkTimeout=30000` (was 10000). The wrapper uses it for the connection and for each read.
  The 27 downloads that passed that day took 3.6 to 13.9 s from start to `Welcome to Gradle`,
  and the four that failed waited 10 s for a header. A server that answers in 10 to 30 s now
  completes the download. The wrapper drops a stalled connection after 30 s.
* `retries=6` and `retryBackOffMs=5000` (were 0 and 500). The Gradle 9.8.1 wrapper
  (`Install.forceFetch`) retries the download on an `IOException`, a 504 included, with a new
  connection and a new `.part` file each time, and doubles the wait each time: 5, 10, 20, 40,
  80 and 160 s. A run of fast 504s ends the download after 315 s. The 504s of this branch's
  first push came and went for at least 2.5 minutes, with some downloads passing in between,
  and the tip's failures spanned about 50 s. The retry covers the distribution download only.
  The build itself still runs once.
* The first commit (`4ac81b5f4`) had `retries=3`, a window of 35 s for fast 504s. The first push
  showed that it's too short (see "Push runs"), and `43b1eb29e` raised it to 6.
* A comment above the three values gives the reason, and the `./gradlew wrapper` options that
  keep them. The `wrapper` task writes `networkTimeout`, `retries` and `retryBackOffMs` from its
  own properties and reads only `distributionSha256Sum` from the existing file, so an upgrade
  without those options resets them.

Why not reuse a distribution instead:

* setup-gradle already reuses it when the branch has a cache entry (the 09:18 jobs). When it
  has none, no other copy is reachable: entries of other branches can't be read, and a job's
  runner starts empty.
* A separate cache of `~/.gradle/wrapper/dists` keyed on the wrapper version would have the same
  branch scope and 7-day removal, and would add about 130 MB per branch to a repository that
  dropped the uPortal build's cache for its size (MOD-I348).
* The `Build uPortal` job that every other job waits for could hand the distribution on as an
  artifact, but only when it builds. Most runs reuse an earlier build and don't run Gradle.

This change also changes the cache key (it hashes `gradle-wrapper.properties`). The first push
of each branch after it starts without a cache entry once, with the new settings in place.

## Evidence

### Local, against a server that stalls or answers 504

A wrapper-only project in the scratchpad contains this branch's `gradlew` and `gradle/wrapper`
files, with `distributionUrl` changed to
`http://127.0.0.1:18731/distributions/gradle-9.8.1-bin.zip`. Each run gets an empty Gradle home.
A small Python server answers request n after the delay given for it, answers 504 at once
("504"), or never answers ("stall", it closes the connection after 60 s). It serves a 3-entry
zip, so a run that gets the file fails afterwards with `does not appear to contain a Gradle
distribution`. The three 504 runs ran in parallel, on ports 18731 to 18733. Command, the
same for every row, on OpenJDK 21:

```sh
GRADLE_USER_HOME=<empty dir> JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew --version
```

| Settings | Server | Result | Time |
| --- | --- | --- | --- |
| tip (10000, 0, 500) | stall | `Attempt 1/1 failed. Reason: Downloading from http://127.0.0.1:18731/... failed: timeout (10000ms)`, `Caused by: java.net.SocketTimeoutException: Read timed out`, exit 1. The message from CI | 10 s |
| tip | answers after 15 s | the same failure | 11 s |
| `4ac81b5f4` (30000, 3, 5000) | answers after 15 s | `Fetching distribution (retrying 3 times, with an initial back off of 5000 ms).`, download 100 % | 16 s |
| `4ac81b5f4` | stall, then answers after 15 s | `Attempt 1/4 failed. ... timeout (30000ms)`, second request 5 s later, download 100 % | 50 s |
| `4ac81b5f4` | stall 4 times | `Attempt 1/4` to `Attempt 4/4 failed`, requests at +1, +36, +76 and +126 s, exit 1 with the timeout as the cause | 155 s |
| `4ac81b5f4` | 504 six times, then the file | `Attempt 1/4` to `Attempt 4/4 failed. Reason: Server returned HTTP response code: 504`, exit 1. As in the first push's 3 failed jobs | 35 s |
| `43b1eb29e` (30000, 6, 5000) | 504 six times, then the file | `Fetching distribution (retrying 6 times, with an initial back off of 5000 ms).`, `Attempt 1/7` to `Attempt 6/7 failed`, then download 100 % | 315 s |
| `43b1eb29e` | 504 seven times | `Attempt 1/7` to `Attempt 7/7 failed`, exit 1 with the 504 as the cause | 315 s |

With 6 retries a run of fast failures ends after 315 s. When every attempt stalls
for the full 30 s read timeout, the bound is 7 × 30 s + 315 s, about 9 minutes, and about 12
minutes if every connection also takes 30 s to time out. The jobs' timeouts are 45 to 90
minutes.

### Checks

* `actionlint` 1.7.12 and `zizmor --offline` 1.30.1 on `.github/workflows`: no findings. No
  workflow changed.
* `check-uportal-downloads.py`: 17 downloads, 0 problems. `check-uportal-downloads.test.sh`:
  11 rows, 0 failed.
* `npm run lint` didn't run: no TypeScript changed.
* `check-commit-messages.sh` passes. `vale.sh` couldn't install Vale here (GitHub's release
  download answered 504 four times). Vale 3.24.0 and ai-tells 1.37.0, already installed in
  `/home/user/uPortal/.github/vale`, ran with this repository's `commits.ini` and `.vale.ini`
  and the same uPortal style: 0 findings in the commit messages and in this note.

No portal ran for this topic.

### Push runs

**First push, `6fbb36846` (retries=3).** The runs built uPortal's integration branch at
`1d485034e` (the build of run 42466854840, reused). This branch had no cache entry, and every
Gradle job fetched the distribution. Every log shows `Fetching distribution (retrying 3 times,
with an initial back off of 5000 ms).` Between 09:51:01 and 09:53:45 UTC most requests got
`Server returned HTTP response code: 504`:

| Job | First attempt | Attempts | Result of the download |
| --- | --- | --- | --- |
| ubuntu-latest (CI 42468899207), 128694777094 | 09:51:01 | 504, 504, 504, then the file at 09:51:50 | passed |
| Cluster: two nodes (Integration 42468899132), 128694850466 | 09:51:30 | the file | passed |
| Playwright: hsqldb (Integration), 128694850414 | 09:51:30 | 504, 504, then the file at 09:51:47 | passed |
| In place: postgres-18 (Migration equivalence 42468899110), 128694869115 | 09:51:33 | 504, then the file at 09:51:39 | passed |
| Playwright: hsqldb, CAS (Integration), 128694850406 | 09:51:36 | 504 four times, until 09:52:35. Its next Gradle step got 504 four times too | failed |
| Replay against 5.17 (HTTP replay 42468899108), 128694891871 | 09:51:39 | 504, 504, 504, then the file at 09:52:28 | passed |
| Copy: mariadb-11.4 to postgres-18 (Migration equivalence), 128694869129 | 09:51:50 | 504 four times, until 09:52:40 | failed |
| DB harness: postgres-18 (Integration), 128694850458 | 09:52:57 | 504 four times, until 09:53:45 | failed |
| G-migrate: mariadb-11.4 to postgres-18 (Integration), 128694850380 | 09:53:02 | the file | passed |
| Playwright: postgres-18 (Integration), 128694850388 | 09:53:02 | the file | passed |

With the tip's settings, only the 3 jobs that got the file on the first attempt would have
passed. With `retries=3`, 7 passed, and the 3 that failed spent 35 to 50 s on their 4 attempts
while other jobs got the file in between. In the same minutes, "Prose (Vale)"
(128694777261) and "Commit messages" (128694777375) of CI failed while `vale.sh` downloaded Vale
from GitHub releases (`curl: (22) The requested URL returned error: 504`, four times each, from
09:51:20 to 09:51:43). The commit subject check in that job passed (`Checked 390 commit(s); 0
with problems.`).

Other results of that push: HTTP replay and G-index passed. "Playwright: postgres-18" got the
distribution and then failed on a test that passed only on a retry,
`background-preference.spec.ts:108` ("offers None and the three images, each with a thumbnail"),
which this branch doesn't change.

**Second push, `43b1eb29e` (retries=6).** Next step: read its runs. The cache key changed
again with `gradle-wrapper.properties`. Its Gradle jobs fetch the distribution once more.
Look for `Fetching distribution (retrying 6 times, with an initial back off of 5000 ms).` and
whether each download passed.

## Left open

* uPortal's `gradle/wrapper/gradle-wrapper.properties` has the same `networkTimeout=10000`
  and `retries=0`. The four `Build uPortal` jobs run that wrapper with the cache disabled. The
  same three lines in uPortal would cover them. That's a uPortal change, outside this topic.
* uPortal-start's wrapper properties have no `distributionSha256Sum`, and uPortal's have one.
  setup-gradle checks the wrapper jar, and nothing checks the downloaded distribution. Outside
  this topic.
* `vale.sh` downloads Vale and the ai-tells styles from GitHub releases in every "Prose (Vale)"
  and "Commit messages" job, with `curl --retry 3` (1, 2 and 4 s apart). The 504s of
  2026-11-08 failed both jobs. Outside this topic.
* An outage longer than about 5 minutes still fails a job. Re-run such a job once, as the guide
  says for a job that stopped before any test ran.

## Proposed LOG row

| ID | Area | Issue | Status |
| --- | --- | --- | --- |
| MOD-I? | CI | On 2026-11-08 the tip's Cluster and DB harness: postgres-18 jobs (Integration 42463431999) and In place: mariadb-12.3 and Copy: mariadb-11.4 to postgres-18 (Migration equivalence 42463431964) failed before any test ran. The Gradle wrapper gave up on services.gradle.org after 10 s (`networkTimeout=10000`, `retries=0`). Every Gradle job downloads the distribution when its branch has no Gradle cache entry, as on a topic branch's first push or after a build file change. The tip's entry of 2026-10-15 was gone after 24 days without a push, and 32 jobs downloaded the distribution on that push. | **Fixed** (uPortal-start, this branch): the wrapper waits 30 s for each read and retries the download 6 times, 5 s to 160 s apart (315 s for a run of fast 504s). services.gradle.org redirects to GitHub releases, which answered 504 for minutes on 2026-11-08. uPortal's wrapper, used by the `Build uPortal` jobs, still has the old values (`notes/gradle-download.md`). |
