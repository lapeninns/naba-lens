# Handoff: integrator, merge #4b

- **Goal:** merge `feat/nl-secfix`, `feat/nl-uploads`, `feat/nl-journey`, `feat/nl-load`
  into `feat/nabalens-mvp` (main checkout) with `--no-ff`, resolve per the tracks'
  handoffs and `docs/fanout/merge-plan.md`, verify, record in `docs/fanout/STATUS.md`.
  No push, no `main`.
- **Done:** merges `1c5db9b`, `3fd04cc`, `9fc4d95`, `137c7a8`; integration commits
  `5f19b58`, `be3ba67`, `bac072f`, `455d345` and this STATUS/handoff commit. Details and
  check results: STATUS.md "Merge #4b". All required checks green; integration has no
  failures (`gaps-profile-origin` passes).
- **In progress:** nothing.
- **Next:** merge `feat/nl-authedge` and `feat/nl-visual` when they finish: add visual's
  Playwright config as its own gate and exclude `visual.spec.ts` from the root config;
  keep one trailing duration in the tile name; re-check upload selectors; update the
  POST-only cleanup wording for authedge. Then the lead runs full e2e and `local-ci.sh`.
- **Stacks:** default `nabalens` 554xx from this checkout (`supabase start`,
  `supabase db reset`, `pnpm test:integration`, `supabase stop`). Security/lifecycle:
  `node tests/security/prepare-stack.mjs /tmp/nl-merge4b-sec`, set
  `project_id = "nabalens-merge4b"`, disable studio/realtime (analytics/edge already off),
  `supabase --workdir … start/db reset`, `pnpm test:security|test:lifecycle <W>`, stop.
  E2E: `W=$(node tests/e2e/prepare-stack.mjs /tmp/nl-merge4b-e2e)`, start, reset,
  `E2E_SUPABASE_WORKDIR="$W" pnpm exec playwright test <spec> --project=chromium`, stop.
  All left stopped.
- **Open questions:** none blocking; see STATUS.md "Open items after merge #4b".
