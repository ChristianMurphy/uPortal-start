# shellcheck shell=bash
# Shared by tests/db/harness.sh and tests/db/migrate.sh (sourced, not run). The caller sets ROOT
# (the checkout), GRADLE_EXTRA (arguments for every Gradle call) and HTTP_PORT.
#
# A vendor is a file in tests/db/vendors. One with a container.image runs as a throwaway Docker
# container named uportal-dbh-<vendor> on its host.port; one without is served by uPortal-start's
# own HSQLDB server (hsqlStart), with the vendor's gradle.args (port, directory, HSQLDB version).

VENDOR_ARGS=()

prop() {  # prop <vendor> <key>: one value from tests/db/vendors/<vendor>.properties
    sed -n "s/^$2=//p" "tests/db/vendors/$1.properties" | tail -1
}

use_vendor() {  # use_vendor <vendor>: later gradle calls get the vendor's gradle.args
    VENDOR_ARGS=()
    if [ -n "$1" ]; then
        read -r -a VENDOR_ARGS <<< "$(prop "$1" gradle.args)"
    fi
}

gradle() {
    echo "+ ./gradlew $* ${VENDOR_ARGS[*]+"${VENDOR_ARGS[*]}"}"
    ./gradlew --no-daemon -S "$@" "${VENDOR_ARGS[@]+"${VENDOR_ARGS[@]}"}" "${GRADLE_EXTRA[@]+"${GRADLE_EXTRA[@]}"}"
}

container_name() {
    echo "uportal-dbh-$1"
}

hsql_database_dir() {  # the HSQLDB directory of the current vendor (see use_vendor)
    local arg dir=.gradle/hsqldb
    for arg in "${VENDOR_ARGS[@]+"${VENDOR_ARGS[@]}"}"; do
        case "$arg" in -PhsqlDatabaseDir=*) dir="${arg#-PhsqlDatabaseDir=}" ;; esac
    done
    echo "$dir"
}

start_database() {  # start_database <vendor>: a fresh, empty database
    local vendor="$1" image port env args hostport container
    image=$(prop "$vendor" container.image)
    use_vendor "$vendor"
    if [ -z "$image" ]; then
        # HSQLDB: start from an empty database directory so object names repeat
        rm -rf "$(hsql_database_dir)"
        gradle hsqlStart || return 1
        return 0
    fi
    port=$(prop "$vendor" container.port)
    env=$(prop "$vendor" container.env)
    args=$(prop "$vendor" container.args)
    hostport=$(prop "$vendor" host.port)
    container=$(container_name "$vendor")
    docker rm -f "$container" > /dev/null 2>&1 || true
    local envargs=() kv
    for kv in $env; do envargs+=(-e "$kv"); done
    # shellcheck disable=SC2086
    docker run -d --name "$container" -p "$hostport:$port" "${envargs[@]}" "$image" $args > /dev/null || return 1
    echo "Started $image as $container on port $hostport"
}

container_report() {  # container_report <vendor>: state and last log lines of its container
    local container
    [ -n "$(prop "$1" container.image)" ] || return 0
    container=$(container_name "$1")
    docker inspect -f "$container: {{.State.Status}}, exit code {{.State.ExitCode}}, OOM killed {{.State.OOMKilled}}" \
        "$container" 2>/dev/null || { echo "$container: no such container"; return 0; }
    docker logs --tail 15 "$container" 2>&1 | cut -c1-200
}

stop_database() {  # stop_database <vendor>
    local vendor="$1"
    use_vendor "$vendor"
    if [ -z "$(prop "$vendor" container.image)" ]; then
        gradle hsqlStop || true
    else
        docker rm -f "$(container_name "$vendor")" > /dev/null 2>&1 || true
        echo "Removed $(container_name "$vendor")"
    fi
}

stop_own_tomcat() {  # stop_own_tomcat <vendor>
    # tomcatStop can leave the JVM running (MOD-I53); only ever touch this checkout's Tomcat.
    use_vendor "$1"
    gradle -PdbVendor="$1" tomcatStop || true
    local base="$ROOT/.gradle/tomcat"
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        pgrep -f -- "-Dcatalina.base=$base " > /dev/null || return 0
        sleep 3
    done
    echo "Tomcat in $base did not exit after tomcatStop; sending SIGTERM"
    pkill -f -- "-Dcatalina.base=$base " || true
}

start_portal() {  # start_portal <vendor>: start Tomcat on the vendor's database and wait for uPortal
    local url="http://localhost:$HTTP_PORT/uPortal/"
    use_vendor "$1"
    gradle -PdbVendor="$1" tomcatStart || return 1
    for _ in $(seq 1 60); do
        if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -qE "200|302"; then
            echo "uPortal is up at $url against $1"
            return 0
        fi
        sleep 5
    done
    echo "uPortal did not answer at $url" >&2
    stop_own_tomcat "$1"
    return 1
}

# The connection budget (MOD-I190): what the portal and the bundled portlets may hold on the database
# at once (docs/connection-budget.md lists the pools that make it up). A run is checked against the
# budget or the server's max_connections less 10 for admin and monitoring tools, whichever is lower.
CONNECTION_BUDGET=${HARNESS_CONNECTION_BUDGET:-110}
CONNECTION_LIMIT=$CONNECTION_BUDGET

start_connection_sampler() {  # start_connection_sampler <container> <file>: count client connections every second
    local container="$1" file="$2" max
    : > "$file"
    max=$(docker exec "$container" psql -U uportal -d uportal -Atc "show max_connections" 2>/dev/null)
    CONNECTION_LIMIT=$CONNECTION_BUDGET
    if [ -n "$max" ] && [ $((max - 10)) -lt "$CONNECTION_BUDGET" ]; then CONNECTION_LIMIT=$((max - 10)); fi
    (
        while :; do
            n=$(docker exec "$container" psql -U uportal -d uportal -Atc \
                "select count(*) from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid()" \
                2>/dev/null) && echo "$(date -u +%H:%M:%S) $n" >> "$file"
            sleep 1
        done
    ) &
    SAMPLER_PID=$!
}

stop_connection_sampler() {  # stop_connection_sampler <file> <label>: print the peak; fail above the budget
    local file="$1" label="$2" peak samples
    kill "$SAMPLER_PID" 2>/dev/null; wait "$SAMPLER_PID" 2>/dev/null
    samples=$(wc -l < "$file")
    peak=$(awk 'BEGIN { m = 0 } $2 > m { m = $2; t = $1 } END { print m " at " t }' "$file")
    echo "Database connections ($label): peak ${peak:-0}, $samples samples, limit $CONNECTION_LIMIT" \
        "(budget $CONNECTION_BUDGET)"
    if [ "$samples" -lt 10 ]; then
        echo "The connection sampler took only $samples samples ($file)" >&2
        return 1
    fi
    if [ "${peak%% *}" -gt "$CONNECTION_LIMIT" ]; then
        github_annotation error "$label: database connections over budget" \
            "Peak ${peak} connections, limit $CONNECTION_LIMIT (docs/connection-budget.md)"
        return 1
    fi
}

github_annotation() {  # github_annotation <level> <title> <text>: on GitHub Actions only
    [ "${GITHUB_ACTIONS:-}" = true ] || return 0
    local title="$2" text="$3"
    # A property value also ends at ',' and ':'
    title=${title//'%'/'%25'}; title=${title//$'\r'/'%0D'}; title=${title//$'\n'/'%0A'}
    title=${title//':'/'%3A'}; title=${title//','/'%2C'}
    text=${text//'%'/'%25'}; text=${text//$'\r'/'%0D'}; text=${text//$'\n'/'%0A'}
    echo "::$1 title=$title::$text"
}

tomcat_errors() {  # the distinct database and schema errors in this checkout's Tomcat logs
    grep -rhE 'ERROR|SEVERE|Exception' "$ROOT/.gradle/tomcat/logs" 2>/dev/null |
        grep -iE 'dialect|schema|deadlock|table|hibernate|sql' | sed -E 's/^[0-9: ,.-]+//' |
        cut -c1-300 | sort | uniq -c | sort -rn | head -n 15
}

failed_specs() {  # the failure summary at the end of a Playwright list-reporter log
    sed -n '/^  [0-9]* failed/,$p' "$1" | head -n 40
}
