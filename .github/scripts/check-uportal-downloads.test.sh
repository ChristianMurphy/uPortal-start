#!/usr/bin/env bash
# Test of check-uportal-downloads.py (MOD-I371). Each row runs the check on workflow files and
# compares its exit status, and a line its output must have, with the row's expectation.
#
#   .github/scripts/check-uportal-downloads.test.sh
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SCRIPT=$ROOT/.github/scripts/check-uportal-downloads.py
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
failures=0
cases=0

# row <name> <expected exit status> <text the output must have> <workflow file>...
row() {
    local name="$1" expected="$2" text="$3" out status
    shift 3
    cases=$((cases + 1))
    out=$(cd "$ROOT" && python3 "$SCRIPT" "$@" 2>&1)
    status=$?
    if [ "$status" = "$expected" ] && grep -qF -- "$text" <<< "$out"; then
        printf 'ok    %-52s exit %s\n' "$name" "$status"
    else
        printf 'FAIL  %-52s expected exit %s and "%s", got exit %s\n' "$name" "$expected" "$text" "$status"
        sed 's/^/        /' <<< "$out"
        failures=$((failures + 1))
    fi
}

download() {  # download <artifact name> <path>: a job step that downloads an artifact
    cat <<STEP
      - name: Download
        uses: actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131 # v7.0.0
        with:
          name: $1
          path: $2
STEP
}

job() {  # job <id>: the start of a job
    printf '  %s:\n    runs-on: ubuntu-latest\n    steps:\n' "$1"
}

M2=\~/.m2/repository/org/jasig/portal
{ echo 'jobs:'; job uportal; download '${{ steps.reuse.outputs.artifact }}' "$M2"
  job test; download '${{ needs.uportal.outputs.artifact }}' "$M2"
  job fixtures; download 'replay-fixtures-5.17' 'build/recorded'; } > "$WORK/good.yml"
{ echo 'jobs:'; job budgets; download 'uportal-maven-local' "$M2"; } > "$WORK/fixed-name.yml"
{ echo 'jobs:'; job budgets; download 'build-${{ github.sha }}' "${M2%/org/jasig/portal}"; } > "$WORK/other-name.yml"
{ echo 'jobs:'; job fixtures; download 'replay-fixtures-5.17' 'build/recorded'; } > "$WORK/none.yml"
sed '0,/name: \${{ needs.uportal.outputs.artifact }}/s//name: uportal-maven-local/' \
    "$ROOT/.github/workflows/integration.yml" > "$WORK/integration.yml"

row "the repository's workflows"                       0 "0 with problems"
row "uportal job, test job and replay fixtures"        0 "Checked 2 download(s) of the uPortal build; 0 with problems." "$WORK/good.yml"
row "fixed name uportal-maven-local (MOD-I371)"        1 "line=5,title=uPortal build download::downloads the uPortal build as 'uportal-maven-local'" "$WORK/fixed-name.yml"
row "other name into ~/.m2"                            1 "as 'build-\${{ github.sha }}'" "$WORK/other-name.yml"
row "no download of the uPortal build"                 1 "Checked 0 download(s)" "$WORK/none.yml"
row "integration.yml with one name changed"            1 "1 with problems" "$WORK/integration.yml"

echo "$cases rows, $failures failed"
[ "$failures" -eq 0 ]
