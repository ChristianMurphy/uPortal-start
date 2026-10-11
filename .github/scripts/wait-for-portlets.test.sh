#!/usr/bin/env bash
# Table test of wait-for-portlets.sh (MOD-I350). Each row builds a small Tomcat directory (webapps
# with a WEB-INF/portlet.xml and a portal.log), runs the script on it, and compares its exit status
# and a line of its output with the ones the row expects.
#
#   .github/scripts/wait-for-portlets.test.sh
set -uo pipefail

SCRIPT=$(cd "$(dirname "$0")" && pwd)/wait-for-portlets.sh
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
failures=0
cases=0

# Log lines as uPortal's LocalPortletContextManager writes them
first() {  # first <ctx> <portlets>: the first servlet of a webapp registers
    echo "INFO  [Timer-1] o.a.p.p.c.s.LocalPortletContextManager 2026-10-11 21:42:50,634 - Registered portlet application for context '$1'"
    echo "INFO  [Timer-1] o.a.p.p.c.s.LocalPortletContextManager 2026-10-11 21:42:50,634 - Registering $2 portlets for context $1"
}
again() {  # again <ctx>: another servlet of the webapp registers
    echo "INFO  [Timer-2] o.a.p.p.c.s.LocalPortletContextManager 2026-10-11 21:42:51,042 - Portlet application for context '$1' already registered."
}

tomcat() {  # tomcat <dir> <webapp>...: webapps with a portlet.xml, plus ROOT without one
    local dir="$1" webapp
    shift
    rm -rf "$dir"
    mkdir -p "$dir/webapps/ROOT/WEB-INF" "$dir/logs/portal"
    for webapp in "$@"; do
        mkdir -p "$dir/webapps/$webapp/WEB-INF"
        echo '<portlet-app/>' > "$dir/webapps/$webapp/WEB-INF/portlet.xml"
    done
}

# row <name> <expected status> <expected output line (grep -F)> <command...>
row() {
    local name="$1" status="$2" expected="$3" out actual
    shift 3
    cases=$((cases + 1))
    out=$(PORTLET_WAIT_SECONDS=2 GITHUB_ACTIONS='' "$@" 2>&1)
    actual=$?
    if [ "$actual" != "$status" ] || ! grep -qF -- "$expected" <<< "$out"; then
        failures=$((failures + 1))
        echo "FAIL $name: expected status $status and '$expected', got status $actual:"
        sed 's/^/    /' <<< "$out"
    else
        echo "ok   $name"
    fi
}

t="$WORK/tomcat"
log="$t/logs/portal/portal.log"

tomcat "$t" A B uPortal
{ first /A 1; first /B 2; again /B; first /uPortal 3; again /uPortal; again /uPortal; } > "$log"
row "every servlet registered" 0 "All 3 portlet webapps have registered" "$SCRIPT" "$t"

{ first /A 1; first /B 2; first /uPortal 3; again /uPortal; again /uPortal; } > "$log"
row "a webapp registered, one of its servlets not yet" 1 "/B (1 of 2)" "$SCRIPT" "$t"

{ first /A 1; first /uPortal 3; again /uPortal; again /uPortal; } > "$log"
row "a webapp with no servlet registered" 1 "within 2s (see $log): /B (none registered)" "$SCRIPT" "$t"

{ first /A 1; again /B; first /uPortal 3; again /uPortal; again /uPortal; } > "$log"
row "registrations without the number of portlets" 1 "/B (1 of ?)" "$SCRIPT" "$t"

{ first /A 1; first /B 2; again /B; first /uPortal 3; again /uPortal; } > "$log"
row "a context that starts like another one" 1 "/uPortal (2 of 3)" "$SCRIPT" "$t"

{ first /A 1; first /B 2; again /B; first /uPortal 3; again /uPortal; again /uPortal; first /Other 5; } > "$log"
row "a context without a portlet.xml here doesn't count" 0 "All 3 portlet webapps" "$SCRIPT" "$t"

{ first /A 1; first /B 2; again /B; first /uPortal 3; again /uPortal; again /uPortal; } > "$log"
offset=$(wc -c < "$log" | tr -d ' ')
{ first /A 1; first /B 2; again /B; first /uPortal 3; again /uPortal; } >> "$log"
row "only the log after the offset counts" 1 "/uPortal (2 of 3)" "$SCRIPT" "$t" "$offset"

{ first /A 1; first /B 2; again /B; first /uPortal 3; again /uPortal; again /uPortal; } > "$log"
row "an offset past the end reads the new file from the start" 0 "All 3 portlet" "$SCRIPT" "$t" 100000

{ first /A 1; first /B 2; again /B; first /uPortal 3; again /uPortal; again /uPortal; } | sed 's/$/\r/' > "$log"
row "CRLF line endings" 0 "All 3 portlet" "$SCRIPT" "$t"

rm -f "$log"
row "no portal.log yet" 1 "/A (none registered), /B (none registered), /uPortal (none registered)" "$SCRIPT" "$t"

{ first /A 1; first /B 2; first /uPortal 3; again /uPortal; again /uPortal; } > "$log"
( sleep 1; again /B >> "$log" ) &
row "a servlet that registers during the wait" 0 "All 3 portlet" "$SCRIPT" "$t"
wait

tomcat "$t" 'a#b'
first /a/b 1 > "$log"
row "a nested context (a#b is /a/b)" 0 "All 1 portlet" "$SCRIPT" "$t"

tomcat "$t"
row "no webapp with a portlet.xml (the wrong directory)" 1 "No webapp under $t/webapps has a WEB-INF/portlet.xml" "$SCRIPT" "$t"

tomcat "$t" A
: > "$log"
row "the annotation on GitHub Actions" 1 "::error title=Portlets not registered::These portlet webapps did not register" \
    env GITHUB_ACTIONS=true "$SCRIPT" "$t"

echo "$((cases - failures)) of $cases cases passed"
[ "$failures" -eq 0 ]
