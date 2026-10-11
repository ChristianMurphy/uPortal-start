#!/usr/bin/env bash
# Prints the lines of Tomcat's logs that say which web applications deployed and why one did not
# start, into the job log and the job summary. A failed job then shows them without anyone
# downloading its artifact, which agents behind a proxy can't do. Always exits 0, so it never
# hides the step that failed.
#
# Usage: tomcat-log-summary.sh [log directory]    default: .gradle/tomcat/logs
set -uo pipefail

dir=${1:-.gradle/tomcat/logs}
shopt -s nullglob
files=("$dir"/catalina* "$dir"/localhost*)
if [ ${#files[@]} -eq 0 ]; then
  echo "No Tomcat logs in $dir"
  exit 0
fi

# Deployment lines name each web application; the others say why one failed.
pattern='Deployment of web application|SEVERE|startup failed|failed to start|Error (deploying|starting)'
errors='SEVERE|startup failed|failed to start'
for f in "${files[@]}"; do
  echo "::group::$f"
  grep -E -n "$pattern" "$f" | head -n 200
  echo "::endgroup::"
done

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Tomcat startup errors"
    echo
    echo '```'
    for f in "${files[@]}"; do
      grep -E -H "$errors" "$f" | head -n 20
    done
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit 0
