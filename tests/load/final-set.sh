#!/bin/sh
# Runs the final measurement set, waiting before each scenario until the host's
# 1-minute load average is below 8 (other worktrees share this Mac).
#   sh tests/load/final-set.sh <workdir> <fixtures> <tag>
set -e
W=$1 F=$2 TAG=${3:-final}
load1() { sysctl -n vm.loadavg | awk '{print $2}'; }
quiet() { until awk -v l="$(load1)" 'BEGIN { exit !(l < 8) }'; do sleep 10; done; }
run() {
  quiet
  echo "$(date +%T) $1: uptime $(uptime | sed 's/.*load averages*: //')"
  shift
  node tests/load/run.mjs --workdir "$W" --fixtures "$F" "$@" >/dev/null
}
run "c"          --scenario c --out "tests/load/results/$TAG-c.json"
run "b5"         --scenario b --heic 5 --out "tests/load/results/$TAG-b5.json"
run "b20"        --scenario b --heic 20 --out "tests/load/results/$TAG-b20.json"
run "a mixed"    --scenario a --out "tests/load/results/$TAG-a.json"
run "a heic"     --scenario a --batch heic --out "tests/load/results/$TAG-a-heic.json"
echo "$(date +%T) done: uptime $(uptime | sed 's/.*load averages*: //')"
