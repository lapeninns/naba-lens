# Final CI reproduction

Goal: independently reproduce documented CI at 5d28d640b7e15443538f95e31c953f2ae4f3816a without code changes.
Branch: review/nl-final-ci (clean candidate at start).

In progress: `bash scripts/ci/local-ci.sh`, with temporary PATH wrapper selecting `corepack pnpm@10.30.1`. Default pnpm 11.17.0 caused initial preflight exit 1 at scripts/ci/local-ci.sh:11; no stack created by that attempt.

Done: installation, typecheck, lint, unit (153 passed / 21 files), build, bundle scan, isolated stack start/reset. Integration has reported failures; final counts pending. No fixes or retries added.

Owned stack: `/var/folders/t4/b7qzq59j6y95v59m5_32snvw0000gn/T/nabalens-ci.mGq8si`. Logs are under its `logs/` directory; startup/status contain fixture keys and must not be committed.

Next: await foreground gate completion, inspect each suite's counts and first error, confirm owned stack stopped, finalize this report. Cleanup command: `supabase --workdir /var/folders/t4/b7qzq59j6y95v59m5_32snvw0000gn/T/nabalens-ci.mGq8si stop --no-backup`.

Open evidence gap: stage-boundary uptime was not instrumented by the unchanged gate. Initial load 7.04 / 5.03 / 4.72; intermediate observations retained in session. Do not invent per-stage measurements.
