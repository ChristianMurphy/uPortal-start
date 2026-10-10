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

prop() {  # prop <vendor> <key>: one value from tests/db/vendors/<vendor>.properties
    sed -n "s/^$2=//p" "tests/db/vendors/$1.properties" | tail -1
}

gradle() {
    echo "+ ./gradlew $*"
    ./gradlew --no-daemon -S "$@" "${GRADLE_EXTRA[@]+"${GRADLE_EXTRA[@]}"}"
}

vacuumlo_dry_run() {  # vacuumlo -n prints one "Removing lo N" per object; keep the summary
    docker exec "$1" vacuumlo -n -v -U uportal uportal 2>&1 | tr '\r' '\n' | sed 's/Removing lo *[0-9]* */\n/g' | grep -v '^ *$' || true
}

stop_own_tomcat() {
    # tomcatStop can leave the JVM running (MOD-I53); only ever touch this checkout's Tomcat.
    gradle -PdbVendor="$1" tomcatStop || true
    local base="$ROOT/.gradle/tomcat"
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        pgrep -f -- "-Dcatalina.base=$base " > /dev/null || return 0
        sleep 3
    done
    echo "Tomcat in $base did not exit after tomcatStop; sending SIGTERM"
    pkill -f -- "-Dcatalina.base=$base " || true
}

run_vendor() {
    local vendor="$1"
    local out="build/db-harness/$vendor"
    local image port env args container
    if [ ! -f "tests/db/vendors/$vendor.properties" ]; then
        echo "Unknown vendor $vendor" >&2
        return 1
    fi
    image=$(prop "$vendor" container.image)
    port=$(prop "$vendor" container.port)
    env=$(prop "$vendor" container.env)
    args=$(prop "$vendor" container.args)
    container="uportal-dbh-$vendor"
    mkdir -p "$out"

    echo "==== $vendor: $(prop "$vendor" vendor.name)"
    local started=false
    if [ "$EXTERNAL" = false ]; then
        if [ -z "$image" ]; then
            # Bundled HSQLDB: start from an empty database directory so object names repeat
            rm -rf .gradle/hsqldb
            gradle hsqlStart || return 1
        else
            local hostport
            hostport=$(prop "$vendor" host.port)
            docker rm -f "$container" > /dev/null 2>&1 || true
            local envargs=()
            for kv in $env; do envargs+=(-e "$kv"); done
            # shellcheck disable=SC2086
            docker run -d --name "$container" -p "$hostport:$port" "${envargs[@]}" "$image" $args > /dev/null || return 1
            echo "Started $image as $container on port $hostport"
        fi
        started=true
    fi

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
        if [ -z "$image" ]; then
            gradle hsqlStop || true
        else
            docker rm -f "$container" > /dev/null 2>&1 || true
            echo "Removed $container"
        fi
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
    gradle -PdbVendor="$vendor" tomcatStart || return 1
    for _ in $(seq 1 60); do
        if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -qE "200|302"; then break; fi
        sleep 5
    done
    if ! curl -s -o /dev/null -w "%{http_code}" "$url" | grep -qE "200|302"; then
        echo "uPortal did not answer at $url" >&2
        stop_own_tomcat "$vendor"
        return 1
    fi
    echo "uPortal is up at $url against $vendor"
    local specs=(tests/api) log="$out/playwright-api.log"
    if [ "$FULL_SUITE" = true ]; then specs=(); log="$out/playwright.log"; fi
    PORTAL_BASE_URL="$url" npx playwright test --config=tests/uportal-pw.config.ts \
        "${specs[@]+"${specs[@]}"}" --reporter=list --output="$out/playwright" 2>&1 | tee "$log"
    status=${PIPESTATUS[0]}
    if [ "$status" -ne 0 ] && [ "${GITHUB_ACTIONS:-}" = true ]; then
        # Temporary diagnostic: the exceptions the portal logged (the artifacts are out of reach)
        grep -h -A80 "PortletListRESTController" .gradle/tomcat/logs/portal/portal.log |
            grep -E "PortletListRESTController|^[A-Za-z_.$]+(Exception|Error)\b|^Caused by:|ORA-[0-9]" |
            head -n 80 || true
    fi
    stop_own_tomcat "$vendor"
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
    [ "${GITHUB_ACTIONS:-}" = true ] || return 0
    local f text
    for f in "build/db-harness/$1/drift-report.txt" "build/db-harness/$1/playwright-api.log" \
            "build/db-harness/$1/playwright.log"; do
        [ -f "$f" ] || continue
        case "$f" in
            *drift-report.txt) grep -q '^RESULT: DRIFT' "$f" || continue; text=$(head -n 40 "$f") ;;
            *) text=$(sed -n '/^  [0-9]* failed/,$p' "$f" | head -n 40) ;;
        esac
        [ -n "$text" ] || continue
        text=${text//'%'/'%25'}; text=${text//$'\r'/'%0D'}; text=${text//$'\n'/'%0A'}
        echo "::error title=$1 ($(basename "$f"))::$text"
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
