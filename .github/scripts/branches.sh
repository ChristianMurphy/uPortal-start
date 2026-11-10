#!/usr/bin/env bash
# The branch names of the modernization prototype, in one place. (Prototype only. uPortal and
# uPortal-start each keep a copy of this file, and the copies are the same.)
#
#   integration   feat/uportal-6, where the coordinator lands reviewed work
#   staging       staging/landing-<n>, where a landing passes the full matrix before it is pushed
#   topic         <type>/<topic> with a Conventional Commits type from TOPIC_TYPES below, except
#                 the integration branch itself
#   other         everything else, such as master or a branch of Renovate
#
# The names from before 2026-11-10 still count until the owner deletes those branches:
# ccr-43ba0785-hzlrj5 (integration), ccr-43ba0785-hzlrj5-landing-<n> (staging) and
# ccr-43ba0785-hzlrj5-<topic> (topic). To drop them, remove the OLD_ lines and their uses below,
# the old names in the push trigger and in cancel-in-progress of each workflow, and the rows of
# the table tests.
#
#   branches.sh kind <branch>     prints integration, staging, topic or other
#   branches.sh integration       prints the integration branch names, the current one first
#   branches.sh types             prints the types a topic branch may start with
#   branches.sh integration-ref [<git directory>]
#       prints the first origin/<integration branch> that the checkout has. Exit status 1 when it
#       has none
#   branches.sh base <branch> [<git directory>]
#       prints the commit from which the commits of a new branch are checked: for a topic or
#       staging branch, where HEAD left the integration branch. For an integration branch, where
#       HEAD left the integration branch of the other name, so that a first push of the new name
#       at the tip of the old one has nothing to check again. Exit status 1 for any other branch,
#       and when there is no such commit
#   branches.sh integration-on <URL>
#       prints the first integration branch that the repository at <URL> has. Exit status 1 when
#       it has none, 2 when the repository could not be asked
#
# Other scripts read the names with `. branches.sh` and call the functions. A workflow can't run a
# script in `on:`, `concurrency:` or a workflow's `env:`, so each workflow lists the push triggers
# itself, and branches.test.sh checks those lists against this file. The first job of each
# workflow (Staging check) runs "kind" and gives the answer to the jobs that need it.
# The table test is .github/scripts/branches.test.sh.

INTEGRATION_BRANCH=feat/uportal-6
STAGING_PREFIX=staging/landing-
TOPIC_TYPES=(feat fix ci docs test build refactor chore perf)
OLD_INTEGRATION_BRANCH=ccr-43ba0785-hzlrj5
OLD_STAGING_PREFIX=$OLD_INTEGRATION_BRANCH-landing-
OLD_TOPIC_PREFIX=$OLD_INTEGRATION_BRANCH-
# The current name first: a script that needs one integration branch takes the first that exists.
INTEGRATION_BRANCHES=("$INTEGRATION_BRANCH" "$OLD_INTEGRATION_BRANCH")

branch_kind() {  # branch_kind <branch>
    local type
    case "$1" in
        "$INTEGRATION_BRANCH" | "$OLD_INTEGRATION_BRANCH") echo integration; return ;;
        "$STAGING_PREFIX"?* | "$OLD_STAGING_PREFIX"?*) echo staging; return ;;
        "$OLD_TOPIC_PREFIX"?*) echo topic; return ;;
    esac
    for type in "${TOPIC_TYPES[@]}"; do
        case "$1" in
            "$type"/?*) echo topic; return ;;
        esac
    done
    echo other
}

integration_ref() {  # integration_ref [<git directory>]
    local branch
    for branch in "${INTEGRATION_BRANCHES[@]}"; do
        if git -C "${1:-.}" rev-parse -q --verify "refs/remotes/origin/$branch^{commit}" > /dev/null 2>&1; then
            echo "origin/$branch"
            return 0
        fi
    done
    return 1
}

new_branch_base() {  # new_branch_base <branch> [<git directory>]
    local dir="${2:-.}" other candidate
    case "$(branch_kind "$1")" in
        topic | staging)
            other=$(integration_ref "$dir") || return 1
            ;;
        integration)
            other=
            for candidate in "${INTEGRATION_BRANCHES[@]}"; do
                if [ "$candidate" != "$1" ] &&
                    git -C "$dir" rev-parse -q --verify "refs/remotes/origin/$candidate^{commit}" > /dev/null 2>&1; then
                    other="origin/$candidate"
                    break
                fi
            done
            [ -n "$other" ] || return 1
            ;;
        *) return 1 ;;
    esac
    git -C "$dir" merge-base "$other" HEAD 2> /dev/null
}

integration_on() {  # integration_on <URL>
    local branch
    for branch in "${INTEGRATION_BRANCHES[@]}"; do
        git ls-remote --exit-code --heads "$1" "refs/heads/$branch" > /dev/null 2>&1
        case $? in
            0) echo "$branch"; return 0 ;;
            2) ;;
            *) return 2 ;;
        esac
    done
    return 1
}

# Run as a command, not read with `.`
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    set -uo pipefail
    case "${1:-}" in
        kind) branch_kind "${2:?branch}" ;;
        integration) printf '%s\n' "${INTEGRATION_BRANCHES[@]}" ;;
        types) printf '%s\n' "${TOPIC_TYPES[@]}" ;;
        integration-ref) integration_ref "${2:-.}" ;;
        base) new_branch_base "${2:?branch}" "${3:-.}" ;;
        integration-on) integration_on "${2:?URL}" ;;
        *)
            echo "usage: branches.sh kind <branch> | integration | types | integration-ref [<git directory>] | base <branch> [<git directory>] | integration-on <URL>" >&2
            exit 2
            ;;
    esac
fi
