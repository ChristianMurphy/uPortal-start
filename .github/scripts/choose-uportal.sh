#!/usr/bin/env bash
# Which uPortal does this uPortal-start run build and test? (Prototype only: MOD-D30, MOD-I307.)
#
# In order:
#   1. the ref given to a manual run (the uportal-ref input), in the repository given (the
#      uportal-repository input, default <owner>/uPortal);
#   2. uPortal's branch with the name of this branch;
#   3. uPortal's integration branch (ccr-43ba0785-hzlrj5);
#   4. master.
# No prefix of the branch name is tried in between. Dropping one "-suffix" at a time made
# ccr-x-topic-r3 test the older ccr-x-topic when uPortal had no ccr-x-topic-r3, and the whole run
# tested a uPortal from before the change it was meant to check.
#
# The repository, ref and commit that were chosen go to the job summary, to a notice annotation and
# to $GITHUB_OUTPUT as repository, ref, sha and description (one line, for the last step of the job). The workflows check out the sha, so the commit
# that was reported is the commit that runs. A git failure other than "no such branch", such as a
# network error, fails the step instead of moving on to the next candidate.
#
# Environment:
#   OWNER, BRANCH       github.repository_owner and github.ref_name
#   INPUT_REPOSITORY    the uportal-repository input (empty: <OWNER>/uPortal)
#   INPUT_REF           the uportal-ref input: a branch, a tag or a commit (empty: the order above)
#   INTEGRATION         uPortal's integration branch (default ccr-43ba0785-hzlrj5)
#   GITHUB_URL          where the repositories are (default https://github.com; the table test
#                       points it at local directories)
#   RETRY_SECONDS       the wait before the one retry of a failed git call (default 5)
# The table test is .github/scripts/choose-uportal.test.sh.
set -uo pipefail

OWNER=${OWNER:?OWNER is not set}
BRANCH=${BRANCH:?BRANCH is not set}
INPUT_REPOSITORY=${INPUT_REPOSITORY:-}
INPUT_REF=${INPUT_REF:-}
INTEGRATION=${INTEGRATION:-ccr-43ba0785-hzlrj5}
GITHUB_URL=${GITHUB_URL:-https://github.com}

repository=${INPUT_REPOSITORY:-$OWNER/uPortal}
if ! [[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    echo "Unexpected uPortal repository '$repository'" >&2
    exit 1
fi
if [ -n "$INPUT_REF" ] && ! [[ "$INPUT_REF" =~ ^[A-Za-z0-9_./-]+$ ]]; then
    echo "Unexpected uPortal ref '$INPUT_REF'" >&2
    exit 1
fi
url="$GITHUB_URL/$repository"

ls_remote() {  # ls_remote <pattern>...: sets LS_OUT to the "<sha> <ref>" lines; a git error stops the script
    local err
    err=$(mktemp)
    if ! LS_OUT=$(git ls-remote "$url" "$@" 2> "$err"); then
        sleep "${RETRY_SECONDS:-5}"
        if ! LS_OUT=$(git ls-remote "$url" "$@" 2> "$err"); then
            echo "Could not list the refs of $url: $(cat "$err")" >&2
            rm -f "$err"
            exit 1
        fi
    fi
    rm -f "$err"
    LS_OUT=$(tr '\t' ' ' <<< "$LS_OUT")
}

ref=
sha=
if [ -n "$INPUT_REF" ]; then
    ref=$INPUT_REF
    reason="it was given as the uportal-ref input"
    ls_remote "refs/heads/$ref" "refs/tags/$ref" "refs/tags/$ref^{}"
    sha=$(awk -v r="refs/heads/$ref" '$2 == r { print $1 }' <<< "$LS_OUT")
    # an annotated tag lists its commit on the line with ^{}
    [ -n "$sha" ] || sha=$(awk -v r="refs/tags/$ref^{}" '$2 == r { print $1 }' <<< "$LS_OUT")
    [ -n "$sha" ] || sha=$(awk -v r="refs/tags/$ref" '$2 == r { print $1 }' <<< "$LS_OUT")
    if [ -z "$sha" ] && [[ "$ref" =~ ^[0-9a-f]{40}$ ]]; then sha=$ref; fi
else
    candidates=("$BRANCH")
    if [ "$INTEGRATION" != "$BRANCH" ]; then candidates+=("$INTEGRATION"); fi
    if [ master != "$BRANCH" ] && [ master != "$INTEGRATION" ]; then candidates+=(master); fi
    for candidate in "${candidates[@]}"; do
        ls_remote "refs/heads/$candidate"
        found=$(awk -v r="refs/heads/$candidate" '$2 == r { print $1 }' <<< "$LS_OUT")
        if [ -n "$found" ]; then
            ref=$candidate
            sha=$found
            case "$candidate" in
                "$BRANCH") reason="uPortal has a branch named $BRANCH, like this one" ;;
                "$INTEGRATION") reason="uPortal has no branch named $BRANCH, so the integration branch" ;;
                *) reason="uPortal has no branch named $BRANCH and no $INTEGRATION, so master" ;;
            esac
            break
        fi
    done
    if [ -z "$ref" ]; then
        echo "$repository has none of the branches ${candidates[*]}" >&2
        exit 1
    fi
fi

{
    echo "### uPortal under test"
    echo
    echo "- Repository: \`$repository\`"
    echo "- Ref: \`$ref\`"
    echo "- Commit: \`${sha:-not resolved, the checkout uses the ref as given}\`"
    echo "- Why: $reason"
} > "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
description="$repository $ref at ${sha:-an unresolved commit}: $reason"
# A notice annotation: agents can't read job summaries, but the check run's annotations come back
# through the API
echo "::notice title=uPortal under test::$description"
{
    echo "repository=$repository"
    echo "ref=$ref"
    echo "sha=$sha"
    echo "description=$description"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"
