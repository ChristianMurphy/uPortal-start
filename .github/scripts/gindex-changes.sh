#!/usr/bin/env bash
# Does this run need G-index? (Prototype only: MOD-D30, MOD-D55, MOD-I306.)
#
# G-index loads a large database and runs the portal against it for about an hour, and it
# measures the schema, the queries and the indexes. A push to a topic branch
# (ccr-43ba0785-hzlrj5-<topic>) that touches none of those has nothing new for it to measure.
# This script says "run" for every other kind of run, and for a topic push only when the push
# changes persistence, SQL, schema, data files or G-index itself:
#
#   - the integration branch, a manual run and the nightly run always run G-index;
#   - on a topic push, two lists of changed files are compared with the paths below. The first is
#     uPortal-start's own (the topic branch against origin/<integration branch>); the second is
#     the uPortal branch of the same name, if there is one, against uPortal's integration branch.
#   - when the script cannot tell (a branch or a history it cannot fetch), it runs G-index.
#
# Environment:
#   EVENT_NAME   github.event_name
#   BRANCH       github.ref_name
#   INTEGRATION  the integration branch (default ccr-43ba0785-hzlrj5)
#   START_DIR    a checkout of uPortal-start with the history of origin/<INTEGRATION> (default .)
#   UPORTAL_URL  where to fetch uPortal from; empty skips the uPortal check
#
# It writes run=true or run=false and a one-line report to $GITHUB_OUTPUT (to standard output when
# that is unset), and the files that matched, or "no matching changes, G-index skipped", to the job
# summary, the log and a notice annotation. Agents can't read job summaries, but the annotations of
# a job come back through the API, and the workflow prints the report again in the last step of the
# job.
#
# Rule of thumb for the paths: when unsure, include the path. A false "run" costs an hour of a
# runner; a false "skip" is caught by the next push to the integration branch, which always runs.
# The table test is .github/scripts/gindex-changes.test.sh.
set -uo pipefail

EVENT_NAME=${EVENT_NAME:?EVENT_NAME is not set}
BRANCH=${BRANCH:?BRANCH is not set}
INTEGRATION=${INTEGRATION:-ccr-43ba0785-hzlrj5}
START_DIR=${START_DIR:-.}
UPORTAL_URL=${UPORTAL_URL:-}
LIST_LIMIT=40

# uPortal-start: the tests/db scripts and vendor files, the data files, G-index's workflow and this
# script, the Gradle tasks that gindex.sh runs (database, Tomcat, dataInit) and the build files they
# read, the portal and Tomcat settings (data source, pool), and the overlays' versions.
START_PATHS='^(tests/db/|data/|\.github/workflows/g-index\.yml$|\.github/scripts/gindex-changes(\.test)?\.sh$|gradle/tasks/|build\.gradle$|settings\.gradle$|gradle\.properties\.example$|buildSrc/|etc/(portal|hsql|tomcat)/|overlays/(build\.gradle$|[^/]+/build\.gradle$|patches/))'

# uPortal: SQL and Hibernate or JPA mappings and configuration, the data access, the RDBM stores,
# the aggregation of events, the import and export of data, the scripts of uPortal-tools, and the
# Spring contexts and property files that set up the data source and the caches.
UPORTAL_PATHS='(\.sql$|\.hbm\.xml$|\.cfg\.xml$|(^|/)(persistence|orm)\.xml$|(^|/)hibernate[^/]*\.properties$|(^|/)ehcache[^/]*\.xml$|(^|/)[a-z]*(persistence|datasource|cache|importexport)[a-z]*context[^/]*\.xml$|^uPortal-webapp/src/main/resources/properties/(db/|rdbm\.properties$|portal\.properties$)|(^|/)(dao|jpa|aggr|rdbm|hibernate|persistence|entity|entities|usertype)(/|$)|(^|/)RDBM[^/]*\.java$|^uPortal-(rdbm|hibernate|db-migrate|io|events|tools)/|^gradle\.properties$|^gradle/[^/]*\.(toml|properties)$)'

finish() {  # finish <true|false> <heading> <one-line report> [markdown lines...]
    local run="$1" heading="$2" report="$3" text note
    shift 3
    text=$(printf '### G-index change check: %s\n\n' "$heading"; if [ $# -gt 0 ]; then printf '%s\n' "$@"; fi)
    echo "$text"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$text" >> "$GITHUB_STEP_SUMMARY"; fi
    # an annotation message: % first, then the line ends
    note=${text//'%'/'%25'}; note=${note//$'\r'/'%0D'}; note=${note//$'\n'/'%0A'}
    echo "::notice title=G-index change check::$note"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        { echo "run=$run"; echo "report=$report"; } >> "$GITHUB_OUTPUT"
    else
        echo "run=$run"
        echo "report=$report"
    fi
    exit 0
}

bullets() {  # bullets <label> <files>: the first LIST_LIMIT files, one bullet each
    local label="$1" files="$2" total
    total=$(printf '%s\n' "$files" | wc -l)
    echo "$label ($total):"
    printf '%s\n' "$files" | head -n "$LIST_LIMIT" | sed 's/^/- `/; s/$/`/'
    if [ "$total" -gt "$LIST_LIMIT" ]; then echo "- and $((total - LIST_LIMIT)) more"; fi
}

case "$EVENT_NAME:$BRANCH" in
    push:"$INTEGRATION"-*) ;;
    *) finish true "run" "run: $EVENT_NAME on $BRANCH is not a push to a topic branch" \
        "$EVENT_NAME on $BRANCH is not a push to a topic branch of $INTEGRATION, which always runs G-index." ;;
esac

# uPortal-start's own changes
if ! start_files=$(git -C "$START_DIR" diff --no-renames --name-only "origin/$INTEGRATION...HEAD" 2>&1); then
    finish true "run" "run: could not compare this push with origin/$INTEGRATION" \
        "Could not compare this push with origin/$INTEGRATION, so G-index runs to be safe:" '```' "$start_files" '```'
fi
start_matched=$(printf '%s\n' "$start_files" | grep -E -i -- "$START_PATHS" || true)

# the uPortal branch of the same name, if there is one
uportal_matched=
uportal_note="no uPortal branch named $BRANCH"
if [ -n "$UPORTAL_URL" ]; then
    git ls-remote --exit-code --heads "$UPORTAL_URL" "refs/heads/$BRANCH" > /dev/null 2>&1
    case $? in
        0)
            tmp=$(mktemp -d)
            trap 'rm -rf "$tmp"' EXIT
            git -C "$tmp" init -q
            if ! git -C "$tmp" fetch -q --no-tags --filter=blob:none "$UPORTAL_URL" \
                    "+refs/heads/$INTEGRATION:refs/remotes/u/integration" "+refs/heads/$BRANCH:refs/remotes/u/topic" 2> "$tmp/fetch.err" ||
                ! uportal_files=$(git -C "$tmp" diff --no-renames --name-only u/integration...u/topic 2>&1); then
                finish true "run" "run: could not compare uPortal's $BRANCH with its $INTEGRATION" \
                    "Could not compare uPortal's $BRANCH with its $INTEGRATION, so G-index runs to be safe:" '```' "$(cat "$tmp/fetch.err" 2> /dev/null)" "${uportal_files:-}" '```'
            fi
            uportal_matched=$(printf '%s\n' "$uportal_files" | grep -E -i -- "$UPORTAL_PATHS" || true)
            uportal_note="uPortal branch $BRANCH, $(printf '%s\n' "$uportal_files" | grep -c .) changed files"
            ;;
        2) ;;
        *) finish true "run" "run: could not list the branches of uPortal" \
            "Could not list the branches of uPortal, so G-index runs to be safe." ;;
    esac
fi

if [ -z "$start_matched" ] && [ -z "$uportal_matched" ]; then
    finish false "skipped" "skipped: no matching changes, G-index skipped" "no matching changes, G-index skipped" "" \
        "Checked uPortal-start against origin/$INTEGRATION ($(printf '%s\n' "$start_files" | grep -c .) changed files) and uPortal ($uportal_note)."
fi

lines=("This push changes files that G-index measures:" "")
if [ -n "$start_matched" ]; then lines+=("$(bullets "uPortal-start" "$start_matched")" ""); fi
if [ -n "$uportal_matched" ]; then lines+=("$(bullets "uPortal branch $BRANCH" "$uportal_matched")" ""); fi
report="run: $(printf '%s\n' "$start_matched" | grep -c .) matching files in uPortal-start"
if [ -n "$start_matched" ]; then report+=" (first: $(printf '%s\n' "$start_matched" | head -n 1))"; fi
report+=", $(printf '%s\n' "$uportal_matched" | grep -c .) in uPortal"
if [ -n "$uportal_matched" ]; then report+=" (first: $(printf '%s\n' "$uportal_matched" | head -n 1))"; fi
finish true "run" "$report" "${lines[@]}"
