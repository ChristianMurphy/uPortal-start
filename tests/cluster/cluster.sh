#!/usr/bin/env bash
#
# Two-node cluster test. See docs/cluster-tests.md.
#
# Runs two uPortal Tomcats from this checkout on one PostgreSQL 18 database, with uPortal's
# default cluster configuration (Ehcache 2 replication over JGroups, JDBC_PING discovery in the
# shared database, UP_MUTEX cluster locks for the clustered jobs), and checks:
#
#   cluster-join             node B joins node A's JGroups cluster when it starts: both nodes
#                            install the same view of two members within 30 s of node B's
#                            channel starting
#   invalidation-portlet     a portlet definition changed on one node shows on the other
#   invalidation-layout      a user's layout changed on one node shows in a new session on the
#                            other
#   invalidation-permission  a permission granted, then revoked, on one node is enforced in a new
#                            session on the other
#   permission-session       a session that checked the permission before the change follows it
#   split-heal               the nodes are split (JGroups traffic blocked), node A changes a portlet
#                            title and grants a permission, and once JGroups merges the nodes again
#                            node B shows both: the title, and an existing session allowed
#   jobs-once                login and render events made on both nodes are aggregated exactly
#                            once: each interval's aggregate counts equal the raw events
#   failover-takeover        the node holding the aggregation lock is killed; the other node
#                            takes the lock over only once it is abandoned (60 s without an
#                            update), and within a bounded time after that
#   failover-jobs-once       the events are still aggregated exactly once after the takeover
#   events-aggregated        every raw event either node stored was aggregated, over the whole
#                            run (none is left behind the aggregator's last event date)
#   no-overlap               no clustered job ran on both nodes at once, over the whole run
#
# A check listed in KNOWN_FAILURES fails because of a known uPortal problem: its failure is
# reported as a warning and does not fail the run.
#
#   tests/cluster/cluster.sh [--fault <fault>] [--join-starts <n>] [--keep] [--no-deploy]
#                            [-- <extra Gradle arguments>]
#
# Options:
#   --fault F    seed a fault and expect the checks that should catch it to fail (exit 0 when
#                they all failed, 1 when one of them passed); F is one of:
#                  replication-off  the nodes use ehcache-no-jgroups.xml (no cache replication)
#                  lock-ignored     a held cluster lock counts as abandoned at once
#                                   (abandonedLockAge=PT0S), so another node can take it
#                  event-flush-delayed  the nodes write their portal events only 120 s after
#                                   they start, as uPortal 5 did (flushInitialDelay=PT120S)
#                  join-gives-up    node B waits 1 ms for an answer to its JOIN and tries once
#                                   (GMS join_timeout=1, max_join_attempts=1)
#                  merge-clear-off  the nodes keep their caches when JGroups merges them
#                                   (clearCachesOnMerge=false)
#   --join-starts N  only measure joins: start node A, then start and stop node B N times and
#                count how often cluster-join passed (build/cluster/join-starts.txt)
#   --lone-restarts N  only measure a lone node's restart after a crash: start node A alone,
#                then N times kill -9 it and start it again, and time how long it waits on the
#                coordinator row it left in JGROUPSPING (build/cluster/lone-restarts.txt)
#   --keep       leave the nodes and the database running afterwards
#   --no-deploy  reuse the database and the nodes deployed by an earlier --keep run
#
# Needs Docker, curl, Node.js, Java 11 in JAVA_HOME (the portal), a JDK 21 for Gradle, and iptables
# as root or through sudo without a password (split-heal). Node A is this checkout's Tomcat
# (.gradle/tomcat, port 8080); node B is a copy of it in .gradle/tomcat-b on port 8180 (shutdown
# port 8105). Everything a run produces is in build/cluster/.
#
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

FAULT=
JOIN_STARTS=0
LONE_RESTARTS=0
KEEP=false
DEPLOY=true
GRADLE_EXTRA=()
while [ $# -gt 0 ]; do
    case "$1" in
        --fault) FAULT="$2"; shift ;;
        --join-starts) JOIN_STARTS="$2"; shift ;;
        --lone-restarts) LONE_RESTARTS="$2"; shift ;;
        --keep) KEEP=true ;;
        --no-deploy) DEPLOY=false ;;
        --) shift; GRADLE_EXTRA=("$@"); break ;;
        -h|--help) sed -n '2,61p' "$0"; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
    shift
done

# The checks each seeded fault must make fail
declare -A FAULT_CHECKS=(
    [replication-off]="invalidation-portlet invalidation-permission"
    [lock-ignored]="failover-takeover"
    [event-flush-delayed]="events-aggregated"
    [join-gives-up]="cluster-join"
    [merge-clear-off]="split-heal"
)
# Checks that fail because of a known uPortal problem (docs/cluster-tests.md): reported as
# warnings, they do not fail the run. Remove an entry once uPortal is fixed.
declare -A KNOWN_FAILURES=()
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
# How long the failover check keeps the lock holder alive before killing it: past the
# abandonment age and the server bias, so a node that takes a live holder's lock is caught
LIVE_HOLD_MS=95000
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
B_STARTED=0

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

record() {  # record <check> <PASS|FAIL> <detail>
    RESULTS[$1]="$2"
    CHECK_ORDER+=("$1")
    echo "$1: $2 - $3" | tee -a "$OUT/results.txt"
    if [ "$2" = FAIL ] && [ -z "$FAULT" ]; then
        if [ -n "${KNOWN_FAILURES[$1]+x}" ]; then
            github_annotation warning "cluster: $1 (known failure: ${KNOWN_FAILURES[$1]})" "$3"
        else
            github_annotation error "cluster: $1" "$3"
        fi
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
            event-flush-delayed)
                echo "# Seeded fault (tests/cluster/cluster.sh --fault event-flush-delayed)"
                echo "org.apereo.portal.events.handlers.db.PortalEventDaoQueuingEventHandler.flushInitialDelay=PT120S" ;;
            merge-clear-off)
                echo "# Seeded fault (tests/cluster/cluster.sh --fault merge-clear-off)"
                echo "org.apereo.portal.cache.clearCachesOnMerge=false" ;;
        esac
    } >> "$file"
}

trace_cluster_locks() {  # trace_cluster_locks <node>: log every cluster-lock change (lock-overlap.mjs)
    local file
    file=$(node_home "$1")/webapps/uPortal/WEB-INF/classes/logback.xml
    grep -q 'ClusterLockServiceImpl" level="TRACE"' "$file" && return 0
    sed -i 's#</configuration>#  <logger name="org.apereo.portal.concurrency.locking.ClusterLockServiceImpl" level="TRACE"/>\n</configuration>#' "$file"
    # JGroups' warnings and each cluster view the node installs, to the portal log
    sed -i 's#</configuration>#  <logger name="org.jgroups" level="INFO"/>\n  <logger name="org.jgroups.protocols.pbcast.GMS" level="TRACE"/>\n  <logger name="org.jgroups.protocols.MERGE3" level="DEBUG"/>\n  <logger name="org.jgroups.protocols.ASYM_ENCRYPT" level="TRACE"/>\n</configuration>#' "$file"
    # ASYM_ENCRYPT discards a message sent or received while the node has no secret key or an
    # older one, and logs that below INFO. JGroups writes through java.util.logging, which
    # Tomcat's logging.properties filters, so its levels are raised there too.
    local jul
    jul=$(node_home "$1")/conf/logging.properties
    [ -f "$jul" ] && printf '%s\n' 'org.jgroups.protocols.ASYM_ENCRYPT.level = FINEST' \
        '1catalina.org.apache.juli.AsyncFileHandler.level = ALL' \
        'java.util.logging.ConsoleHandler.level = ALL' >> "$jul"
    return 0
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
    if [ "$FAULT" = join-gives-up ]; then
        sed -i -E 's#(<pbcast\.GMS [^>]*)join_timeout="[0-9]+"([^>]*)max_join_attempts="[0-9]+"#\1join_timeout="1"\2max_join_attempts="1"#' \
            "$B_HOME/webapps/uPortal/WEB-INF/classes/properties/jgroups.xml"
        grep -q 'join_timeout="1" max_join_attempts="1"' "$B_HOME/webapps/uPortal/WEB-INF/classes/properties/jgroups.xml" || return 1
    fi
    grep -q "port=\"$B_HTTP_PORT\"" "$B_HOME/conf/server.xml" &&
        grep -q 'serverName=node-b' "$B_HOME/portal/uPortal.properties"
}

show_nodes() {  # each node's JVM portal.home and configured server name
    local n pid
    for n in a b; do
        pid=$(node_pid "$n")
        log "node $n: pid ${pid:-none}, $(ps -o args= -p "${pid:-0}" 2> /dev/null | tr ' ' '\n' | grep -E '^-D(portal.home|catalina.base)=' | tr '\n' ' ')$(grep -h '^org.apereo.portal.PortalInfoProvider.serverName=' "$(node_home "$n")/portal/uPortal.properties")"
    done
}

# JGroups 3 logs through java.util.logging, so its lines land in Tomcat's own logs (catalina.out
# and catalina.<date>.log), not in the portal log
jgroups_lines() {  # jgroups_lines <node>: the JGroups lines of all the node's logs
    grep -hiE 'org\.jgroups|jgroups\.|GMS|installing view|\] \([0-9]+\) \[' \
        "$(node_home "$1")"/logs/catalina.* "$(node_home "$1")"/logs/portal/portal.log 2> /dev/null
}

JOIN_BOUND_S=30

log_clock_ms() {  # now in the logs' clock: local time read as UTC, in ms (cluster-join.mjs)
    echo $(( $(TZ=UTC date -d "$(date '+%F %T')" +%s) * 1000 ))
}

join_outcome() {  # join_outcome <since ms>: cluster-join.mjs on both nodes' Tomcat logs
    node tests/cluster/cluster-join.mjs \
        "a=$(printf "%s," "$A_HOME"/logs/catalina.*.log)" \
        "b=$(printf "%s," "$B_HOME"/logs/catalina.*.log)" \
        --since "$1" --bound "$JOIN_BOUND_S"
}

check_cluster_join() {  # check_cluster_join <since ms>: node B joined node A's cluster
    local out rc
    for _ in $(seq 1 $(( JOIN_BOUND_S + 30 ))); do
        out=$(join_outcome "$1")
        rc=$?
        [ "$rc" -ne 2 ] && break
        sleep 1
    done
    case "$rc" in
        0) record cluster-join PASS "${out#PASS: }" ;;
        1) record cluster-join FAIL "${out#FAIL: }" ;;
        *) record cluster-join FAIL "still undecided $(( JOIN_BOUND_S + 30 )) s after node B answered: ${out#UNDECIDED: }" ;;
    esac
}

two_member_view() {  # two_member_view <node>: the node logged a cluster view of two members
    jgroups_lines "$1" | grep -qE '\|[0-9]+\] \(2\) \['
}

view_state() {  # whether each node has logged a cluster view of two members so far
    local n out=()
    for n in a b; do
        if two_member_view "$n"; then out+=("node $n logged a view of two members"); else out+=("node $n logged no view of two members"); fi
    done
    (IFS=','; echo "${out[*]}")
}

wait_for_cluster() {  # both nodes registered in JGroups' JDBC_PING table, and in one view
    local n
    show_nodes
    for _ in $(seq 1 60); do
        n=$(sql "select count(*) from jgroupsping" 2> /dev/null)
        [ "${n:-0}" -ge 2 ] && break
        sleep 2
    done
    if [ "${n:-0}" -lt 2 ]; then
        log "JGroups: only ${n:-0} member(s) in jgroupsping"
        [ "$FAULT" = replication-off ]  # without JGroups there is no cluster to form
        return
    fi
    log "JGroups: $n members in jgroupsping"
    # A change made before the nodes share a view is not replicated
    if poll 60 two_member_view a && poll 60 two_member_view b; then
        log "JGroups: both nodes installed a view of two members"
    else
        log "JGroups: no view of two members logged on both nodes within 60 s"
        github_annotation warning "cluster: JGroups view" "no view of two members logged on both nodes within 60 s"
    fi
}

# ---- HTTP helpers ------------------------------------------------------------------------------

JARS=$OUT/cookies
mkdir -p "$JARS"

login() {  # login <node> <user> <jar>: a new session; the login page lands on the user's layout
    local body
    rm -f "$3"
    body=$(curl -sS -L -c "$3" -b "$3" "$(node_url "$1")/Login?userName=$2&password=$2") || return 1
    printf '%s' "$body" > "$OUT/landing.html"
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

csrf_header() {  # csrf_header <node> <jar>: "<header>: <token>" for the session's POSTs under /api
    local html
    html=$(curl -sS -L -b "$2" -c "$2" "$(node_url "$1")/")
    printf '%s: %s' "$(sed -n 's/.*<meta name="_csrf_header" content="\([^"]*\)".*/\1/p' <<< "$html" | head -n 1)" \
        "$(sed -n 's/.*<meta name="_csrf" content="\([^"]*\)".*/\1/p' <<< "$html" | head -n 1)"
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

late_by() {  # late_by <seconds> <command...>: after a failed bound, how much longer until it succeeds
    local started
    started=$(date +%s)
    if poll "$@"; then
        echo "; it did $(( $(date +%s) - started )) s after the bound"
    else
        echo "; not within a further $1 s either"
    fi
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
    curl -sS -b "$a" -H "$(csrf_header a "$a")" -o /dev/null -w '%{http_code}' -F "file=@$OUT/portlet-changed.xml;type=text/xml" \
        "$(node_url a)/api/import" > "$OUT/status"
    if [ "$(status_of)" != 200 ] || ! title_is a "$a" "$changed"; then
        record invalidation-portlet FAIL "import on node A failed (HTTP $(status_of))"
        return
    fi
    if poll 30 title_is b "$b" "$changed"; then
        elapsed=$(( $(now_ms) - started ))
        record invalidation-portlet PASS "node B showed the new title ${elapsed} ms after the import on node A"
    else
        record invalidation-portlet FAIL "node B still showed '$(portlet_title_on b "$b")' 30 s after node A imported '$changed' (database: '$(sql "select portlet_title from up_portlet_def where portlet_fname = '$PORTLET_FNAME'")')$(late_by 270 title_is b "$b" "$changed"); $(view_state)"
    fi
    curl -sS -b "$a" -H "$(csrf_header a "$a")" -o /dev/null -F "file=@$OUT/portlet-original.xml;type=text/xml" "$(node_url a)/api/import"
}

has_tab_after_login() {  # has_tab_after_login <node> <jar> <tab>: a new session renders the tab
    login "$1" student "$2" || return 1
    logout "$1" "$2"
    grep -qF ">$3<" "$OUT/landing.html"
}

check_layout_invalidation() {
    local a=$JARS/layout-a b=$JARS/layout-b tab started elapsed stored
    tab="Cluster $RANDOM"
    # Node B loads (and caches) the student's layout
    if ! login b student "$b"; then
        record invalidation-layout FAIL "student login on node B failed"
        return
    fi
    logout b "$b"
    login a student "$a" || { record invalidation-layout FAIL "student login on node A failed"; return; }
    started=$(now_ms)
    curl -sS -b "$a" -H "$(csrf_header a "$a")" -o "$OUT/add-tab.json" -w '%{http_code}' --data-urlencode "tabName=$tab" \
        --data-urlencode 'widths%5B%5D=100' "$(node_url a)/api/layout?action=addTab" > "$OUT/status"
    stored=$(sql "select count(*) from up_layout_struct where name = '$tab'")
    if [ "$(status_of)" != 200 ] || [ "$stored" != 1 ]; then
        record invalidation-layout FAIL "adding the tab on node A failed (HTTP $(status_of), $stored rows in UP_LAYOUT_STRUCT; $(head -c 300 "$OUT/add-tab.json"))"
        return
    fi
    logout a "$a"
    if poll 30 has_tab_after_login b "$b" "$tab"; then
        elapsed=$(( $(now_ms) - started ))
        record invalidation-layout PASS "a new session on node B rendered the tab ${elapsed} ms after node A added it"
    else
        record invalidation-layout FAIL "30 s after node A added the tab '$tab' (stored in UP_LAYOUT_STRUCT), a new student session on node B does not render it$(late_by 270 has_tab_after_login b "$b" "$tab")"
    fi
}

PERMISSION_FNAME=permissionsmanager
# uPortal caches permission checks per node (AuthorizationImpl.PRINCIPAL_HAS_PERMISSION, 180 s,
# and AnyUnblockedGrantPermissionPolicy.HAS_UNBLOCKED_GRANT, 300 s, in ehcache.xml). A change
# clears both caches and the clear is replicated, so the other node enforces it at once.
PERMISSION_BOUND_S=330
# Sessions that checked the permission before the change
PERMISSION_SESSION_BOUND_S=30

update_permission() {  # update_permission <jar> <GRANT|INHERIT>: student, SUBSCRIBE on the portlet
    local principal
    principal="$PERSON_TYPE.student"
    # POST with the CSRF token since uPortal 6.0 (it was a GET)
    curl -sS -b "$1" -H "$(csrf_header a "$1")" -o /dev/null -w '%{http_code}' "$(node_url a)/api/updatePermission" \
        --data-urlencode "principal=$principal" --data-urlencode "principals%5B%5D=$principal" \
        --data-urlencode "assignment=$2" --data-urlencode owner=UP_PORTLET_SUBSCRIBE \
        --data-urlencode activity=SUBSCRIBE --data-urlencode "target=PORTLET_ID.$PORTLET_ID" > "$OUT/status"
    [ "$(status_of)" = 200 ]
}

portlet_status() {  # portlet_status <node> <jar>: HTTP status of the portlet's registry entry
    get "$1" "$2" "/api/portlet/$PERMISSION_FNAME.json" > /dev/null
    status_of
}

denied_on() { [ "$(portlet_status "$1" "$2")" = 403 ]; }
new_session_status() {  # new_session_status <node>: what a new student session on the node gets
    local jar=$JARS/perm-new-$1
    rm -f "$jar"
    login "$1" student "$jar" || { echo login-failed; return; }
    portlet_status "$1" "$jar"
    logout "$1" "$jar"
}
new_session_allowed() { [ "$(new_session_status "$1")" = 200 ]; }
new_session_denied() { [ "$(new_session_status "$1")" = 403 ]; }
allowed_on() { [ "$(portlet_status "$1" "$2")" = 200 ]; }

check_permission_invalidation() {
    local admin=$JARS/perm-admin started elapsed session=() n
    PERSON_TYPE=$(sql "select entity_type_id from up_entity_type where entity_type_name = 'org.apereo.portal.security.IPerson'")
    PORTLET_ID=$(sql "select portlet_def_id from up_portlet_def where portlet_fname = '$PERMISSION_FNAME'")
    if [ -z "$PERSON_TYPE" ] || [ -z "$PORTLET_ID" ]; then
        record invalidation-permission FAIL "could not look up the person entity type or portlet $PERMISSION_FNAME"
        return
    fi
    login a admin "$admin" || { record invalidation-permission FAIL "admin login failed"; return; }
    # A student session on each node checks (and caches) the denial first
    for n in a b; do
        login "$n" student "$JARS/perm-early-$n" && denied_on "$n" "$JARS/perm-early-$n" ||
            { record invalidation-permission FAIL "student could already open $PERMISSION_FNAME on node $n (HTTP $(status_of))"; return; }
    done
    update_permission "$admin" GRANT || { record invalidation-permission FAIL "grant on node A failed (HTTP $(status_of))"; return; }
    log "invalidation-permission: UP_PERMISSION rows for the target: $(sql "select principal_type, principal_key, activity, permission_type from up_permission
         where target = 'PORTLET_ID.$PORTLET_ID'" | tr '\n' ' ')"
    # The existing sessions first: a new login of the student could refresh what they read
    for n in a b; do
        poll "$PERMISSION_SESSION_BOUND_S" allowed_on "$n" "$JARS/perm-early-$n" ||
            session+=("node $n: the session denied before the grant was still denied $PERMISSION_SESSION_BOUND_S s after it$(late_by 120 allowed_on "$n" "$JARS/perm-early-$n")")
    done
    started=$(now_ms)
    if ! poll 30 new_session_allowed a; then
        record invalidation-permission FAIL "a new session on node A, where the grant was made, still denied the portlet 30 s later"
        update_permission "$admin" INHERIT
        return
    fi
    if ! poll "$PERMISSION_BOUND_S" new_session_allowed b; then
        record invalidation-permission FAIL "a new session on node B still denied the portlet $PERMISSION_BOUND_S s after node A granted it"
        update_permission "$admin" INHERIT
        return
    fi
    log "invalidation-permission: a new session on node B allowed the grant after $(( $(now_ms) - started )) ms"
    for n in a b; do
        login "$n" student "$JARS/perm-granted-$n" && allowed_on "$n" "$JARS/perm-granted-$n" ||
            { record invalidation-permission FAIL "a new student session on node $n was not allowed"; update_permission "$admin" INHERIT; return; }
    done

    # Revoke: the security-relevant direction. The existing sessions first again.
    update_permission "$admin" INHERIT || { record invalidation-permission FAIL "revoke on node A failed (HTTP $(status_of))"; return; }
    started=$(now_ms)
    for n in a b; do
        poll "$PERMISSION_SESSION_BOUND_S" denied_on "$n" "$JARS/perm-granted-$n" ||
            session+=("node $n: the session allowed before the revocation was still allowed $PERMISSION_SESSION_BOUND_S s after it$(late_by 120 denied_on "$n" "$JARS/perm-granted-$n")")
    done
    if ! poll 30 new_session_denied a; then
        record invalidation-permission FAIL "a new session on node A, where the permission was revoked, was still allowed 30 s later"
    elif poll "$PERMISSION_BOUND_S" new_session_denied b; then
        elapsed=$(( $(now_ms) - started ))
        record invalidation-permission PASS "a new session on node B was denied ${elapsed} ms after node A revoked the permission (bound ${PERMISSION_BOUND_S} s)"
    else
        record invalidation-permission FAIL "a new session on node B was still allowed $PERMISSION_BOUND_S s after node A revoked the permission"
    fi
    if [ ${#session[@]} -eq 0 ]; then
        record permission-session PASS "existing sessions on both nodes followed the grant and the revocation within $PERMISSION_SESSION_BOUND_S s"
    else
        record permission-session FAIL "$(IFS=';'; echo "${session[*]}")"
    fi
}

# ---- Split and merge ---------------------------------------------------------------------------

# Both nodes' JGroups TCP ports (TCP bind_port 7800 and its port range); HTTP and the database
# stay reachable
SPLIT_PORTS=7800:7810
# After the merge, node B must show what node A changed during the split within this time
SPLIT_HEAL_BOUND_S=30
# SPLIT_HEAL_STATEMENTS=1 also counts the statements PostgreSQL runs in the 30 s after the merge,
# when the nodes read their emptied caches again, and in 30 s before the split for comparison
SPLIT_HEAL_STATEMENTS=${SPLIT_HEAL_STATEMENTS:-}

utc_now() { date -u '+%F %T.%3N'; }

statements_between() {  # statements_between <from> <to>: statements PostgreSQL logged in between
    # Each statement is one "LOG:  statement:" or "LOG:  execute" line, after a UTC timestamp
    docker logs "$(container_name "$VENDOR")" 2>&1 |
        awk -v from="$1" -v to="$2" '/LOG:  (statement|execute)/ { t = $1 " " $2; if (t >= from && t < to) n++ } END { print n + 0 }'
}

first_merge_utc() {  # first_merge_utc <lines before on a> <lines before on b>: when the first MergeView was installed
    { views_installed a | tail -n +"$(( $1 + 1 ))"; views_installed b | tail -n +"$(( $2 + 1 ))"; } |
        grep 'MergeView' | awk '{ print $1, $2 }' | sort | head -n 1 |
        { read -r day time && date -u -d "${day//-/ } $time" '+%F %T.%3N'; }
}

firewall() {  # firewall <iptables arguments...>
    if [ "$(id -u)" = 0 ]; then iptables "$@"; else sudo -n iptables "$@"; fi
}

split() {  # drop every JGroups packet between the nodes, both ways
    firewall -I INPUT -i lo -p tcp --dport "$SPLIT_PORTS" -j DROP &&
        firewall -I INPUT -i lo -p tcp --sport "$SPLIT_PORTS" -j DROP
}

heal() {
    firewall -D INPUT -i lo -p tcp --dport "$SPLIT_PORTS" -j DROP 2> /dev/null
    firewall -D INPUT -i lo -p tcp --sport "$SPLIT_PORTS" -j DROP 2> /dev/null
    return 0
}

views_installed() {  # views_installed <node>: the "installing view" lines the node has logged
    grep -h 'GMS.installView' "$(node_home "$1")"/logs/catalina.*.log 2> /dev/null
}

new_view_matches() {  # new_view_matches <node> <lines before> <pattern>: a later view matches
    views_installed "$1" | tail -n +"$(( $2 + 1 ))" | grep -qE "$3"
}

check_split_heal() {
    local a=$JARS/split-a b=$JARS/split-b s=$JARS/split-student-b admin=$JARS/split-admin
    local original changed before_a before_b merged elapsed stale=()
    login a admin "$a" && login b admin "$b" && login a admin "$admin" ||
        { record split-heal FAIL "admin login failed"; return; }
    # Node B caches the portlet definition, and a student session on node B the denial
    original=$(portlet_title_on b "$b")
    login b student "$s" && denied_on b "$s" ||
        { record split-heal FAIL "the student could already open $PERMISSION_FNAME on node B (HTTP $(status_of))"; return; }
    get a "$a" "/api/entity/portlet-definition/$PORTLET_FNAME?download=false" > "$OUT/split-original.xml"
    grep -q "<title>$original</title>" "$OUT/split-original.xml" ||
        { record split-heal FAIL "could not export $PORTLET_FNAME from node A (HTTP $(status_of))"; return; }
    changed="$original (split $RANDOM)"
    sed "s#<title>$original</title>#<title>$changed</title>#" "$OUT/split-original.xml" > "$OUT/split-changed.xml"

    if [ -n "$SPLIT_HEAL_STATEMENTS" ]; then
        sql "alter system set log_statement = 'all'" > /dev/null && sql "select pg_reload_conf()" > /dev/null
        sleep 30
        local quiet_to quiet_from
        quiet_to=$(utc_now)
        quiet_from=$(date -u -d "$quiet_to 30 seconds ago" '+%F %T.%3N')
    fi
    before_a=$(views_installed a | wc -l)
    before_b=$(views_installed b | wc -l)
    split || { record split-heal FAIL "could not block the JGroups ports with iptables"; return; }
    log "split-heal: JGroups ports $SPLIT_PORTS blocked"
    if ! { poll 60 new_view_matches a "$before_a" '\] \(1\) \[' && poll 60 new_view_matches b "$before_b" '\] \(1\) \['; }; then
        heal
        record split-heal FAIL "the nodes did not both install a view of one member within 60 s of the split"
        return
    fi
    log "split-heal: both nodes installed a view of one member"
    curl -sS -b "$a" -H "$(csrf_header a "$a")" -o /dev/null -w '%{http_code}' -F "file=@$OUT/split-changed.xml;type=text/xml" \
        "$(node_url a)/api/import" > "$OUT/status"
    [ "$(status_of)" = 200 ] && update_permission "$admin" GRANT ||
        { heal; record split-heal FAIL "the changes on node A failed during the split (HTTP $(status_of))"; return; }
    sleep 5
    # The split must hold: node B has not heard of either change
    title_is b "$b" "$original" || stale+=("node B showed '$(portlet_title_on b "$b")' during the split")
    denied_on b "$s" || stale+=("the student session on node B was allowed during the split")
    before_a=$(views_installed a | wc -l)
    before_b=$(views_installed b | wc -l)
    heal
    log "split-heal: JGroups ports unblocked"
    if ! { poll 120 new_view_matches a "$before_a" 'MergeView' && poll 120 new_view_matches b "$before_b" 'MergeView'; }; then
        record split-heal FAIL "the nodes did not both install a MergeView within 120 s of the heal"
    elif [ ${#stale[@]} -gt 0 ]; then
        record split-heal FAIL "the split did not hold: $(IFS=';'; echo "${stale[*]}")"
    else
        merged=$(now_ms)
        if [ -n "$SPLIT_HEAL_STATEMENTS" ]; then
            local merge_utc
            merge_utc=$(first_merge_utc "$before_a" "$before_b")
        fi
        if poll "$SPLIT_HEAL_BOUND_S" title_is b "$b" "$changed" && poll "$SPLIT_HEAL_BOUND_S" allowed_on b "$s"; then
            elapsed=$(( $(now_ms) - merged ))
            record split-heal PASS "after the merge node B showed the title and allowed the student session within ${elapsed} ms (both changed on node A during the split)"
        else
            record split-heal FAIL "$SPLIT_HEAL_BOUND_S s after the merge node B showed '$(portlet_title_on b "$b")' (database: '$changed') and the student session got HTTP $(portlet_status b "$s")"
        fi
    fi
    if [ -n "$SPLIT_HEAL_STATEMENTS" ] && [ -n "${merge_utc:-}" ]; then
        local after_to
        after_to=$(date -u -d "$merge_utc 30 seconds" '+%F %T.%3N')
        while [ "$(utc_now)" \< "$after_to" ]; do sleep 1; done
        sleep 2
        log "split-heal: PostgreSQL ran $(statements_between "$merge_utc" "$after_to") statements in the 30 s after the merge at $merge_utc UTC, and $(statements_between "$quiet_from" "$quiet_to") in the 30 s before the split"
        sql "alter system reset log_statement" > /dev/null && sql "select pg_reload_conf()" > /dev/null
    fi
    curl -sS -b "$a" -H "$(csrf_header a "$a")" -o /dev/null -F "file=@$OUT/split-original.xml;type=text/xml" "$(node_url a)/api/import"
    update_permission "$admin" INHERIT
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

# Events not aggregated yet (one that failed to convert is never aggregated), split at the
# aggregator's last event date: the aggregator reads only events after it, so an event before it
# that is still not aggregated (stored late by a node whose event queue was not flushed yet) never
# will be
UNAGGREGATED="aggregated is not true and error_aggr is not true"
LAST_EVENT_DATE="(select last_event_date from up_event_aggr_status where processing_type = 'AGGREGATION')"
pending() { sql "select count(*) from up_raw_events where $UNAGGREGATED and \"timestamp\" >= coalesce($LAST_EVENT_DATE, '-infinity')"; }
stranded() { sql "select count(*) from up_raw_events where $UNAGGREGATED and \"timestamp\" < $LAST_EVENT_DATE"; }

wait_aggregated() {  # wait_aggregated <seconds>: until the aggregator has read every raw event so far
    local deadline=$(( $(date +%s) + $1 )) n
    sleep 6  # aggregationDelay: the newest events are not eligible yet
    while true; do
        n=$(pending)
        [ "$n" = 0 ] && return 0
        if [ "$(date +%s)" -ge "$deadline" ]; then
            log "$n raw events still not aggregated; now $(sql "select localtimestamp")"
            sql "select server_id, event_type, \"timestamp\", aggregated, error_aggr from up_raw_events
                 where $UNAGGREGATED order by \"timestamp\" limit 30"
            log "aggregator status:"
            sql "select * from up_event_aggr_status"
            return 1
        fi
        sleep 3
    done
}

wait_schedulers() {  # until node B's scheduled tasks run (they start 120 s after uPortal starts)
    local ready=$(( B_STARTED + 125 ))
    if [ "$(date +%s)" -lt "$ready" ]; then
        log "waiting $(( ready - $(date +%s) )) s for node B's scheduled tasks (event flush, aggregation)"
        sleep $(( ready - $(date +%s) ))
    fi
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
    if [ -z "$KILLED_NODE" ] && ! cut -d'|' -f1 "$OUT/$check-raw-by-node.txt" | sort -u | tr '\n' ' ' | grep -q 'node-a node-b'; then
        problems+=("the raw events do not carry both server names node-a and node-b: $(cut -d'|' -f1 "$OUT/$check-raw-by-node.txt" | sort -u | tr '\n' ' ')")
    fi
    if [ ${#problems[@]} -eq 0 ]; then
        record "$check" PASS "$(IFS=';'; echo "${summary[*]}"), each interval's aggregates grew by exactly that"
    else
        record "$check" FAIL "$(IFS=';'; echo "${problems[*]}") ($(IFS=';'; echo "${summary[*]}"))"
    fi
}

check_jobs_once() {
    local since
    # Until then node B only queues its events, and stores them after node A aggregated past them
    # (see events-aggregated)
    wait_schedulers
    if ! wait_aggregated 300; then
        record jobs-once FAIL "the events of the earlier checks were not aggregated within 300 s"
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
    sql "select server_id, locked, (extract(epoch from lock_start) * 1000)::bigint,
             (extract(epoch from lock_update) * 1000)::bigint from up_mutex where mutex_name = '$AGGREGATION_MUTEX'"
}

check_failover() {
    local since locker row holder survivor last_update start took deadline stolen=false
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
    # The holder stays alive past the abandonment age: while it keeps updating the lock, the
    # other node must not take it
    log "failover: $holder holds $AGGREGATION_MUTEX and waits on up_event_aggr_status; keeping it for $(( LIVE_HOLD_MS / 1000 )) s"
    deadline=$(( $(date +%s) + LIVE_HOLD_MS / 1000 ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        IFS='|' read -r server locked _ _ <<< "$(mutex_row)"
        if [ "${server%%_*}" = "node-$survivor" ]; then
            record failover-takeover FAIL "node $survivor took $AGGREGATION_MUTEX from $holder while $holder was alive and updating it"
            stolen=true
            break
        fi
        sleep 1
    done
    log "failover: killing $holder"
    KILL_MS=$(now_ms)
    kill -9 "$(node_pid "$KILLED_NODE")"
    sql "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'cluster-test-lock'" > /dev/null
    wait "$locker" 2> /dev/null
    last_update=$(mutex_row | cut -d'|' -f4)
    log "failover: killed node $KILLED_NODE at $KILL_MS; its last lock update was $last_update"

    # The survivor may take the lock once it is abandoned: 60 s after its last update
    deadline=$(( last_update / 1000 + (ABANDONED_LOCK_AGE_MS + SERVER_BIAS_MS) / 1000 + 60 ))
    took=
    while [ "$stolen" = false ] && [ "$(date +%s)" -lt "$deadline" ]; do
        IFS='|' read -r server locked start _ <<< "$(mutex_row)"
        if [ "${server%%_*}" = "node-$survivor" ] && [ "$start" -gt "$last_update" ]; then
            took=$start
            break
        fi
        sleep 1
    done
    if [ "$stolen" = true ]; then
        :  # already recorded
    elif [ -z "$took" ]; then
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

check_events_aggregated() {  # no raw event was left behind the aggregator
    local n
    n=$(stranded)
    if [ "${n:-0}" = 0 ]; then
        record events-aggregated PASS "no raw event is left behind the aggregator's last event date"
        return
    fi
    sql "select server_id, event_type, count(*), min(\"timestamp\"), max(\"timestamp\") from up_raw_events
         where $UNAGGREGATED and \"timestamp\" < $LAST_EVENT_DATE group by 1, 2 order by 1, 2" > "$OUT/stranded-events.txt"
    cat "$OUT/stranded-events.txt"
    record events-aggregated FAIL "$n raw events are older than the aggregator's last event date ($(sql "select $LAST_EVENT_DATE")) and will never be aggregated: $(tr '\n' ' ' < "$OUT/stranded-events.txt")(node B started at $(date -u -d "@$B_STARTED" +%H:%M:%S) UTC, its event queue is flushed from 120 s later)"
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
    heal
    if [ "$KEEP" = false ]; then
        stop_node a
        stop_node b
        stop_database "$VENDOR"
    fi
}

jgroups_report() {  # the cluster views and JGroups problems each node logged
    local n
    for n in a b; do
        log "node $n JGroups: $(jgroups_lines "$n" | grep -c .) lines; the views, merges and problems:"
        jgroups_lines "$n" | grep -iE 'view|merg|suspect|secret key|cipher|discard|SEVERE|WARN|ERROR' | cut -c1-240 | head -n 40
    done
}

collect_logs() {  # keep both nodes' logs next to the results
    local n
    for n in a b; do
        rm -rf "$OUT/logs-$n"
        cp -r "$(node_home "$n")/logs" "$OUT/logs-$n" 2> /dev/null || true
    done
}

: > "$OUT/results.txt"
# The overlap check must catch the overlap seeded in tests/cluster/fixtures (lock-ignored rarely
# makes two nodes run a job at once, so it cannot be relied on to show this)
if node tests/cluster/lock-overlap.mjs a=tests/cluster/fixtures/overlap-a.log b=tests/cluster/fixtures/overlap-b.log \
        > "$OUT/lock-overlap-fixture.txt"; then
    echo "FAILED: tests/cluster/lock-overlap.mjs missed the overlap seeded in tests/cluster/fixtures"
    github_annotation error "cluster: no-overlap" "lock-overlap.mjs missed the overlap seeded in tests/cluster/fixtures"
    exit 1
fi
log "no-overlap: lock-overlap.mjs catches the overlap seeded in tests/cluster/fixtures"
log "Two-node cluster test${FAULT:+ with the seeded fault $FAULT}"
setup_ok=true
if [ "$DEPLOY" = true ]; then
    stop_node a
    stop_node b
    deploy || setup_ok=false
fi
if [ "$setup_ok" = true ]; then
    use_vendor "$VENDOR"
    start_node a || setup_ok=false
fi

if [ "$setup_ok" = true ] && [ "$LONE_RESTARTS" -gt 0 ]; then
    # A lone node's restart after a crash: its JGROUPSPING row says it is the coordinator, and
    # the restarted node sends JOINs to that dead address before it forms a cluster of its own
    : > "$OUT/lone-restarts.txt"
    for i in $(seq 1 "$LONE_RESTARTS"); do
        kill -9 "$(node_pid a)" 2> /dev/null
        sleep 5
        since=$(log_clock_ms)
        start_node a || { echo "restart $i: node A did not start" >> "$OUT/lone-restarts.txt"; continue; }
        outcome=$(node tests/cluster/cluster-join.mjs --lone "a=$(printf "%s," "$A_HOME"/logs/catalina.*.log)" --since "$since")
        echo "restart $i: $outcome" | tee -a "$OUT/lone-restarts.txt"
    done
    collect_logs
    cleanup
    exit 0
fi

if [ "$setup_ok" = true ] && [ "$JOIN_STARTS" -gt 0 ]; then
    # Join measurement only: node B started and stopped again and again against node A
    : > "$OUT/join-starts.txt"
    for i in $(seq 1 "$JOIN_STARTS"); do
        since=$(log_clock_ms)
        start_node b || { echo "start $i: node B did not start" >> "$OUT/join-starts.txt"; stop_node b; continue; }
        outcome=$(join_outcome "$since")
        rc=$?
        for _ in $(seq 1 $(( JOIN_BOUND_S + 30 ))); do
            [ "$rc" -ne 2 ] && break
            sleep 1
            outcome=$(join_outcome "$since")
            rc=$?
        done
        [ "$rc" -eq 2 ] && outcome="FAIL: still undecided $(( JOIN_BOUND_S + 30 )) s after node B answered: ${outcome#UNDECIDED: }"
        echo "start $i: $outcome" | tee -a "$OUT/join-starts.txt"
        stop_node b
        sleep 5
    done
    joined=$(grep -c ': PASS:' "$OUT/join-starts.txt")
    echo "==== cluster-join: node B joined within $JOIN_BOUND_S s on $joined of $JOIN_STARTS starts"
    collect_logs
    cleanup
    exit 0
fi

if [ "$setup_ok" = true ]; then
    since=$(log_clock_ms)
    { start_node b && B_STARTED=$(date +%s); } || setup_ok=false
fi
if [ "$setup_ok" = true ]; then
    check_cluster_join "$since"
    wait_for_cluster || setup_ok=false
fi

if [ "$setup_ok" = true ]; then
    check_portlet_invalidation
    check_layout_invalidation
    check_permission_invalidation
    check_split_heal
    if check_jobs_once; then
        check_failover
    fi
    check_events_aggregated
    check_no_overlap
fi
jgroups_report
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

failed=()
for check in "${CHECK_ORDER[@]}"; do
    if [ -n "${KNOWN_FAILURES[$check]+x}" ]; then
        if [ "${RESULTS[$check]}" = PASS ]; then
            echo "NOTE: $check passed although it is listed in KNOWN_FAILURES; remove it there if uPortal was fixed"
            github_annotation warning "cluster: $check passed" "$check is listed in KNOWN_FAILURES in tests/cluster/cluster.sh but passed"
        fi
    elif [ "${RESULTS[$check]}" = FAIL ]; then
        failed+=("$check")
    fi
done
if [ ${#failed[@]} -gt 0 ]; then
    echo "FAILED: ${failed[*]} (see $OUT)"
    node_errors
    exit 1
fi
echo "OK: every cluster check passed, apart from the known failures"
github_annotation notice "cluster: OK" "$(cat "$OUT/results.txt")"
