#!/usr/bin/env bash
# Times the audit's DB calls on a synthetic library in a throwaway schema of the
# ws2 local stack. Refuses any database that is not the loopback ws2 port.
#
#   node <harness>/scripts/ci/stack.mjs env ws2 --write
#   scripts/archive/capacity/db-timing.sh [N ...]        # default: 75050 221150 1115750
#
# Only the schema `capacity_scratch` is created, and it is dropped on exit.
set -euo pipefail

env_file="${NABALENS_WS2_ENV:-/tmp/nabalens-ws/ws2/env.sh}"
here="$(cd "$(dirname "$0")" && pwd)"
[ -r "$env_file" ] || { echo "missing $env_file (run the Harness env command for ws2)" >&2; exit 2; }
# shellcheck disable=SC1090
. "$env_file"
url="${SUPABASE_DB_URL:?SUPABASE_DB_URL not set}"
if ! [[ "$url" =~ ^postgres(ql)?://[^@]*@(127\.0\.0\.1|localhost):64222/ ]]; then
  echo "refusing: database is not the loopback ws2 port 64222" >&2
  exit 2
fi

cleanup() { psql "$url" -q -v ON_ERROR_STOP=1 -c "drop schema if exists capacity_scratch cascade" >/dev/null; }
trap cleanup EXIT

sizes=("$@")
[ "${#sizes[@]}" -gt 0 ] || sizes=(75050 221150 1115750)
for n in "${sizes[@]}"; do
  echo "=== N=$n ==="
  psql "$url" -q -v ON_ERROR_STOP=1 -v n="$n" -v missing=3 -f "$here/db-timing.sql" 2>&1 \
    | grep -v "^\s*$\|does not exist\|drop cascades\|DETAIL" | sed -e 's/^psql:[^ ]* NOTICE:  //' -e 's/^NOTICE:  //'
done
