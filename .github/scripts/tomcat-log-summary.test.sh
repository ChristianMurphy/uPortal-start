#!/usr/bin/env bash
# Table test of tomcat-log-summary.sh. Each row writes Tomcat logs into a directory, runs the
# script on it with a job summary file, and checks the exit status (always 0) and which lines the
# job log's exceptions section and the summary hold.
#
#   .github/scripts/tomcat-log-summary.test.sh
set -uo pipefail

SCRIPT=$(cd "$(dirname "$0")" && pwd)/tomcat-log-summary.sh
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
failures=0
cases=0

# Log lines as Tomcat 9 writes them
plain_severe() {  # plain_severe <n>: SEVERE lines that no exception follows, as at shutdown
    local i
    for ((i = 1; i <= $1; i++)); do
        echo "08-Nov-2026 13:49:36.106 SEVERE [Catalina-utility-2] org.apache.catalina.loader.WebappClassLoaderBase.checkThreadLocalMapForLeaks The web application [uPortal] created a ThreadLocal $i"
    done
}
listener_failure() {  # a listener that failed, with its exception, two causes and stack frames
    echo "08-Nov-2026 13:00:01.123 INFO [main] org.apache.catalina.core.ApplicationContext.log Initializing Spring root WebApplicationContext"
    echo "08-Nov-2026 13:00:02.456 SEVERE [main] org.apache.catalina.core.StandardContext.listenerStart Exception sending context initialized event to listener instance of class [org.springframework.web.context.ContextLoaderListener]"
    printf '\torg.springframework.beans.factory.BeanCreationException: Error creating bean with name %s\n' "'announcementService'"
    printf '\t\tat org.springframework.beans.factory.support.AbstractBeanFactory.getBean(AbstractBeanFactory.java:208)\n'
    printf '\tCaused by: org.hibernate.exception.SQLGrammarException: could not extract ResultSet\n'
    printf '\t\t... 40 more\n'
    printf '\tCaused by: org.postgresql.util.PSQLException: ERROR: relation "hibernate_sequence" does not exist\n'
    printf '\t\tat org.postgresql.core.v3.QueryExecutorImpl.receiveErrorResponse(QueryExecutorImpl.java:2725)\n'
    echo "08-Nov-2026 13:00:03.000 INFO [main] org.apache.catalina.core.ApplicationContext.log Closing Spring root WebApplicationContext"
}
startup_failed() {
    echo "08-Nov-2026 13:00:04.100 SEVERE [main] org.apache.catalina.core.StandardContext.startInternal Context [/Announcements] startup failed due to previous errors"
}

# logs <dir> <plain SEVERE lines in the catalina log> [listener]: writes catalina and localhost logs
logs() {
    local dir="$1" plain="$2" listener="${3:-}"
    rm -rf "$dir"
    mkdir -p "$dir"
    { plain_severe "$plain"; [ -n "$listener" ] && startup_failed; } > "$dir/catalina.2026-11-08.log"
    if [ -n "$listener" ]; then listener_failure; else echo "08-Nov-2026 13:00:01.123 INFO [main] started"; fi \
        > "$dir/localhost.2026-11-08.log"
}

# row <name> <dir> <section: log|summary> <expected line (grep -F), or !line for one that must be absent>...
row() {
    local name="$1" dir="$2" out summary actual section text check ok=1
    shift 2
    cases=$((cases + 1))
    summary="$WORK/summary.md"
    : > "$summary"
    out=$(GITHUB_STEP_SUMMARY="$summary" "$SCRIPT" "$dir" 2>&1)
    actual=$?
    # The job log's section, and the summary's
    local log_section summary_section
    log_section=$(sed -n '/^::group::Exceptions after SEVERE lines$/,/^::endgroup::$/p' <<< "$out")
    summary_section=$(sed -n '/^### Exceptions after SEVERE lines$/,$p' "$summary")
    [ "$actual" = 0 ] || ok=0
    while [ $# -gt 0 ]; do
        section="$1" check="$2"
        shift 2
        if [ "$section" = log ]; then text="$log_section"; else text="$summary_section"; fi
        if [ "${check#!}" != "$check" ]; then
            grep -qF -- "${check#!}" <<< "$text" && ok=0
        else
            grep -qF -- "$check" <<< "$text" || ok=0
        fi
    done
    if [ "$ok" = 1 ]; then
        echo "ok   $name"
    else
        failures=$((failures + 1))
        echo "FAIL $name (status $actual):"
        sed 's/^/    log: /' <<< "$log_section"
        sed 's/^/    summary: /' <<< "$summary_section"
    fi
}

d="$WORK/logs"
CAUSE='Caused by: org.postgresql.util.PSQLException: ERROR: relation "hibernate_sequence" does not exist'
LISTENER='Exception sending context initialized event to listener'

for plain in 0 167 400; do
    logs "$d" "$plain" listener
    row "the listener's exception after $plain plain SEVERE lines" "$d" \
        log "$LISTENER" log "BeanCreationException" log "Caused by: org.hibernate.exception.SQLGrammarException" log "$CAUSE" \
        summary "$LISTENER" summary "$CAUSE" \
        log '!checkThreadLocalMapForLeaks' summary '!checkThreadLocalMapForLeaks' \
        log '!AbstractBeanFactory.getBean' log '!... 40 more'
done

logs "$d" 167
row "plain SEVERE lines only" "$d" log "No exception follows a SEVERE line." summary "No exception follows a SEVERE line." \
    log '!checkThreadLocalMapForLeaks'

rm -rf "$d"; mkdir -p "$d"; : > "$d/catalina.2026-11-08.log"; : > "$d/localhost.2026-11-08.log"
row "empty logs" "$d" log "No exception follows a SEVERE line." summary "No exception follows a SEVERE line."

rm -rf "$d"; mkdir -p "$d"
cases=$((cases + 1))
out=$("$SCRIPT" "$d" 2>&1); actual=$?
if [ "$actual" = 0 ] && grep -qF "No Tomcat logs in $d" <<< "$out"; then
    echo "ok   no logs"
else
    failures=$((failures + 1)); echo "FAIL no logs (status $actual): $out"
fi

# An exception line at the start of the next file doesn't belong to the last SEVERE line before it
rm -rf "$d"; mkdir -p "$d"
startup_failed > "$d/catalina.2026-11-08.log"
{ echo "08-Nov-2026 13:00:02.456 SEVERE [main] org.example.Last line of the file"; } > "$d/localhost.2026-11-08.log"
printf '\tjava.lang.IllegalStateException: from another file\n' > "$d/localhost.2026-11-09.log"
row "a SEVERE line at the end of a file" "$d" log "No exception follows a SEVERE line." log '!from another file'

echo "$((cases - failures)) of $cases cases passed"
[ "$failures" -eq 0 ]
