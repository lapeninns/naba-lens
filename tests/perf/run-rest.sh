#!/bin/sh
# Second pass of the baseline: regenerates one volume and runs the benches that
# need the built app on the stack app port (refresh, delivery, TTFB and bundle size) and the
# menu bench (last: it activates menus, so it changes the data).
#
#   source /tmp/nabalens-ws/<stack>/env.sh
#   export PERF_STACK=<stack>   # unset means spare6
#   pnpm exec next build && (pnpm exec next start -p "$(node tests/perf/stack-config.mjs app-port)" &)   # once
#   sh tests/perf/run-rest.sh current|expected|high [out]
set -e
V=$1 OUT=${2:-docs/perf/raw}
load1() { sysctl -n vm.loadavg | awk '{print $2}'; }
i=0; until awk -v l="$(load1)" 'BEGIN { exit !(l < 8) }' || [ $i -ge 90 ]; do sleep 10; i=$((i+1)); done
echo "$(date +%T) $V: load $(load1)"
node tests/perf/generate.mjs --volume "$V" > "/tmp/ws3-gen-rest-$V.json"
NODE="node --conditions=react-server --import tsx"
$NODE tests/perf/refresh-bench.mjs --volume "$V" --out "$OUT"
$NODE tests/perf/delivery-bench.mjs --volume "$V" --out "$OUT"
node tests/perf/ttfb-bench.mjs --volume "$V" --out "$OUT"
$NODE tests/perf/menu-bench.mjs --volume "$V" --out "$OUT"
echo "$(date +%T) $V: done, load $(load1)"
