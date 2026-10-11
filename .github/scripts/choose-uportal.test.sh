#!/usr/bin/env bash
# Table test of choose-uportal.sh (MOD-I307). Each row builds a small uPortal repository with the
# branches (and tag) the row lists, runs the script as the workflows do and compares the ref it
# chose with the expected one, or expects the script to fail ("FAIL" as the expected ref).
#
#   .github/scripts/choose-uportal.test.sh
set -uo pipefail

SCRIPT=$(cd "$(dirname "$0")" && pwd)/choose-uportal.sh
INT=ccr-43ba0785-hzlrj5
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
failures=0
cases=0

git_in() { git -C "$1" -c user.email=test@example.com -c user.name=test -c commit.gpgsign=false "${@:2}"; }

# make_uportal <dir> <branch>...: a repository at <dir>/owner/uPortal with one commit on master
# and one more commit on each other branch; the commit of each branch differs. A first word
# "-master" renames master, so that the repository has no master.
make_uportal() {
    local dir="$1/owner/uPortal" branch no_master=false
    shift
    if [ "${1:-}" = -master ]; then no_master=true; shift; fi
    git init -q -b master "$dir"
    echo master > "$dir/file"
    git_in "$dir" add -A
    git_in "$dir" commit -q -m master
    for branch in "$@"; do
        [ "$branch" = master ] && continue
        git_in "$dir" checkout -q -b "$branch" master
        echo "$branch" > "$dir/file"
        git_in "$dir" commit -q -a -m "$branch"
    done
    git_in "$dir" checkout -q master
    if [ "$no_master" = true ]; then git_in "$dir" branch -q -m master initial; fi
}

# row <name> <expected ref|FAIL> <branches of uPortal, comma separated> <this branch> [env assignments...]
row() {
    local name="$1" expected="$2" branches="$3" this_branch="$4" dir out answer expected_sha status head_sha
    shift 4
    dir="$WORK/case$cases"
    cases=$((cases + 1))
    mkdir -p "$dir"
    make_uportal "$dir" ${branches//,/ }
    git_in "$dir/owner/uPortal" tag -a -m "a tag" v1 "$(git_in "$dir/owner/uPortal" rev-parse HEAD)"
    head_sha=$(git_in "$dir/owner/uPortal" rev-parse HEAD)
    set -- "${@//SHA_OF_HEAD/$head_sha}"
    expected=${expected//SHA_OF_HEAD/$head_sha}
    out=$(env OWNER=owner BRANCH="$this_branch" INTEGRATION="$INT" GITHUB_URL="file://$dir" RETRY_SECONDS=0 \
        GITHUB_STEP_SUMMARY="" GITHUB_OUTPUT="" "$@" "$SCRIPT" 2>&1)
    status=$?
    answer=$(sed -n 's/^ref=//p' <<< "$out")
    if [ "$expected" = FAIL ]; then
        if [ "$status" -ne 0 ] && [ -z "$answer" ]; then
            printf 'ok    %-62s fails\n' "$name"
        else
            printf 'FAIL  %-62s expected a failure, got ref "%s" (status %s)\n' "$name" "$answer" "$status"
            failures=$((failures + 1))
        fi
        return
    fi
    expected_sha=$(git_in "$dir/owner/uPortal" rev-parse "$expected^{commit}" 2> /dev/null)
    if [ "$answer" = "$expected" ] && [ "$(sed -n 's/^sha=//p' <<< "$out")" = "$expected_sha" ] && [ "$status" -eq 0 ]; then
        printf 'ok    %-62s %s\n' "$name" "$answer"
    else
        printf 'FAIL  %-62s expected %s at %s\n' "$name" "$expected" "$expected_sha"
        sed 's/^/        /' <<< "$out"
        failures=$((failures + 1))
    fi
    last_output=$out
}

must_say() {  # must_say <text>: the last row's output has the text
    if ! grep -qF -- "$1" <<< "$last_output"; then
        printf 'FAIL  the output of the last row lacks: %s\n' "$1"
        sed 's/^/        /' <<< "$last_output"
        failures=$((failures + 1))
    fi
}

E2E=$INT-tests-e2e
R3=$INT-tests-e2e-r3

row "a branch of the same name exists"                      "$R3"   "master,$INT,$E2E,$R3" "$R3"
must_say "uPortal has a branch named $R3, like this one"
must_say "::notice title=uPortal under test::"
row "only an older prefix branch exists: the integration branch" "$INT" "master,$INT,$E2E" "$R3"
must_say "uPortal has no branch named $R3, so the integration branch"
row "this branch is the integration branch"                 "$INT"  "master,$INT,$E2E" "$INT"
row "no same-name and no integration branch: master"        master  "master,$E2E" "$R3"
must_say "so master"
row "this branch is master"                                 master  "master,$INT" master
row "a manual run gives a branch (it wins over the same name)" "$E2E" "master,$INT,$E2E,$R3" "$R3" INPUT_REF="$E2E"
must_say "it was given as the uportal-ref input"
row "a manual run gives a tag"                              v1      "master,$INT" "$R3" INPUT_REF=v1
row "a manual run gives a full commit"                      SHA_OF_HEAD "master,$INT" "$R3" INPUT_REF=SHA_OF_HEAD
row "a manual run gives a ref with a space"                 FAIL    "master,$INT" "$R3" INPUT_REF="a b"
row "a repository with a slash too many"                    FAIL    "master,$INT" "$R3" INPUT_REPOSITORY="a/b/c"
row "none of the three branches exists"                     FAIL    "-master,$E2E" "$R3"
row "the repository cannot be reached"                      FAIL    "master,$INT" "$R3" GITHUB_URL="file://$WORK/nowhere"

echo "$cases rows, $failures failed"
[ "$failures" -eq 0 ]
