#!/usr/bin/env bash
#
# Migration equivalence (MOD-D29 item 1): does the build under test read back exactly the data
# that uPortal 5.17 wrote? See docs/migration-equivalence.md.
#
#   tests/db/equivalence.sh [options] in-place <vendor> [-- <extra Gradle arguments>]
#   tests/db/equivalence.sh [options] copy <source> <target> [-- <extra Gradle arguments>]
#
# Both start like a 5.17 portal: uPortal 5.17 (OLD_UPORTAL_VERSION) creates the database with
# dataInit, imports the fixture (tests/db/equivalence/fixture), starts once and exports everything
# (dataExport of uPortal and of News Reader). That export, normalised and with its volatile values
# masked, must equal tests/db/equivalence/reference, apart from exactly the recorded difference
# tests/db/equivalence/vendors/<vendor>.diff if the vendor has one. A second export (the first one
# writes to the database, MOD-I154) is what the build under test must reproduce:
#
#   in-place  The build under test (NEW_UPORTAL_VERSION) is deployed on the same database, starts
#             once and exports everything; that export must be identical to 5.17's, unmasked.
#   copy      The build under test creates <target> with dataInit, dbMigrate copies <source> into
#             it, and the build under test starts on <target> and exports; identical to 5.17's
#             export of <source>, unmasked. Timestamps compare in whole seconds when one side keeps
#             less precision than the other (MySQL/MariaDB DATETIME, SQL Server datetime: MOD-I95).
#
# Options:
#   --record   in-place only: write the masked 5.17 export as the new reference instead of comparing
#              (do this with uPortal 5.17 only, on hsqldb; see the doc)
#   --keep     leave the database containers running
#
# Environment:
#   OLD_UPORTAL_VERSION   the 5.17 release that writes the data (default 5.17.9)
#   NEW_UPORTAL_VERSION   the build under test (default: uPortalVersion in gradle.properties)
#
# Needs Docker for every vendor but hsqldb, and the build under test's uPortal-db-migrate for copy.
# Everything a run produces is in build/db-equivalence/<in-place-vendor|source-to-target>/. On GitHub
# Actions the results go to the job summary and every difference becomes an annotation.
# Exit status: 0 when every comparison matched, 1 otherwise, 2 for a usage error.
#
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

RECORD=false
KEEP=false
ARGS=()
GRADLE_EXTRA=()
while [ $# -gt 0 ]; do
    case "$1" in
        --record) RECORD=true ;;
        --keep) KEEP=true ;;
        --) shift; GRADLE_EXTRA=("$@"); break ;;
        -h|--help) sed -n '2,38p' "$0"; exit 0 ;;
        -*) echo "Unknown option: $1" >&2; exit 2 ;;
        *) ARGS+=("$1") ;;
    esac
    shift
done

MODE=${ARGS[0]:-}
case "$MODE" in
    in-place) [ ${#ARGS[@]} -eq 2 ] || { echo "Usage: $0 [--record] [--keep] in-place <vendor>" >&2; exit 2; }
        SOURCE=${ARGS[1]}; TARGET=${ARGS[1]}; NAME="in-place-$SOURCE" ;;
    copy) [ ${#ARGS[@]} -eq 3 ] || { echo "Usage: $0 [--keep] copy <source> <target>" >&2; exit 2; }
        SOURCE=${ARGS[1]}; TARGET=${ARGS[2]}; NAME="$SOURCE-to-$TARGET"
        if [ "$RECORD" = true ]; then echo "--record works with in-place only" >&2; exit 2; fi
        if [ "$SOURCE" = "$TARGET" ]; then echo "Source and target must be different databases" >&2; exit 2; fi ;;
    *) echo "Usage: $0 [--record] [--keep] in-place <vendor> | copy <source> <target> [-- <gradle args>]" >&2; exit 2 ;;
esac
for v in "$SOURCE" "$TARGET"; do
    if [ ! -f "tests/db/vendors/$v.properties" ]; then
        echo "Unknown vendor $v; vendors: $(cd tests/db/vendors && ls ./*.properties | sed 's#^\./##; s/\.properties$//' | tr '\n' ' ')" >&2
        exit 2
    fi
done

OLD=${OLD_UPORTAL_VERSION:-5.17.9}
NEW=${NEW_UPORTAL_VERSION:-$(sed -n 's/^uPortalVersion=//p' gradle.properties 2>/dev/null | tr -d '\r' | tail -1)}
if [ -z "$NEW" ]; then
    echo "No build under test: set NEW_UPORTAL_VERSION or uPortalVersion in gradle.properties" >&2
    exit 2
fi
if [ "$RECORD" = true ] && [ "${OLD%%.*}" != 5 ]; then
    echo "The reference is recorded with uPortal 5.17 code only (OLD_UPORTAL_VERSION=$OLD)" >&2
    exit 2
fi

HTTP_PORT=8080
for arg in "${GRADLE_EXTRA[@]+"${GRADLE_EXTRA[@]}"}"; do
    case "$arg" in -PtomcatHttpPort=*) HTTP_PORT="${arg#-PtomcatHttpPort=}" ;; esac
done

# Exported file names are user, group and portlet names (Unicode in the fixture): the JVMs need a
# UTF-8 file system encoding, which they take from the locale
if [ "$(locale charmap 2>/dev/null)" != UTF-8 ]; then
    export LC_ALL=C.UTF-8
fi

# shellcheck source=tests/db/lib.sh
. tests/db/lib.sh

EQ=tests/db/equivalence
OUT="build/db-equivalence/$NAME"
rm -rf "$OUT"
mkdir -p "$OUT"
FAILED=()
RESULTS=()
TIMINGS=()

step() {  # step <name> <log> <command...>: run, log and time a step; remember a failure
    local name="$1" log="$OUT/$2" started status
    shift 2
    echo "==== $NAME: $name"
    started=$(date +%s)
    "$@" 2>&1 | tee "$log"
    status=${PIPESTATUS[0]}
    TIMINGS+=("$(printf '%-58s %5ss  %s' "$name" "$(( $(date +%s) - started ))" "$([ "$status" -eq 0 ] && echo ok || echo FAILED)")")
    if [ "$status" -ne 0 ]; then FAILED+=("$name (see $log)"); fi
    return "$status"
}

family() {  # family <vendor>: the vendor without its version
    echo "${1%%-[0-9]*}"
}

# The bundled portlets other than News Reader keep no data that dataExport covers, so only uPortal
# and News Reader are deployed
deploy() {  # deploy <vendor> <version> [extra tasks]: deploy for the vendor, then the extra tasks
    local vendor="$1" version="$2"
    shift 2
    use_vendor "$vendor"
    gradle -PdbVendor="$vendor" -PuPortalVersion="$version" tomcatInstall \
        :overlays:uPortal:tomcatDeploy :overlays:NewsReaderPortlet:tomcatDeploy "$@"
}

create_database() {  # create_database <vendor> <version>: an empty uPortal database, as dataInit makes it
    deploy "$1" "$2" dbWait dbSetup :overlays:uPortal:dataInit :overlays:NewsReaderPortlet:dataInit
}

import_fixture() {  # import_fixture <vendor> <version>
    use_vendor "$1"
    gradle -PdbVendor="$1" -PuPortalVersion="$2" :overlays:uPortal:dataImport -Ddir="$ROOT/$EQ/fixture/uportal" &&
        gradle -PdbVendor="$1" -PuPortalVersion="$2" :overlays:NewsReaderPortlet:dataImport -Ddir="$ROOT/$EQ/fixture/news-reader"
}

start_once() {  # start_once <vendor>: start the deployed portal, wait for it, stop it
    start_portal "$1" || return 1
    stop_own_tomcat "$1"
}

export_all() {  # export_all <vendor> <version> <dir>
    local vendor="$1" version="$2" dir="$ROOT/$3"
    rm -rf "$dir"
    mkdir -p "$dir/uportal" "$dir/news-reader"
    use_vendor "$vendor"
    gradle -PdbVendor="$vendor" -PuPortalVersion="$version" :overlays:uPortal:dataExport -Ddir="$dir/uportal" &&
        gradle -PdbVendor="$vendor" -PuPortalVersion="$version" :overlays:NewsReaderPortlet:dataExport -Ddir="$dir/news-reader"
}

normalize() {  # normalize <export dir> <normalised dir> [Gradle options]
    local from="$1" to="$2"
    shift 2
    use_vendor ''
    gradle dataExportNormalize -PexportDir="$ROOT/$from" -PnormalizedDir="$ROOT/$to" "$@"
}

compare() {  # compare <title> <expected dir> <actual dir> <labels> <report> [expected diff]
    local title="$1" expected="$2" actual="$3" labels="$4" report="$5" diff="${6:-}" status
    local options=()
    if [ -n "$diff" ] && [ -f "$diff" ]; then options+=(-PexpectedDiff="$ROOT/$diff"); fi
    use_vendor ''
    gradle dataExportCompare -Pexpected="$ROOT/$expected" -Pactual="$ROOT/$actual" \
        -PcompareLabels="$labels" -PcompareReport="$ROOT/$report" "${options[@]+"${options[@]}"}" \
        > "$report.log" 2>&1
    status=$?
    if [ "$status" -ne 0 ] && [ ! -f "$report" ]; then
        cat "$report.log"
    fi
    report_result "$title" "$report" "$status"
    return "$status"
}

report_result() {  # report_result <title> <report> <status>: log, summary and annotation
    local title="$1" report="$2" status="$3" summary
    summary=$(sed -n 's/^Compared: //p' "$report" 2>/dev/null)
    if [ "$status" -eq 0 ]; then
        RESULTS+=("| $title | equivalent | ${summary:-} |")
        echo "EQUIVALENT: $title (${summary:-})"
        return 0
    fi
    RESULTS+=("| $title | **DIFFERENT** | ${summary:-see $report} |")
    FAILED+=("$title (see $report)")
    echo "DIFFERENT: $title; the full report follows"
    cat "$report" 2>/dev/null
    github_annotation error "Migration equivalence $NAME: $title" "$(head -n 60 "$report" 2>/dev/null)"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ] && [ -f "$report" ]; then
        {
            echo "<details><summary>$title: ${summary:-different}</summary>"
            echo
            echo '```diff'
            head -n 400 "$report"
            [ "$(wc -l < "$report")" -le 400 ] || echo "... ($(( $(wc -l < "$report") - 400 )) more lines in the job log)"
            echo '```'
            echo '</details>'
        } >> "$OUT/summary-details.md"
    fi
    return 1
}

cleanup() {
    if [ "$KEEP" = false ]; then
        stop_database "$SOURCE"
        if [ "$TARGET" != "$SOURCE" ]; then stop_database "$TARGET"; fi
    fi
}

write_summary() {
    {
        echo "### Migration equivalence: $NAME"
        echo
        echo "uPortal $OLD wrote the data; the build under test is uPortal $NEW."
        echo
        echo "| Check | Result | Files |"
        echo "| --- | --- | --- |"
        printf '%s\n' "${RESULTS[@]+"${RESULTS[@]}"}"
        if [ ${#FAILED[@]} -gt 0 ]; then
            echo
            echo "Failed: $(printf '%s; ' "${FAILED[@]}")"
        fi
        echo
        echo '```'
        printf '%s\n' "${TIMINGS[@]+"${TIMINGS[@]}"}"
        echo '```'
        [ -f "$OUT/summary-details.md" ] && cat "$OUT/summary-details.md"
    } > "$OUT/summary.md"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat "$OUT/summary.md" >> "$GITHUB_STEP_SUMMARY"; fi
}

WHOLE_SECONDS=()
if [ "$MODE" = copy ] && [ "$(family "$SOURCE")" != "$(family "$TARGET")" ]; then
    case "$(family "$SOURCE") $(family "$TARGET")" in
        *mysql*|*mariadb*|*sqlserver*) WHOLE_SECONDS=(-PwholeSeconds) ;;
    esac
fi

echo "==== Migration equivalence $NAME: uPortal $OLD writes, uPortal $NEW reads"
if ! start_database "$SOURCE" || { [ "$TARGET" != "$SOURCE" ] && ! start_database "$TARGET"; }; then
    FAILED+=("starting the databases")
    cleanup
    write_summary
    exit 1
fi

# 1. uPortal 5.17 writes the data, runs once, and exports it
if step "5.17 on $SOURCE: deploy, dataInit" old-init.log create_database "$SOURCE" "$OLD" &&
    step "5.17 on $SOURCE: import the fixture" old-import.log import_fixture "$SOURCE" "$OLD" &&
    step "5.17 on $SOURCE: start once" old-start.log start_once "$SOURCE" &&
    step "5.17 on $SOURCE: dataExport" old-export.log export_all "$SOURCE" "$OLD" "$OUT/export-5.17-first" &&
    step "normalise the 5.17 export, masked" old-normalize-masked.log normalize "$OUT/export-5.17-first" "$OUT/normalized-5.17-masked" -PmaskVolatile &&
    # Exporting layouts writes a default profile for every user without one (MOD-I154), so the
    # first export changed the database. The build under test is compared with a second export,
    # of the database it will read; the reference with the first, of the database 5.17 left.
    step "5.17 on $SOURCE: dataExport again" old-export-again.log export_all "$SOURCE" "$OLD" "$OUT/export-5.17" &&
    step "normalise the second 5.17 export" old-normalize.log normalize "$OUT/export-5.17" "$OUT/normalized-5.17" "${WHOLE_SECONDS[@]+"${WHOLE_SECONDS[@]}"}"; then
    if [ "$RECORD" = true ]; then
        use_vendor ''
        step "record the reference" record.log gradle dataExportRecord -PnormalizedDir="$ROOT/$OUT/normalized-5.17-masked"
    else
        compare "5.17 on $SOURCE = reference" "$EQ/reference" "$OUT/normalized-5.17-masked" reference,export \
            "$OUT/reference-report.txt" "$EQ/vendors/$SOURCE.diff"
    fi
    OLD_OK=true
else
    OLD_OK=false
fi

# 2. The build under test reads it: on the same database, or after a copy
if [ "$RECORD" = false ] && [ "$OLD_OK" = true ]; then
    if [ "$MODE" = in-place ]; then
        prepare() { step "$NEW on $TARGET: deploy" new-deploy.log deploy "$TARGET" "$NEW"; }
    else
        migrate() {
            use_vendor ''
            gradle -PuPortalVersion="$NEW" dbMigrate -PsourceDbVendor="$SOURCE" -PtargetDbVendor="$TARGET" -PdbMigrateClearTarget
        }
        prepare() {
            step "$NEW on $TARGET: deploy, dataInit" new-init.log create_database "$TARGET" "$NEW" &&
                step "dbMigrate $SOURCE to $TARGET (copy, verify)" db-migrate.log migrate
        }
    fi
    if prepare &&
        step "$NEW on $TARGET: start once" new-start.log start_once "$TARGET" &&
        step "$NEW on $TARGET: dataExport" new-export.log export_all "$TARGET" "$NEW" "$OUT/export-current" &&
        step "normalise the export of the build under test" new-normalize.log normalize "$OUT/export-current" "$OUT/normalized-current" "${WHOLE_SECONDS[@]+"${WHOLE_SECONDS[@]}"}"; then
        compare "$NEW on $TARGET = 5.17 on $SOURCE" "$OUT/normalized-5.17" "$OUT/normalized-current" 5.17,current \
            "$OUT/equivalence-report.txt"
    fi
fi

cleanup
write_summary
echo "==== Migration equivalence $NAME summary"
printf '%s\n' "${TIMINGS[@]+"${TIMINGS[@]}"}"
printf '%s\n' "${RESULTS[@]+"${RESULTS[@]}"}"
if [ ${#FAILED[@]} -gt 0 ]; then
    printf 'FAILED: %s\n' "${FAILED[@]}"
    for f in "${FAILED[@]}"; do
        case "$f" in *report*) ;; *) github_annotation error "Migration equivalence $NAME" "$f" ;; esac
    done
    exit 1
fi
echo "OK: $NAME$([ "$RECORD" = true ] && echo ': reference recorded')"
