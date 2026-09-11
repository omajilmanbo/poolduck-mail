#!/usr/bin/env sh
set -eu

output_path=${1:?output path is required}
sample_interval=${CAPACITY_MONITOR_INTERVAL_SECONDS:-5}
sample_count=${CAPACITY_MONITOR_SAMPLES:-420}

case "$sample_interval:$sample_count" in
  *[!0-9:]*|0:*|*:0) echo "interval and sample count must be positive integers" >&2; exit 1 ;;
esac

if docker info >/dev/null 2>&1; then
  docker_prefix="docker"
elif sudo -n docker info >/dev/null 2>&1; then
  docker_prefix="sudo -n docker"
else
  echo "Docker access is required." >&2
  exit 1
fi

printf 'timestamp\tkind\tname\tcpu_percent\tmemory_usage\tnetwork_io\tblock_io\tpids\tload1\tmem_available_kb\tswap_free_kb\troot_used_percent\n' > "$output_path"

sample=0
while [ "$sample" -lt "$sample_count" ]; do
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  load1=$(awk '{print $1}' /proc/loadavg)
  mem_available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
  swap_free=$(awk '/SwapFree:/ {print $2}' /proc/meminfo)
  root_used=$(df -P / | awk 'NR == 2 {gsub(/%/, "", $5); print $5}')
  printf '%s\thost\tapp01\t-\t-\t-\t-\t-\t%s\t%s\t%s\t%s\n' \
    "$timestamp" "$load1" "$mem_available" "$swap_free" "$root_used" >> "$output_path"
  $docker_prefix stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}' |
    while IFS="$(printf '\t')" read -r name cpu memory network block pids; do
      printf '%s\tcontainer\t%s\t%s\t%s\t%s\t%s\t%s\t-\t-\t-\t-\n' \
        "$timestamp" "$name" "$cpu" "$memory" "$network" "$block" "$pids" >> "$output_path"
    done
  sample=$((sample + 1))
  if [ "$sample" -lt "$sample_count" ]; then sleep "$sample_interval"; fi
done
