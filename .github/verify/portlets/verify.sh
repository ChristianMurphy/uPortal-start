#!/usr/bin/env bash
#
# Checks one portlet fix in a portal, before and after the fix.
#
#   verify.sh <calendar|newsreader> <uPortal-start clone> <out directory>
#
# It builds the portlet's war from the fix branch, runs portalInit with the released portlets,
# runs the check, deploys the fix branch's war in place of the released one, and runs the check
# again. The database stays the same throughout. Needs JDK 11 as the default java, Maven and Node.
#
# Optional environment: CHECK_SECONDS (how long the newsreader load runs in each phase) and
# CHECK_SEED.
#
set -u
here=$(cd "$(dirname "$0")" && pwd)
which=$1 start=$2 out=$3
case "$which" in
  calendar)
    name=CalendarPortlet branch=fix/calendar-labels-json
    head=fd519a4ac082fd936c6986e65b085eb7252c543f
    property=calendarPortletVersion
    # A file that only the fix branch's war has
    marker=WEB-INF/tag/calendar.tld
    ;;
  newsreader)
    name=NewsReaderPortlet branch=fix/news-set-two-sessions
    head=986b3c9509ff998a3abaa7b737873778aa310fa0
    property=newsReaderPortletVersion
    # The class that the fix changes
    marker=WEB-INF/classes/org/jasig/portlet/newsreader/service/SharedNewsSetServiceImpl.class
    ;;
  *) echo "unknown portlet $which"; exit 2 ;;
esac
mkdir -p "$out"
out=$(cd "$out" && pwd)
webapp=$start/.gradle/tomcat/webapps/$name
logs=$start/.gradle/tomcat/logs
failed=0

step() { echo; echo "##### $*"; }

gw() { (cd "$start" && ./gradlew --no-daemon "$@"); }

wait_for_portal() {
  for _ in $(seq 1 150); do
    code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/uPortal/ || true)
    case "$code" in 200 | 302) echo "The portal answers ($code)"; return 0 ;; esac
    sleep 2
  done
  echo "The portal didn't answer in 5 minutes"
  return 1
}

marker_sum() {
  if [ -f "$webapp/$marker" ]; then sha256sum < "$webapp/$marker" | cut -c1-16; else echo absent; fi
}

deployed() { # <label>: says which war the deployed portlet comes from
  echo "Deployed $name ($1): $(ls "$webapp/WEB-INF/lib" | wc -l) jars, $marker: $(marker_sum)"
}

checks() { # <label>
  step "Start the portal: $1"
  gw tomcatStart > "$out/tomcatStart-$1.log" 2>&1
  wait_for_portal || { failed=1; return; }
  # The first page loads compile JSPs and fill caches
  curl -s -o /dev/null 'http://localhost:8080/uPortal/Login?userName=admin&password=admin'
  step "Check: $1"
  if [ "$which" = calendar ]; then
    (cd "$start" && node "$here/calendar-french.mjs" "$1" "$out") || failed=1
  else
    fnames=$(grep -l '/NewsReaderPortlet' "$start"/data/quickstart/portlet-definition/*.xml |
      xargs sed -n 's|.*<fname>\(.*\)</fname>.*|\1|p' | sort | tr '\n' ' ')
    # shellcheck disable=SC2086
    python3 "$here/news_two_sessions.py" "$1" "$out" "$logs" $fnames || failed=1
  fi
  step "Stop the portal: $1"
  gw tomcatStop > "$out/tomcatStop-$1.log" 2>&1
  mkdir -p "$out/tomcat-logs-$1" && cp -r "$logs"/. "$out/tomcat-logs-$1/"
  gw tomcatClearLogs > /dev/null 2>&1
}

step "Build $name from $branch ($head)"
git clone --quiet "https://github.com/ChristianMurphy/$name.git" "$out/$name" &&
  git -C "$out/$name" checkout --quiet --detach "$head" || { echo "clone failed"; exit 1; }
(cd "$out/$name" && mvn -B -DskipTests install) > "$out/build-fix.log" 2>&1 ||
  { tail -40 "$out/build-fix.log"; echo "the build of the fix branch failed"; exit 1; }
snapshot=$(sed -n 's|.*<version>\(.*-SNAPSHOT\)</version>.*|\1|p' "$out/$name/pom.xml" | head -1)
echo "Built $name $snapshot: $(cd "$out/$name/target" && ls ./*.war)"
rm -rf "$out/$name"

step "uPortal-start $(git -C "$start" rev-parse --short HEAD): portalInit with the released portlets"
cp "$start/gradle.properties.example" "$start/gradle.properties"
grep -E "^(uPortalVersion|$property)=" "$start/gradle.properties"
gw portalInit > "$out/portalInit.log" 2>&1 || { tail -60 "$out/portalInit.log"; echo "portalInit failed"; exit 1; }
tail -3 "$out/portalInit.log"
deployed released
released_sum=$(marker_sum)
if [ "$which" = calendar ]; then
  (cd "$start" && npm ci > "$out/npm-ci.log" 2>&1 &&
    npx playwright install --with-deps chromium > "$out/playwright-install.log" 2>&1) ||
    { tail -20 "$out/playwright-install.log"; echo "Playwright isn't installed"; exit 1; }
fi

checks before

step "Deploy $name $snapshot, the fix branch's war"
sed -i "s/^$property=.*/$property=$snapshot/" "$start/gradle.properties"
grep "^$property=" "$start/gradle.properties"
gw ":overlays:$name:tomcatDeploy" > "$out/deploy-fix.log" 2>&1 || { tail -60 "$out/deploy-fix.log"; echo "deploy failed"; exit 1; }
# So that Tomcat compiles the JSPs of the new war
rm -rf "$start/.gradle/tomcat/work/Catalina/localhost/$name"
deployed fix
if [ "$(marker_sum)" = "$released_sum" ] || [ "$(marker_sum)" = absent ]; then
  echo "The deployed portlet isn't the fix branch's"
  exit 1
fi

checks after

step "Stop the database"
gw hsqlStop > "$out/hsqlStop.log" 2>&1

python3 - "$out" "$which" <<'PY' || failed=1
import json, sys
out, which = sys.argv[1:3]
after = json.load(open(f'{out}/check-after.json'))
print('Problems with the fix deployed:', after['problems'] or 'none')
sys.exit(1 if after['problems'] else 0)
PY
exit $failed
