# Handoff: gradle-download (wrapper download timeouts on 2026-11-08)

The branch is `ccr-43ba0785-hzlrj5-gradle-download` in uPortal-start, from the integration tip
`a0a125fee`. uPortal has no branch of this name. Its runs build the uPortal integration branch.

On the tip's push runs of 2026-11-08, four jobs failed before any test ran. Each one's first
`./gradlew` call downloaded `gradle-9.8.1-bin.zip`, and the wrapper gave up after 10 s:
`Downloading from https://services.gradle.org/distributions/gradle-9.8.1-bin.zip failed: timeout
(10000ms)`, caused by `java.net.SocketTimeoutException: Read timed out` in
`HttpURLConnection.getResponseCode`. The server accepted the connection and didn't send a
response header within 10 s.

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
* `retries=3` and `retryBackOffMs=5000` (were 0 and 500). The Gradle 9.8.1 wrapper
  (`Install.forceFetch`) retries the download on an `IOException`, with a new connection and a
  new `.part` file each time, and doubles the wait each time: 5, 10 and 20 s. A stalled
  connection gets replaced, and an outage like the one that day (about 50 s) ends before the
  last attempt. The retry covers the distribution download only. The build itself still runs
  once.
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

### Local, against a server that stalls

A wrapper-only project in the scratchpad contains this branch's `gradlew` and `gradle/wrapper`
files, with `distributionUrl` changed to
`http://127.0.0.1:18731/distributions/gradle-9.8.1-bin.zip`. Each run gets an empty Gradle home.
A small Python server answers request n after the delay given for it, or never answers
("stall", it closes the connection after 60 s). It serves a 3-entry zip, so a run that gets the
file fails afterwards with `does not appear to contain a Gradle distribution`. Command, the same
for every row, on OpenJDK 21:

```sh
GRADLE_USER_HOME=<empty dir> JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew --version
```

| Settings | Server | Result | Time |
| --- | --- | --- | --- |
| tip (10000, 0, 500) | stall | `Attempt 1/1 failed. Reason: Downloading from http://127.0.0.1:18731/... failed: timeout (10000ms)`, `Caused by: java.net.SocketTimeoutException: Read timed out`, exit 1. The message from CI | 10 s |
| tip | answers after 15 s | the same failure | 11 s |
| this branch (30000, 3, 5000) | answers after 15 s | `Fetching distribution (retrying 3 times, with an initial back off of 5000 ms).`, download 100 % | 16 s |
| this branch | stall, then answers after 15 s | `Attempt 1/4 failed. ... timeout (30000ms)`, second request 5 s later, download 100 % | 50 s |
| this branch | stall 4 times | `Attempt 1/4` to `Attempt 4/4 failed`, requests at +1, +36, +76 and +126 s, exit 1 with the timeout as the cause | 155 s |

The last row is the bound: when the server accepts connections and never answers, a job fails
after about 2.5 minutes. When the connection itself times out as well, the bound is about 4.6
minutes (4 attempts of up to 30 s to connect and 30 s to read, plus 35 s of waits).

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

Next step: push, then read the Integration and Migration equivalence runs. This branch has no
cache entry on its first push. Every Gradle job downloads the distribution there. Look for
`Fetching distribution (retrying 3 times, with an initial back off of 5000 ms).` and a passing
job.

## Left open

* uPortal's `gradle/wrapper/gradle-wrapper.properties` has the same `networkTimeout=10000`
  and `retries=0`. The four `Build uPortal` jobs run that wrapper with the cache disabled. The
  same three lines in uPortal would cover them. That's a uPortal change, outside this topic.
* uPortal-start's wrapper properties have no `distributionSha256Sum`, and uPortal's have one.
  setup-gradle checks the wrapper jar, and nothing checks the downloaded distribution. Outside
  this topic.

## Proposed LOG row

| ID | Area | Issue | Status |
| --- | --- | --- | --- |
| MOD-I? | CI | On 2026-11-08 the tip's Cluster and DB harness: postgres-18 jobs (Integration 42463431999) and In place: mariadb-12.3 and Copy: mariadb-11.4 to postgres-18 (Migration equivalence 42463431964) failed before any test ran. The Gradle wrapper gave up on services.gradle.org after 10 s (`networkTimeout=10000`, `retries=0`). Every Gradle job downloads the distribution when its branch has no Gradle cache entry, as on a topic branch's first push or after a build file change. The tip's entry of 2026-10-15 was gone after 24 days without a push, and 32 jobs downloaded the distribution on that push. | **Fixed** (uPortal-start, this branch): the wrapper waits 30 s for each read and retries the download 3 times, 5, 10 and 20 s apart. uPortal's wrapper, used by the `Build uPortal` jobs, still has the old values (`notes/gradle-download.md`). |
