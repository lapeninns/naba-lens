# docs-expand continuity

## Goal and boundaries

Expand README and setup, staff/admin usage, operations and release-checklist docs
against actual source. Branch: `feat/nl-docs2`. No application/config changes,
hosted writes, deploys, pushes or PRs. This handoff is the mandatory extra path.

## Done

- Read AGENTS, contract, coding prompt and MVP v0.2 in the required order.
- `pnpm install --frozen-lockfile`: exit 0, lockfile unchanged, pnpm 10.30.1,
  Node v24.16.0. Install warns `Ignored build scripts: esbuild@0.28.2`.
- Inspected scripts, media limits, stack/test configs and operator scripts.

## In progress

- Parent: setup/environment/stack/production, operations, README and release gates.
- One shared-checkout delegate: only `docs/usage-staff.md` and
  `docs/usage-admin.md`, checking exact UI labels against source. No child commits.

## Next exact steps

1. Finish source audit (environment uses, media/runtime, Auth, storage migrations).
2. Rewrite owned docs, verify delegate report and cross-links.
3. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; record actual
   output, update this handoff and commit. Do not change dependency approval policy
   or other tracks' code to conceal failures.

## Stack and safety

No stack started by this track. Test prepare scripts have fixed project IDs and
port blocks (security 564xx; lifecycle 594xx), NOT per-worktree isolation. Before
starting, inspect Docker and use only a unique copied temporary config, disabling
studio/realtime/analytics/edge_runtime. Stop only the owned workdir. Documentation
will give this procedure; no stack is needed for lint/unit/build.

## Open questions / blockers

- pnpm 11 compatibility was mentioned in the request; this shell actually runs
  pnpm 10.30.1. Report this rather than claiming pnpm 11 was exercised.
- Owner-confirmed venues, hosted Auth/SMTP/hosting/cleanup/backups, real-phone and
  target-runtime evidence remain external release prerequisites.
