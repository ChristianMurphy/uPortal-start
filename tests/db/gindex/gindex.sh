#!/usr/bin/env bash
#
# G-index: large-campus database workload and index audit (MOD-D12). See docs/g-index.md.
#
#   tests/db/gindex/gindex.sh [options] <vendor> [-- <extra Gradle arguments>]
#
# For one vendor (postgres-18 or mariadb-12.3): start the database with statement statistics on,
# deploy every overlay, dataInit, customize a template user's layout, generate and bulk-load the
# synthetic campus (tests/db/gindex/generate.py), start the portal and run the workload (the whole
# Playwright suite, the concurrent browsing and login driver, and the analytics jobs that the portal
# schedules), then audit every captured statement and every index (tests/db/gindex/audit.py).
#
# Options:
#   --scale X         fraction of the MOD-Q7 campus (default 0.01: 1,000 users, 50,000 events/day)
#   --seed N          generator and driver seed (default 42)
#   --now ISO         the dataset's present (default: now, to the minute)
#   --duration S      seconds the driver runs (default 240)
#   --concurrency N   driver users at once (default 16)
#   --no-suite        skip the Playwright suite (the driver and the jobs still run)
#   --min-rows N      seq-scan check: smallest table that counts (default 1000)
#   --fault F         seed a fault after the load, to prove the audit fails (repeatable):
#                       drop-index:<index>              drop an index the workload needs
#                       duplicate-index:<table>:<cols>  add a second index on the same columns
#   --external        the database is already running (as started by this script); no Docker run
#   --keep            leave the database container running afterwards
#   --no-deploy       reuse the Tomcat and webapps already deployed in this checkout
#   --reuse           the database is running and loaded (by an earlier --keep run): only seed the
#                     faults, run the workload and audit (implies --external and --no-deploy); the
#                     way to compare the workload before and after an index change
#   --ddl FILE        run this SQL file before the workload (an index change to try)
#
# Everything a run produces is in build/g-index/<vendor>/: load.md, workload.md, findings.json,
# summary.md, plans (PostgreSQL), the driver and Playwright logs. On GitHub Actions the load,
# workload and audit tables go to the job summary and failing findings become annotations.
#
# Exit status: 0 when the workload ran and the audit passed; 1 otherwise.
#
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 2
ROOT=$(pwd)

SCALE=0.01
SEED=42
NOW=""
DURATION=240
CONCURRENCY=16
SUITE=true
MIN_ROWS=1000
FAULTS=()
EXTERNAL=false
KEEP=false
DEPLOY=true
REUSE=false
DDL=""
VENDOR=""
GRADLE_EXTRA=()

while [ $# -gt 0 ]; do
    case "$1" in
        --scale) SCALE="$2"; shift ;;
        --seed) SEED="$2"; shift ;;
        --now) NOW="$2"; shift ;;
        --duration) DURATION="$2"; shift ;;
        --concurrency) CONCURRENCY="$2"; shift ;;
        --no-suite) SUITE=false ;;
        --min-rows) MIN_ROWS="$2"; shift ;;
        --fault) FAULTS+=("$2"); shift ;;
        --external) EXTERNAL=true ;;
        --keep) KEEP=true ;;
        --no-deploy) DEPLOY=false ;;
        --reuse) REUSE=true; EXTERNAL=true; DEPLOY=false ;;
        --ddl) DDL="$2"; shift ;;
        --) shift; GRADLE_EXTRA=("$@"); break ;;
        -h|--help) sed -n '2,41p' "$0"; exit 0 ;;
        -*) echo "Unknown option: $1" >&2; exit 2 ;;
        *) VENDOR="$1" ;;
    esac
    shift
done

case "$VENDOR" in
    postgres-*) FAMILY=postgres ;;
    mariadb-*) FAMILY=mariadb ;;
    *) echo "Usage: $0 [options] postgres-18|mariadb-12.3 [-- <gradle args>]" >&2; exit 2 ;;
esac
NOW=${NOW:-$(date -u +%Y-%m-%dT%H:%M:00)}

HTTP_PORT=8080
for arg in "${GRADLE_EXTRA[@]+"${GRADLE_EXTRA[@]}"}"; do
    case "$arg" in -PtomcatHttpPort=*) HTTP_PORT="${arg#-PtomcatHttpPort=}" ;; esac
done
URL="http://localhost:$HTTP_PORT/uPortal/"

# shellcheck source=tests/db/lib.sh
. tests/db/lib.sh

OUT="build/g-index/$VENDOR"
CONTAINER=$(container_name "$VENDOR")
GEN=(python3 -I tests/db/gindex/generate.py)
mkdir -p "$OUT"
rm -f "$OUT"/*.md "$OUT"/findings.json "$OUT"/plans.json*

step() { echo; echo "==== G-index $VENDOR: $*"; }

summary() {  # summary <file>: append to the GitHub job summary
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ] && [ -f "$1" ]; then cat "$1" >> "$GITHUB_STEP_SUMMARY"; fi
}

dbsql() {  # dbsql: run the SQL on stdin as the portal's database user, print the rows
    if [ "$FAMILY" = postgres ]; then
        docker exec -i -e PGPASSWORD=uportal "$CONTAINER" psql -U uportal -d uportal -AtqX -v ON_ERROR_STOP=1
    else
        docker exec -i -e MYSQL_PWD=uportal-root "$CONTAINER" mariadb -u root -D uportal -N -B
    fi
}

start_gindex_database() {
    # The vendor file's container, plus what the capture needs: pg_stat_statements and
    # auto_explain (plans of executed statements, logged as JSON; off until the workload starts).
    # auto_explain.log_min_duration stays off the command line: a -c setting overrides the
    # ALTER SYSTEM that turns it on for the workload
    # on PostgreSQL, performance_schema on MariaDB
    local image port env args hostport envargs=() kv
    image=$(prop "$VENDOR" container.image)
    port=$(prop "$VENDOR" container.port)
    env=$(prop "$VENDOR" container.env)
    args=$(prop "$VENDOR" container.args)
    hostport=$(prop "$VENDOR" host.port)
    for kv in $env; do envargs+=(-e "$kv"); done
    local extra=()
    if [ "$FAMILY" = postgres ]; then
        # shellcheck disable=SC2054  # commas inside one -c value
        extra=(-c shared_preload_libraries=pg_stat_statements,auto_explain -c compute_query_id=on
               -c pg_stat_statements.max=20000 -c pg_stat_statements.track=all -c track_io_timing=on
               -c logging_collector=on -c log_destination=jsonlog -c log_directory=gindex-log
               -c log_filename=postgresql -c log_rotation_size=0 -c log_rotation_age=0
               -c auto_explain.log_analyze=on
               -c auto_explain.log_buffers=on -c auto_explain.log_timing=off -c auto_explain.log_format=json
               -c auto_explain.log_verbose=off -c auto_explain.log_nested_statements=on
               -c shared_buffers=512MB -c max_wal_size=4GB -c max_connections=300)
    else
        extra=(--performance-schema=ON --local-infile=1 --innodb-buffer-pool-size=1G --max-connections=300
               --performance-schema-digests-size=20000 --max-digest-length=4096
               --performance-schema-max-digest-length=4096)
    fi
    docker rm -f "$CONTAINER" > /dev/null 2>&1 || true
    # shellcheck disable=SC2086
    docker run -d --name "$CONTAINER" -p "$hostport:$port" --shm-size=1g "${envargs[@]}" "$image" $args \
        "${extra[@]}" > /dev/null || return 1
    echo "Started $image as $CONTAINER on port $hostport"
}

portal_properties() {
    # The MOD-Q7 retention (30 days of raw events) and analytics jobs that run every ~20 s instead
    # of every ~60 s, so a short workload sees each of them several times. The aggregation job may
    # cross 50 intervals per run instead of 5: it catches up on the loaded backlog in its first
    # runs and then closes live five-minute intervals (deleting their UP_UNIQUE_STR rows) in every
    # workload, not only on a fast runner
    local global=.gradle/tomcat/portal/global.properties
    sed -i '/^## G-index workload/,$d' "$global"
    cat >> "$global" <<'EOF'
## G-index workload (tests/db/gindex/gindex.sh)
org.apereo.portal.events.aggr.PortalEventPurgerImpl.purgeDelay=P30D
org.apereo.portal.events.aggr.PortalEventProcessingManagerImpl.aggregateRawEventsPeriod=20011
org.apereo.portal.events.aggr.PortalRawEventsAggregatorImpl.intervalAggregationBatchSize=50
org.apereo.portal.events.aggr.PortalEventProcessingManagerImpl.purgeEventSessionsPeriod=20021
org.apereo.portal.events.aggr.PortalEventProcessingManagerImpl.purgeRawEventsPeriod=20023
org.apereo.portal.portlet.container.services.PortletCookieServiceImpl.purgeExpiredCookiesPeriod=30011
EOF
}

customize_template() {
    # A real layout customization by the quickstart student (a tab with two columns, a favorite),
    # made through the layout API so DLM writes the rows; the generator clones them
    local jar="$OUT/template.cookies" home tok cal
    home=$(curl -s -c "$jar" -b "$jar" -L "${URL}Login?userName=student&password=student")
    tok=$(grep -o '_csrf=[0-9a-f-]*' <<< "$home" | head -1 | cut -d= -f2)
    cal=$(echo "SELECT portlet_def_id FROM up_portlet_def WHERE portlet_fname = 'calendar';" | dbsql | tr -d '[:space:]')
    curl -sf -b "$jar" -c "$jar" -X POST "${URL}api/layout" \
        --data "_csrf=$tok&action=addTab&widths%5B%5D=50&widths%5B%5D=50&tabName=My%20Stuff" > /dev/null || return 1
    curl -sf -b "$jar" -c "$jar" -X POST "${URL}api/layout" \
        --data "_csrf=$tok&action=addFavorite&channelId=$cal" > /dev/null || return 1
    curl -s -b "$jar" "${URL}Logout" > /dev/null
}

reset_template() {
    # Give the student back the layout the Playwright specs expect
    dbsql <<'EOF'
DELETE FROM up_layout_param WHERE user_id = (SELECT user_id FROM up_user WHERE user_name = 'student');
DELETE FROM up_layout_struct WHERE user_id = (SELECT user_id FROM up_user WHERE user_name = 'student');
DELETE FROM up_user_layout WHERE user_id = (SELECT user_id FROM up_user WHERE user_name = 'student');
UPDATE up_user SET next_struct_id = 2 WHERE user_name = 'student';
UPDATE up_user_profile SET layout_id = 0 WHERE user_id = (SELECT user_id FROM up_user WHERE user_name = 'student');
EOF
}

seed_faults() {
    local fault table cols name
    for fault in "${FAULTS[@]+"${FAULTS[@]}"}"; do
        case "$fault" in
            drop-index:*)
                name="${fault#drop-index:}"
                echo "Seeded fault: dropping index $name"
                if [ "$FAMILY" = postgres ]; then
                    echo "DROP INDEX $name;" | dbsql || return 1
                else
                    table=$(echo "SELECT table_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND index_name = '$name' LIMIT 1;" | dbsql)
                    echo "ALTER TABLE $table DROP INDEX $name;" | dbsql || return 1
                fi ;;
            duplicate-index:*)
                IFS=: read -r _ table cols <<< "$fault"
                echo "Seeded fault: a second index on $table ($cols)"
                echo "CREATE INDEX gx_fault_dup ON $table ($cols);" | dbsql || return 1 ;;
            *) echo "Unknown fault $fault" >&2; return 1 ;;
        esac
    done
}

capture() {  # capture on|off
    if [ "$FAMILY" = postgres ]; then
        if [ "$1" = on ]; then
            # In a schema of its own, so the audit and the harness see only uPortal's objects
            dbsql <<'EOF' || return 1
CREATE SCHEMA IF NOT EXISTS gindex;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA gindex;
SELECT gindex.pg_stat_statements_reset();
SELECT pg_stat_reset();
ALTER SYSTEM SET auto_explain.log_min_duration = 0;
SELECT pg_reload_conf();
EOF
            # Plans logged so far (the load) are not the workload's
            docker exec "$CONTAINER" sh -c ': > "$PGDATA/gindex-log/postgresql.json"'
        else
            # Freeze the workload's statements, so the audit's own queries stay out of them
            dbsql <<'EOF'
ALTER SYSTEM RESET auto_explain.log_min_duration;
SELECT pg_reload_conf();
DROP TABLE IF EXISTS gindex.workload_statements;
CREATE TABLE gindex.workload_statements AS
  SELECT s.* FROM gindex.pg_stat_statements s JOIN pg_database d ON d.oid = s.dbid
  WHERE d.datname = current_database() AND s.query NOT LIKE '%gindex.%';
DROP TABLE IF EXISTS gindex.workload_index_usage;
CREATE TABLE gindex.workload_index_usage AS
  SELECT relname, indexrelname, idx_scan FROM pg_stat_user_indexes WHERE schemaname = 'public';
EOF
        fi
    else
        if [ "$1" = on ]; then
            dbsql <<'EOF' || return 1
TRUNCATE TABLE performance_schema.events_statements_summary_by_digest;
TRUNCATE TABLE performance_schema.table_io_waits_summary_by_index_usage;
EOF
        else
            # Freeze the workload's digests and index use in a database of their own
            dbsql <<'EOF'
CREATE DATABASE IF NOT EXISTS gindex;
DROP TABLE IF EXISTS gindex.workload_digests;
CREATE TABLE gindex.workload_digests AS
  SELECT * FROM performance_schema.events_statements_summary_by_digest WHERE schema_name = 'uportal';
DROP TABLE IF EXISTS gindex.workload_index_usage;
CREATE TABLE gindex.workload_index_usage AS
  SELECT * FROM performance_schema.table_io_waits_summary_by_index_usage WHERE object_schema = 'uportal';
EOF
        fi
    fi
}

job_report() {
    # Proof that each analytics job ran during the workload, from the captured statements
    local q
    if [ "$FAMILY" = postgres ]; then
        q="SELECT j.job, coalesce(sum(s.calls), 0) FROM (VALUES
            ('raw-event aggregation', '%from up_raw_events %aggregated%'),
            ('raw events marked aggregated', 'update up_raw_events set aggregated%'),
            ('raw-event purge', 'delete from up_raw_events%'),
            ('event-session purge', '%from up_event_session %last_accessed<%'),
            ('portal-cookie purge', 'delete from up_portal_cookies%'),
            ('closed intervals (unique strings deleted)', 'delete from up_unique_str %'),
            ('login', '%from up_person_dir %')) j(job, pattern)
          LEFT JOIN gindex.workload_statements s ON lower(s.query) LIKE j.pattern
          GROUP BY j.job ORDER BY j.job;"
    else
        q="SELECT j.job, COALESCE(SUM(s.count_star), 0) FROM (
            SELECT 'raw-event aggregation' AS job, '%from \`up_raw_events\` %aggregated%' AS pattern UNION ALL
            SELECT 'raw events marked aggregated', 'update \`up_raw_events\` set \`aggregated\`%' UNION ALL
            SELECT 'raw-event purge', 'delete from \`up_raw_events\`%' UNION ALL
            SELECT 'event-session purge', '%from \`up_event_session\` %\`last_accessed\` <%' UNION ALL
            SELECT 'portal-cookie purge', 'delete from \`up_portal_cookies\`%' UNION ALL
            SELECT 'closed intervals (unique strings deleted)', 'delete from \`up_unique_str\` %' UNION ALL
            SELECT 'login', '%from \`up_person_dir\` %') j
          LEFT JOIN gindex.workload_digests s ON LOWER(s.digest_text) LIKE j.pattern
          GROUP BY j.job ORDER BY j.job;"
    fi
    echo "$q" | dbsql | tr '|\t' '  '
}

run() {
    if [ "$EXTERNAL" = false ]; then
        step "start the database"
        start_gindex_database || return 1
    fi
    use_vendor "$VENDOR"
    if [ "$REUSE" = false ]; then
        prepare || return 1
    fi
    seed_faults || return 1
    if [ -n "$DDL" ]; then
        echo "Index change from $DDL:"; cat "$DDL"
        dbsql < "$DDL" || return 1
    fi
    workload
}

prepare() {
    step "deploy and dataInit"
    local tasks=(dbWait dbSetup dataInit)
    if [ "$DEPLOY" = true ]; then tasks=(tomcatInstall tomcatDeploy "${tasks[@]}"); else tasks=(tomcatConfig "${tasks[@]}"); fi
    gradle -PdbVendor="$VENDOR" "${tasks[@]}" 2>&1 | tee "$OUT/deploy.log" | grep -E '^> Task|BUILD|FAIL|rror' || true
    [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "deploy or dataInit failed; see $OUT/deploy.log" >&2; return 1; }
    portal_properties

    step "template user"
    start_portal "$VENDOR" || return 1
    customize_template || { echo "could not customize the template user's layout" >&2; stop_own_tomcat "$VENDOR"; return 1; }
    stop_own_tomcat "$VENDOR"
    "${GEN[@]}" reference --vendor "$FAMILY" --container "$CONTAINER" --out "$OUT/reference.json" || return 1
    reset_template || return 1

    step "generate and load (scale $SCALE, seed $SEED, now $NOW)"
    "${GEN[@]}" load --vendor "$FAMILY" --container "$CONTAINER" --ref "$OUT/reference.json" --scale "$SCALE" \
        --seed "$SEED" --now "$NOW" --jobs "$(nproc)" --report "$OUT/load.md" || return 1
    summary "$OUT/load.md"
}

workload() {
    local status=0
    step "workload"
    portal_properties
    capture on || { echo "could not reset the statement statistics" >&2; return 1; }
    local started
    started=$(date +%s)
    start_portal "$VENDOR" || return 1
    if [ "$SUITE" = true ]; then
        PORTAL_BASE_URL="$URL" npx playwright test --config=tests/uportal-pw.config.ts --reporter=list \
            --output="$OUT/playwright" > "$OUT/playwright.log" 2>&1
        echo "Playwright suite: $(grep -E '^ +[0-9]+ (passed|failed|flaky|skipped)' "$OUT/playwright.log" | tr -s ' ' | tr '\n' ',')"
    fi
    node tests/db/gindex/driver.mjs --url "$URL" --users "$(python3 -c "print(max(50, round(100000 * $SCALE)))")" \
        --concurrency "$CONCURRENCY" --duration "$DURATION" --seed "$SEED" > "$OUT/driver.json" 2> "$OUT/driver.log" || status=1
    cat "$OUT/driver.json" "$OUT/driver.log"
    # The analytics jobs start 120 s after the portal and then run every ~20 s; give them three rounds
    while [ $(( $(date +%s) - started )) -lt 200 ]; do sleep 10; done
    # Stop the portal first: its pools hold most of the database's connections
    stop_own_tomcat "$VENDOR"
    capture off || { echo "could not freeze the captured statements" >&2; return 1; }
    local elapsed=$(( $(date +%s) - started ))

    {
        echo "### G-index workload ($VENDOR)"
        echo
        echo "Portal start, $([ "$SUITE" = true ] && echo "the whole Playwright suite ($(grep -E '^ +[0-9]+ (passed|failed|flaky)' "$OUT/playwright.log" | tr -s ' ' | sed 's/^ //' | paste -sd, -)), ")the driver ($CONCURRENCY users for $DURATION s: $(python3 -c "import json; d=json.load(open('$OUT/driver.json')); print(f\"{d['requests']} requests, {d['logins']} logins, {d['errors']} errors\")" 2>/dev/null || echo 'no result')) and the analytics jobs; $elapsed s in all."
        echo
        echo "| Job or path | Executions captured |"
        echo "| --- | ---: |"
        job_report | awk '{n=$NF; $NF=""; printf "| %s | %s |\n", $0, n}'
        echo
    } > "$OUT/workload.md"
    cat "$OUT/workload.md"
    summary "$OUT/workload.md"
    for job in 'raw-event aggregation' 'raw events marked aggregated' 'raw-event purge' 'event-session purge' \
            'closed intervals \(unique strings deleted\)'; do
        if ! grep -E "^\| $job +\| [1-9]" "$OUT/workload.md" > /dev/null; then
            echo "The workload is incomplete: the $job job did not run" >&2
            github_annotation error "G-index $VENDOR" "The workload is incomplete: the $job job did not run"
            status=1
        fi
    done

    step "audit"
    local plans=()
    if [ "$FAMILY" = postgres ]; then
        docker exec "$CONTAINER" sh -c 'cat "$PGDATA/gindex-log/postgresql.json"' > "$OUT/plans.jsonl"
        ls -la "$OUT/plans.jsonl"
        plans=(--plans "$OUT/plans.jsonl")
    fi
    local audit_container="$CONTAINER" audit_user=uportal audit_password=uportal
    if [ "$FAMILY" = mariadb ]; then audit_user=root; audit_password=uportal-root; fi
    python3 -I tests/db/gindex/audit.py --vendor "$FAMILY" --container "$audit_container" \
        --user "$audit_user" --password "$audit_password" "${plans[@]+"${plans[@]}"}" \
        --min-rows "$MIN_ROWS" --label "$VENDOR (scale $SCALE)" --out "$OUT" || status=1
    return $status
}

run
status=$?
if [ "$KEEP" = false ] && [ "$EXTERNAL" = false ]; then
    docker rm -f "$CONTAINER" > /dev/null 2>&1 || true
fi
echo "==== G-index $VENDOR: $([ $status -eq 0 ] && echo PASSED || echo FAILED)"
exit $status
