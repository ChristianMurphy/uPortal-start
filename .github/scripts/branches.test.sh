#!/usr/bin/env bash
# Table test of branches.sh. The first rows give a branch name and the kind expected for it. The
# next ones build small repositories and ask which integration branch they have. The last ones
# read the push triggers of the workflows beside this script and compare them with the names in
# branches.sh.
#
#   .github/scripts/branches.test.sh
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT=$HERE/branches.sh
WORKFLOWS=$HERE/../workflows
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
failures=0
cases=0

result() {  # result <name> <expected> <got>
    cases=$((cases + 1))
    if [ "$2" = "$3" ]; then
        printf 'ok    %-62s %s\n' "$1" "$3"
    else
        printf 'FAIL  %-62s expected "%s", got "%s"\n' "$1" "$2" "$3"
        failures=$((failures + 1))
    fi
}

kind() { result "$1" "$2" "$("$SCRIPT" kind "$1" 2>&1)"; }

kind feat/uportal-6                             integration
kind ccr-43ba0785-hzlrj5                        integration
kind staging/landing-13                         staging
kind staging/landing-semantic-proof             staging
kind ccr-43ba0785-hzlrj5-landing-12             staging
kind ccr-43ba0785-hzlrj5-landing-ci-test        staging
kind feat/search                                topic
kind fix/layout-save                            topic
kind ci/semantic-proof                          topic
kind docs/upgrading                             topic
kind test/replay-date                           topic
kind build/gradle-9                             topic
kind refactor/java-time                         topic
kind chore/cleanup                              topic
kind perf/layout-cache                          topic
kind fix/a/b                                    topic
kind ccr-43ba0785-hzlrj5-semantic-branches      topic
# the old archive branch looks like a topic, so nobody pushes to it. The new one starts no run
kind ccr-43ba0785-hzlrj5-archive-2026-11-08     topic
kind archive/2026-11-08                         other
# look-alikes
kind feat/uportal-6-x                           topic
kind feat/uportal-60                            topic
kind ccr-43ba0785-hzlrj5-landing                topic
kind ccr-43ba0785-hzlrj5-landing-               topic
kind fix/landing-3                              topic
kind staging/other                              other
kind staging/landing-                           other
kind staging/landing                            other
kind staging                                    other
kind feat/                                      other
kind feat                                       other
kind feature/search                             other
kind style/format                               other
kind revert/landing-3                           other
kind renovate/guava-monorepo                    other
kind backup/land-b2-start                       other
kind x/feat/search                              other
kind xfeat/uportal-6                            other
kind uportal-6                                  other
kind ccr-43ba0785-hzlrj5-                       other
kind ccr-43ba0785-hzlrj5x                       other
kind ccr-other                                  other
kind master                                     other
kind rel-5-17-patches                           other
kind 12/merge                                   other

result "integration: the current name first" "feat/uportal-6 ccr-43ba0785-hzlrj5" "$("$SCRIPT" integration | tr '\n' ' ' | sed 's/ $//')"
result "types" "feat fix ci docs test build refactor chore perf" "$("$SCRIPT" types | tr '\n' ' ' | sed 's/ $//')"
"$SCRIPT" > /dev/null 2>&1
result "no command: usage and exit status 2" 2 "$?"

git_in() { git -C "$1" -c user.email=test@example.com -c user.name=test -c commit.gpgsign=false "${@:2}"; }

# remote <name> <branch>...: a repository with one commit on each of the branches
remote() {
    local dir="$WORK/$1" branch
    shift
    git init -q -b first "$dir"
    echo text > "$dir/file"
    git_in "$dir" add -A
    git_in "$dir" commit -q -m first
    for branch in "$@"; do git_in "$dir" branch -q "$branch"; done
}

# integration_row <name> <expected branch or "none"> <branch>...
integration_row() {
    local name="$1" expected="$2" got status
    shift 2
    remote "remote$cases" "$@"
    got=$("$SCRIPT" integration-on "file://$WORK/remote$cases")
    status=$?
    if [ "$expected" = none ]; then
        result "on a remote: $name" "1:" "$status:$got"
    else
        result "on a remote: $name" "0:$expected" "$status:$got"
    fi
    git clone -q "$WORK/remote$((cases - 1))" "$WORK/clone$cases"
    got=$("$SCRIPT" integration-ref "$WORK/clone$cases")
    status=$?
    if [ "$expected" = none ]; then
        result "in a checkout: $name" "1:" "$status:$got"
    else
        result "in a checkout: $name" "0:origin/$expected" "$status:$got"
    fi
}

integration_row "only the old name"                 ccr-43ba0785-hzlrj5 master ccr-43ba0785-hzlrj5 ccr-43ba0785-hzlrj5-topic
integration_row "only the new name"                 feat/uportal-6      master feat/uportal-6 fix/topic
integration_row "both names: the new one"           feat/uportal-6      master ccr-43ba0785-hzlrj5 feat/uportal-6
integration_row "neither, only look-alikes"         none                master feat/uportal-6-x ccr-43ba0785-hzlrj5-landing-1
"$SCRIPT" integration-on "file://$WORK/nowhere" > /dev/null 2>&1
result "on a remote that can't be reached: exit status 2" 2 "$?"

# base_row <name> <expected: the commit of a branch, or "none"> <this branch> <branches of the remote>...
# The remote's first branch has one commit. Every other branch adds one commit of its own to it,
# and the checkout is on <this branch>.
base_row() {
    local name="$1" expected="$2" this="$3" dir="$WORK/base$cases" branch got status
    shift 3
    git init -q -b first "$dir-remote"
    echo text > "$dir-remote/file"
    git_in "$dir-remote" add -A
    git_in "$dir-remote" commit -q -m first
    for branch in "$@"; do
        git_in "$dir-remote" checkout -q -b "$branch" first
        echo "$branch" > "$dir-remote/file"
        git_in "$dir-remote" commit -q -a -m "$branch"
    done
    git clone -q "$dir-remote" "$dir"
    git_in "$dir" checkout -q "$this"
    got=$("$SCRIPT" base "$this" "$dir")
    status=$?
    if [ "$expected" = none ]; then
        result "base: $name" "1:" "$status:$got"
    else
        result "base: $name" "0:$(git_in "$dir" rev-parse "origin/$expected")" "$status:$got"
    fi
}

base_row "a topic branch, old integration name"           first fix/topic fix/topic ccr-43ba0785-hzlrj5
base_row "a topic branch, new integration name"           first fix/topic fix/topic feat/uportal-6
base_row "an old topic branch, both integration names"    first ccr-43ba0785-hzlrj5-topic ccr-43ba0785-hzlrj5-topic ccr-43ba0785-hzlrj5 feat/uportal-6
base_row "a staging branch"                               first staging/landing-3 staging/landing-3 feat/uportal-6
base_row "a topic branch without an integration branch"   none  fix/topic fix/topic
base_row "the new integration name beside the old one"    first feat/uportal-6 feat/uportal-6 ccr-43ba0785-hzlrj5
base_row "the new integration name alone"                 none  feat/uportal-6 feat/uportal-6
base_row "another branch"                                 none  renovate/x renovate/x feat/uportal-6
# the cut-over: the new name is pushed at the tip of the old one, so there is nothing to check
remote cutover-remote ccr-43ba0785-hzlrj5 feat/uportal-6
git clone -q -b feat/uportal-6 "$WORK/cutover-remote" "$WORK/cutover"
got=$("$SCRIPT" base feat/uportal-6 "$WORK/cutover")
result "base: the new name at the tip of the old one is HEAD" "0:$(git_in "$WORK/cutover" rev-parse HEAD)" "$?:$got"

# The push triggers. A workflow can't read branches.sh, so each one that runs on our branches
# lists them itself: every type as '<type>/**', the staging branches and the old names. Some
# also run on master.
triggers() {  # triggers <workflow file>: the branches of its push trigger, one per line
    awk '
        /^  push:/ { push = 1; next }
        push && /^  [a-z_]+:/ { push = 0 }
        push && /^    branches:/ { branches = 1; next }
        push && branches && /^    [a-z-]+:/ { branches = 0 }
        push && branches && /^      - / { gsub(/^      - |'"'"'/, ""); print }
    ' "$1" | grep -vx master
}
expected=$(
    {
        echo 'ccr-*'
        "$SCRIPT" types | sed 's|$|/**|'
        echo 'staging/landing-*'
    } | sort
)
checked=0
for workflow in "$WORKFLOWS"/*.yml; do
    got=$(triggers "$workflow" | sort)
    # a workflow that runs on master alone, or has no push trigger, is not one of ours to check
    if [ -z "$got" ]; then continue; fi
    checked=$((checked + 1))
    result "push trigger of $(basename "$workflow")" "$(tr '\n' ' ' <<< "$expected")" "$(tr '\n' ' ' <<< "$got")"
done
cases=$((cases + 1))
if [ "$checked" -ge 4 ]; then
    printf 'ok    %-62s %s\n' "workflows with a push trigger for our branches" "$checked"
else
    printf 'FAIL  %-62s only %s\n' "workflows with a push trigger for our branches" "$checked"
    failures=$((failures + 1))
fi
# Outside the triggers, a workflow gives a branch name only where it can't ask branches.sh: in
# cancel-in-progress, which is read before any job runs. Such a line has the old topic prefix and
# leaves out the integration branch. A name anywhere else is a rule that branches.sh doesn't know.
cases=$((cases + 1))
stray=$(grep -n -- 'ccr-43ba0785-hzlrj5\|feat/uportal-6' "$WORKFLOWS"/*.yml | grep -v '^[^:]*:[0-9]*: *#' |
    grep -v "description: '.*(feat/uportal-6)" |
    grep -v "cancel-in-progress: .*startsWith(github.ref_name, 'ccr-43ba0785-hzlrj5-') || (contains(github.ref_name, '/') && github.ref_name != 'feat/uportal-6'")
if [ -z "$stray" ]; then
    printf 'ok    %-62s none\n' "branch names in the workflows outside cancel-in-progress"
else
    printf 'FAIL  %-62s\n%s\n' "branch names in the workflows outside cancel-in-progress" "$stray"
    failures=$((failures + 1))
fi
# The integration branch is itself a '<type>/…' name, so the triggers above start its runs too
case "$("$SCRIPT" integration | head -1)" in
    */*) type=$("$SCRIPT" integration | head -1 | cut -d/ -f1) ;;
    *) type= ;;
esac
result "the integration branch starts with a type" 1 "$("$SCRIPT" types | grep -cx -- "$type")"

echo "$cases rows, $failures failed"
[ "$failures" -eq 0 ]
