# Native, bounded Linux observation. Only counts and reviewed metadata leave the host.
deadline=$((SECONDS + 28))
run() {
  local left=$((deadline - SECONDS))
  (( left > 0 )) || return 1
  (( left > 6 )) && left=6
  LC_ALL=C timeout --kill-after=1s "${left}s" "$@" 2>/dev/null
}
json_string() {
  local value=$1
  value=${value//\\/\\\\}; value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}; value=${value//$'\r'/\\r}; value=${value//$'\t'/\\t}
  printf '"%s"' "$value"
}
json_optional() { if [ -n "$1" ]; then json_string "$1"; else printf null; fi; }
property() { printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -n 1; }
canonical_time() {
  [[ "$1" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$ ]] || return 1
  run date -d "$1" --iso-8601=seconds
}
checks=false
if ids=$(run docker ps -aq --no-trunc); then
  if [ -z "$ids" ]; then checks=true; else
    mapfile -t container_ids <<< "$ids"
    format='docker-health={"id":{{json .Id}},"health":{{with (index .State "Health")}}{{json .Status}}{{else}}null{{end}},"restarts":{{.RestartCount}},"exit_code":{{.State.ExitCode}},"oom":{{.State.OOMKilled}},"started_at":{{json .State.StartedAt}}}'
    if details=$(run docker inspect --format "$format" "${container_ids[@]}"); then checks=true; printf '%s\n' "$details"; fi
  fi
fi
journal='{"available":false,"window_minutes":30}'
if rows=$(run sudo -n journalctl --since '30 minutes ago' -p err -n 101 -o json --output-fields=_SYSTEMD_UNIT --no-pager); then
  count=0; units=''; valid=true
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    [[ "$line" = \{*\} ]] || { valid=false; break; }
    count=$((count + 1))
    unit=$(printf '%s\n' "$line" | sed -n 's/.*"_SYSTEMD_UNIT"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9_.@:-]*\)".*/\1/p')
    units+="${unit:-kernel/system}"$'\n'
  done <<< "$rows"
  if [ "$valid" = true ]; then
    unit_json=''; limited=false
    while IFS= read -r unit; do [ -n "$unit" ] || continue; unit_json+="${unit_json:+,}$(json_string "$unit")"; done < <(printf '%s' "$units" | sort -u | head -n 10)
    (( count >= 101 )) && limited=true
    journal="{\"available\":true,\"window_minutes\":30,\"count\":$count,\"limited\":$limited,\"units\":[$unit_json]}"
  fi
fi
failed=null
if rows=$(run systemctl --failed --no-legend --plain --no-pager); then
  failed_json=''
  while IFS= read -r unit; do [ -n "$unit" ] || continue; failed_json+="${failed_json:+,}$(json_string "$unit")"; done < <(printf '%s\n' "$rows" | awk 'NF { print $1 }' | head -n 30)
  failed="[$failed_json]"
fi
backup_json=''
observe_backup() {
  local unit=$1 receipt_path=$2 marker=$3 props timer receipt='' last_run='' converted result exit_status active timer_active drift=false evidence='systemd completed run' exit_time
  [[ "$unit" =~ ^[A-Za-z0-9_.@-]+$ ]] || return 1
  props=$(run systemctl show "$unit.service" -p LoadState -p Result -p ExecMainStatus -p ExecMainExitTimestamp -p ActiveState) || return 0
  [ "$(property "$props" LoadState)" = loaded ] || return 0
  result=$(property "$props" Result); exit_status=$(property "$props" ExecMainStatus); active=$(property "$props" ActiveState)
  if [ -n "$receipt_path" ]; then evidence='success receipt'; receipt=$(canonical_time "$(run sudo -n cat "$receipt_path")") || receipt=''; fi
  if [ -n "$marker" ]; then evidence='completed snapshot'; run sudo -n test -f "$marker" || receipt=''; fi
  exit_time=$(property "$props" ExecMainExitTimestamp)
  if [ -n "$exit_time" ] && converted=$(run date -d "$exit_time" --iso-8601=seconds); then last_run=$converted; fi
  if [ -z "$receipt_path" ] && [ -z "$marker" ] && [ "$result" = success ] && [ "$exit_status" = 0 ]; then receipt=$last_run; fi
  timer=$(run systemctl show "$unit.timer" -p ActiveState -p NeedDaemonReload) || timer=''
  timer_active=$(property "$timer" ActiveState)
  [ "$(property "$timer" NeedDaemonReload)" = yes ] && drift=true
  backup_json+="${backup_json:+,}$(json_string "$unit"):{\"result\":$(json_string "$result"),\"exit_code\":$(json_string "$exit_status"),\"active\":$(json_string "$active"),\"last_success\":$(json_optional "$receipt"),\"last_run\":$(json_optional "$last_run"),\"timer_active\":$(json_optional "$timer_active"),\"timer_drift\":$drift,\"evidence\":$(json_string "$evidence")}"
}
