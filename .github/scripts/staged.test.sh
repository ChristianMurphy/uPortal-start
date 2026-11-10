#!/usr/bin/env bash
# Table test of staged.sh. The first rows check which changes move the key of a tree. The others
# give the markers that a fake gh lists and the run of each, run "staged.sh check" and compare its
# skip and mark outputs with the expected ones.
#
#   .github/scripts/staged.test.sh
set -uo pipefail

SCRIPT=$(cd "$(dirname "$0")" && pwd)/staged.sh
INTEGRATION=ccr-43ba0785-hzlrj5
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
failures=0
cases=0

commit() {  # commit <repository> <file> <text>: adds a line to a file and commits it
    mkdir -p "$1/$(dirname "$2")"
    echo "$3" >> "$1/$2"
    git -C "$1" add -A
    git -C "$1" -c user.name=test -c user.email=test@example.org commit -q -m "change $2"
}

repository() {  # repository <directory>: a repository with code, a workflow and notes
    git init -q "$1"
    commit "$1" src/Main.java "class Main {}"
    commit "$1" .github/workflows/CI.yml "name: CI"
    commit "$1" docs/developer/modernization/LOG.md "# Log"
    commit "$1" docs/README.md "# Docs"
}

key_of() { (cd "$1" && shift && "$SCRIPT" key "$@"); }

# key_row <name> <same|differs> <file> [<repository to change> [uportal]]: changes one file and
# compares the key of $WORK/own before and after, with the head of $WORK/uportal when "uportal" is
# given
key_now() {
    if [ -n "$1" ]; then key_of "$WORK/own" "$UPORTAL" "$(uportal_head)"; else key_of "$WORK/own"; fi
}
key_row() {
    local name="$1" expected="$2" file="$3" target="${4:-$WORK/own}" with="${5:-}" before after answer
    cases=$((cases + 1))
    before=$(key_now "$with")
    commit "$target" "$file" "a change"
    after=$(key_now "$with")
    answer=differs
    if [ "$before" = "$after" ]; then answer=same; fi
    if [[ "$before" =~ ^[0-9a-f]{64}$ ]] && [[ "$after" =~ ^[0-9a-f]{64}$ ]] && [ "$answer" = "$expected" ]; then
        printf 'ok    %-62s %s\n' "$name" "$answer"
    else
        printf 'FAIL  %-62s expected %s, got %s ("%s", "%s")\n' "$name" "$expected" "$answer" "$before" "$after"
        failures=$((failures + 1))
    fi
}

repository "$WORK/own"
repository "$WORK/uportal"
# a commit can be fetched by its id, as from GitHub
git -C "$WORK/uportal" config uploadpack.allowAnySHA1InWant true
git -C "$WORK/uportal" config uploadpack.allowFilter true
UPORTAL="file://$WORK/uportal"
uportal_head() { git -C "$WORK/uportal" rev-parse HEAD; }

key_row "a log entry"                                        same    docs/developer/modernization/LOG.md
key_row "a new note"                                         same    docs/developer/modernization/notes/topic.md
key_row "a coordinator file in Markdown"                     same    .claude/modernization/README.md
key_row "a coordinator script"                               differs .claude/modernization/land-push.sh
key_row "a file beside the notes that isn't Markdown"        differs docs/developer/modernization/notes/Tool.java
key_row "another doc"                                        differs docs/README.md
key_row "code"                                               differs src/Main.java
key_row "a workflow"                                         differs .github/workflows/CI.yml
key_row "a new file"                                         differs src/New.java
key_row "with uPortal: a log entry in uPortal"               same    docs/developer/modernization/LOG.md "$WORK/uportal" uportal
key_row "with uPortal: code in uPortal"                      differs src/Main.java "$WORK/uportal" uportal
key_row "with uPortal: code in this repository"              differs src/Main.java "$WORK/own" uportal

cases=$((cases + 1))
if [ "$(key_of "$WORK/own")" != "$(key_of "$WORK/own" "$UPORTAL" "$(uportal_head)")" ]; then
    printf 'ok    %-62s differs\n' "the key with uPortal and the key without"
else
    printf 'FAIL  %-62s the same key\n' "the key with uPortal and the key without"
    failures=$((failures + 1))
fi
cases=$((cases + 1))
if out=$(key_of "$WORK/own" "$UPORTAL" 0123456789abcdef0123456789abcdef01234567 2>&1); then
    printf 'FAIL  %-62s got "%s"\n' "a uPortal commit that doesn't exist gives no key" "$out"
    failures=$((failures + 1))
else
    printf 'ok    %-62s no key\n' "a uPortal commit that doesn't exist gives no key"
fi

# A fake gh: "gh api <path> --jq <filter>" answers from the files in $FAKE. The artifacts file
# holds the lines that the real filter would print (id, run id, head repository id, branch),
# newest first; runs/<id> holds a run's event and workflow path. A file named "fail-<name>" makes
# that call fail.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/gh" <<'EOF'
#!/usr/bin/env bash
path="$2"
case "$path" in
    repos/owner/uPortal)
        [ -e "$FAKE/fail-repository" ] && { echo "HTTP 500" >&2; exit 1; }
        echo 42 ;;
    repos/owner/uPortal/actions/artifacts\?name=staged-CI-*)
        [ -e "$FAKE/fail-artifacts" ] && { echo "HTTP 403" >&2; exit 1; }
        echo "$path" >> "$FAKE/asked"
        cat "$FAKE/artifacts" ;;
    repos/owner/uPortal/actions/runs/*)
        run=${path##*/}
        [ -e "$FAKE/fail-run-$run" ] && { echo "HTTP 404" >&2; exit 1; }
        cat "$FAKE/runs/$run" ;;
    *) echo "unexpected gh call: $*" >&2; exit 2 ;;
esac
EOF
chmod +x "$WORK/bin/gh"

STAGING="$INTEGRATION-landing-7"
PUSH="push .github/workflows/CI.yml"

# row <name> <expected skip> <expected mark> <event> <branch> <artifact lines, ";" between them>
#     <runs, "id=event path" with "," between them> [files that make calls fail, "," between them]
row() {
    local name="$1" skip="$2" mark="$3" event="$4" branch="$5" artifacts="$6" runs="$7" failing="${8:-}"
    local fake="$WORK/case$cases" out status got_skip got_mark got_key pair
    cases=$((cases + 1))
    mkdir -p "$fake/runs"
    tr ';' '\n' <<< "$artifacts" > "$fake/artifacts"
    IFS=, read -ra pairs <<< "$runs"
    for pair in "${pairs[@]}"; do echo "${pair#*=}" > "$fake/runs/${pair%%=*}"; done
    for pair in ${failing//,/ }; do touch "$fake/$pair"; done
    : > "$fake/output"
    out=$(cd "$WORK/own" && env PATH="$WORK/bin:$PATH" FAKE="$fake" REPOSITORY=owner/uPortal \
        EVENT_NAME="$event" BRANCH="$branch" WORKFLOW=CI GITHUB_OUTPUT="$fake/output" \
        GITHUB_STEP_SUMMARY=/dev/null "$SCRIPT" check 2>&1)
    status=$?
    got_skip=$(sed -n 's/^skip=//p' "$fake/output")
    got_mark=$(sed -n 's/^mark=//p' "$fake/output")
    got_key=$(sed -n 's/^key=//p' "$fake/output")
    # a lookup asks for the marker of this tree's key, and nothing else is asked without one
    if [ -e "$fake/asked" ] && ! grep -qx "repos/owner/uPortal/actions/artifacts?name=staged-CI-$got_key&per_page=30" "$fake/asked"; then
        status="asked for $(cat "$fake/asked")"
    fi
    # a run that looks nothing up doesn't ask GitHub
    if [ "$skip$mark" = falsefalse ] && [ -e "$fake/asked" ]; then status="asked GitHub with nothing to look up"; fi
    if [ "$status" = 0 ] && [ "$got_skip" = "$skip" ] && [ "$got_mark" = "$mark" ]; then
        printf 'ok    %-62s skip=%s mark=%s\n' "$name" "$got_skip" "$got_mark"
    else
        printf 'FAIL  %-62s expected skip=%s mark=%s, got skip=%s mark=%s (status %s)\n%s\n' \
            "$name" "$skip" "$mark" "$got_skip" "$got_mark" "$status" "$out"
        failures=$((failures + 1))
    fi
}

row "integration branch, no marker"                          false true  push "$INTEGRATION" "" ""
row "staging branch, no marker"                              false true  push "$STAGING" "" ""
row "integration branch, marker from a staging branch"       true  false push "$INTEGRATION" "11 101 42 $STAGING" "101=$PUSH"
row "staging branch, marker from another staging branch"     true  false push "$STAGING" "11 101 42 $INTEGRATION-landing-6" "101=$PUSH"
row "integration branch, marker from the integration branch" true  false push "$INTEGRATION" "11 101 42 $INTEGRATION" "101=$PUSH"
row "topic branch: nothing is asked"                         false false push "$INTEGRATION-topic" "11 101 42 $STAGING" "101=$PUSH"
row "a branch that only starts like a staging branch"        false false push "$INTEGRATION-landing" "11 101 42 $STAGING" "101=$PUSH"
row "master"                                                 false false push master "11 101 42 $STAGING" "101=$PUSH"
row "manual run on the integration branch"                   false false workflow_dispatch "$INTEGRATION" "11 101 42 $STAGING" "101=$PUSH"
row "the schedule"                                           false false schedule "$INTEGRATION" "11 101 42 $STAGING" "101=$PUSH"
row "marker from a topic branch"                             false true  push "$INTEGRATION" "11 101 42 $INTEGRATION-topic" "101=$PUSH"
row "marker from a fork"                                     false true  push "$INTEGRATION" "11 101 77 $STAGING" "101=$PUSH"
row "marker from a manual run"                               false true  push "$INTEGRATION" "11 101 42 $STAGING" "101=workflow_dispatch .github/workflows/CI.yml"
row "marker from another workflow"                           false true  push "$INTEGRATION" "11 101 42 $STAGING" "101=push .github/workflows/other.yml"
row "a fork's first, then this repository's"                 true  false push "$INTEGRATION" "12 102 77 $STAGING;11 101 42 $STAGING" "101=$PUSH,102=$PUSH"
row "the artifacts can't be listed"                          false true  push "$INTEGRATION" "11 101 42 $STAGING" "101=$PUSH" "fail-artifacts"
row "the repository can't be read"                           false true  push "$INTEGRATION" "11 101 42 $STAGING" "101=$PUSH" "fail-repository"
row "the run can't be read"                                  false true  push "$INTEGRATION" "11 101 42 $STAGING" "101=$PUSH" "fail-run-101"

# The names since 2026-11-10 (branches.sh). The rows above use the names from before, which count
# until those branches are deleted, and a marker under either name counts for a push to either.
NEW=feat/uportal-6
NEW_STAGING=staging/landing-7
row "new names: integration branch, no marker"               false true  push "$NEW" "" ""
row "new names: staging branch, no marker"                   false true  push "$NEW_STAGING" "" ""
row "new integration branch, marker from a new staging one"  true  false push "$NEW" "11 101 42 $NEW_STAGING" "101=$PUSH"
row "new integration branch, marker from an old staging one" true  false push "$NEW" "11 101 42 $STAGING" "101=$PUSH"
row "new integration branch, marker from the old one"        true  false push "$NEW" "11 101 42 $INTEGRATION" "101=$PUSH"
row "old integration branch, marker from a new staging one"  true  false push "$INTEGRATION" "11 101 42 $NEW_STAGING" "101=$PUSH"
row "new staging branch, marker from the new integration"    true  false push "staging/landing-8" "11 101 42 $NEW" "101=$PUSH"
row "new names: topic branch, nothing is asked"              false false push fix/topic "11 101 42 $NEW_STAGING" "101=$PUSH"
row "a topic that starts like the integration branch"        false false push feat/uportal-6-x "11 101 42 $NEW_STAGING" "101=$PUSH"
row "a branch that only starts like a new staging branch"    false false push staging/other "11 101 42 $NEW_STAGING" "101=$PUSH"
row "staging/landing- without a number"                      false false push staging/landing- "11 101 42 $NEW_STAGING" "101=$PUSH"
row "marker from a new topic branch"                         false true  push "$NEW" "11 101 42 fix/topic" "101=$PUSH"
row "marker from a topic that starts like the integration"   false true  push "$NEW" "11 101 42 feat/uportal-6-x" "101=$PUSH"
row "marker from staging/other"                              false true  push "$NEW" "11 101 42 staging/other" "101=$PUSH"
row "a topic's marker first, then a staging branch's"        true  false push "$NEW" "12 102 42 fix/topic;11 101 42 $NEW_STAGING" "101=$PUSH,102=$PUSH"
row "manual run on the new integration branch"               false false workflow_dispatch "$NEW" "11 101 42 $NEW_STAGING" "101=$PUSH"

# Outside a repository there is no key: the jobs run, and no marker is promised
cases=$((cases + 1))
mkdir -p "$WORK/empty" "$WORK/none"
: > "$WORK/none/output"
(cd "$WORK/empty" && env PATH="$WORK/bin:$PATH" FAKE="$WORK/none" REPOSITORY=owner/uPortal EVENT_NAME=push \
    BRANCH="$INTEGRATION" WORKFLOW=CI GITHUB_OUTPUT="$WORK/none/output" GIT_CEILING_DIRECTORIES="$WORK" \
    "$SCRIPT" check > /dev/null 2>&1)
if [ "$(tr '\n' ' ' < "$WORK/none/output" | cut -d' ' -f1-3)" = "skip=false mark=false key=" ]; then
    printf 'ok    %-62s skip=false mark=false\n' "no key"
else
    printf 'FAIL  %-62s got %s\n' "no key" "$(tr '\n' ' ' < "$WORK/none/output")"
    failures=$((failures + 1))
fi

echo "$cases rows, $failures failed"
[ "$failures" -eq 0 ]
