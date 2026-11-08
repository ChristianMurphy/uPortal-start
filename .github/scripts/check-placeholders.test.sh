#!/usr/bin/env bash
# Test of check-placeholders.sh. It builds a scratch repository with a tip and topic branches,
# then each row runs the check and compares its exit status, and a line its output must have,
# with the row's expectation.
#
#   .github/scripts/check-placeholders.test.sh
set -uo pipefail

SCRIPT=$(cd "$(dirname "$0")" && pwd)/check-placeholders.sh
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
failures=0
cases=0

# The scratch repository ignores the user's git settings, and git doesn't look for a repository
# above $WORK.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_CEILING_DIRECTORIES=$WORK
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.org
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.org

# A git that fails the command named in FAIL_GIT, as a broken repository would, and runs every
# other command.
mkdir -p "$WORK/bin" "$WORK/not-a-repo"
cat > "$WORK/bin/git" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "\${FAIL_GIT:-}" ]; then echo "fatal: simulated failure of git \$1" >&2; exit 128; fi
exec "$(command -v git)" "\$@"
EOF
chmod +x "$WORK/bin/git"
FAIL_GIT=

# row <name> <directory> <expected exit status> <text the output must have> [<argument>...]
row() {
    local name="$1" dir="$2" expected="$3" text="$4" out status
    shift 4
    cases=$((cases + 1))
    out=$(cd "$dir" && PATH="$WORK/bin:$PATH" FAIL_GIT="$FAIL_GIT" "$SCRIPT" "$@" 2>&1)
    status=$?
    if [ "$status" = "$expected" ] && grep -qF -- "$text" <<< "$out"; then
        printf 'ok    %-58s exit %s\n' "$name" "$status"
    else
        printf 'FAIL  %-58s expected exit %s and "%s", got exit %s\n' "$name" "$expected" "$text" "$status"
        sed 's/^/        /' <<< "$out"
        failures=$((failures + 1))
    fi
}

R=$WORK/repo
git init -q -b main "$R"
cd "$R" || exit 2
mkdir -p docs/notes src
save() { git add -A && git commit -q -m "$1"; }
topic() { git checkout -q -b "$1" "$base"; }

# The tip: the guide mentions a placeholder, and the note of a topic that has landed still has one.
printf '# Guide\n\nThe coordinator numbers each `MOD-I?` row.\n' > docs/guide.md
printf '# Old topic\n\n| MOD-I? | a row of a topic that has landed |\n' > docs/notes/old.md
printf 'code\n' > src/main.txt
save 'the tip'
base=$(git rev-parse HEAD)

topic new-row
printf '# New topic\n\n| MOD-I? | a new row |\n' > docs/notes/new.md
save 'a new row'
topic mention
printf 'Number each `MOD-D?` row before the landing.\n' >> docs/guide.md
save 'a mention in backticks'
topic all-kinds
printf '| MOD-I? | a row |\n| MOD-D? | a decision |\nRuns: RUNS_PLACEHOLDER\nStart: START_SHA\n' >> docs/guide.md
save 'one placeholder of each kind'
topic plus
printf 'First line\n++ MOD-I? on a line that starts with two plus signs\n' > docs/notes/plus.md
save 'a line that starts with ++'
topic space
printf '| MOD-I? | a row |\n' > 'docs/notes/my note.md'
save 'a file name with a space'
topic clean
printf 'other code\n' > src/main.txt
save 'no placeholder'
# The tip moves on: the coordinator numbers the old topic's row.
git checkout -q main
printf '# Old topic\n\n| MOD-I400 | a row of a topic that has landed |\n' > docs/notes/old.md
save 'number the old row'
git checkout -q new-row

row "placeholder added in a new file"                            "$R" 1 \
    "::error file=docs/notes/new.md,line=3,title=Placeholder::MOD-I? is still a placeholder" "$base" new-row
row "mention in backticks"                                       "$R" 0 "0 placeholder(s) found." "$base" mention
row "one of each kind, appended to a file"                       "$R" 1 "4 placeholder(s) found." "$base" all-kinds
row "line number of an appended line"                            "$R" 1 \
    "::error file=docs/guide.md,line=7,title=Placeholder::START_SHA is still a placeholder" "$base" all-kinds
row "added line that starts with ++"                             "$R" 1 "file=docs/notes/plus.md,line=2," "$base" plus
row "file name with a space"                                     "$R" 1 "file=docs/notes/my note.md,line=1," "$base" space
row "head defaults to HEAD"                                      "$R" 1 "file=docs/notes/new.md,line=3," "$base"
row "from a subdirectory"                                        "$R/src" 1 "file=docs/notes/new.md,line=3," "$base" new-row
row "tip as base blames the topic for a row the tip numbered"    "$R" 1 "file=docs/notes/old.md,line=3," main clean
row "merge base as base"                                         "$R" 0 "0 placeholder(s) found." \
    "$(git merge-base main clean)" clean
row "base that isn't a commit"                                   "$R" 2 \
    "check-placeholders: not a commit: no-such-branch" no-such-branch new-row
row "head that isn't a commit"                                   "$R" 2 \
    "check-placeholders: not a commit: no-such-branch" "$base" no-such-branch
row "every Markdown file, with the old topic's row"              "$R" 1 "2 placeholder(s) found."
row "every Markdown file, from a subdirectory"                   "$R/src" 1 "file=docs/notes/old.md,line=3,"
row "outside a repository"                                       "$WORK/not-a-repo" 2 "not a git repository"
FAIL_GIT=diff
row "git diff fails"                                             "$R" 2 "simulated failure of git diff" "$base" new-row
FAIL_GIT=grep
row "git grep fails"                                             "$R" 2 "simulated failure of git grep"
FAIL_GIT=

echo "$cases rows, $failures failed"
[ "$failures" -eq 0 ]
