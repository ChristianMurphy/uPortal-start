#!/usr/bin/env bash
# Checks that Markdown files hold no placeholder the coordinator must fill in before a landing:
# MOD-I?, MOD-D?, RUNS_PLACEHOLDER or START_SHA. A placeholder inside backticks is a mention, such
# as in the agent guide, and is skipped.
#
# Usage: check-placeholders.sh <base> [<head>]   lines that <base>..<head> adds (head: HEAD)
#        check-placeholders.sh                    every tracked Markdown file
set -euo pipefail

pattern='MOD-[ID]\?|RUNS_PLACEHOLDER|START_SHA'

if [ "$#" -gt 0 ]; then
  # A wrong revision must fail here: the pipeline below ends in '|| true'.
  git rev-parse --quiet --verify "$1^{commit}" > /dev/null
  git rev-parse --quiet --verify "${2:-HEAD}^{commit}" > /dev/null
  # Prints "file:line:text" for each added line, from the hunk headers of a diff without context.
  hits=$(git diff --unified=0 --no-color --no-renames "$1" "${2:-HEAD}" -- '*.md' |
    awk '/^\+\+\+ /{file=substr($0, 7); next}
         /^@@ /{split($3, a, ","); line=substr(a[1], 2); next}
         /^\+/{print file ":" line ":" substr($0, 2); line++}' | grep -E "$pattern" || true)
else
  hits=$(git grep -n -I -E "$pattern" -- '*.md' || true)
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
