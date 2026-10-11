#!/usr/bin/env bash
#
# Copy-migration check (G-migrate, MOD-D11/MOD-D25). See "Copy migration" in
# docs/db-upgrade-harness.md.
#
# For one source and one target vendor (files in tests/db/vendors):
#   1. start both databases (throwaway containers, or uPortal-start's HSQLDB server);
#   2. source: deploy every overlay for it, dataInit, start the portal and run the Playwright API
#      specs, so it holds a used 5.17 portal's data (events, portlet lists, the tables that
#      Bookmarks, Feedback and Notification create on first start);
#   3. target: deploy for it, dataInit, start the portal once (MOD-I92: those portlet tables must
#      exist before the copy) and stop it;
#   4. ./gradlew dbMigrate -PsourceDbVendor=<source> -PtargetDbVendor=<target>
#      -PdbMigrateClearTarget, which copies, positions the generators and verifies every table;
#   5. with --playwright: start the portal on the migrated target and run the whole Playwright suite
#      (needs `npx playwright install chromium`).
#
#   tests/db/migrate.sh [--playwright] [--keep] <source> <target> [-- <extra Gradle arguments>]
#
# Needs Docker, `npm ci`, and the uPortal build (uPortalVersion) including uPortal-db-migrate.
# Everything a run produces is in build/db-migrate/ (the tool's JSON report) and
# build/db-migrate/<source>-to-<target>/ (logs, Playwright output).
# Exit status: 0 when every step passed, 1 otherwise.
#
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

PLAYWRIGHT=false
KEEP=false
VENDORS=()
GRADLE_EXTRA=()
while [ $# -gt 0 ]; do
    case "$1" in
        --playwright) PLAYWRIGHT=true ;;
        --keep) KEEP=true ;;
        --) shift; GRADLE_EXTRA=("$@"); break ;;
        -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
        -*) echo "Unknown option: $1" >&2; exit 2 ;;
        *) VENDORS+=("$1") ;;
    esac
    shift
done
if [ ${#VENDORS[@]} -ne 2 ]; then
    echo "Usage: $0 [--playwright] [--keep] <source> <target> [-- <gradle args>]" >&2
    exit 2
fi
SOURCE=${VENDORS[0]}
TARGET=${VENDORS[1]}
for v in "$SOURCE" "$TARGET"; do
    if [ ! -f "tests/db/vendors/$v.properties" ]; then
        echo "Unknown vendor $v; vendors: $(cd tests/db/vendors && ls ./*.properties | sed 's#^\./##; s/\.properties$//' | tr '\n' ' ')" >&2
        exit 2
    fi
done
if [ "$SOURCE" = "$TARGET" ]; then
    echo "Source and target must be different databases" >&2
    exit 2
fi

HTTP_PORT=8080
for arg in "${GRADLE_EXTRA[@]+"${GRADLE_EXTRA[@]}"}"; do
    case "$arg" in -PtomcatHttpPort=*) HTTP_PORT="${arg#-PtomcatHttpPort=}" ;; esac
done

# shellcheck source=tests/db/lib.sh
. tests/db/lib.sh

PAIR="$SOURCE-to-$TARGET"
OUT="build/db-migrate/$PAIR"
mkdir -p "$OUT"
FAILED_STEP=
FAILED_LOG=

step() {  # step <name> <log> <command...>: run, log, time (see phase_begin); remember the first failure
    local name="$1" log="$OUT/$2" status
    shift 2
    phase_begin "$name"
    "$@" 2>&1 | tee "$log"
    status=${PIPESTATUS[0]}
    phase_end "$status"
    if [ "$status" -ne 0 ] && [ -z "$FAILED_STEP" ]; then FAILED_STEP=$name; FAILED_LOG=$log; fi
    return "$status"
}

deploy_and_init() {  # deploy_and_init <vendor>: every overlay against the vendor's database
    use_vendor "$1"
    gradle -PdbVendor="$1" tomcatInstall tomcatDeploy dbWait dbSetup dataInit
}

start_and_stop_portal() {  # MOD-I92: the first start creates the remaining portlet tables
    start_portal "$1" || return 1
    stop_own_tomcat "$1"
}

run_specs() {  # run_specs <vendor> <output dir> [spec paths]: Playwright against the running portal
    local vendor="$1" output="$2" status
    shift 2
    start_portal "$vendor" || return 1
    PORTAL_BASE_URL="http://localhost:$HTTP_PORT/uPortal/" npx playwright test \
        --config=tests/uportal-pw.config.ts "$@" "$(playwright_reporter)" --output="$output"
    status=$?
    stop_own_tomcat "$vendor"
    return $status
}

migrate() {
    # Only the two vendor files matter here: the source's gradle.args (e.g. its HSQLDB port) must
    # not leak into the target's settings
    use_vendor ''
    gradle dbMigrate -PsourceDbVendor="$SOURCE" -PtargetDbVendor="$TARGET" -PdbMigrateClearTarget
}

copy_summary() {  # the copy tool's own summary of this pair (build/db-migrate/<pair>.txt), if any
    local f="build/db-migrate/$PAIR.txt"
    [ -f "$f" ] || return 0
    head -n 5 "$f"
    tail -n +6 "$f" | grep -iE 'mismatch|fail|error|missing' | head -n 20
}

cleanup() {
    if [ "$KEEP" = false ]; then
        timed "stop the $SOURCE database" stop_database "$SOURCE"
        timed "stop the $TARGET database" stop_database "$TARGET"
    fi
}

echo "==== Copy migration $SOURCE ($(prop "$SOURCE" vendor.name)) -> $TARGET ($(prop "$TARGET" vendor.name))"
rm -f "build/db-migrate/$PAIR.json" "build/db-migrate/$PAIR.txt"
# Both databases start first: Oracle and SQL Server need a while before they accept connections
if ! timed "start the $SOURCE database" start_database "$SOURCE" || ! timed "start the $TARGET database" start_database "$TARGET"; then
    cleanup
    exit 1
fi

step "source: deploy, dataInit" source-init.log deploy_and_init "$SOURCE" &&
    step "source: API specs (portal activity)" source-api-specs.log \
        run_specs "$SOURCE" "$OUT/source-playwright" tests/api &&
    step "target: deploy, dataInit" target-init.log deploy_and_init "$TARGET" &&
    step "target: first start (portlet tables)" target-first-start.log start_and_stop_portal "$TARGET" &&
    step "dbMigrate (copy, generators, verify)" db-migrate.log migrate &&
    if [ "$PLAYWRIGHT" = true ]; then
        step "target: whole Playwright suite" target-playwright.log \
            run_specs "$TARGET" "$OUT/target-playwright"
    fi
status=$?
if [ -n "$FAILED_STEP" ] || [ "$status" -ne 0 ]; then
    # Before the containers go: did a database die (e.g. out of memory)?
    CONTAINERS=$(container_report "$SOURCE"; container_report "$TARGET")
    echo "$CONTAINERS"
fi
cleanup

phase_summary "Copy migration $PAIR phases"
echo "==== Copy migration $PAIR summary"
if [ -n "$FAILED_STEP" ] || [ "$status" -ne 0 ]; then
    echo "FAILED: ${FAILED_STEP:-starting the databases} ${FAILED_LOG:+(see $FAILED_LOG)}"
    if [ -f "$FAILED_LOG" ]; then
        case "$(basename "$FAILED_LOG")" in
            *playwright*|*specs*) text=$(failed_specs "$FAILED_LOG") ;;
            *db-migrate*) text="$(copy_summary)"$'\n'"$(grep -v '^\s*at ' "$FAILED_LOG" | grep -iE 'error|exception|caused by' | tail -n 20)" ;;
            *) text=$(grep -v '^\s*at ' "$FAILED_LOG" | grep -iE 'error|exception|fail|mismatch|caused by' | tail -n 30) ;;
        esac
        github_annotation error "G-migrate $PAIR: $FAILED_STEP" "${text:-$(tail -n 30 "$FAILED_LOG")}"
        text=$(tomcat_errors)
        if [ -n "$text" ]; then github_annotation warning "G-migrate $PAIR: Tomcat log errors" "$text"; fi
    fi
    if [ -n "${CONTAINERS:-}" ]; then github_annotation warning "G-migrate $PAIR: database containers" "$CONTAINERS"; fi
    exit 1
fi
echo "OK: $SOURCE copied to $TARGET and verified$([ "$PLAYWRIGHT" = true ] && echo ', Playwright suite passed on the target')"
github_annotation notice "G-migrate $PAIR: OK" "$(copy_summary)"$'\n'"$(printf '%s\n' "${TIMINGS[@]}")"
