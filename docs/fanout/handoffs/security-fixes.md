# Handoff: security-fixes (wave 3 review findings 1, 3, 4, 5, 6, 7)

- **Goal:** fix my own findings from `docs/reviews/wave3-review.md`, with tests that run
  as real users. The decisions and the evidence are in `docs/reviews/wave3-fixes.md`.
- **Branch:** `feat/nl-secfix`. Base: `feat/nabalens-mvp` @ 3a23c9b, plus a merge of
  `review/nl-wave3`.
- **Status:** DONE. All suites are green (see below). Nothing is in progress.

## Done

- **Migration** `supabase/migrations/20261030100000_security_hardening.sql`:
  - drops the end-user SELECT policies on `media` and `avatars`;
  - adds the `storage.objects` trigger `nabalens_guard_media_original_write`;
  - makes `reserve_media_asset` enforce the allow-list, the size cap and the cap of 20 open
    reservations;
  - adds `take_over_stale_media_claim` and `fail_stale_media_processing` (both
    service-role only).
- **App:**
  - Service-role signing after the existing checks in `lib/server/media/access.ts`
    (`signDerivative`), `lib/server/media/profile.ts` (`signAvatar`), and
    `lib/server/accounts/{directory,portfolio}.ts`.
  - DB-time takeover and ready-on-lost-claim in `lib/server/media/finalise.ts`.
  - The reaper, and `p_now` only from `options.now`, in `lib/server/lifecycle/cleanup.ts`.
  - `MEDIA_LIMITS.staleProcessingMinutes`, and `rpcFailure` mappings for the new reserve
    errors.
  - `isSameOriginRequest` (`lib/server/http/same-origin.ts`), used by `app/api/profile`.
  - Security headers in `next.config.ts`.
- **Tests:**
  - New: `tests/security/hardening.test.ts`, `tests/lifecycle/stale-processing.test.ts`,
    `tests/e2e/security-headers.spec.ts`, `tests/unit/{same-origin,rpc-failure}.test.ts`.
  - Updated expectations (end users never read storage directly):
    `tests/security/access.test.ts`, `tests/lifecycle/lifecycle.test.ts`, and
    `tests/integration/{isolation,accounts,lifecycle}.test.ts`.
  - `tests/security/vitest.config.ts` gained the `@/` alias.
- **Docs:** `docs/media-routes.md`, `docs/cleanup.md`, `docs/reviews/wave3-fixes.md`.
- `lib/db/types.ts` was regenerated; it adds only the two new RPCs.

## Edits outside the track's paths (unavoidable; for the integrator)

- **`lib/server/media/finalise.ts`:** finding 6 needs it.
- **`lib/server/media/errors.ts`, `lib/config/media.ts`, `lib/db/types.ts`:** small,
  additive changes.
- **`lib/server/accounts/{directory,portfolio}.ts`:** one line each to sign with
  `ctx.service`. Without it, the admin directory avatars and the portfolio would break
  once the SELECT policies were gone.
  - The `library` track replaces `portfolio.ts` (finding 2).
  - Conflicts with `library` are likely in `access.ts` and `portfolio.ts`. Keep the rule
    "sign with `actor.service` only after `getReadableAsset`".
- **Tests owned by foundation, lifecycle and slice:** these asserted direct storage reads,
  which finding 1 removes by design.

## Open questions and next steps

- **Hosted Supabase:** confirm that a trigger on `storage.objects` is allowed before the
  first `db push`. It works locally.
- **Admin avatar route:** `app/admin/staff/[id]/avatar/route.ts` (accounts) should use
  `isSameOriginRequest`. Its `nextUrl.origin` check refuses uploads under
  `next dev --hostname 127.0.0.1`, because `nextUrl` reports `localhost` there.
- **Cleanup scheduling:** cleanup is still unscheduled. The reaper and the abandoned-upload
  cleanup run only when cleanup runs.

## How to run my stack

- **Create the workdir:**

  ```
  node tests/security/prepare-stack.mjs /tmp/nl-secfix-stack
  ```

  Then, in its `supabase/config.toml`:
  - set `project_id = "nabalens-secfix"`;
  - move the ports to 631xx;
  - set `enabled = false` for `[studio]`, `[realtime]`, `[analytics]` and `[edge_runtime]`.

  The helper `/tmp/nl-secfix-prep.mjs` does these edits.

- **Start:** `supabase --workdir /tmp/nl-secfix-stack start`.
- **Run the suites:** `pnpm test:security /tmp/nl-secfix-stack` and
  `pnpm test:lifecycle /tmp/nl-secfix-stack`. Early on, `supabase status` exited non-zero
  once while the stack was still settling, and `run.mjs` failed on it. For that case and
  for the integration project, `/tmp/nl-secfix-run.sh <security|lifecycle|integration>`
  exports the env from `status -o json` and refuses any stack outside 631xx.
- **E2E:** export the same env with `E2E_PORT=3631`, then run `pnpm exec playwright test`.
- **Stop:** `supabase --workdir /tmp/nl-secfix-stack stop`.
