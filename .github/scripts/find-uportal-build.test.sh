#!/usr/bin/env bash
# Table test of find-uportal-build.sh (MOD-I342). Each row gives the artifacts that a fake gh lists
# and the event of each run, runs the script and compares the run it chose with the expected one
# ("build" when it must build).
#
#   .github/scripts/find-uportal-build.test.sh
set -uo pipefail

SCRIPT=$(cd "$(dirname "$0")" && pwd)/find-uportal-build.sh
SHA=0123456789abcdef0123456789abcdef01234567
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
failures=0
cases=0

# A fake gh: "gh api <path> --jq <filter>" answers from the files in $FAKE. The artifacts file
# holds the lines that the real filter would print (id, run id, head repository id), newest
# first; runs/<id> holds a run's event. A file named "fail-<name>" makes that call fail.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/gh" <<'EOF'
#!/usr/bin/env bash
path="$2"
case "$path" in
    repos/owner/uPortal-start)
        [ -e "$FAKE/fail-repository" ] && { echo "HTTP 500" >&2; exit 1; }
        echo 42 ;;
    repos/owner/uPortal-start/actions/artifacts\?name=uportal-m2-*)
        [ -e "$FAKE/fail-artifacts" ] && { echo "HTTP 403" >&2; exit 1; }
        cat "$FAKE/artifacts" ;;
    repos/owner/uPortal-start/actions/runs/*)
        run=${path##*/}
        [ -e "$FAKE/fail-run-$run" ] && { echo "HTTP 404" >&2; exit 1; }
        cat "$FAKE/runs/$run" ;;
    *) echo "unexpected gh call: $*" >&2; exit 2 ;;
esac
EOF
chmod +x "$WORK/bin/gh"

# row <name> <expected run|build> <artifact lines, ";" between them> <run events, "id=event" with
# "," between them> [files that make calls fail, "," between them] [sha]
row() {
    local name="$1" expected="$2" artifacts="$3" events="$4" failing="${5:-}" sha="${6-$SHA}"
    local fake="$WORK/case$cases" out status answer artifact pair
    cases=$((cases + 1))
    mkdir -p "$fake/runs"
    tr ';' '\n' <<< "$artifacts" > "$fake/artifacts"
    for pair in ${events//,/ }; do echo "${pair#*=}" > "$fake/runs/${pair%%=*}"; done
    for pair in ${failing//,/ }; do touch "$fake/$pair"; done
    : > "$fake/output"
    out=$(env PATH="$WORK/bin:$PATH" FAKE="$fake" REPOSITORY=owner/uPortal-start \
        UPORTAL_REPOSITORY=owner/uPortal UPORTAL_SHA="$sha" GITHUB_OUTPUT="$fake/output" "$SCRIPT" 2>&1)
    status=$?
    answer=$(sed -n 's/^run-id=//p' "$fake/output")
    artifact=$(sed -n 's/^artifact=//p' "$fake/output")
    [ -n "$answer" ] || answer=build
    if [ "$status" -eq 0 ] && [ "$answer" = "$expected" ] && [ -n "$artifact" ]; then
        printf 'ok    %-58s %s (%s)\n' "$name" "$answer" "$artifact"
    else
        printf 'FAIL  %-58s expected %s, got %s (status %s, artifact "%s")\n%s\n' \
            "$name" "$expected" "$answer" "$status" "$artifact" "$out"
        failures=$((failures + 1))
    fi
}

row "no artifact" build "" ""
row "one artifact from a push" 101 "11 101 42" "101=push"
row "from a manual run" 102 "12 102 42" "102=workflow_dispatch"
row "from the schedule" 103 "13 103 42" "103=schedule"
row "from a pull request" build "14 104 42" "104=pull_request"
row "from a fork" build "15 105 77" "105=push"
row "a fork's first, then this repository's" 106 "16 105 77;17 106 42" "105=push,106=push"
row "a pull request's first, then a push's" 108 "18 107 42;19 108 42" "107=pull_request_target,108=push"
row "the newest of two pushes" 110 "21 110 42;20 109 42" "109=push,110=push"
row "a run that can't be read, then one that can" 112 "22 111 42;23 112 42" "112=push" "fail-run-111"
row "the artifacts can't be listed" build "11 101 42" "101=push" "fail-artifacts"
row "the repository can't be read" build "11 101 42" "101=push" "fail-repository"
row "no commit chosen" build "11 101 42" "101=push" "" ""
row "not a commit id" build "11 101 42" "101=push" "" "main"

echo "$cases rows, $failures failed"
[ "$failures" -eq 0 ]
