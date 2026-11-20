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
phase=${CI_PHASE:-full}
case "$phase" in full|common|database|browser) ;; *) echo 'Invalid CI_PHASE'; exit 1;; esac
if [[ "$phase" != full && -z "${CI_COMMON_RECEIPT:-}" ]]; then
  echo 'Split CI requires CI_COMMON_RECEIPT'; exit 1
fi
if [[ "$phase" != common ]]; then
  for tool in ffmpeg psql; do
    command -v "$tool" >/dev/null || { echo "Requires $tool on PATH (see docs/ci.md)"; exit 1; }
  done
fi
if [[ "$phase" == common ]]; then
  node scripts/ci/common-receipt.mjs clear "$CI_COMMON_RECEIPT" || exit 1
fi
if [[ "$phase" == database ]]; then
  [[ -n "${CI_DATABASE_RECEIPT:-}" ]] || { echo 'Database phase requires CI_DATABASE_RECEIPT'; exit 1; }
  node scripts/ci/common-receipt.mjs clear "$CI_DATABASE_RECEIPT" database || exit 1
fi
if [[ "$phase" == browser || "$phase" == database ]]; then
  node scripts/ci/common-receipt.mjs verify "$CI_COMMON_RECEIPT" || exit 1
fi
suite_mode=full
if [[ "$phase" == database ]]; then
  suite_mode=database
elif [[ "$phase" == browser && -n "${CI_DATABASE_RECEIPT:-}" ]]; then
  node scripts/ci/common-receipt.mjs verify "$CI_DATABASE_RECEIPT" database || exit 1
  suite_mode=browser
fi
work=$(mktemp -d "${TMPDIR:-/tmp}/nabalens-ci.XXXXXX")
logdir="${CI_LOG_DIR:-$work/logs}"
mkdir -p "$logdir"
steps=(); results=(); failed=0; started=0
printf 'step\tseconds\tresult\n' > "$logdir/timings.tsv"
run() {
  local name=$1; shift
  local start=$SECONDS result=PASS
  steps+=("$name")
  if "$@" >"$logdir/$name.log" 2>&1; then results+=(PASS); else
    results+=(FAIL); failed=1
    result=FAIL
    tail -n 35 "$logdir/$name.log"
  fi
  printf '%s\t%s\t%s\n' "$name" "$((SECONDS - start))" "$result" >> "$logdir/timings.tsv"
  if [[ "$result" == FAIL ]]; then
    return 1
  fi
}
finish() {
  local exit_status=$?
  trap - EXIT
  if [[ $started == 1 ]]; then
    run stop supabase --workdir "$work" stop --no-backup || true
  fi
  printf '\n%-24s %s\n' CHECK RESULT
  for ((i=0;i<${#steps[@]};i++)); do printf '%-24s %s\n' "${steps[$i]}" "${results[$i]}"; done
  printf 'Logs: %s\n' "$logdir"
  # Cleanup is part of the gate, even when the checks selected exit 0 already.
  if [[ $exit_status == 0 && $failed != 0 ]]; then exit_status=1; fi
  exit "$exit_status"
}
trap finish EXIT
trap 'exit 130' INT TERM
run install pnpm install --frozen-lockfile || exit 1
if [[ "$phase" == full || "$phase" == common ]]; then
  run typecheck pnpm typecheck || true
  run lint pnpm lint || true
  run unit pnpm test || true
  run monitoring pnpm test:monitoring || true
  run archive pnpm test:archive || true
  run verification pnpm test:verification || true
fi
if [[ "$phase" == common ]]; then
  # A failed common check never publishes reusable evidence.
  [[ "$failed" == 0 ]] || exit "$failed"
  run common-receipt node scripts/ci/common-receipt.mjs write "$CI_COMMON_RECEIPT" || exit 1
  exit "$failed"
fi
[[ "$failed" == 0 ]] || exit "$failed"
run prepare node scripts/ci/prepare-stack.mjs "$work" || exit 1
initial_e2e_port_set=${E2E_PORT+x}
initial_e2e_port=${E2E_PORT-}
export E2E_PORT
E2E_PORT=$(cat "$work/e2e-port") || exit 1
started=1
run start supabase --workdir "$work" start || exit 1
run reset supabase --workdir "$work" db reset || exit 1
supabase --workdir "$work" status -o json > "$work/status.json" 2>/dev/null || exit 1
run database-and-browser node scripts/ci/run-suites.mjs "$work" "$suite_mode" || true
if [[ "$phase" == database ]]; then
  # Cleanup is required evidence too. Publish only after every suite AND stop.
  run stop supabase --workdir "$work" stop --no-backup || exit 1
  started=0
  [[ "$failed" == 0 ]] || exit "$failed"
  if [[ "$initial_e2e_port_set" == x ]]; then
    export E2E_PORT="$initial_e2e_port"
  else
    unset E2E_PORT
  fi
  run database-receipt node scripts/ci/common-receipt.mjs write "$CI_DATABASE_RECEIPT" database || exit 1
  exit "$failed"
fi
# After the browser suites: reuses their stack build and e2e port (never skipped).
run privacy-runtime node scripts/ci/privacy-runtime.mjs "$work" || true
exit "$failed"
