# Handoff: review/nl-scope (independent scope audit)

## Goal

Audit `feat/nabalens-mvp` @ `3a23c9b` against `docs/spec/*` (v0.2 + coding-agent
prompt): exactly two roles, staff sees own portfolio only, admin nav is
Content + Staff only, and none of the spec's out-of-scope features are present.
Deliverable: `docs/reviews/scope-audit.md` with file:line evidence and a verdict.
Do not modify code; commit only that file (plus this handoff).

## Done

- Full read of `app/`, `components/`, `lib/`, `supabase/migrations`,
  `supabase/config.toml`, `scripts/`, `package.json`; keyword sweeps for every
  out-of-scope item (approv/review/submitted, caption/tag/comment/like/notif,
  analytic/tracking, zip/export, AI, edit tools, manager/org/tenant).
- Wrote `docs/reviews/scope-audit.md`. Verdict: **PASS** — no out-of-scope
  feature ships.
- Notable non-violations recorded in the report:
  - Gap (in-scope, missing): admin `/admin/staff/[id]` portfolio viewer is
    preview-only; spec §3 wants download/delete there too
    (`app/admin/staff/[id]/portfolio-gallery.tsx:76-82`).
  - `tests/media/sniff.test.ts:8` uses the word "approve" in a test title.
  - `app/(dev)/ui-preview` 404s in production, unlinked, labelled fixtures.
  - `[realtime] enabled = true` is a stock local-stack service; app polls.

## In progress / next exact steps

- Nothing. Audit is complete; commit `docs/reviews/scope-audit.md` and this file.

## How to run

- Review only; no stack needed. If you must re-verify: `pnpm install
  --frozen-lockfile`, then `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- No Supabase stack was started for this audit (static analysis only).

## Open questions

- Should the preview-only admin portfolio viewer be flagged to the slice track
  as a missing in-scope feature? (Recommend yes — spec §3.)
