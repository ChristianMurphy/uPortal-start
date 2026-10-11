#!/usr/bin/env bash
# Prose lint with Vale and the ai-tells rules (MOD-D35).
#
#   vale.sh docs [path...]     lint the docs in scope (default: the paths below)
#   vale.sh commits <range>    lint the messages of the non-merge commits in <range>
#
# Downloads the pinned Vale binary and ai-tells styles on first use, checks their SHA-256,
# and keeps them under .github/vale/ (ignored by git). The uPortal style next to them is ours
# and committed. Exits non-zero when Vale reports an
# error. In GitHub Actions each finding becomes an annotation.
set -euo pipefail

VALE_VERSION=3.24.0
AI_TELLS_VERSION=1.37.0
AI_TELLS_SHA256=f8d1e981abbfbac1aa092d1623a1ac9bc935f0b15e8071e7a072915abddf0570
AI_TELLS_COMMITS_SHA256=12e86278246813a3d26f5623e04843c6a8b814ad4a50eada2c781829077cbabe

# Docs written for the 6.0 modernization. Upstream docs join as they are rewritten.
DOC_PATHS=(
  docs/db-upgrade-harness.md
  docs/developer/ci-logs.md
)

root=$(git rev-parse --show-toplevel)
cd "$root"
home="$root/.github/vale"
bin_dir="$home/bin/$VALE_VERSION"
styles="$home/styles"

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

fetch() { # url expected-sha256 destination
  local tmp
  tmp=$(mktemp)
  curl -sSfL --retry 3 -o "$tmp" "$1"
  if [ "$(sha256 "$tmp")" != "$2" ]; then
    rm -f "$tmp"
    echo "Checksum mismatch for $1" >&2
    exit 2
  fi
  mv "$tmp" "$3"
}

install_vale() {
  [ -x "$bin_dir/vale" ] && return
  local asset sum
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) asset=Linux_64-bit sum=867534ddb678abca7f214bc4706ead0922bd5252ffe8035fc227013f66c8b214 ;;
    Linux-aarch64 | Linux-arm64) asset=Linux_arm64 sum=104cbd349279e50c4cb40adb70adf345d93cc4a3a0191f9e68bdccb97086b582 ;;
    Darwin-x86_64) asset=macOS_64-bit sum=eeb39e86f1daac27cc2a77fef3af1824d50559bdc22329fb25fb921c80c79472 ;;
    Darwin-arm64) asset=macOS_arm64 sum=87b513f26499f6657c15cf7175ba5b058a7c1ff2bb2d4e07265db2dd43451e44 ;;
    *) echo "No pinned Vale build for $(uname -s)-$(uname -m); use Linux, macOS or WSL." >&2; exit 2 ;;
  esac
  mkdir -p "$bin_dir"
  fetch "https://github.com/vale-cli/vale/releases/download/v$VALE_VERSION/vale_${VALE_VERSION}_${asset}.tar.gz" \
    "$sum" "$bin_dir/vale.tar.gz"
  tar -xzf "$bin_dir/vale.tar.gz" -C "$bin_dir" vale
  rm "$bin_dir/vale.tar.gz"
}

install_styles() {
  [ "$(cat "$styles/.version" 2>/dev/null)" = "$AI_TELLS_VERSION" ] && return
  local base="https://github.com/tbhb/vale-ai-tells/releases/download/v$AI_TELLS_VERSION" tmp
  tmp=$(mktemp -d)
  fetch "$base/ai-tells.zip" "$AI_TELLS_SHA256" "$tmp/ai-tells.zip"
  fetch "$base/ai-tells-commits.zip" "$AI_TELLS_COMMITS_SHA256" "$tmp/ai-tells-commits.zip"
  unzip -q "$tmp/ai-tells.zip" -d "$tmp/prose"
  unzip -q "$tmp/ai-tells-commits.zip" -d "$tmp/commits"
  rm -rf "$styles/ai-tells" "$styles/ai-tells-commits"
  mkdir -p "$styles"
  mv "$tmp/prose/ai-tells/styles/ai-tells" "$tmp/commits/ai-tells-commits" "$styles/"
  echo "$AI_TELLS_VERSION" > "$styles/.version"
  rm -rf "$tmp"
}

run_vale() { # kind (file|commit) vale-args...
  local kind=$1 out status=0
  shift
  if [ -z "${GITHUB_ACTIONS:-}" ]; then
    "$bin_dir/vale" "$@" || status=$?
    return $status
  fi
  out=$(mktemp)
  "$bin_dir/vale" --output=JSON "$@" > "$out" || status=$?
  python3 - "$out" "$kind" <<'EOF'
import json, os, sys
results = json.load(open(sys.argv[1]))
for path, alerts in results.items():
    for a in alerts:
        level = {"error": "error", "warning": "warning"}.get(a["Severity"], "notice")
        msg = a["Message"].replace("%", "%25").replace("\r", "").replace("\n", " ")
        if sys.argv[2] == "commit":
            sha = os.path.basename(path)[:-3]
            print(f"::{level} title=Commit {sha} {a['Check']}::{msg} (message line {a['Line']})")
        else:
            print(f"::{level} file={path},line={a['Line']},col={a['Span'][0]},title={a['Check']}::{msg}")
print(f"Vale: {sum(len(a) for a in results.values())} finding(s) in {len(results)} file(s).")
EOF
  rm -f "$out"
  return $status
}

install_vale
install_styles

case "${1:-}" in
  docs)
    shift
    [ "$#" -gt 0 ] || set -- "${DOC_PATHS[@]}"
    run_vale file --config=.vale.ini --glob='*.md' "$@"
    ;;
  commits)
    shift
    [ "$#" -gt 0 ] || { echo "usage: vale.sh commits <range>" >&2; exit 2; }
    # Commits older than this script are not checked.
    added=$(git log --format=%H --diff-filter=A -- .github/scripts/vale.sh | tail -1)
    since=()
    [ -n "$added" ] && since=(--since="$(git log -1 --format=%cI "$added")")
    dir=$(mktemp -d)
    skip=$(grep -oE '^[0-9a-f]{40}' "$home/commit-exceptions.txt" 2>/dev/null || true)
    while read -r sha; do
      [ -n "$sha" ] || continue
      if grep -qx "$sha" <<< "$skip"; then
        echo "Skipping ${sha:0:9}: listed in .github/vale/commit-exceptions.txt"
        continue
      fi
      git log -1 --format=%B "$sha" | grep -vE '^(Co-Authored-By|Claude-Session|Signed-off-by):' > "$dir/${sha:0:9}.md"
    done < <(git log --no-merges "${since[@]}" --format=%H "$@")
    count=$(find "$dir" -name '*.md' | wc -l)
    if [ "$count" -eq 0 ]; then
      echo "No commits to check."
      exit 0
    fi
    status=0
    (cd "$dir" && run_vale commit --config="$home/commits.ini" ./*.md) || status=$?
    rm -rf "$dir"
    echo "Checked $count commit message(s)."
    exit $status
    ;;
  *)
    echo "usage: vale.sh docs [path...] | vale.sh commits <range>" >&2
    exit 2
    ;;
esac
