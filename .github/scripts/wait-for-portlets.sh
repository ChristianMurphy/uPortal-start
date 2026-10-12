#!/usr/bin/env bash
# Waits until every portlet of a portal that has just started has registered with uPortal
# (MOD-I350). Run it once uPortal answers HTTP, before the first request that renders a page.
#
#   .github/scripts/wait-for-portlets.sh [tomcat base] [portal.log offset]
#
# Tomcat starts the portlet webapps before uPortal's portlet container exists. Each portlet's
# PortletServlet (Apache Pluto 2.1.0-M3) registers with uPortal from a timer that tries again every
# 10 seconds, so the last ones register a few seconds after Tomcat reports that it has started and
# uPortal answers. A page that renders a portlet before its servlet has registered makes Tomcat
# mark that servlet unavailable until the next restart, and the portlet stays broken for the whole
# test run.
#
# Every webapp under <tomcat base>/webapps (default .gradle/tomcat) with a WEB-INF/portlet.xml
# counts. In <tomcat base>/logs/portal/portal.log uPortal logs "Registering <n> portlets for
# context /<ctx>" and "Registered portlet application for context '/<ctx>'" when the first servlet
# of a webapp registers, and "Portlet application for context '/<ctx>' already registered." for
# each of the others. A webapp is ready when <n> of its servlets have registered.
#
# Only the log after <offset> bytes counts (default 0): pass the size portal.log had before
# tomcatStart, so that the lines of an earlier start of the same Tomcat don't count. The wait
# fails after PORTLET_WAIT_SECONDS (default 120) and names the webapps that are not ready.
set -uo pipefail

base=${1:-.gradle/tomcat}
offset=${2:-0}
timeout=${PORTLET_WAIT_SECONDS:-120}
log="$base/logs/portal/portal.log"

fail() {
    echo "$1" >&2
    if [ "${GITHUB_ACTIONS:-}" = true ]; then
        echo "::error title=Portlets not registered::$1"
    fi
    exit 1
}

contexts=()
for xml in "$base"/webapps/*/WEB-INF/portlet.xml; do
    [ -f "$xml" ] || continue
    name=${xml%/WEB-INF/portlet.xml}
    name=${name##*/}
    contexts+=("/${name//#//}")  # Tomcat names the directory of context /a/b "a#b"
done
if [ ${#contexts[@]} -eq 0 ]; then
    fail "No webapp under $base/webapps has a WEB-INF/portlet.xml. Is $base the Tomcat of the portal?"
fi

# Prints one line for each webapp that is not ready, "/<ctx> (<registered> of <portlets>)", using
# the log after the offset. Nothing means every webapp is ready.
not_ready() {
    local size from=$offset
    if [ -f "$log" ]; then
        size=$(wc -c < "$log" | tr -d ' ')
        [ "$size" -ge "$from" ] || from=0  # a new file: the log rolled over, or someone emptied it
        tail -c "+$((from + 1))" "$log"
    fi | tr -d '\r' | awk -v q="'" -v contexts="${contexts[*]}" '
        match($0, "Registering [0-9]+ portlets for context /.*$") {
            split(substr($0, RSTART + 12), part, " portlets for context ")
            portlets[part[2]] = part[1] + 0
            next
        }
        match($0, "Registered portlet application for context " q "/[^" q "]*" q "$") {
            servlets[substr($0, RSTART + 44, RLENGTH - 45)]++
            next
        }
        match($0, "Portlet application for context " q "/[^" q "]*" q " already registered[.]$") {
            servlets[substr($0, RSTART + 33, RLENGTH - 54)]++
        }
        END {
            n = split(contexts, wanted, " ")
            for (i = 1; i <= n; i++) {
                c = wanted[i]
                if (!(c in servlets)) print c " (none registered)"
                else if (!(c in portlets)) print c " (" servlets[c] " of ?)"
                else if (servlets[c] < portlets[c]) print c " (" servlets[c] " of " portlets[c] ")"
            }
        }'
}

started=$SECONDS
next_report=$((SECONDS + 10))
while :; do
    waiting=$(not_ready)
    if [ -z "$waiting" ]; then
        echo "All ${#contexts[@]} portlet webapps have registered their portlets with uPortal ($((SECONDS - started))s)"
        exit 0
    fi
    if [ $((SECONDS - started)) -ge "$timeout" ]; then
        fail "These portlet webapps did not register all their portlets with uPortal within ${timeout}s (see $log): $(echo "$waiting" | paste -sd, - | sed 's/,/, /g')"
    fi
    if [ "$SECONDS" -ge "$next_report" ]; then
        echo "Waiting for portlets to register: $(echo "$waiting" | paste -sd, - | sed 's/,/, /g')"
        next_report=$((SECONDS + 10))
    fi
    sleep 1
done
