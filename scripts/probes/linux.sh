#!/usr/bin/env bash
# Read-only native facts. No environment, credential files or application logs.
echo "host=$(hostname)"
echo "os=$(. /etc/os-release; echo "$PRETTY_NAME")"
echo "kernel=$(uname -r)"
echo "cpu=$(awk -F: '/model name/ {sub(/^ +/, "", $2); print $2; exit}' /proc/cpuinfo)"
echo "cores=$(nproc)"
echo "board=$(cat /sys/class/dmi/id/board_vendor /sys/class/dmi/id/board_name 2>/dev/null | paste -sd ' ' -)"
free -m | awk '/^Mem:/{printf "memused=%d\nmemtot=%d\n",$3,$2} /^Swap:/{printf "swapused=%d\n",$3}'
echo "uptime=$(uptime -p 2>/dev/null)"
echo "load=$(cut -d' ' -f1-3 /proc/loadavg)"
df -hP / | awk 'NR==2{printf "rootuse=%s\nrootsize=%s\n",$5,$2}'
for mount in /models /data /var/lib/docker /mnt/scratch; do
  mountpoint -q "$mount" || continue
  mode=$(findmnt -n -o OPTIONS --mountpoint "$mount" | cut -d, -f1)
  size=$(df -hP "$mount" | awk 'NR==2{printf "%s total, %s free (%s used)",$2,$4,$5}')
  echo "storage=$mount|$mode|$size"
done
if containers=$(docker ps -q 2>/dev/null); then
  echo "containers=$(printf '%s\n' "$containers" | awk 'NF {n++} END {print n+0}')"
  docker ps -a --no-trunc --format 'docker={"id":{{json .ID}},"name":{{json .Names}},"image":{{json .Image}},"state":{{json .State}},"status":{{json .Status}},"ports":{{json .Ports}},"project":{{json (.Label "com.docker.compose.project")}},"service":{{json (.Label "com.docker.compose.service")}}}'
else
  echo containers=unavailable
fi
# Never resume a runtime-suspended GPU just to obtain its power counter.
for device in /sys/class/drm/card*/device; do
  [ "$(cat "$device/vendor" 2>/dev/null)" = 0x8086 ] || continue
  name="Intel GPU $(cat "$device/device" 2>/dev/null)"
  state=$(cat "$device/power/runtime_status" 2>/dev/null)
  case "${state:-active}" in active|unsupported) ;; *) echo "gpu=$name|runtime PM $state, power not read"; continue ;; esac
  for hwmon in "$device"/hwmon/hwmon*; do
    [ -r "$hwmon/energy1_input" ] || continue
    first=$(cat "$hwmon/energy1_input"); sleep 1; second=$(cat "$hwmon/energy1_input")
    echo "gpu=$name|$(( (second-first)/1000000 ))W"
  done
done
if grep -qx 0x10de /sys/bus/pci/devices/*/vendor 2>/dev/null; then
  nvidia-smi --query-gpu=name,power.draw,memory.used,memory.total --format=csv,noheader 2>/dev/null |
    while IFS=, read -r name power used total; do echo "gpu=$name|$power, VRAM $used /$total"; done
fi
