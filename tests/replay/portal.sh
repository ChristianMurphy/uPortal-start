#!/usr/bin/env bash
# Helpers for the HTTP differential replay (docs/http-replay.md).
#
#   tests/replay/portal.sh wait  [base url]                    wait until the portal answers and its portlets have started
#                                                              (run it in the checkout that runs the portal)
#   tests/replay/portal.sh reset <checkout> [gradle args...]   stop Tomcat, empty HSQLDB, dataInit, start Tomcat, wait
#
# The replay compares a portal in the state a fresh portalInit leaves it in, so the recorder
# and the replayer both start from a reset portal. dataInit also redeploys every overlay, so
# anything changed by hand in .gradle/tomcat/webapps is gone after a reset. <checkout> is the
# uPortal-start checkout that runs the portal (the 5.17 checkout when recording). Gradle
# arguments such as -PtomcatHttpPort=8180 go to every Gradle call; PORTAL_BASE_URL selects the
# portal to wait for.
set -euo pipefail

base="${PORTAL_BASE_URL:-http://localhost:8080/uPortal/}"
here=$(cd "$(dirname "$0")" && pwd)

wait_for_portal() {  # wait_for_portal <tomcat base> <portal.log offset> [url]
    local url="${3:-$base}"
    # /health-check answers without rendering a portlet. A page render while Pluto still
    # initialises the portlets makes Tomcat mark a portlet's servlet unavailable until the next
    # restart (NotificationPortlet's EmergencyAlert, see docs/http-replay.md, and MOD-I350), so the
    # first render waits until every portlet has registered with uPortal, and a while longer.
    for i in $(seq 1 90); do
        if curl -s -o /dev/null -w '%{http_code}' "${url}health-check" | grep -q 200; then
            "$here/../../.github/scripts/wait-for-portlets.sh" "$1" "$2" || return 1
            echo "Portal is up at $url; letting the portlets initialise for ${PORTAL_SETTLE_SECONDS:-30}s"
            sleep "${PORTAL_SETTLE_SECONDS:-30}"
            return 0
        fi
        echo "Waiting for $url ($i/90)"
        sleep 2
    done
    echo "Portal at $url did not become ready" >&2
    return 1
}

case "${1:-}" in
    wait)
        wait_for_portal .gradle/tomcat 0 "${2:-}"
        ;;
    reset)
        checkout="$2"
        shift 2
        log="$checkout/.gradle/tomcat/logs/portal/portal.log"
        offset=0
        [ ! -f "$log" ] || offset=$(wc -c < "$log" | tr -d ' ')
        (
            cd "$checkout"
            ./gradlew "$@" tomcatStop
            # A fresh database, as on a new CI runner: dataInit recreates uPortal's tables, but the
            # portlets that create their own tables when they start (NotificationPortlet) fail on
            # the ones left from the previous run.
            ./gradlew "$@" hsqlStop
            rm -rf .gradle/hsqldb
            ./gradlew "$@" hsqlStart
            ./gradlew "$@" dataInit
            ./gradlew "$@" tomcatStart
        )
        wait_for_portal "$checkout/.gradle/tomcat" "$offset"
        ;;
    *)
        echo "usage: $0 wait [url] | reset <checkout> [gradle args...]" >&2
        exit 2
        ;;
esac
