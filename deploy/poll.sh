#!/usr/bin/env bash
# The only scheduling process lives inside the builder container.
set -euo pipefail
INTERVAL=${POLL_SECONDS:-60}
[[ "$INTERVAL" =~ ^[0-9]+$ ]] && (( INTERVAL >= 10 && INTERVAL <= 120 )) || {
  echo 'POLL_SECONDS must be 10–120' >&2; exit 2;
}
mkdir -p "$STATE_DIR"
child=''
stop() { [ -z "$child" ] || { kill -TERM "$child" 2>/dev/null || true; wait "$child" || true; }; exit 0; }
trap stop TERM INT
while true; do
  timeout 300 bash /app/scripts/deploy.sh & child=$!
  if wait "$child"; then
    date +%s > "$STATE_DIR/.last-check-ok-next"
    mv -f "$STATE_DIR/.last-check-ok-next" "$STATE_DIR/last-check-ok"
  else
    echo 'reports-site: check/build failed; last good release retained' >&2
  fi
  sleep "$INTERVAL" & child=$!
  wait "$child" || true
done
