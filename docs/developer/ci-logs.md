# Reading a failed CI job

A CI job log can run to several thousand lines, and the line that says why the job failed is one of
them. This page is the cheap way to find it. It applies to the uPortal-start workflows and to
uPortal's, which follow the same log rules (MOD-D53).

## Find the cause

1. Open the run's summary page first, before any log. It lists the failed jobs. The DB harness and
   G-migrate scripts also add an error annotation for a failed vendor or pair: the drift report, or
   the failed specs with their file and line. Often that is the whole answer.
2. Read the end of the failed job's log. With the GitHub tools, call `get_job_logs` with `run_id`,
   `failed_only: true`, `return_content: true` and `tail_lines: 300`. In the browser, open the failed
   step and go to its last lines.
3. Look in those lines for the first match in the table below.
4. If nothing matches, ask for more lines: 600, then 1000. `get_job_logs` returns at most 5000
   lines, whatever `tail_lines` says, and its `original_length` field gives the true number of
   lines in the log. Compare the two to see whether the start of the log was cut. For the whole log,
   take the archive URL from `actions_get` with `method: get_workflow_run_logs_url`.

| Kind of failure | What to look for in the last lines |
| --- | --- |
| Gradle task failed | `FAILURE: Build failed with an exception`, then `What went wrong` with the task and its cause. Compiler errors are above it, as `error:` lines. |
| DB harness found a difference | `RESULT: DRIFT`, then the changed tables and sequences. The whole report is in the `db-harness-<vendor>` artifact. |
| Playwright test failed | `N failed`, then one `file.spec.ts:line` for each failed test. The error and the code around the line are above that summary. |
| Data import failed | `N failed: FAIL: <type> - <file>`, then `Caused by:` lines from the report of each failed entity. |
| Tomcat did not start | The `Show Tomcat startup errors` step, which prints the errors from the Tomcat logs. |

## Output the workflows cut

These were cut so that the lines above are not buried. Each one has a switch for running the same
step on your own machine with the full output.

* **Compiler warnings.** uPortal builds with `-PquietCompile` in every job except the Linux,
  Temurin 21 leg of its `CI` workflow, and uPortal-start passes the property when it builds uPortal.
  Errors always print. Leave the property out to see the warnings.
* **Gradle stack traces.** The workflows no longer pass `-S` or `--stacktrace`, because Gradle's own
  frames were about 190 lines. The `What went wrong` block still names the task and its cause. To get a
  trace, run the step again with `--stacktrace`.
* **The data import.** With the `CI` environment variable set, or `-PquietImport`, the shell tools
  and the portlet import scripts log warnings and errors only. After each import the script prints
  one line per entity type, such as `Import from data/base: portlet-definition: 41 imported`.
  Without `CI`, or with `-PquietImport=false`, every entity logs its own line.
* **Passing Playwright tests.** With `CI` set, Playwright prints one dot for each passing test and
  the `github` reporter adds an annotation for each failure. Locally it prints a line for each test.
  The note that requests were still in flight after 3 seconds appears only for a test that failed;
  for a passing test it is in the HTML report.

## Time per phase

The DB harness, G-migrate, migration-equivalence and G-index scripts each run as one workflow step,
so the step list shows only their total time. Each script prints its phases (start the database,
deploy and load the data, start the portal, the Playwright run, stop the portal) as a log group,
and ends each one with a line such as `---- start the portal: 41s, ok`. A phase that failed ends
with `FAILED`, and its output is inside the group above that line. At the end the script prints the
table of all its phases, adds it to the run's job summary and writes it as a notice annotation,
which the annotations API of the job returns. Locally the groups are `====` headings.

## Output that stays

Warnings and errors from the code under test, the output of failed steps, and the result of every
check. A short log with no cause in it means one of the cuts above went too far. Report that job.
