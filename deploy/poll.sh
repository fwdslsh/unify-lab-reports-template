#!/usr/bin/env bash
# The only scheduling process lives inside the builder container.
set -euo pipefail
INTERVAL=${POLL_SECONDS:-60}
[[ "$INTERVAL" =~ ^[0-9]+$ ]] && (( INTERVAL >= 10 && INTERVAL <= 120 )) || {
  echo 'POLL_SECONDS must be 10–120' >&2; exit 2;
}
mkdir -p "$STATE_DIR"
COLLECT=${LAB_COLLECT:-false}
[[ "$COLLECT" = true || "$COLLECT" = false ]] || { echo 'LAB_COLLECT must be true or false' >&2; exit 2; }
COLLECT_INTERVAL=${LAB_COLLECT_SECONDS:-1800}
[[ "$COLLECT_INTERVAL" =~ ^[0-9]+$ ]] && (( COLLECT_INTERVAL >= 60 && COLLECT_INTERVAL <= 86400 )) || {
  echo 'LAB_COLLECT_SECONDS must be 60–86400' >&2; exit 2;
}
child=''
stop() { [ -z "$child" ] || { kill -TERM "$child" 2>/dev/null || true; wait "$child" || true; }; exit 0; }
trap stop TERM INT
while true; do
  last=0
  [ ! -f "$STATE_DIR/last-collection-ok" ] || read -r last < "$STATE_DIR/last-collection-ok"
  if [ "$COLLECT" = true ] && (( $(date +%s) - last >= COLLECT_INTERVAL )); then
    timeout 300 bun /app/scripts/collect.mjs & child=$!
    if wait "$child"; then
      date +%s > "$STATE_DIR/.last-collection-ok-next"
      mv -f "$STATE_DIR/.last-collection-ok-next" "$STATE_DIR/last-collection-ok"
    else
      echo 'reports-site: collection failed; last observation retained' >&2
    fi
  fi
  timeout 300 bash /app/deploy.sh & child=$!
  if wait "$child"; then
    date +%s > "$STATE_DIR/.last-check-ok-next"
    mv -f "$STATE_DIR/.last-check-ok-next" "$STATE_DIR/last-check-ok"
  else
    echo 'reports-site: check/build failed; last good release retained' >&2
  fi
  sleep "$INTERVAL" & child=$!
  wait "$child" || true
done
