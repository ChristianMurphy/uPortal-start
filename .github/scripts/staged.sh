#!/usr/bin/env bash
# Have the slow jobs of a workflow already passed for this tree? (Prototype only. The design is in
# uPortal's docs/developer/modernization/notes/ci-prelanding.md.)
#
# A landing is tested before it reaches the integration branch. The coordinator pushes it to a
# staging branch (staging/landing-<n>), where every workflow runs the jobs that the
# integration branch runs. When the slow jobs of a workflow pass, its last job uploads a marker: an
# artifact named staged-<workflow>-<key>. The key is a hash of the tree those jobs tested. A later
# push with the same key, such as the landing itself, finds the marker and skips the slow jobs.
#
# The key is the SHA-256 of `git ls-tree -r` of the commit, without the files that match IGNORED
# below. In uPortal-start, a workflow that builds uPortal adds the key of the uPortal commit it
# chose, so its marker stands for both trees.
#
#   staged.sh key [<uPortal URL> <uPortal commit>]
#       prints the key of HEAD, with the uPortal commit when one is given
#   staged.sh find <workflow> <key>
#       prints "<run id> <branch>" of the run that uploaded the marker. Exit status 0 when there is
#       one, 1 when there is none, 2 when GitHub could not be asked
#   staged.sh check
#       for the first job of a workflow. Writes skip, mark, key and report to $GITHUB_OUTPUT and a
#       notice annotation. skip=true: the marker exists, so skip the slow jobs. mark=true: this is
#       a full run without a marker, so upload one when the slow jobs pass
#   staged.sh landing
#       for land-push.sh. Looks for the marker of every workflow of this repository for HEAD (in
#       uPortal-start, with the tip of uPortal's integration branch). Exit status 1 when one is
#       missing
#
# A marker counts only when a push run of the same workflow file uploaded it, in this repository,
# on the integration branch or a staging branch. branches.sh has the names, the ones from before
# 2026-11-10 included, so a marker from a run on an old name still counts. When anything is unclear (GitHub does not answer,
# the tree cannot be listed, no uPortal commit), check says skip=false and the jobs run.
#
# Environment:
#   REPOSITORY    owner/name of this repository (check and find; landing takes it from OWNER)
#   EVENT_NAME, BRANCH, WORKFLOW
#                 for check: github.event_name, github.ref_name and the workflow file's name
#                 without .yml
#   UPORTAL_URL, UPORTAL_SHA
#                 for check: the uPortal that the run builds, when the workflow builds one
#   OWNER         for landing: the owner of both repositories (default ChristianMurphy)
#   GH_TOKEN      for gh, with read access to the repository's Actions
# The table test is .github/scripts/staged.test.sh.
set -uo pipefail

# This repository's name, and its workflows with slow jobs: the ones that test this repository
# alone, and the ones that also build uPortal.
NAME=uPortal-start
OWN_TREE=(CI)
WITH_UPORTAL=(integration g-index migration-equivalence replay)

# The branch names: branch_kind and integration_on
# shellcheck source=.github/scripts/branches.sh
. "$(dirname "${BASH_SOURCE[0]}")/branches.sh"
# Files that no slow job reads: the Markdown notes, log and guide of the modernization, and the
# coordinator's Markdown files. A landing adds its log entry here after the staging runs. The
# Prose job reads them, and it is never skipped. Add a path only when no build, test or lint step
# of a slow job can read it.
IGNORED='^(docs/developer/modernization/|\.claude/modernization/).*\.md$'

tree_key() {  # tree_key <git directory> <commit>: the key of one tree
    local listing
    listing=$(git -C "$1" -c core.quotePath=false ls-tree -r --full-tree "$2" 2> /dev/null) || return 1
    [ -n "$listing" ] || return 1
    awk -F'\t' -v ignored="$IGNORED" '$2 !~ ignored' <<< "$listing" | sha256sum | cut -d' ' -f1
}

remote_tree_key() {  # remote_tree_key <URL> <commit>: the same for a commit of another repository
    local tmp key
    [[ "$2" =~ ^[0-9a-f]{40}$ ]] || return 1
    tmp=$(mktemp -d)
    git -C "$tmp" init -q
    # trees only: the key needs the names and ids of the files, not their contents
    if git -C "$tmp" fetch -q --no-tags --depth 1 --filter=blob:none "$1" "$2" 2> /dev/null; then
        key=$(tree_key "$tmp" FETCH_HEAD)
    fi
    rm -rf "$tmp"
    [ -n "${key:-}" ] && echo "$key"
}

key() {  # key [<uPortal URL> <uPortal commit>]
    local own uportal
    own=$(tree_key . HEAD) || return 1
    if [ $# -eq 0 ]; then
        echo "$own"
        return 0
    fi
    uportal=$(remote_tree_key "$1" "$2") || return 1
    printf 'own %s\nuPortal %s\n' "$own" "$uportal" | sha256sum | cut -d' ' -f1
}

find_marker() {  # find_marker <workflow> <key>
    local name="staged-$1-$2" repository_id artifacts artifact run head branch run_info
    if ! repository_id=$(gh api "repos/$REPOSITORY" --jq .id 2>&1); then
        echo "Could not read $REPOSITORY: $repository_id" >&2
        return 2
    fi
    # Newest first: id, run id, repository id of the run's head, branch of the run
    if ! artifacts=$(gh api "repos/$REPOSITORY/actions/artifacts?name=$name&per_page=30" \
            --jq '.artifacts | sort_by(.created_at) | reverse | .[] | select(.expired == false) | "\(.id) \(.workflow_run.id) \(.workflow_run.head_repository_id) \(.workflow_run.head_branch)"' 2>&1); then
        echo "Could not list the artifacts named $name: $artifacts" >&2
        return 2
    fi
    while read -r artifact run head branch; do
        [ -n "$artifact" ] || continue
        if [ "$head" != "$repository_id" ]; then
            echo "Artifact $artifact (run $run) comes from another repository; not used" >&2
            continue
        fi
        case "$(branch_kind "$branch")" in
            integration | staging) ;;
            *)
                echo "Artifact $artifact (run $run) comes from branch '$branch'; not used" >&2
                continue
                ;;
        esac
        if ! run_info=$(gh api "repos/$REPOSITORY/actions/runs/$run" --jq '"\(.event) \(.path)"' 2>&1); then
            echo "Could not read run $run: $run_info" >&2
            return 2
        fi
        if [ "$run_info" != "push .github/workflows/$1.yml" ]; then
            echo "Artifact $artifact comes from run $run ($run_info); not used" >&2
            continue
        fi
        echo "$run $branch"
        return 0
    done <<< "$artifacts"
    return 1
}

check() {
    local skip=false mark=false key="" report found status
    EVENT_NAME=${EVENT_NAME:?EVENT_NAME is not set}
    BRANCH=${BRANCH:?BRANCH is not set}
    WORKFLOW=${WORKFLOW:?WORKFLOW is not set}
    REPOSITORY=${REPOSITORY:?REPOSITORY is not set}
    case "$EVENT_NAME:$(branch_kind "$BRANCH")" in
        push:integration | push:staging)
            if [ -n "${UPORTAL_URL:-}" ]; then
                key=$(key "$UPORTAL_URL" "${UPORTAL_SHA:-}")
            else
                key=$(key)
            fi
            if [ -z "$key" ]; then
                report="run: could not work out the key of this tree"
            else
                found=$(find_marker "$WORKFLOW" "$key")
                status=$?
                case "$status" in
                    0)
                        skip=true
                        report="skipped: the slow jobs passed for this tree in run ${found%% *} on ${found#* } (key $key)"
                        ;;
                    1)
                        mark=true
                        report="run: no earlier full run passed for this tree (key $key)"
                        ;;
                    *)
                        mark=true
                        report="run: could not ask GitHub for an earlier full run (key $key)"
                        ;;
                esac
            fi
            ;;
        *)
            report="run: $EVENT_NAME on $BRANCH is not a push to the integration branch or a staging branch"
            ;;
    esac
    echo "Staging check: $report"
    echo "::notice title=Staging check::$report"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "Staging check: $report" >> "$GITHUB_STEP_SUMMARY"; fi
    {
        echo "skip=$skip"
        echo "mark=$mark"
        echo "key=$key"
        echo "report=$report"
    } >> "${GITHUB_OUTPUT:-/dev/stdout}"
}

landing() {
    local owner=${OWNER:-ChristianMurphy} missing=0 workflow key uportal_url uportal_branch uportal_sha found
    REPOSITORY="$owner/$NAME"
    for workflow in "${OWN_TREE[@]}" "${WITH_UPORTAL[@]}"; do
        if [[ " ${WITH_UPORTAL[*]} " == *" $workflow "* ]]; then
            if [ -z "${uportal_sha:-}" ]; then
                uportal_url="https://github.com/$owner/uPortal"
                uportal_branch=$(integration_on "$uportal_url")
                uportal_sha=$(git ls-remote "$uportal_url" "refs/heads/$uportal_branch" | cut -f1)
            fi
            key=$(key "$uportal_url" "$uportal_sha")
        else
            key=$(key)
        fi
        if [ -z "$key" ]; then
            echo "$workflow: could not work out the key of HEAD"
            missing=1
        elif found=$(find_marker "$workflow" "$key"); then
            echo "$workflow: passed in run ${found%% *} on ${found#* }"
        else
            echo "$workflow: no staging run passed for this tree (key $key)"
            missing=1
        fi
    done
    if [ -n "${uportal_sha:-}" ]; then echo "uPortal's $uportal_branch is at $uportal_sha"; fi
    return "$missing"
}

case "${1:-}" in
    key)
        shift
        key "$@" || { echo "Could not work out the key" >&2; exit 1; }
        ;;
    find)
        REPOSITORY=${REPOSITORY:?REPOSITORY is not set}
        find_marker "${2:?workflow}" "${3:?key}"
        ;;
    check) check ;;
    landing) landing ;;
    *)
        echo "usage: staged.sh key [<uPortal URL> <uPortal commit>] | find <workflow> <key> | check | landing" >&2
        exit 2
        ;;
esac
