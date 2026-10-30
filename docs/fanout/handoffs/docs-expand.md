# docs-expand continuity

## Goal and boundaries

Expand README and setup, staff/admin usage, operations and release-checklist docs
against actual source. Branch: `feat/nl-docs2`. No authored application/config
changes, hosted writes, deploys, pushes or PRs. The requested integration merge
imports the upstream dependency-policy change; this handoff is the mandatory
extra documentation path.

## Merged baseline follow-up

- Ran `git merge feat/nabalens-mvp` successfully, then
  `CI=true pnpm install --frozen-lockfile` successfully, in that order.
- Merge commit `505f172` includes integration head `3a23c9b`. Ancestry check:
  `git merge-base --is-ancestor 3a23c9b HEAD`, exit 0.
- `git diff a4ebc8d..HEAD --name-only` reported only `pnpm-workspace.yaml`.
  The application, routes, components, scripts, migrations and lockfile are
  unchanged by this merge, so the existing source audit still applies.
- Merged policy adds `allowBuilds.esbuild: false`, the explicit pnpm 11 denial
  decision. README/setup now document that merged policy, not the old omission.
- CI install actual output: `Lockfile is up to date, resolution step is skipped`,
  `Already up to date`, `Ignored build scripts: esbuild@0.28.2.`,
  `Done in 342ms using pnpm v10.30.1`, exit 0. pnpm 11 itself was not run.
- Post-merge `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`
  all exited 0. Actual output excerpts:

  ```text
  pnpm typecheck
  > tsc --noEmit
  # exit 0
  pnpm lint
  > eslint
  # exit 0, no diagnostics
  pnpm test
  Test Files  12 passed (12)
       Tests  102 passed (102)
    Duration  25.74s (tests 82%, import 11%, transform 5%, environment 3%)
  # exit 0
  pnpm build
  ✓ Compiled successfully in 1003ms
  Finished TypeScript in 1779ms ...
  ✓ Generating static pages using 17 workers (15/15) in 190ms
  # exit 0
  ```

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
- `pnpm lint`: exit 0 (`eslint`), no diagnostics.
- `pnpm build`: exit 0, Next.js 16.4.2, compiled in 4.8s, TypeScript in 5.3s,
  static pages 15/15. Route table includes the actual staff/admin, Auth, private
  media/profile/avatar and cleanup routes. No private env file was read.
- Completed and reviewed the independent usage-guide contribution against its
  source audit: staff guide 492 words, admin guide 553 words. Corrected the old
  invented removal label to actual **Delete**, and recorded actual account
  confirmation behavior and preview-only individual admin portfolios.
- Final Markdown validation: 40 local link targets/heading anchors and shell
  syntax for 16 command blocks passed. The first ad hoc validator mishandled an
  indented Markdown fence; fixed that checker and reran successfully. This was a
  validator parsing issue, not a failed application test or broken shell recipe.

## In progress

None. Merged-baseline documentation and validation are complete. No stubs added.

## Changed paths and purpose

- `README.md`: safe entry point, verified versions/scripts and guide navigation.
- `docs/setup.md`: dependency policy, complete env inventory, collision-safe local
  recipe, exact test workdirs, admin/venue procedures and individually NOT DONE,
  owner-authorisation-only hosted steps; explicit UNTESTED restore rehearsal.
- `docs/usage-staff.md`, `docs/usage-admin.md`: short task guides using actual UI.
- `docs/operations.md`: capture/privacy, routine checks, cleanup reports/retention,
  signed/downloaded-copy limits and lost-phone incident steps.
- `docs/release-checklist.md`: four evidence-based gates and two-venue pilot;
  documented individual-portfolio implementation gap.
- `docs/fanout/handoffs/docs-expand.md`: mandatory continuity file, the only extra
  authored path beyond the six owned docs. The authorised integration merge also
  imports upstream `pnpm-workspace.yaml`; no independent dependency-policy edit.

## Usage-guide source audit

The completed delegate checked login-card/app-shell, edit-profile/upload dialogs
and queue, admin-library/library-filters/load-more/media-viewer/delete confirmation,
invite dialog/directory/account-controls/account-header and portfolio-gallery;
server invite/manage/portfolio helpers and the original-download handler.
Source-referenced findings were reconciled into operations/release docs. Notable
limitations: individual portfolios lack download/delete; Reactivate and the
Account active switch have no dedicated confirmation; avatar updates can persist
before another field fails; closing uploads clears retry context.

## Next exact steps

1. Integrator reviews/merges `feat/nl-docs2` into `feat/nabalens-mvp`; no remote,
   push, PR or main-branch mutation was performed or requested.
2. Route owner resolves individual-portfolio download/delete actions or obtains
   an explicit scope decision. Current workaround: Content + Staff member filter.
3. Release owner collects current-head service-suite and physical-device evidence,
   confirms venues, then separately authorises staging/provider configuration.
4. Keep all hosted checklist items NOT DONE until that environment's real evidence
   exists. Do not infer production readiness from this documentation milestone.

## Initial validation output (2026-10-30, before integration-policy merge)

```text
pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
Ignored build scripts: esbuild@0.28.2.
Done in 3.1s using pnpm v10.30.1
# exit 0

pnpm typecheck
> tsc --noEmit
# exit 0

pnpm test
Test Files  12 passed (12)
     Tests  102 passed (102)
  Duration  24.80s (tests 79%, import 13%, transform 6%, environment 3%)
# exit 0

pnpm lint
> eslint
# exit 0, no diagnostics

pnpm build
▲ Next.js 16.4.2 (Turbopack)
✓ Compiled successfully in 4.8s
Finished TypeScript in 5.3s ...
✓ Generating static pages using 17 workers (15/15) in 311ms
# exit 0

PASS documented config recipe: unique ID, 8 remapped ports, 4 disabled services,
matching Auth origin, templates preserved; no stack started.
PASS 40 local links, including heading anchors, across 6 owned guides.
PASS shell syntax for 16 documented command blocks; no commands executed.
```

Not run: integration, security, lifecycle or e2e service suites (docs-only work;
no stack started), hosted SMTP/auth/processing/cleanup, phone/browser journeys,
deployment, backup or restore. pnpm 11 was not exercised. The documented config
recipe was executed against a temporary directory only; no containers or provider
state changed. Private media/credentials were not used.

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
- Individual admin-portfolio download/delete actions are absent in current UI.
  Exactly two interfaces/roles and all exclusions remain unchanged.
