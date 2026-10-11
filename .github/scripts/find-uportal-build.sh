#!/usr/bin/env bash
#
# Finds an earlier build of the uPortal commit that this run tests (MOD-I342), so that the
# "Build uPortal" job can reuse it instead of building the same commit again. Integration,
# Migration equivalence, G-index and HTTP replay each build uPortal, often the same commit, minutes
# apart.
#
# Each build uploads ~/.m2/repository/org/jasig/portal as the artifact uportal-m2-<commit>, with
# the file uportal-build.txt that names the repository and commit it was built from. This script
# lists the artifacts of that name in this repository and picks the newest one that:
#   * has not expired;
#   * comes from a run of this repository itself (not from a fork), started by a push, a manual
#     run or the schedule.
# The job then downloads it and checks uportal-build.txt before it uses it; when anything is
# missing or wrong, it builds.
#
# Environment: REPOSITORY (owner/name of this repository), UPORTAL_REPOSITORY and UPORTAL_SHA (the
# uPortal that choose-uportal.sh chose), GITHUB_OUTPUT, and GH_TOKEN for gh.
# Outputs: artifact=uportal-m2-<commit> always; run-id=<id> when an earlier build was found.
# Exit status: 0, unless the output can't be written. An API failure means "build".
#
set -uo pipefail

REPOSITORY=${REPOSITORY:?REPOSITORY is not set}
UPORTAL_REPOSITORY=${UPORTAL_REPOSITORY:-}
UPORTAL_SHA=${UPORTAL_SHA:-}
GITHUB_OUTPUT=${GITHUB_OUTPUT:?GITHUB_OUTPUT is not set}

if ! [[ "$UPORTAL_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "artifact=uportal-m2-unknown" >> "$GITHUB_OUTPUT"
    echo "No uPortal commit was chosen ('$UPORTAL_SHA'), so uPortal is built"
    exit 0
fi
name="uportal-m2-$UPORTAL_SHA"
echo "artifact=$name" >> "$GITHUB_OUTPUT"

if ! repository_id=$(gh api "repos/$REPOSITORY" --jq .id 2>&1); then
    echo "Could not read this repository ($repository_id), so uPortal is built"
    exit 0
fi
# Newest first: id, run id, repository id of the run's head
if ! artifacts=$(gh api "repos/$REPOSITORY/actions/artifacts?name=$name&per_page=30" \
        --jq '.artifacts | sort_by(.created_at) | reverse | .[] | select(.expired == false) | "\(.id) \(.workflow_run.id) \(.workflow_run.head_repository_id)"' 2>&1); then
    echo "Could not list the artifacts named $name ($artifacts), so uPortal is built"
    exit 0
fi

while read -r artifact run head_repository; do
    [ -n "$artifact" ] || continue
    if [ "$head_repository" != "$repository_id" ]; then
        echo "Artifact $artifact (run $run) comes from another repository; not used"
        continue
    fi
    if ! event=$(gh api "repos/$REPOSITORY/actions/runs/$run" --jq '.event' 2>&1); then
        echo "Could not read run $run ($event); not used"
        continue
    fi
    case "$event" in
        push|workflow_dispatch|schedule) ;;
        *)
            echo "Artifact $artifact comes from a $event run ($run); not used"
            continue
            ;;
    esac
    echo "run-id=$run" >> "$GITHUB_OUTPUT"
    echo "Reusing the build of $UPORTAL_REPOSITORY@$UPORTAL_SHA from run $run ($event), artifact $artifact"
    exit 0
done <<< "$artifacts"

echo "No earlier build of $UPORTAL_REPOSITORY@$UPORTAL_SHA, so uPortal is built"
exit 0
