#!/usr/bin/env bash
#
# Query-count budgets. See docs/query-budgets.md.
#
# Puts p6spy in front of uPortal's JDBC driver in the deployed portal (this checkout's
# .gradle/tomcat, after portalInit), logs every statement uPortal runs with its thread, starts
# Tomcat, and runs tests/query-budget/query-budget.mjs against the budgets in budgets.json.
# Only the deployed copy changes: the overlay, the WAR and production settings stay as they are,
# and the next tomcatDeploy (or portalInit) removes the instrumentation.
#
#   tests/query-budget/run.sh [--record] [-- <extra Gradle arguments>]
#
#   --record   write the observed counts to tests/query-budget/budgets.json
#
# Needs a deployed portal whose Tomcat is stopped and whose database is running (hsqlStart).
#
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

RECORD=()
GRADLE_EXTRA=()
while [ $# -gt 0 ]; do
    case "$1" in
        --record) RECORD=(--record) ;;
        --) shift; GRADLE_EXTRA=("$@"); break ;;
        -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
    shift
done

HTTP_PORT=8080
for arg in "${GRADLE_EXTRA[@]+"${GRADLE_EXTRA[@]}"}"; do
    case "$arg" in -PtomcatHttpPort=*) HTTP_PORT="${arg#-PtomcatHttpPort=}" ;; esac
done
# shellcheck source=tests/db/lib.sh
. tests/db/lib.sh

OUT=build/query-budget
P6SPY_VERSION=3.9.1
P6SPY_SHA256=197aa64a6676da578dac1097824accda7a89d5ab21c0829e05bfde92a176f4a1
TOMCAT=$ROOT/.gradle/tomcat
WEBAPP=$TOMCAT/webapps/uPortal
SQL_LOG=$TOMCAT/logs/portal/sql.log
mkdir -p "$OUT"

if [ ! -d "$WEBAPP/WEB-INF" ]; then
    echo "No uPortal deployed in $TOMCAT; run ./gradlew portalInit first" >&2
    exit 1
fi

# p6spy, pinned by checksum
jar=$OUT/p6spy-$P6SPY_VERSION.jar
if [ ! -f "$jar" ]; then
    curl -sSfL -o "$jar" "https://repo.maven.apache.org/maven2/p6spy/p6spy/$P6SPY_VERSION/p6spy-$P6SPY_VERSION.jar" || exit 1
fi
if ! echo "$P6SPY_SHA256  $jar" | sha256sum -c --quiet; then
    echo "Checksum mismatch for $jar" >&2
    rm -f "$jar"
    exit 1
fi
cp "$jar" "$WEBAPP/WEB-INF/lib/"

# Log each statement (only the "statement" category) through slf4j, to the logger "p6spy"
cat > "$WEBAPP/WEB-INF/classes/spy.properties" <<'EOF'
# tests/query-budget/run.sh: count uPortal's SQL statements (test only)
appender=com.p6spy.engine.spy.appender.Slf4JLogger
logMessageFormat=com.p6spy.engine.spy.appender.CustomLineFormat
customLogMessageFormat=%(category)|%(sqlSingleLine)
excludecategories=info,debug,result,resultset,batch,commit,rollback
driverlist=org.hsqldb.jdbc.JDBCDriver,org.postgresql.Driver,org.mariadb.jdbc.Driver,com.mysql.cj.jdbc.Driver
EOF

# <timestamp>|<thread>|<category>|<sql> in logs/portal/sql.log
logback=$WEBAPP/WEB-INF/classes/logback.xml
if ! grep -q 'name="P6SPY"' "$logback"; then
    sed -i "s#</configuration>#  <appender name=\"P6SPY\" class=\"ch.qos.logback.core.FileAppender\">\n    <file>\${catalina.base}/logs/portal/sql.log</file>\n    <encoder><pattern>%d{ISO8601}|%thread|%msg%n</pattern></encoder>\n  </appender>\n  <logger name=\"p6spy\" level=\"INFO\" additivity=\"false\"><appender-ref ref=\"P6SPY\"/></logger>\n</configuration>#" "$logback"
fi

# uPortal reads ${portal.home}/uPortal.properties after global.properties; the portlets do not,
# so only uPortal's connections go through p6spy
properties=$TOMCAT/portal/uPortal.properties
url=$(sed -n 's/^hibernate.connection.url=//p' "$TOMCAT/portal/global.properties" | tail -n 1)
sed -i '/^# tests\/query-budget/,$d' "$properties"
{
    echo "# tests/query-budget/run.sh: uPortal's JDBC through p6spy (test only)"
    echo "hibernate.connection.driver_class=com.p6spy.engine.spy.P6SpyDriver"
    echo "hibernate.connection.url=${url/jdbc:/jdbc:p6spy:}"
} >> "$properties"
rm -f "$SQL_LOG"

use_vendor ''
gradle tomcatStart || exit 1
node tests/query-budget/query-budget.mjs "$SQL_LOG" "${RECORD[@]+"${RECORD[@]}"}" | tee "$OUT/results.txt"
status=${PIPESTATUS[0]}
gradle tomcatStop || true
cp "$SQL_LOG" "$OUT/" 2> /dev/null || true

if [ "$status" -ne 0 ]; then
    github_annotation error "query budgets" "$(sed -n '/^FAILED/,$p' "$OUT/results.txt" | head -n 30)"
elif [ ${#RECORD[@]} -eq 0 ]; then
    github_annotation notice "query budgets: OK" "$(cat "$OUT/results.txt")"
fi
exit "$status"
