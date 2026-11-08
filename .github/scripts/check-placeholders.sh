#!/usr/bin/env bash
# Checks that Markdown files hold no placeholder the coordinator must fill in before a landing:
# MOD-I?, MOD-D?, RUNS_PLACEHOLDER or START_SHA. A placeholder inside backticks is a mention, such
# as in the agent guide, and is skipped.
#
# Usage: check-placeholders.sh <base> [<head>]   lines that <base>..<head> adds (head: HEAD)
#        check-placeholders.sh                    every tracked Markdown file
# A landing uses the first form, with the merge base of the tip and the topic head as <base>
# (agent-guide section 11). The second form also reports the placeholders still in the notes of
# topics that have already landed. Either form checks the whole repository, from any directory
# in it.
# Exit status: 0 when there is no placeholder, 1 when there is one, 2 when the check can't run,
# such as outside a repository or with a revision that isn't a commit.
# .github/scripts/check-placeholders.test.sh tests it.
set -euo pipefail

pattern='MOD-[ID]\?|RUNS_PLACEHOLDER|START_SHA'
# Pathspecs and git grep are relative to the working directory, so start at the top.
top=$(git rev-parse --show-toplevel) || exit 2
cd "$top"

if [ "$#" -gt 0 ]; then
  for rev in "$1" "${2:-HEAD}"; do
    git rev-parse --quiet --verify "$rev^{commit}" > /dev/null ||
      { echo "check-placeholders: not a commit: $rev" >&2; exit 2; }
  done
  # Prints "file:line:text" for each added line, from the hunk headers of a diff without context.
  # A file's "+++ " line comes between "diff --git" and its first "@@". After that, a line that
  # starts with "+++ " is an added line that starts with "++ ". Git ends the name of a file with a
  # space in it with a tab.
  added=$(git diff --unified=0 --no-color --no-renames "$1" "${2:-HEAD}" -- '*.md' |
    awk '/^diff --git /{header = 1; next}
         header && /^\+\+\+ /{file = substr($0, 7); sub(/\t$/, "", file); next}
         /^@@ /{header = 0; split($3, a, ","); line = substr(a[1], 2); next}
         !header && /^\+/{print file ":" line ":" substr($0, 2); line++}') || exit 2
  # grep exits 1 when nothing matches and 2 on an error.
  hits=$(grep -E "$pattern" <<< "$added") || [ "$?" -eq 1 ] || exit 2
else
  # git grep exits 1 when nothing matches and 128 on an error.
  hits=$(git grep -n -I -E "$pattern" -- '*.md') || [ "$?" -eq 1 ] || exit 2
fi

bad=0
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  file=${hit%%:*}
  rest=${hit#*:}
  line=${rest%%:*}
  text=${rest#*:}
  if sed 's/`[^`]*`//g' <<< "$text" | grep -qE "$pattern"; then
    bad=$((bad + 1))
    echo "::error file=${file},line=${line},title=Placeholder::$(grep -oE "$pattern" <<< "$text" | head -1) is still a placeholder"
  fi
done <<< "$hits"

echo "${bad} placeholder(s) found."
[ "$bad" -eq 0 ]
