echo "host=$(hostname -s)"
echo "os=$(sw_vers -productName) $(sw_vers -productVersion)"
echo "kernel=Darwin $(uname -r)"
echo "cpu=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || sysctl -n hw.model)"
echo "cores=$(sysctl -n hw.ncpu)"
total=$(( $(sysctl -n hw.memsize) / 1048576 ))
echo "memtot=$total"
free=$(memory_pressure -Q 2>/dev/null | awk -F': *' '/free percentage/ {sub(/%/, "", $2); print $2}')
[ -n "$free" ] && echo "memused=$(( total * (100 - free) / 100 ))"
echo "uptime=$(uptime)"
echo "load=$(sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1, $2, $3}')"
echo "containers=none (macOS)"
df -k /System/Volumes/Data | awk 'NR == 2 {printf "rootuse=%s\nrootsize=%dG\n", $5, $2 / 1048576}'
