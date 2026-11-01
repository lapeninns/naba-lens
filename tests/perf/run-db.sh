#!/bin/sh
# Generates one volume on spare6 and runs the database-side measurements:
# volume facts, EXPLAIN set and the app-code path bench. Waits for a quiet host
# first (1-minute load average under 8; this Mac is shared).
#
#   source /tmp/nabalens-ws/spare6/env.sh
#   sh tests/perf/run-db.sh current|expected|high [n] [out]
set -e
V=$1 N=${2:-20} OUT=${3:-docs/perf/raw}
load1() { sysctl -n vm.loadavg | awk '{print $2}'; }
i=0; until awk -v l="$(load1)" 'BEGIN { exit !(l < 8) }' || [ $i -ge 90 ]; do sleep 10; i=$((i+1)); done
echo "$(date +%T) $V: load $(load1)"
node tests/perf/generate.mjs --volume "$V" > "/tmp/ws3-gen-$V.json"
node tests/perf/volume-info.mjs --volume "$V" --out "$OUT"
node tests/perf/explain.mjs --volume "$V" --out "$OUT"
echo "$(date +%T) $V: load $(load1) before bench"
node --conditions=react-server --import tsx tests/perf/db-bench.mjs --volume "$V" --n "$N" --out "$OUT"
echo "$(date +%T) $V: done, load $(load1)"
