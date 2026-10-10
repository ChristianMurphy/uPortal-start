#!/usr/bin/env bash
#
# Writes the visual snapshots that a CI run of the "Browsers: visual" job printed (because none
# existed yet) back into tests/visual/snapshots, so they can be committed. Artifacts cannot always
# be downloaded, but a job log can (GitHub's "Download log archive", or the API).
#
#   tests/visual/fetch-snapshots.sh <job log file>
#
set -euo pipefail
cd "$(dirname "$0")/../.."
log="$1"
# GitHub prefixes every log line with a timestamp
sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z //' "$log" |
    awk '/^=== BEGIN SNAPSHOT / { file = $4; next }
         /^=== END SNAPSHOT / { file = ""; next }
         file != "" && $0 != "" { print file " " $0 }' |
    while read -r file data; do
        case "$file" in tests/visual/snapshots/*.png) ;; *) echo "Skipping $file" >&2; continue ;; esac
        mkdir -p "$(dirname "$file")"
        printf '%s' "$data" | base64 -d > "$file"
        echo "Wrote $file ($(wc -c < "$file") bytes)"
    done
