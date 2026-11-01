#!/bin/sh
# The whole after-run for one volume, in the order the benches need: the
# baseline set (run-db.sh, run-rest.sh), then the benches added for the phase 2
# fixes. The two that add rows of their own run last. Stops before any step when
# the data volume has under 8 GiB free.
#
#   export PERF_STACK=spare6; source /tmp/nabalens-ws/spare6/env.sh
#   pnpm exec next build && (pnpm exec next start -p "$(node tests/perf/stack-config.mjs app-port)" -H 127.0.0.1 &)   # once
#   sh tests/perf/run-after.sh current|expected|high [out]
set -e
V=$1 OUT=${2:-docs/perf/after-raw}
NODE="node --conditions=react-server --import tsx"
free_gib() { df -k /tmp | awk 'NR==2 { printf "%d", $4 / 1048576 }'; }
guard() {
  if [ "$(free_gib)" -lt 8 ]; then
    echo "STOP before $1: $(free_gib) GiB free, under 8 GiB" >&2
    exit 3
  fi
}
PORT=$(node tests/perf/stack-config.mjs app-port)
lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null || { echo "no app listening on :$PORT" >&2; exit 4; }

guard "$V run-db"
sh tests/perf/run-db.sh "$V" 20 "$OUT"
guard "$V run-rest"
sh tests/perf/run-rest.sh "$V" "$OUT"
guard "$V library-bad-cases"
node tests/perf/library-bad-cases.mjs --volume "$V" --n 20 --out "$OUT"
node tests/perf/library-explain.mjs --volume "$V" --out "$OUT"
guard "$V menus-archived-bench"
$NODE tests/perf/menus-archived-bench.mjs --volume "$V" --out "$OUT"
if [ "$V" = high ]; then
  guard "$V index-cost"
  $NODE tests/perf/index-cost.mjs --volume "$V" --out "$OUT"
fi
echo "$(date +%T) $V: after-run done, $(free_gib) GiB free"
