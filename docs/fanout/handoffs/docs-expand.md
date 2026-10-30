# docs-expand continuity

## Goal and boundaries

Expand README and setup, staff/admin usage, operations and release-checklist docs
against actual source. Branch: `feat/nl-docs2`. No application/config changes,
hosted writes, deploys, pushes or PRs. This handoff is the mandatory extra path.

## Done

- Read AGENTS, contract, coding prompt and MVP v0.2 in the required order.
- `pnpm install --frozen-lockfile`: exit 0, lockfile unchanged, pnpm 10.30.1,
  Node v24.16.0. Install warns `Ignored build scripts: esbuild@0.28.2`.
- Verified scripts, media/runtime limits, all process.env uses, Auth handlers and
  templates, Storage/cleanup migrations, seed data, test configs and installed
  Next deployment/environment guides.
- Expanded README, setup, operations and release gates. All production/staging
  checklist items remain NOT DONE and owner-authorisation-only.
- Dry-ran the documented temporary-config recipe: unique ID, eight remapped
  ports, four disabled services, matching Auth origin and templates preserved.
  No stack/container started. Checked 40 local Markdown link targets.
- `pnpm typecheck`: exit 0 (`tsc --noEmit`).
- `pnpm test`: exit 0, `Test Files 12 passed (12)`, `Tests 102 passed (102)`,
  `Duration 24.80s`. Includes actual synthetic HEIC worker memory regression.

## In progress

- Parent: final documentation review and required lint/build.
- One shared-checkout delegate: only `docs/usage-staff.md` and
  `docs/usage-admin.md`, checking exact UI labels against source. No child commits.

## Next exact steps

1. Verify delegate's usage-guide report and exact UI labels, then cross-links.
2. Run `pnpm lint` and `pnpm build`; retain actual output.
3. Update this handoff, review staged diff and commit. Do not change dependency
   approval policy or other tracks' code to conceal failures.

## Stack and safety

No stack started by this track. Test prepare scripts have fixed project IDs and
port blocks (security 564xx; lifecycle 594xx), NOT per-worktree isolation. Before
starting, inspect Docker and use only a unique copied temporary config, disabling
studio/realtime/analytics/edge_runtime. Stop only the owned workdir. The expanded
setup gives the tested config-copy procedure; no stack is needed for lint/unit/build.

## Open questions / blockers

- pnpm 11 compatibility was mentioned in the request; this shell actually runs
  pnpm 10.30.1. Report this rather than claiming pnpm 11 was exercised.
- Owner-confirmed venues, hosted Auth/SMTP/hosting/cleanup/backups, real-phone and
  target-runtime evidence remain external release prerequisites.
