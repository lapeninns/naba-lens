#!/usr/bin/env bash
# Run the complete browser matrix concurrently from a committed tree.
set -euo pipefail
cd "$(dirname "$0")/../.."
revision=$(git rev-parse --verify --end-of-options "${1:-HEAD}^{commit}")
root=$(mktemp -d "${TMPDIR:-/tmp}/nabalens-matrix.XXXXXX")
names=(chromium-1 chromium-2 firefox webkit)
browsers=(chromium chromium firefox webkit)
shards=(1/2 2/2 "" "")

git archive "$revision" > "$root/source.tar"
for name in "${names[@]}"; do
  mkdir -p "$root/$name/src" "$root/$name/logs"
  tar -xf "$root/source.tar" -C "$root/$name/src"
done
rm "$root/source.tar"
printf 'NabaLens fixture matrix at %s\nEvidence: %s\n' "$revision" "$root"

# Give each job a process group so an interruption reaches only this run's
# app, browser and CLI processes, including the stack cleanup trap.
set -m
pids=()
stop() {
  trap - INT TERM
  for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  wait || true
  exit 130
}
trap stop INT TERM

for index in "${!names[@]}"; do
  name=${names[$index]}
  (
    cd "$root/$name/src"
    exec nice -n 5 env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
      VITEST_MAX_WORKERS=2 \
      CI_BROWSER="${browsers[$index]}" CI_PLAYWRIGHT_SHARD="${shards[$index]}" \
      CI_FIXTURE_LANE="$((index + 1))" CI_LOG_DIR="$root/$name/logs" \
      bash scripts/ci/local-ci.sh
  ) > "$root/$name/gate.log" 2>&1 &
  pids+=("$!")
done

failed=0
for index in "${!pids[@]}"; do
  name=${names[$index]}
  if wait "${pids[$index]}"; then
    printf '%-14s PASS\n' "$name"
  else
    printf '%-14s FAIL (%s)\n' "$name" "$root/$name/gate.log"
    failed=1
  fi
done
exit "$failed"
