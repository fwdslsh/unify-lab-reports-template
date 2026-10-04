#!/usr/bin/env bash
# Fetch one trusted branch, build in isolation, and atomically publish good output.
set -euo pipefail
: "${REPO_URL:?Set REPO_URL to the site Git URL}"
: "${STATE_DIR:?Set STATE_DIR to a dedicated build/cache directory}"
: "${PUBLISH_DIR:?Set PUBLISH_DIR to the Caddy-mounted output directory}"
BRANCH=${BRANCH:-main}
BUN=${BUN:-bun}
COLLECT=${COLLECT:-false}
COLLECT_SECONDS=${COLLECT_SECONDS:-1800}
[[ "$COLLECT" = true || "$COLLECT" = false ]] || { echo 'COLLECT must be true or false' >&2; exit 2; }
[[ "$COLLECT_SECONDS" =~ ^[0-9]+$ ]] && (( COLLECT_SECONDS >= 60 && COLLECT_SECONDS <= 86400 )) || { echo 'COLLECT_SECONDS must be 60–86400' >&2; exit 2; }
git check-ref-format "refs/heads/$BRANCH"
mkdir -p "$STATE_DIR" "$PUBLISH_DIR/_releases"
STATE_DIR=$(realpath "$STATE_DIR")
PUBLISH_DIR=$(realpath "$PUBLISH_DIR")
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || exit 0
export GIT_TERMINAL_PROMPT=0
CACHE="$STATE_DIR/repository.git"
if [ ! -d "$CACHE" ]; then
  git init --bare -q "$CACHE"
fi
git --git-dir="$CACHE" fetch --quiet --no-tags "$REPO_URL" "+refs/heads/$BRANCH:refs/heads/publish"
REVISION=$(git --git-dir="$CACHE" rev-parse refs/heads/publish)
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'Unsupported Git revision' >&2; exit 1; }
# Configuration belongs to the fetched source revision, not the image or host clone.
if [ -z "${CONFIG_FILE:-}" ]; then
  git --git-dir="$CACHE" show "$REVISION:config.json" > "$STATE_DIR/.config-next"
  mv -f "$STATE_DIR/.config-next" "$STATE_DIR/config.json"
  export CONFIG_FILE="$STATE_DIR/config.json"
fi
export SNAPSHOT_FILE=${SNAPSHOT_FILE:-$STATE_DIR/observed.json}
export PREVIOUS_FILE=${PREVIOUS_FILE:-$STATE_DIR/previous.json}
if [ "${COLLECT:-false}" = true ]; then
  last=0
  if [ -r "$STATE_DIR/last-collection-ok" ]; then read -r last < "$STATE_DIR/last-collection-ok"; fi
  [[ "$last" =~ ^[0-9]+$ ]] || last=0
  if (( $(date +%s) - last >= COLLECT_SECONDS )); then
    if timeout 300 bun "$(dirname "${BASH_SOURCE[0]}")/collect.mjs"; then
      date +%s > "$STATE_DIR/.collection-next"
      mv -f "$STATE_DIR/.collection-next" "$STATE_DIR/last-collection-ok"
    else echo 'reports-site: collection failed; retaining the previous snapshot' >&2; fi
  fi
fi
CONFIG_HASH=$(bun "$(dirname "${BASH_SOURCE[0]}")/config.mjs" --hash)
TARGET="_releases/$REVISION${CONFIG_HASH:+-$CONFIG_HASH}"
PREVIOUS=$(readlink "$PUBLISH_DIR/current" || true)
if [ "$PREVIOUS" = "$TARGET" ] && [ -f "$PUBLISH_DIR/current/index.html" ]; then
  exit 0
fi
WORK=$(mktemp -d "$STATE_DIR/build.XXXXXX")
RELEASE=$(mktemp -d "$PUBLISH_DIR/_releases/.build.XXXXXX")
NEXT="$PUBLISH_DIR/.current-next"
cleanup() { rm -rf -- "$WORK" "$RELEASE"; rm -f -- "$NEXT"; }
trap cleanup EXIT
echo "reports-site: building $REVISION"
git --git-dir="$CACHE" archive "$REVISION" | tar -xf - -C "$WORK"
(
  cd "$WORK"
  "$BUN" install --frozen-lockfile --ignore-scripts
  "$BUN" run build -- -o "$RELEASE"
)
[ -s "$RELEASE/index.html" ] && [ -s "$RELEASE/status.html" ] &&
  [ -s "$RELEASE/reports/index.html" ] && [ -s "$RELEASE/sitemap.html" ] && [ -s "$RELEASE/styles.css" ] || {
  echo 'Build did not produce the required site entrypoints; previous site retained' >&2
  exit 1
}
printf '{"revision":"%s","publishedAt":"%s"}\n' "$REVISION" "$(date -u +%FT%TZ)" > "$RELEASE/deployment.json"
chmod 0755 "$RELEASE"
if [ -e "$PUBLISH_DIR/$TARGET" ]; then
  # Only our generated release cache is replaceable, never authored sources.
  rm -rf -- "$PUBLISH_DIR/$TARGET"
fi
mv -- "$RELEASE" "$PUBLISH_DIR/$TARGET"
rm -f -- "$NEXT"
ln -s "$TARGET" "$NEXT"
mv -Tf -- "$NEXT" "$PUBLISH_DIR/current"
echo "reports-site: published $REVISION"
# Keep current and previous generated releases. Source history belongs in Git.
for candidate in "$PUBLISH_DIR/_releases/"*; do
  name=${candidate##*/}
  if [[ "$name" =~ ^[0-9a-f]{40}(-[0-9a-f]{64})?$ ]] && [ ! -L "$candidate" ] &&
      [ "_releases/$name" != "$TARGET" ] && [ "_releases/$name" != "$PREVIOUS" ]; then
    rm -rf -- "$candidate"
  fi
done
