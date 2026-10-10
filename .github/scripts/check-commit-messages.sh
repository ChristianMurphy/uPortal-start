#!/usr/bin/env bash
# Checks that commit subjects follow the Conventional Commits rules uPortal uses (AGENTS.md):
# "type(scope)!: description", lowercase, imperative, no trailing period, at most 72 characters.
# Merge commits are skipped, as commitlint does. Commits older than this script are not checked.
#
# Usage: check-commit-messages.sh <revision range>    e.g. origin/master..HEAD
set -euo pipefail

range=("$@")
script=.github/scripts/check-commit-messages.sh
added=$(git log --format=%H --diff-filter=A -- "$script" | tail -1)
since_args=()
if [ -n "$added" ]; then
  since_args=(--since="$(git log -1 --format=%cI "$added")")
fi

types='feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert'
pattern="^($types)(\\([a-z0-9._/-]+\\))?!?: [^A-Z]"
bad=0
checked=0
while IFS=$'\t' read -r sha subject; do
  [ -n "$sha" ] || continue
  checked=$((checked + 1))
  problems=()
  [[ "$subject" =~ $pattern ]] || problems+=("not 'type(scope): lowercase description' with type one of ${types//|/, }")
  [ "${#subject}" -le 72 ] || problems+=("${#subject} characters, more than 72 (put issue references in a Refs footer)")
  [[ "$subject" != *. ]] || problems+=("ends with a period")
  if [ "${#problems[@]}" -gt 0 ]; then
    bad=$((bad + 1))
    for p in "${problems[@]}"; do
      echo "::error title=Commit ${sha:0:9}::${subject} -- ${p}"
    done
  fi
done < <(git log --no-merges "${since_args[@]}" --format='%H%x09%s' "${range[@]}")

echo "Checked ${checked} commit(s); ${bad} with problems."
[ "$bad" -eq 0 ]
