#!/usr/bin/env bash
# Table test of gindex-changes.sh (MOD-I306). Each row builds two small Git repositories, an
# uPortal-start with a topic branch and an uPortal, runs the script as the workflow does, and
# compares its answer (run=true or run=false) with the one the row expects.
#
#   .github/scripts/gindex-changes.test.sh
set -uo pipefail

SCRIPT=$(cd "$(dirname "$0")" && pwd)/gindex-changes.sh
INT=ccr-43ba0785-hzlrj5
TOPIC=$INT-search
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
failures=0
cases=0

git_in() { git -C "$1" -c user.email=test@example.com -c user.name=test -c commit.gpgsign=false "${@:2}"; }

make_repo() {  # make_repo <dir> <base file>: a repository whose integration branch has one commit
    git init -q -b "$INT" "$1"
    git -C "$1" config uploadpack.allowFilter true
    mkdir -p "$1/$(dirname "$2")"
    echo base > "$1/$2"
    git_in "$1" add -A
    git_in "$1" commit -q -m base
}

change() {  # change <dir> <path>...: one commit on the current branch that adds or edits the files
    local dir="$1" path
    shift
    for path in "$@"; do
        mkdir -p "$dir/$(dirname "$path")"
        echo "change $RANDOM" >> "$dir/$path"
    done
    git_in "$dir" add -A
    git_in "$dir" commit -q -m change
}

# row <name> <expected run> <event> <branch> <start files, space separated|-> <uPortal files|-|none>
#   uPortal files: "-" is a uPortal branch of the same name with no change, "none" means there is no
#   such branch in uPortal
row() {
    local name="$1" expected="$2" event="$3" branch="$4" start_files="$5" uportal_files="$6"
    local dir="$WORK/case$cases" out answer
    cases=$((cases + 1))
    mkdir -p "$dir"
    make_repo "$dir/start-origin" README.md
    make_repo "$dir/uportal" README.md
    if [ "$branch" != "$INT" ]; then
        git_in "$dir/start-origin" checkout -q -b "$branch"
        if [ "$start_files" != "-" ]; then
            # shellcheck disable=SC2086
            change "$dir/start-origin" $start_files
        fi
        if [ "$uportal_files" != "none" ]; then
            git_in "$dir/uportal" checkout -q -b "$branch"
            if [ "$uportal_files" != "-" ]; then
                # shellcheck disable=SC2086
                change "$dir/uportal" $uportal_files
            fi
        fi
    fi
    git clone -q "$dir/start-origin" "$dir/start"
    git_in "$dir/start" checkout -q "$branch" 2> /dev/null || true
    out=$(EVENT_NAME="$event" BRANCH="$branch" INTEGRATION="$INT" START_DIR="$dir/start" \
        UPORTAL_URL="file://$dir/uportal" GITHUB_OUTPUT="" "$SCRIPT" 2>&1)
    answer=$(sed -n 's/^run=//p' <<< "$out")
    if [ "$answer" = "$expected" ]; then
        printf 'ok    %-58s run=%s\n' "$name" "$answer"
    else
        printf 'FAIL  %-58s expected run=%s, got "%s"\n' "$name" "$expected" "$answer"
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

row "web component only (uPortal), no start change"       false push "$TOPIC" -  "uPortal-webcomponents/src/search/search.ts uPortal-webcomponents/package.json"
must_say "no matching changes, G-index skipped"
row "docs only in both"                                    false push "$TOPIC" "docs/developer/x.md" "docs/developer/y.md"
row "i18n messages only (uPortal)"                         false push "$TOPIC" -  "uPortal-webapp/src/main/resources/properties/i18n/Messages_es.properties"
row "Playwright spec only (start)"                         false push "$TOPIC" "tests/ux/search.spec.ts" none
row "no uPortal branch of that name, no start change"      false push "$TOPIC" -  none
row "uPortal DAO change"                                   true  push "$TOPIC" -  "uPortal-layout/uPortal-layout-core/src/main/java/org/apereo/portal/layout/dao/jpa/JpaFoo.java"
must_say "uPortal-layout/uPortal-layout-core/src/main/java/org/apereo/portal/layout/dao/jpa/JpaFoo.java"
row "uPortal JPA entity mapping file"                      true  push "$TOPIC" -  "uPortal-webapp/src/main/resources/META-INF/orm.xml"
row "uPortal SQL file anywhere"                            true  push "$TOPIC" -  "uPortal-portlets/src/main/resources/db/fix.sql"
row "uPortal RDBM store"                                   true  push "$TOPIC" -  "uPortal-layout/uPortal-layout-core/src/main/java/org/apereo/portal/layout/RDBMUserLayoutStore.java"
row "uPortal aggregation"                                  true  push "$TOPIC" -  "uPortal-events/src/main/java/org/apereo/portal/events/aggr/Foo.java"
row "uPortal import and export"                            true  push "$TOPIC" -  "uPortal-io/uPortal-io-core/src/main/java/org/apereo/portal/io/xml/Foo.java"
row "uPortal Hibernate config"                             true  push "$TOPIC" -  "uPortal-webapp/src/main/resources/properties/db/hibernate.cfg.xml"
row "uPortal persistence Spring context"                   true  push "$TOPIC" -  "uPortal-webapp/src/main/resources/properties/contexts/persistenceContext.xml"
row "tests/db/gindex change (start)"                       true  push "$TOPIC" "tests/db/gindex/gindex.sh" none
must_say "tests/db/gindex/gindex.sh"
row "tests/db vendor file (start)"                         true  push "$TOPIC" "tests/db/vendors/postgres-18.properties" -
row "data file (start)"                                    true  push "$TOPIC" "data/quickstart/portlet-definition/search.portlet-definition.xml" -
row "G-index workflow (start)"                             true  push "$TOPIC" ".github/workflows/g-index.yml" none
row "the filter script itself (start)"                     true  push "$TOPIC" ".github/scripts/gindex-changes.sh" none
row "Gradle task the script runs (start)"                  true  push "$TOPIC" "gradle/tasks/db.gradle" none
row "web component only in uPortal, DAO in start data"     true  push "$TOPIC" "data/base/user/x.user.xml" "uPortal-webcomponents/src/a.ts"
row "integration branch push, no change"                   true  push "$INT"   -  none
row "manual run on a topic branch, no matching change"     true  workflow_dispatch "$TOPIC" - "uPortal-webcomponents/src/a.ts"
row "nightly run"                                          true  schedule "master" - none

# when the script cannot tell, it runs
dir="$WORK/unsure"
mkdir -p "$dir"
make_repo "$dir/start-origin" README.md
git_in "$dir/start-origin" checkout -q -b "$TOPIC"
change "$dir/start-origin" docs/x.md
git clone -q "$dir/start-origin" "$dir/start"
git_in "$dir/start" checkout -q "$TOPIC"
git_in "$dir/start" branch -q -D --remotes "origin/$INT" 2> /dev/null || git_in "$dir/start" update-ref -d "refs/remotes/origin/$INT"
cases=$((cases + 1))
out=$(EVENT_NAME=push BRANCH="$TOPIC" INTEGRATION="$INT" START_DIR="$dir/start" UPORTAL_URL="" GITHUB_OUTPUT="" "$SCRIPT" 2>&1)
if [ "$(sed -n 's/^run=//p' <<< "$out")" = true ]; then
    printf 'ok    %-58s run=true\n' "origin/$INT is missing in start (unsure)"
else
    printf 'FAIL  %-58s\n' "origin/$INT is missing in start (unsure)"
    sed 's/^/        /' <<< "$out"
    failures=$((failures + 1))
fi

echo "$cases rows, $failures failed"
[ "$failures" -eq 0 ]
