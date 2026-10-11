#!/usr/bin/env bash
#
# Database upgrade harness runner. See docs/db-upgrade-harness.md.
#
# For each vendor (a file in tests/db/vendors): start a throwaway database container, run
# uPortal's dataInit against it, snapshot the resulting schema, and compare the snapshot with the
# recorded baseline in tests/db/snapshots/<baseline>/<vendor>.
#
#   tests/db/harness.sh [options] <vendor>... [-- <extra Gradle arguments>]
#
# Options:
#   --record        record the snapshots as the new baseline instead of comparing with it
#   --baseline X    compare with (or record into) tests/db/snapshots/X (default: the directory
#                   named after uPortalVersion's major.minor.patch if it exists, else 5.17);
#                   --record needs it
#   --external      the database is already running (e.g. a CI service container): no Docker
#   --keep          leave the database container running afterwards
#   --no-deploy     reuse the Tomcat + uPortal already deployed in this checkout for this vendor
#   --skip-init     do not run dataInit; snapshot the database as it is (e.g. after an upgrade)
#   --portal        also deploy CAS, start Tomcat against the database and run the Playwright
#                   API specs (needs `npm ci`); on PostgreSQL the LOB report is taken again after
#   --full-suite    like --portal, but deploy every overlay, create the portlets' tables after the
#                   snapshot and run the whole Playwright suite (needs `npm ci` and
#                   `npx playwright install chromium`)
#
# Environment:
#   HARNESS_DB_CONTAINER  with --external: the container to `docker exec` into for vacuumlo
#   HARNESS_BASELINE      the default for --baseline (empty: chosen from uPortalVersion)
#
# On GitHub Actions a failed vendor's drift report and failed specs become annotations on the run,
# and so does the snapshot itself (compressed) when it was recorded or had no baseline to compare
# with; tests/db/fetch-ci-snapshot.sh turns those back into baseline files.
#
# Exit status: 0 when every vendor ran and showed zero drift (or was recorded), 1 otherwise.
#
set -uo pipefail

cd "$(dirname "$0")/../.."
ROOT=$(pwd)

RECORD=false
BASELINE=${HARNESS_BASELINE:-}
EXTERNAL=false
KEEP=false
DEPLOY=true
INIT=true
PORTAL=false
FULL_SUITE=false
VENDORS=()
GRADLE_EXTRA=()

while [ $# -gt 0 ]; do
    case "$1" in
        --record) RECORD=true ;;
        --baseline) BASELINE="$2"; shift ;;
        --external) EXTERNAL=true ;;
        --keep) KEEP=true ;;
        --no-deploy) DEPLOY=false ;;
        --skip-init) INIT=false ;;
        --portal) PORTAL=true ;;
        --full-suite) PORTAL=true; FULL_SUITE=true ;;
        --) shift; GRADLE_EXTRA=("$@"); break ;;
        -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
        -*) echo "Unknown option: $1" >&2; exit 2 ;;
        *) VENDORS+=("$1") ;;
    esac
    shift
done

if [ "$RECORD" = true ] && [ -z "$BASELINE" ]; then
    echo "--record needs --baseline <directory>, e.g. --baseline 5.17.9; never re-record 5.17" >&2
    exit 2
fi

if [ ${#VENDORS[@]} -eq 0 ]; then
    echo "Usage: $0 [options] <vendor>... [-- <gradle args>]; vendors: $(cd tests/db/vendors && ls *.properties | sed 's/\.properties$//' | tr '\n' ' ')" >&2
    exit 2
fi

# The HTTP port matters for --portal; read it from the Gradle arguments like the build does.
HTTP_PORT=8080
for arg in "${GRADLE_EXTRA[@]+"${GRADLE_EXTRA[@]}"}"; do
    case "$arg" in -PtomcatHttpPort=*) HTTP_PORT="${arg#-PtomcatHttpPort=}" ;; esac
done

# shellcheck source=tests/db/lib.sh
. tests/db/lib.sh

vacuumlo_dry_run() {  # vacuumlo -n prints one "Removing lo N" per object; keep the summary
    docker exec "$1" vacuumlo -n -v -U uportal uportal 2>&1 | tr '\r' '\n' | sed 's/Removing lo *[0-9]* */\n/g' | grep -v '^ *$' || true
}

annotate_snapshot() {  # annotate_snapshot <vendor>: the snapshot files, as tar.gz in base64
    [ "${GITHUB_ACTIONS:-}" = true ] || return 0
    local dir="build/db-harness/$1" files=() f data parts i
    for f in schema.txt schema-normalized.txt generators.txt lob-report.txt; do
        [ -f "$dir/$f" ] && files+=("$f")
    done
    [ ${#files[@]} -gt 0 ] || return 0
    data=$(tar -cf - -C "$dir" "${files[@]}" | gzip -9 | base64 -w0)
    # GitHub keeps the first 4096 characters of an annotation, and 10 notices per step: about
    # 7 parts for one vendor's snapshot
    parts=$(( (${#data} + 3999) / 4000 ))
    if [ "$parts" -gt 10 ]; then
        echo "The snapshot of $1 needs $parts annotations, more than a step can show" >&2
        return 0
    fi
    for ((i = 0; i < parts; i++)); do
        echo "::notice title=snapshot of $1 (part $((i + 1)) of $parts)::${data:$((i * 4000)):4000}"
    done
}

run_vendor() {
    local vendor="$1"
    local out="build/db-harness/$vendor"
    local container
    if [ ! -f "tests/db/vendors/$vendor.properties" ]; then
        echo "Unknown vendor $vendor" >&2
        return 1
    fi
    container=$(container_name "$vendor")
    mkdir -p "$out"

    echo "==== $vendor: $(prop "$vendor" vendor.name)"
    local started=false
    if [ "$EXTERNAL" = false ]; then
        start_database "$vendor" || return 1
        started=true
    fi
    use_vendor "$vendor"

    local tasks=()
    if [ "$DEPLOY" = true ] && [ "$FULL_SUITE" = true ]; then
        # The whole suite also exercises the bundled portlets
        tasks+=(tomcatInstall tomcatDeploy)
    elif [ "$DEPLOY" = true ]; then
        tasks+=(tomcatInstall :overlays:uPortal:tomcatDeploy)
        # The API specs log out through CAS (logout.redirect)
        if [ "$PORTAL" = true ]; then tasks+=(:overlays:cas:tomcatDeploy); fi
    else
        tasks+=(tomcatConfig)
    fi
    tasks+=(dbWait dbSetup)
    if [ "$INIT" = true ]; then tasks+=(:overlays:uPortal:dataInit); fi
    tasks+=(dbSnapshot dbLobReport)
    if [ "$RECORD" = true ]; then tasks+=(dbRecord); else tasks+=(dbVerify); fi

    local status=0
    local baseline=()
    if [ -n "$BASELINE" ]; then baseline=(-PdbBaseline="$BASELINE"); fi
    gradle -PdbVendor="$vendor" "${baseline[@]+"${baseline[@]}"}" "${tasks[@]}" 2>&1 | tee "$out/harness.log"
    status=${PIPESTATUS[0]}
    if [ "$RECORD" = true ] || grep -qs 'no baseline: ' "$out/drift-report.txt"; then
        annotate_snapshot "$vendor"
    fi
    # The intended data changes (tests/db/snapshots/<baseline>/intended-changes.txt) this run showed
    if grep -qs '^~ .*: found$' "$out/drift-report.txt"; then
        github_annotation notice "$vendor: intended data changes found" "$(grep '^~ .*: found$' "$out/drift-report.txt")"
    fi
    # What Hibernate itself reported during dataInit (HHH000400), next to the snapshot's own answer
    grep -ho "HHH000400: Using dialect: .*" "$out/harness.log" | sort -u > "$out/dialect.txt" || true

    # A CI service container is not ours to name; HARNESS_DB_CONTAINER lets `docker exec` reach it
    if [ "$started" = false ] && [ -n "${HARNESS_DB_CONTAINER:-}" ]; then
        container="$HARNESS_DB_CONTAINER"
    fi
    local reachable=false
    if [ "$started" = true ] || [ -n "${HARNESS_DB_CONTAINER:-}" ]; then reachable=true; fi

    # PostgreSQL: ask vacuumlo itself (dry run) what it would delete (MOD-I24)
    if [ $status -eq 0 ] && [ "$reachable" = true ] && [ "${vendor#postgres}" != "$vendor" ]; then
        vacuumlo_dry_run "$container" > "$out/vacuumlo-dry-run.txt"
        cat "$out/vacuumlo-dry-run.txt"
    fi

    if [ $status -eq 0 ] && [ "$PORTAL" = true ]; then
        run_portal "$vendor" "$out" "$container" "$reachable" || status=1
    fi

    if [ "$started" = true ] && [ "$KEEP" = false ]; then
        stop_database "$vendor"
    fi
    return $status
}

run_portal() {
    local vendor="$1" out="$2" container="$3" reachable="$4"
    local status=0
    local url="http://localhost:$HTTP_PORT/uPortal/"
    if [ "$FULL_SUITE" = true ] && [ "$INIT" = true ]; then
        # The portlets keep their tables in the portal database (the snapshot covers uPortal's
        # own schema only, so it was taken first); create them like portalInit does
        gradle -PdbVendor="$vendor" dataInit -x :overlays:uPortal:dataInit 2>&1 | tee "$out/portlet-data-init.log"
        [ "${PIPESTATUS[0]}" -eq 0 ] || return 1
    fi
    start_portal "$vendor" || return 1
    local specs=(tests/api) log="$out/playwright-api.log"
    if [ "$FULL_SUITE" = true ]; then specs=(); log="$out/playwright.log"; fi
    PORTAL_BASE_URL="$url" npx playwright test --config=tests/uportal-pw.config.ts \
        "${specs[@]+"${specs[@]}"}" --reporter=list --output="$out/playwright" 2>&1 | tee "$log"
    status=${PIPESTATUS[0]}
    stop_own_tomcat "$vendor"
    use_vendor "$vendor"
    if [ "${vendor#postgres}" != "$vendor" ]; then
        # The portal has now written events (EVENT_DATA is a @Lob String); look at the LOBs again
        gradle -PdbVendor="$vendor" -PdbLobReportName=lob-report-after-portal.txt dbLobReport || status=1
        if [ "$reachable" = true ]; then
            vacuumlo_dry_run "$container" > "$out/vacuumlo-dry-run-after-portal.txt"
            cat "$out/vacuumlo-dry-run-after-portal.txt"
        fi
    fi
    return $status
}

annotate() {  # on GitHub Actions, show a failed vendor's drift report and failed specs on the run
    local f text
    for f in "build/db-harness/$1/drift-report.txt" "build/db-harness/$1/playwright-api.log" \
            "build/db-harness/$1/playwright.log"; do
        [ -f "$f" ] || continue
        case "$f" in
            *drift-report.txt) grep -q '^RESULT: DRIFT' "$f" || continue; text=$(head -n 40 "$f") ;;
            *) text=$(failed_specs "$f") ;;
        esac
        [ -n "$text" ] || continue
        github_annotation error "$1 ($(basename "$f"))" "$text"
    done
}

overall=0
summary=()
for vendor in "${VENDORS[@]}"; do
    if run_vendor "$vendor"; then
        summary+=("$vendor: OK")
    else
        summary+=("$vendor: FAILED (see build/db-harness/$vendor)")
        annotate "$vendor"
        overall=1
    fi
done

echo "==== Database harness summary (baseline ${BASELINE:-chosen by uPortalVersion}, $([ "$RECORD" = true ] && echo recorded || echo compared))"
printf '%s\n' "${summary[@]}"
exit $overall
