#!/usr/bin/env bash
#
# Two-node cluster test. See docs/cluster-tests.md.
#
# Runs two uPortal Tomcats from this checkout on one PostgreSQL 18 database, with uPortal's
# default cluster configuration (Ehcache 2 replication over JGroups, JDBC_PING discovery in the
# shared database, UP_MUTEX cluster locks for the clustered jobs), and checks:
#
#   invalidation-portlet     a portlet definition changed on one node shows on the other
#   invalidation-layout      a user's layout changed on one node shows on the other
#   invalidation-permission  a permission revoked on one node is enforced on the other
#   jobs-once                login and render events made on both nodes are aggregated exactly
#                            once: each interval's aggregate counts equal the raw events
#   failover-takeover        the node holding the aggregation lock is killed; the other node
#                            takes the lock over only once it is abandoned (60 s without an
#                            update), and within a bounded time after that
#   failover-jobs-once       the events are still aggregated exactly once after the takeover
#   no-overlap               no clustered job ran on both nodes at once, over the whole run
#
#   tests/cluster/cluster.sh [--fault <fault>] [--keep] [--no-deploy] [-- <extra Gradle arguments>]
#
# Options:
#   --fault F    seed a fault and expect the checks that should catch it to fail (exit 0 when
#                they all failed, 1 when one of them passed); F is one of:
#                  replication-off  the nodes use ehcache-no-jgroups.xml (no cache replication)
#                  lock-ignored     a held cluster lock counts as abandoned at once
#                                   (abandonedLockAge=PT0S), so another node can take it
#   --keep       leave the nodes and the database running afterwards
#   --no-deploy  reuse the database and the nodes deployed by an earlier --keep run
#
# Needs Docker, curl, Node.js, Java 11 in JAVA_HOME (the portal) and a JDK 21 for Gradle. Node A
# is this checkout's Tomcat (.gradle/tomcat, port 8080); node B is a copy of it in
# .gradle/tomcat-b on port 8180 (shutdown port 8105). Everything a run produces is in
# build/cluster/.
#
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

FAULT=
KEEP=false
DEPLOY=true
GRADLE_EXTRA=()
while [ $# -gt 0 ]; do
    case "$1" in
        --fault) FAULT="$2"; shift ;;
        --keep) KEEP=true ;;
        --no-deploy) DEPLOY=false ;;
        --) shift; GRADLE_EXTRA=("$@"); break ;;
        -h|--help) sed -n '2,38p' "$0"; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
    shift
done

# The checks each seeded fault must make fail
declare -A FAULT_CHECKS=(
    [replication-off]="invalidation-portlet invalidation-layout"
    [lock-ignored]="failover-takeover no-overlap"
)
if [ -n "$FAULT" ] && [ -z "${FAULT_CHECKS[$FAULT]+x}" ]; then
    echo "Unknown fault '$FAULT'; faults: ${!FAULT_CHECKS[*]}" >&2
    exit 2
fi

VENDOR=postgres-18
HTTP_PORT=8080
# shellcheck source=tests/db/lib.sh
. tests/db/lib.sh

OUT=build/cluster
CONTAINER=$(container_name "$VENDOR")
A_HOME=$ROOT/.gradle/tomcat
B_HOME=$ROOT/.gradle/tomcat-b
B_HTTP_PORT=8180
B_SHUTDOWN_PORT=8105
# uPortal's default; also the floor of the takeover check
ABANDONED_LOCK_AGE_MS=60000
# 4 x aggregateRawEventsPeriod in cluster.properties: after a node's last update of the
# aggregation lock, another node waits this long before it even tries the lock
SERVER_BIAS_MS=28004
AGGREGATION_MUTEX=org.apereo.portal.events.aggr.PortalRawEventsAggregator.AGGREGATION_LOCK
TEST_USERS=(admin faculty staff student)
declare -A DISPLAY_NAMES=(
    [admin]="Amy Administrator" [faculty]="Felicia Faculty" [staff]="Samuel Staff" [student]="Steven Student"
)
EVERYONE="g.group_service = 'local' and g.group_name = 'Everyone'"

mkdir -p "$OUT"
declare -A RESULTS=()
CHECK_ORDER=()
KILLED_NODE=
KILL_MS=

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

record() {  # record <check> <PASS|FAIL> <detail>
    RESULTS[$1]="$2"
    CHECK_ORDER+=("$1")
    echo "$1: $2 - $3" | tee -a "$OUT/results.txt"
    if [ "$2" = FAIL ] && [ -z "$FAULT" ]; then
        github_annotation error "cluster: $1" "$3"
    fi
}

sql() {  # sql <statement>: unaligned, '|'-separated rows from the shared database
    docker exec -i "$CONTAINER" psql -U uportal -d uportal -v ON_ERROR_STOP=1 -qtAX -F '|' -c "$1"
}

now_ms() { date +%s%3N; }

node_home() { if [ "$1" = a ]; then echo "$A_HOME"; else echo "$B_HOME"; fi; }
node_url() {
    if [ "$1" = a ]; then echo "http://localhost:$HTTP_PORT/uPortal"; else echo "http://localhost:$B_HTTP_PORT/uPortal"; fi
}
node_pid() { pgrep -f -- "-Dcatalina.base=$(node_home "$1") " | head -n 1; }
other() { if [ "$1" = a ]; then echo b; else echo a; fi; }

start_node() {  # start_node <a|b>: start the node's Tomcat and wait until uPortal answers
    local home url
    home=$(node_home "$1")
    url=$(node_url "$1")/
    log "Starting node $1 ($home)"
    CATALINA_HOME="$home" CATALINA_BASE="$home" PORTAL_HOME="$home/portal" \
        "$home/bin/catalina.sh" start > "$OUT/node-$1-start.log" 2>&1 || return 1
    for _ in $(seq 1 120); do
        if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -qE "200|302"; then
            log "Node $1 is up at $url"
            return 0
        fi
        sleep 5
    done
    echo "Node $1 did not answer at $url" >&2
    return 1
}

stop_node() {  # stop_node <a|b>: shut the node down, killing it if it does not exit
    local home pid
    home=$(node_home "$1")
    pid=$(node_pid "$1")
    [ -n "$pid" ] || return 0
    CATALINA_HOME="$home" CATALINA_BASE="$home" "$home/bin/catalina.sh" stop > /dev/null 2>&1 || true
    for _ in $(seq 1 20); do
        kill -0 "$pid" 2> /dev/null || return 0
        sleep 3
    done
    kill -9 "$pid" 2> /dev/null || true
}

# ---- Setup -------------------------------------------------------------------------------------

append_properties() {  # append_properties <node> <server name>
    local file
    file=$(node_home "$1")/portal/uPortal.properties
    {
        echo
        cat tests/cluster/cluster.properties
        echo "# Node name in UP_MUTEX.SERVER_ID and UP_RAW_EVENTS.SERVER_ID (tests/cluster/cluster.sh)"
        echo "org.apereo.portal.PortalInfoProvider.serverName=$2"
        case "$FAULT" in
            replication-off)
                echo "# Seeded fault (tests/cluster/cluster.sh --fault replication-off)"
                echo "org.apereo.portal.ehcache.filename=ehcache-no-jgroups.xml" ;;
            lock-ignored)
                echo "# Seeded fault (tests/cluster/cluster.sh --fault lock-ignored)"
                echo "org.apereo.portal.concurrency.locking.ClusterLockDao.abandonedLockAge=PT0S" ;;
        esac
    } >> "$file"
}

trace_cluster_locks() {  # trace_cluster_locks <node>: log every cluster-lock change (lock-overlap.mjs)
    local file
    file=$(node_home "$1")/webapps/uPortal/WEB-INF/classes/logback.xml
    grep -q 'ClusterLockServiceImpl" level="TRACE"' "$file" && return 0
    sed -i 's#</configuration>#  <logger name="org.apereo.portal.concurrency.locking.ClusterLockServiceImpl" level="TRACE"/>\n</configuration>#' "$file"
}

deploy() {
    start_database "$VENDOR" || return 1
    use_vendor "$VENDOR"
    # Every overlay, so the layouts render real portlets, then uPortal's and the portlets' data
    gradle -PdbVendor="$VENDOR" tomcatInstall tomcatDeploy dbWait dbSetup dataInit 2>&1 | tee "$OUT/deploy.log"
    [ "${PIPESTATUS[0]}" -eq 0 ] || return 1

    append_properties a node-a
    trace_cluster_locks a

    # Node B: a copy of node A's Tomcat with its own ports, without CAS (logins use
    # /Login?userName=...)
    rm -rf "$B_HOME"
    mkdir -p "$B_HOME"
    (cd "$A_HOME" && tar --exclude=./logs --exclude=./work --exclude=./temp --exclude=./webapps/cas -cf - .) |
        (cd "$B_HOME" && tar -xf -) || return 1
    mkdir -p "$B_HOME/logs" "$B_HOME/work" "$B_HOME/temp"
    sed -i -e "s/port=\"$HTTP_PORT\"/port=\"$B_HTTP_PORT\"/" \
        -e "s/<Server port=\"[0-9]*\"/<Server port=\"$B_SHUTDOWN_PORT\"/" "$B_HOME/conf/server.xml"
    sed -i "s/^portal.server=localhost:$HTTP_PORT/portal.server=localhost:$B_HTTP_PORT/" "$B_HOME/portal/global.properties"
    sed -i 's/^org.apereo.portal.PortalInfoProvider.serverName=node-a$/org.apereo.portal.PortalInfoProvider.serverName=node-b/' \
        "$B_HOME/portal/uPortal.properties"
    grep -q "port=\"$B_HTTP_PORT\"" "$B_HOME/conf/server.xml" &&
        grep -q 'serverName=node-b' "$B_HOME/portal/uPortal.properties"
}

wait_for_cluster() {  # both nodes registered in JGroups' JDBC_PING table
    local n
    for _ in $(seq 1 60); do
        n=$(sql "select count(*) from jgroupsping" 2> /dev/null)
        if [ "${n:-0}" -ge 2 ]; then
            log "JGroups: $n members in jgroupsping"
            return 0
        fi
        sleep 2
    done
    log "JGroups: only ${n:-0} member(s) in jgroupsping"
    [ "$FAULT" = replication-off ]  # without JGroups there is no cluster to form
}

# ---- HTTP helpers ------------------------------------------------------------------------------

JARS=$OUT/cookies
mkdir -p "$JARS"

login() {  # login <node> <user> <jar>: a new session; the login page lands on the user's layout
    local body
    rm -f "$3"
    body=$(curl -sS -L -c "$3" -b "$3" "$(node_url "$1")/Login?userName=$2&password=$2") || return 1
    if ! grep -qF "${DISPLAY_NAMES[$2]}" <<< "$body"; then
        echo "Login of $2 on node $1 failed" >&2
        return 1
    fi
}

logout() {  # logout <node> <jar>: ends the session (not following the redirect to CAS)
    curl -sS -o /dev/null -b "$2" "$(node_url "$1")/Logout" || true
}

get() {  # get <node> <jar> <path>: the response body; the status code goes to $OUT/status
    curl -sS -b "$2" -c "$2" -o - -w '%{stderr}%{http_code}' "$(node_url "$1")$3" 2> "$OUT/status"
}

status_of() { tail -c 3 "$OUT/status"; }

poll() {  # poll <seconds> <command...>: run the command every second until it succeeds
    local deadline=$(( $(date +%s) + $1 ))
    shift
    while true; do
        "$@" && return 0
        [ "$(date +%s)" -lt "$deadline" ] || return 1
        sleep 1
    done
}

# ---- Cache invalidation ------------------------------------------------------------------------

PORTLET_FNAME=what-is-uportal

portlet_title_on() {  # portlet_title_on <node> <jar>: the title the node's registry gives
    get "$1" "$2" "/api/portlet/$PORTLET_FNAME.json" | node -e '
        let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
            try { console.log(JSON.parse(s).portlet.title); } catch { console.log("?"); } });'
}

title_is() { [ "$(portlet_title_on "$1" "$2")" = "$3" ]; }

check_portlet_invalidation() {
    local a=$JARS/portlet-a b=$JARS/portlet-b original changed started elapsed
    login a admin "$a" && login b admin "$b" || { record invalidation-portlet FAIL "admin login failed"; return; }
    original=$(portlet_title_on b "$b")  # also caches the definition on node B
    get a "$a" "/api/entity/portlet-definition/$PORTLET_FNAME?download=false" > "$OUT/portlet-original.xml"
    if [ "$(status_of)" != 200 ] || ! grep -q "<title>$original</title>" "$OUT/portlet-original.xml"; then
        record invalidation-portlet FAIL "could not export $PORTLET_FNAME from node A (HTTP $(status_of), title '$original')"
        return
    fi
    changed="$original (cluster $RANDOM)"
    sed "s#<title>$original</title>#<title>$changed</title>#" "$OUT/portlet-original.xml" > "$OUT/portlet-changed.xml"
    started=$(now_ms)
    curl -sS -b "$a" -o /dev/null -w '%{http_code}' -F "file=@$OUT/portlet-changed.xml;type=text/xml" \
        "$(node_url a)/api/import" > "$OUT/status"
    if [ "$(status_of)" != 200 ] || ! title_is a "$a" "$changed"; then
        record invalidation-portlet FAIL "import on node A failed (HTTP $(status_of))"
        return
    fi
    if poll 30 title_is b "$b" "$changed"; then
        elapsed=$(( $(now_ms) - started ))
        record invalidation-portlet PASS "node B showed the new title ${elapsed} ms after the import on node A"
    else
        record invalidation-portlet FAIL "node B still showed '$(portlet_title_on b "$b")' 30 s after node A imported '$changed'"
    fi
    curl -sS -b "$a" -o /dev/null -F "file=@$OUT/portlet-original.xml;type=text/xml" "$(node_url a)/api/import"
}

layout_on() {  # layout_on <node> <jar>: the user's layout as JSON (tab names appear in it)
    get "$1" "$2" /api/v4-3/dlm/layout.json
}

has_tab_after_login() {  # has_tab_after_login <node> <jar> <tab>: a new session sees the tab
    login "$1" student "$2" || return 1
    layout_on "$1" "$2" > "$OUT/layout.json"
    logout "$1" "$2"
    grep -qF "\"$3\"" "$OUT/layout.json"
}

check_layout_invalidation() {
    local a=$JARS/layout-a b=$JARS/layout-b tab started elapsed
    tab="Cluster $RANDOM"
    # Node B loads (and caches) the student's layout
    login b student "$b" && layout_on b "$b" > "$OUT/layout-before.json" && logout b "$b"
    if ! grep -q '"layout"' "$OUT/layout-before.json"; then
        record invalidation-layout FAIL "could not read the student's layout on node B (HTTP $(status_of))"
        return
    fi
    login a student "$a" || { record invalidation-layout FAIL "student login on node A failed"; return; }
    started=$(now_ms)
    curl -sS -b "$a" -o /dev/null -w '%{http_code}' --data-urlencode "tabName=$tab" --data-urlencode 'widths[]=100' \
        "$(node_url a)/api/layout?action=addTab" > "$OUT/status"
    if [ "$(status_of)" != 200 ] || ! layout_on a "$a" | grep -qF "\"$tab\""; then
        record invalidation-layout FAIL "adding the tab on node A failed (HTTP $(status_of))"
        return
    fi
    logout a "$a"
    if poll 30 has_tab_after_login b "$b" "$tab"; then
        elapsed=$(( $(now_ms) - started ))
        record invalidation-layout PASS "a new session on node B had the tab ${elapsed} ms after node A added it"
    else
        record invalidation-layout FAIL "30 s after node A added the tab '$tab', a new student session on node B does not have it"
    fi
}

PERMISSION_FNAME=permissionsmanager
# uPortal caches permission checks per node without replicating them
# (AuthorizationImpl.PRINCIPAL_HAS_PERMISSION, 180 s, and
# AnyUnblockedGrantPermissionPolicy.HAS_UNBLOCKED_GRANT, 300 s, in ehcache.xml): a revoked
# permission is enforced on the other node only once those entries expire.
PERMISSION_BOUND_S=330

update_permission() {  # update_permission <jar> <GRANT|INHERIT>: student, SUBSCRIBE on the portlet
    local principal
    principal="$PERSON_TYPE.student"
    curl -sS -b "$1" -o /dev/null -w '%{http_code}' -G "$(node_url a)/api/updatePermission" \
        --data-urlencode "principal=$principal" --data-urlencode "principals[]=$principal" \
        --data-urlencode "assignment=$2" --data-urlencode owner=UP_PORTLET_SUBSCRIBE \
        --data-urlencode activity=SUBSCRIBE --data-urlencode "target=PORTLET_ID.$PORTLET_ID" > "$OUT/status"
    [ "$(status_of)" = 200 ]
}

portlet_status() {  # portlet_status <node> <jar>: HTTP status of the portlet's registry entry
    get "$1" "$2" "/api/portlet/$PERMISSION_FNAME.json" > /dev/null
    status_of
}

denied_on() { [ "$(portlet_status "$1" "$2")" = 403 ]; }
allowed_on() { [ "$(portlet_status "$1" "$2")" = 200 ]; }

check_permission_invalidation() {
    local admin=$JARS/perm-admin a=$JARS/perm-a b=$JARS/perm-b started elapsed
    PERSON_TYPE=$(sql "select entity_type_id from up_entity_type where entity_type_name = 'org.apereo.portal.security.IPerson'")
    PORTLET_ID=$(sql "select portlet_def_id from up_portlet_def where portlet_fname = '$PERMISSION_FNAME'")
    if [ -z "$PERSON_TYPE" ] || [ -z "$PORTLET_ID" ]; then
        record invalidation-permission FAIL "could not look up the person entity type or portlet $PERMISSION_FNAME"
        return
    fi
    login a admin "$admin" && login a student "$a" && login b student "$b" ||
        { record invalidation-permission FAIL "logins failed"; return; }
    if ! denied_on b "$b"; then
        record invalidation-permission FAIL "student could already open $PERMISSION_FNAME on node B (HTTP $(status_of))"
        return
    fi
    # Grant, and wait until node B allows it (its cached denial expires), so node B caches the grant
    update_permission "$admin" GRANT || { record invalidation-permission FAIL "grant on node A failed (HTTP $(status_of))"; return; }
    started=$(now_ms)
    if ! poll "$PERMISSION_BOUND_S" allowed_on b "$b"; then
        record invalidation-permission FAIL "node B still denied the portlet $PERMISSION_BOUND_S s after node A granted it"
        update_permission "$admin" INHERIT
        return
    fi
    log "invalidation-permission: node B allowed the grant after $(( $(now_ms) - started )) ms"
    # Revoke: the security-relevant direction
    update_permission "$admin" INHERIT || { record invalidation-permission FAIL "revoke on node A failed (HTTP $(status_of))"; return; }
    started=$(now_ms)
    if ! denied_on a "$a"; then
        record invalidation-permission FAIL "node A itself still allowed the revoked permission (HTTP $(status_of))"
        return
    fi
    if poll "$PERMISSION_BOUND_S" denied_on b "$b"; then
        elapsed=$(( $(now_ms) - started ))
        record invalidation-permission PASS "node B denied the revoked permission ${elapsed} ms after node A revoked it (bound ${PERMISSION_BOUND_S} s)"
    else
        record invalidation-permission FAIL "node B still allowed the portlet $PERMISSION_BOUND_S s after node A revoked the permission"
    fi
}

# ---- Clustered jobs ----------------------------------------------------------------------------

traffic() {  # traffic <rounds>: every test user logs in and renders their layout on both nodes
    local round node user jar
    for round in $(seq 1 "$1"); do
        for node in a b; do
            for user in "${TEST_USERS[@]}"; do
                jar=$JARS/traffic-$node-$user
                [ -n "$KILLED_NODE" ] && [ "$node" = "$KILLED_NODE" ] && continue
                login "$node" "$user" "$jar" || return 1
                # The user's default tab, rendered again
                curl -sS -L -o /dev/null -b "$jar" -c "$jar" "$(node_url "$node")/" || return 1
                logout "$node" "$jar"
            done
        done
        log "traffic: round $round of $1 done"
    done
}

unaggregated() {  # events still to aggregate (one that failed to convert is never aggregated)
    sql "select count(*) from up_raw_events where aggregated is not true and error_aggr is not true"
}

wait_aggregated() {  # wait_aggregated <seconds>: until every raw event so far is aggregated
    local deadline=$(( $(date +%s) + $1 )) n
    sleep 6  # aggregationDelay: the newest events are not eligible yet
    while true; do
        n=$(unaggregated)
        [ "$n" = 0 ] && return 0
        if [ "$(date +%s)" -ge "$deadline" ]; then
            log "$n raw events still not aggregated"
            return 1
        fi
        sleep 3
    done
}

# Everything below counts the "Everyone" group, which every event belongs to
aggregates() {  # one line per aggregation and interval: <kind>|<interval>|<count>
    sql "select 'login', a.aggr_interval, sum(a.login_count) from up_login_event_aggr a
             join up_aggr_group_mapping g on g.id = a.aggr_group_id
             where $EVERYONE group by a.aggr_interval
         union all
         select 'render', a.aggr_interval, sum(a.time_count) from up_portlet_exec_aggr a
             join up_aggr_group_mapping g on g.id = a.aggr_group_id
             where $EVERYONE and a.execution_type = 'RENDER' group by a.aggr_interval
         order by 1, 2"
}

raw_counts() {  # <kind>|<count> of the raw events since the given local timestamp
    sql "select 'login', count(*) from up_raw_events
             where event_type = 'org.apereo.portal.events.LoginEvent' and \"timestamp\" >= '$1'
         union all
         select 'render', count(*) from up_raw_events
             where event_type = 'org.apereo.portal.events.PortletRenderExecutionEvent' and \"timestamp\" >= '$1'"
}

compare_counts() {  # compare_counts <check> <before aggregates file> <since timestamp>
    local check="$1" before="$2" since="$3" kind interval count base raw problems=() summary=()
    aggregates > "$OUT/$check-aggregates-after.txt"
    raw_counts "$since" > "$OUT/$check-raw.txt"
    sql "select server_id, event_type, count(*) from up_raw_events where \"timestamp\" >= '$since'
         group by 1, 2 order by 1, 2" > "$OUT/$check-raw-by-node.txt"
    while IFS='|' read -r kind raw; do
        summary+=("$kind: $raw raw events")
        if [ "$raw" -eq 0 ]; then problems+=("no raw $kind events were recorded"); fi
        while IFS='|' read -r k interval count; do
            [ "$k" = "$kind" ] || continue
            base=$(awk -F'|' -v k="$k" -v i="$interval" '$1 == k && $2 == i { print $3 }' "$before")
            if [ $(( count - ${base:-0} )) -ne "$raw" ]; then
                problems+=("$kind $interval aggregates grew by $(( count - ${base:-0} )), not $raw")
            fi
        done < "$OUT/$check-aggregates-after.txt"
        if ! grep -q "^$kind|" "$OUT/$check-aggregates-after.txt"; then problems+=("no $kind aggregates"); fi
    done < "$OUT/$check-raw.txt"
    cat "$OUT/$check-raw-by-node.txt"
    if [ ${#problems[@]} -eq 0 ]; then
        record "$check" PASS "$(IFS=';'; echo "${summary[*]}"), each interval's aggregates grew by exactly that"
    else
        record "$check" FAIL "$(IFS=';'; echo "${problems[*]}") ($(IFS=';'; echo "${summary[*]}"))"
    fi
}

check_jobs_once() {
    local since
    if ! wait_aggregated 300; then
        record jobs-once FAIL "the startup events were not aggregated within 300 s"
        return 1
    fi
    aggregates > "$OUT/jobs-once-aggregates-before.txt"
    since=$(sql "select localtimestamp")
    traffic 3 || { record jobs-once FAIL "test traffic failed"; return 1; }
    if ! wait_aggregated 180; then
        record jobs-once FAIL "the test events were not aggregated within 180 s"
        return 1
    fi
    compare_counts jobs-once "$OUT/jobs-once-aggregates-before.txt" "$since"
}

mutex_row() {  # server_id|locked|lock_start|lock_update of the aggregation lock
    sql "select server_id, locked, lock_start, lock_update from up_mutex where mutex_name = '$AGGREGATION_MUTEX'"
}

check_failover() {
    local since locker row holder survivor last_update start took deadline
    if ! wait_aggregated 180; then
        record failover-takeover FAIL "events from the earlier checks were not aggregated"
        return
    fi
    aggregates > "$OUT/failover-aggregates-before.txt"
    since=$(sql "select localtimestamp")
    traffic 1 || { record failover-takeover FAIL "test traffic failed"; return; }

    # Hold the aggregation status table, so the next aggregation run waits inside the cluster lock
    # (its lock thread keeps updating the UP_MUTEX row meanwhile)
    docker exec -i "$CONTAINER" psql -U uportal -d uportal -v ON_ERROR_STOP=1 -q \
        -c "set application_name = 'cluster-test-lock'" \
        -c "begin" -c "lock table up_event_aggr_status in access exclusive mode" \
        -c "select pg_sleep(600)" > "$OUT/table-lock.log" 2>&1 &
    locker=$!
    deadline=$(( $(date +%s) + 90 ))
    holder=
    while [ "$(date +%s)" -lt "$deadline" ]; do
        row=$(mutex_row)
        IFS='|' read -r server locked _ _ <<< "$row"
        if [ "$locked" = t ] && sql "select 1 from pg_stat_activity where wait_event_type = 'Lock'
                and query ilike '%up_event_aggr_status%'" | grep -q 1; then
            holder=${server%%_*}
            break
        fi
        sleep 1
    done
    if [ -z "$holder" ]; then
        record failover-takeover FAIL "no node took the aggregation lock and waited on the table within 90 s (last row: $row)"
        kill "$locker" 2> /dev/null
        return
    fi
    KILLED_NODE=${holder#node-}
    survivor=$(other "$KILLED_NODE")
    log "failover: $holder holds $AGGREGATION_MUTEX and waits on up_event_aggr_status; killing it"
    sleep 3  # a few more lock updates
    KILL_MS=$(now_ms)
    kill -9 "$(node_pid "$KILLED_NODE")"
    sql "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'cluster-test-lock'" > /dev/null
    wait "$locker" 2> /dev/null
    last_update=$(mutex_row | cut -d'|' -f4)
    log "failover: killed node $KILLED_NODE at $KILL_MS; its last lock update was $last_update"

    # The survivor may take the lock once it is abandoned: 60 s after its last update
    deadline=$(( last_update / 1000 + (ABANDONED_LOCK_AGE_MS + SERVER_BIAS_MS) / 1000 + 60 ))
    took=
    while [ "$(date +%s)" -lt "$deadline" ]; do
        IFS='|' read -r server locked start _ <<< "$(mutex_row)"
        if [ "${server%%_*}" = "node-$survivor" ] && [ "$start" -gt "$last_update" ]; then
            took=$start
            break
        fi
        sleep 1
    done
    if [ -z "$took" ]; then
        record failover-takeover FAIL "node $survivor did not take $AGGREGATION_MUTEX over within $(( deadline - last_update / 1000 )) s of node $KILLED_NODE's last lock update"
    elif [ $(( took - last_update )) -lt "$ABANDONED_LOCK_AGE_MS" ]; then
        record failover-takeover FAIL "node $survivor took the lock $(( took - last_update )) ms after node $KILLED_NODE's last update, before it counted as abandoned (${ABANDONED_LOCK_AGE_MS} ms)"
    else
        record failover-takeover PASS "node $survivor took the lock $(( took - last_update )) ms after node $KILLED_NODE's last update (abandoned after ${ABANDONED_LOCK_AGE_MS} ms)"
    fi

    # The events made before the kill and after it are all aggregated, once
    traffic 1 || { record failover-jobs-once FAIL "test traffic on node $survivor failed"; return; }
    if wait_aggregated 180; then
        compare_counts failover-jobs-once "$OUT/failover-aggregates-before.txt" "$since"
    else
        record failover-jobs-once FAIL "node $survivor did not aggregate the remaining events within 180 s"
    fi
}

check_no_overlap() {
    local args=(a="$A_HOME/logs/portal/portal.log" b="$B_HOME/logs/portal/portal.log")
    if [ -n "$KILLED_NODE" ]; then
        if [ "$KILLED_NODE" = a ]; then args[0]+="@$KILL_MS"; else args[1]+="@$KILL_MS"; fi
    fi
    node tests/cluster/lock-overlap.mjs "${args[@]}" > "$OUT/lock-overlap.txt"
    local status=$?
    cat "$OUT/lock-overlap.txt"
    if [ $status -eq 0 ]; then
        record no-overlap PASS "$(tail -n 1 "$OUT/lock-overlap.txt")"
    else
        record no-overlap FAIL "$(sed -n '/^FAILED/,$p' "$OUT/lock-overlap.txt" | head -n 6)"
    fi
}

node_errors() {  # the distinct errors in both nodes' portal logs, as a warning annotation
    local text
    text=$(grep -hE '^(ERROR|WARN) ' "$OUT"/logs-a/portal/portal.log "$OUT"/logs-b/portal/portal.log 2> /dev/null |
        sed -E 's/ [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:,]+ - / - /' | cut -c1-250 | sort | uniq -c | sort -rn | head -n 20)
    echo "$text"
    if [ -n "$text" ]; then github_annotation warning "cluster: node log errors" "$text"; fi
}

# ---- Run ---------------------------------------------------------------------------------------

cleanup() {
    if [ "$KEEP" = false ]; then
        stop_node a
        stop_node b
        stop_database "$VENDOR"
    fi
}

collect_logs() {  # keep both nodes' logs next to the results
    local n
    for n in a b; do
        rm -rf "$OUT/logs-$n"
        cp -r "$(node_home "$n")/logs" "$OUT/logs-$n" 2> /dev/null || true
    done
}

: > "$OUT/results.txt"
log "Two-node cluster test${FAULT:+ with the seeded fault $FAULT}"
setup_ok=true
if [ "$DEPLOY" = true ]; then
    stop_node a
    stop_node b
    deploy || setup_ok=false
fi
if [ "$setup_ok" = true ]; then
    use_vendor "$VENDOR"
    { start_node a && start_node b && wait_for_cluster; } || setup_ok=false
fi

if [ "$setup_ok" = true ]; then
    check_portlet_invalidation
    check_layout_invalidation
    check_permission_invalidation
    if check_jobs_once; then
        check_failover
    fi
    check_no_overlap
fi
collect_logs
cleanup

echo "==== Two-node cluster test summary${FAULT:+ (seeded fault: $FAULT)}"
cat "$OUT/results.txt"
if [ "$setup_ok" = false ]; then
    echo "FAILED: the cluster did not start (see $OUT)"
    github_annotation error "cluster: setup" "$(tail -n 30 "$OUT/deploy.log" 2> /dev/null; tomcat_errors)"
    node_errors
    exit 1
fi

if [ -n "$FAULT" ]; then
    # Every check meant to catch this fault must have failed
    missed=()
    for check in ${FAULT_CHECKS[$FAULT]}; do
        [ "${RESULTS[$check]:-}" = FAIL ] || missed+=("$check")
    done
    if [ ${#missed[@]} -eq 0 ]; then
        echo "OK: the seeded fault $FAULT made ${FAULT_CHECKS[$FAULT]} fail"
        github_annotation notice "cluster: seeded fault $FAULT caught" "$(cat "$OUT/results.txt")"
        exit 0
    fi
    echo "FAILED: the seeded fault $FAULT was not caught by: ${missed[*]}"
    github_annotation error "cluster: seeded fault $FAULT not caught by ${missed[*]}" "$(cat "$OUT/results.txt")"
    exit 1
fi

for check in "${CHECK_ORDER[@]}"; do
    if [ "${RESULTS[$check]}" = FAIL ]; then
        echo "FAILED (see $OUT)"
        node_errors
        exit 1
    fi
done
echo "OK: every cluster check passed"
github_annotation notice "cluster: OK" "$(cat "$OUT/results.txt")"
