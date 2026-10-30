#!/usr/bin/env bash
# Fixture-only CI; never sources a checkout .env file.
set -uo pipefail
export CI=true
export NEXT_TELEMETRY_DISABLED=1
cd "$(dirname "$0")/../.."
for file in .env .env.*; do
  [[ ! -f "$file" || "$file" == .env.example ]] || { echo "Refusing checkout environment file: $file"; exit 1; }
done
if [[ $(pnpm --version) != 10.30.1 ]]; then
  echo 'Requires pnpm 10.30.1'; exit 1
fi
work=$(mktemp -d "${TMPDIR:-/tmp}/nabalens-ci.XXXXXX")
logdir="${CI_LOG_DIR:-$work/logs}"
mkdir -p "$logdir"
steps=(); results=(); failed=0; started=0
run() {
  local name=$1; shift
  steps+=("$name")
  if "$@" >"$logdir/$name.log" 2>&1; then results+=(PASS); else
    results+=(FAIL); failed=1
    tail -n 35 "$logdir/$name.log"
    return 1
  fi
}
finish() {
  if [[ $started == 1 ]]; then
    run stop supabase --workdir "$work" stop --no-backup || true
  fi
  printf '\n%-24s %s\n' CHECK RESULT
  for ((i=0;i<${#steps[@]};i++)); do printf '%-24s %s\n' "${steps[$i]}" "${results[$i]}"; done
  printf 'Logs: %s\n' "$logdir"
}
trap finish EXIT
trap 'exit 130' INT TERM
run install pnpm install --frozen-lockfile || exit 1
run typecheck pnpm typecheck || true
run lint pnpm lint || true
run unit pnpm test || true
run build pnpm build && run scan-bundle node scripts/ci/scan-bundle.mjs || true
run prepare node scripts/ci/prepare-stack.mjs "$work" || exit 1
started=1
run start supabase --workdir "$work" start || exit 1
run reset supabase --workdir "$work" db reset || exit 1
supabase --workdir "$work" status -o json > "$work/status.json" 2>/dev/null || exit 1
run database-and-browser node scripts/ci/run-suites.mjs "$work" || true
exit "$failed"
