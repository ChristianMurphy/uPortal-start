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

# A web application whose listener failed to start logs the exception after the SEVERE line, as
# an exception line and "Caused by:" lines between stack frames. Print those lines, without the
# frames, so the job log names the cause.
causes() {
  awk '
    /SEVERE/ { if (n > 0) print "--"; n = 0; capture = 1; print FILENAME ": " $0; next }
    capture && /^[[:space:]]*at / { next }
    capture && /^[[:space:]]*(Caused by: |[[:alnum:]_.$]+(Exception|Error)(: |$))/ {
      if (n < 20) print "    " $0
      n++
      next
    }
    capture && /^[0-9]{2}-[A-Za-z]{3}-[0-9]{4} / { capture = 0 }
  ' "$@"
}

echo "::group::Exceptions after SEVERE lines"
causes "${files[@]}" | head -n 300
echo "::endgroup::"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Tomcat startup errors"
    echo
    echo '```'
    for f in "${files[@]}"; do
      grep -E -H "$errors" "$f" | head -n 20
    done
    echo '```'
    echo
    echo "### Exceptions after SEVERE lines"
    echo
    echo '```'
    causes "${files[@]}" | head -n 60
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit 0
