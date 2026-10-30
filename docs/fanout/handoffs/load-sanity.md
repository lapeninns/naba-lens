# Handoff: load-sanity (`feat/nl-load`)

## Goal

Measure upload/finalise behaviour of a production build (`pnpm build && next start`) on an
isolated local stack: (a) 10 staff x 10-file mixed batch, 2 parallel per client; (b) 5
simultaneous 12 MP HEIC finalises (HEIC concurrency 1); (c) 200 MiB video finalise memory.
Recommend Node function memory/timeout/concurrency. Owns `tests/load/**`,
`docs/runtime-sizing.md`.

## Done

- `tests/load/prepare-stack.mjs`: isolated stack `nabalens-load`, ports 615xx, Studio,
  Realtime, Analytics, Edge Runtime, Mailpit disabled.
- `tests/load/fixtures.mjs`: synthetic noise/test-pattern fixtures in a temp dir.
- `tests/load/stack-env.mjs`: env for build/start from `supabase status` (no keys printed).
- `tests/load/worker-probe.cjs`: `--require` preload logging HEIC worker spawn/exit.
- `tests/load/run.mjs`: the runner (Server Actions over HTTP, signed PUT / TUS, RSS sampler).

## In progress

- First runs of scenarios a, b, c.

## Next exact steps

1. `W=$(node tests/load/prepare-stack.mjs)`;
   `supabase --workdir "$W" start -x imgproxy,postgres-meta,vector,logflare,supavisor`
2. `F=$(node tests/load/fixtures.mjs)`
3. `node tests/load/stack-env.mjs "$W" pnpm build`
4. `node tests/load/run.mjs --workdir "$W" --fixtures "$F" --scenario all --out tests/load/results/<name>.json`
5. Write `docs/runtime-sizing.md` from the results. `supabase --workdir "$W" stop` at the end.

## Open questions

- None blocking. Host load from other worktrees (load avg 30-40) inflates latencies; record it.
