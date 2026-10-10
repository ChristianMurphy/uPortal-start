#!/usr/bin/env bash
#
# Writes the snapshots that a GitHub Actions run of tests/db/harness.sh attached to its jobs as
# annotations (with --record, or when a vendor had no baseline) into a new baseline directory. See
# "Recording a baseline in CI" in docs/db-upgrade-harness.md.
#
#   tests/db/fetch-ci-snapshot.sh <owner/repo> <run id> <baseline> [<vendor>...]
#
# e.g. tests/db/fetch-ci-snapshot.sh apereo/uPortal-start 1234567890 5.17 postgres-18
# Without vendors it takes every snapshot in the run. When two jobs of the run snapshot the same
# vendor (the harness and the Playwright job), it says whether the two are identical. Existing
# baseline files are never overwritten. Needs curl, jq, tar and base64; GITHUB_TOKEN, when set, is
# sent to the GitHub API.
#
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ $# -lt 3 ]; then
    sed -n '7,9p' "$0" >&2
    exit 2
fi
repo=$1 run=$2 baseline=$3
shift 3
wanted=("$@")

api() {
    local auth=()
    if [ -n "${GITHUB_TOKEN:-}" ]; then auth=(-H "Authorization: Bearer $GITHUB_TOKEN"); fi
    curl -fsSL -H 'Accept: application/vnd.github+json' "${auth[@]+"${auth[@]}"}" "https://api.github.com/repos/$repo/$1"
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Every job of every attempt (a re-run copies the jobs it does not repeat, without their
# annotations)
jobs=()
page=1
while :; do
    ids=$(api "actions/runs/$run/jobs?filter=all&per_page=100&page=$page" | jq -r '.jobs[].id')
    [ -n "$ids" ] || break
    read -r -d '' -a more <<< "$ids" || true
    jobs+=("${more[@]}")
    page=$((page + 1))
done

# Each job's snapshot annotations, one file per part: $tmp/<job>/<vendor>.<part>-of-<parts>
for job in "${jobs[@]}"; do
    page=1
    while :; do
        api "check-runs/$job/annotations?per_page=50&page=$page" > "$tmp/page.json"
        [ "$(jq length "$tmp/page.json")" -gt 0 ] || break
        jq -r '.[] | select(.title | test("^snapshot of [^ ]+ \\(part [0-9]+ of [0-9]+\\)$"))
            | (.title | capture("^snapshot of (?<v>[^ ]+) \\(part (?<p>[0-9]+) of (?<n>[0-9]+)\\)$")) as $t
            | [$t.v, $t.p, $t.n, .message] | @tsv' "$tmp/page.json" |
        while IFS=$'\t' read -r vendor part parts data; do
            mkdir -p "$tmp/$job"
            printf '%s' "$data" > "$tmp/$job/$vendor.$part-of-$parts"
        done
        page=$((page + 1))
    done
done

found=0
for dir in "$tmp"/*/; do
    [ -d "$dir" ] || continue
    for first in "$dir"*.1-of-*; do
        [ -e "$first" ] || continue
        name=$(basename "$first")
        vendor=${name%.1-of-*}
        parts=${name##*-of-}
        if [ ${#wanted[@]} -gt 0 ] && ! printf '%s\n' "${wanted[@]}" | grep -qx "$vendor"; then continue; fi
        out="$tmp/extracted/$(basename "$dir")/$vendor"
        mkdir -p "$out"
        for ((i = 1; i <= parts; i++)); do cat "$dir$vendor.$i-of-$parts"; done | base64 -d | tar -xzf - -C "$out"
        found=1
    done
done
if [ "$found" = 0 ]; then
    echo "No snapshot annotations in run $run of $repo" >&2
    exit 1
fi

status=0
for vendor in $(find "$tmp/extracted" -mindepth 2 -maxdepth 2 -type d -printf '%f\n' | sort -u); do
    copies=("$tmp/extracted"/*/"$vendor")
    if [ ${#copies[@]} -gt 1 ]; then
        same=true
        for copy in "${copies[@]:1}"; do
            for f in schema.txt generators.txt; do
                diff -q <(grep -v '^#' "${copies[0]}/$f") <(grep -v '^#' "$copy/$f") > /dev/null || same=false
            done
        done
        echo "$vendor: ${#copies[@]} snapshots in the run, $([ "$same" = true ] && echo identical || echo 'DIFFERENT (not recorded)')"
        if [ "$same" = false ]; then status=1; continue; fi
    fi
    dest="tests/db/snapshots/$baseline/$vendor"
    if [ -e "$dest/schema.txt" ]; then
        echo "$dest is already recorded; not overwritten" >&2
        status=1
        continue
    fi
    mkdir -p "$dest"
    cp "${copies[0]}"/* "$dest/"
    echo "Recorded $dest: $(cd "$dest" && ls | tr '\n' ' ')"
done
exit $status
