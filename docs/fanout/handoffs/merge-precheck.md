# Final handoff: merge-precheck

- **Branch/worktree:** `feat/nl-mergeplan`,
  `/Users/amankumarshrestha/.t3/worktrees/nabalens/feat-nl-mergeplan`.
- **Scope:** only `docs/fanout/merge-plan.md` and this file. Application remains
  `3a23c9b`; no application implementation, real branch merges or stack activity.
- **Final scheduled snapshot:** **2026-10-30T01:36:50.133604Z**, integration
  `455d34588434316f034c41d3e6894d6c666b9ac8`. All 15 original targets plus
  integration were pinned with absolute times and observed `%cr` in the plan.
  No pinned ref moved during the scan.
- **Stopping criterion met:** **11/14** original non-superseded refs unchanged
  since snapshot 4 across **1238.857054 seconds (20m39s)**; each qualifying
  commit is at least 20 minutes old. Quiet: library, uploads, CI, docs2,
  acceptance, privacy, migrations, load and the three reviews. Superseded docs
  was checked but excluded only from the quiet denominator. Quiet is not done.
- **Remaining changed/recent tracked refs:** journey
  `ff5325ec8bc377c73699177c5f35bf4de7c82ef3` (01:19:29 UTC, 17 minutes ago,
  integrated); visual `93ed9d05d09231580b3bce3aa50aa0e572b2504f`
  (01:36:39, 11 seconds ago, unmerged); authedge
  `5dc15a58acbf0d4c9224cee71210eaa136aced06` (01:29:37, 7 minutes ago,
  unmerged). Integration itself is active (01:36:41, 9 seconds ago).
  Supplemental secfix changed to `0166b9898389f96e9a83619f63e3cc967367ddac`
  (01:23:35, 13 minutes ago), already integrated, outside the denominator.

## Real outputs and exact remaining resolutions

- **Original matrix:** 120 checks, **115 clean / 5 conflicting**; 14/15 base
  checks and 101/105 pairs clean. Both docs branches included.
- Conflicting calls: integration/visual and journey/visual (mobile row-link
  comment); journey/library (filter); journey/authedge (filter + README);
  journey/docs2 (README). The only current base conflict is visual's row.
  Historical pair failures remain reported, not relabelled as clean.
- **Raw cumulative:** six clean steps, visual conflict at step 7, then stop.
  Proposed object-only pass: 14 steps, 13 automatic + one textual resolution;
  tree `daa783cff9093a32f30bc358228acc95b93d6e1d`.
- Row resolution: comment-free visual blob
  `76fd4a8ad97a089228800790fdf1e6c1ee45521a`; visible content names the link,
  one hidden `, open portfolio` suffix, no overriding mobile `aria-label`.
- **Updated duration precedence:** latest visual now puts filename first, then
  duration. Keep that single duration and its updated component assertion; drop
  journey's trailing duplicate. This supersedes the old trailing-duration rule.
  Tile blob `4abea6a4a4e46c9dcc6efe00f43606c5e897b0a8`; semantic tree
  `06027ab41dbbd3470cecd8b8fc2d053c94ac2fad`.
- README historical pairs: retain journey's richer commands and current
  operational links, but separate service-dependent commands from the no-stack
  block and use actual E2E port 3457. Filter recipe is already correctly combined
  in integration (`filtersToSearch` + optimistic controls/committed gallery).
- **Secfix supplement:** 16 separate pairs, **12 clean / 4 conflicting**, with
  standalone library/authedge/uploads/privacy. Integration/secfix and secfix
  after the proposed cumulative tree are clean because it is already integrated.
  Do not remerge it or reapply snapshot 4's old four-path recipe to integration.
- Six production migration paths, no divergent current shared blobs or duplicate
  timestamps. The first five are unchanged. Sixth revision is
  `e25aa6bd3b1f8d98bb93de3e2a93c5fcd1ce702d`; old sandbox evidence was for an
  earlier revision and is not final-schema proof.

## Integrator's next work, not performed by this track

1. Repin actual integration before the remaining **authedge → visual** merges
   and this branch's final docs delta. All other original tips and secfix are
   already ancestors. Do not merge unreferenced scratch commits.
2. **Resolve the new contract mismatch:** secfix `c83af95` now refuses null/
   missing upload keys and sizes; `CONTRACT.md` still promises the optional
   fifth RPC argument/nullable column. Written compatibility wins until an
   explicitly authorised amendment. Preserve documented legacy/keyless calls
   with a forward correction and tests; a mandatory-key redesign needs explicit
   approval and legacy transition. Do not call rewritten keyed fixtures proof
   of compatibility or silently edit already-applied SQL.
3. Keep actual integrated security/size/tombstone/DB-clock/service-signing fixes.
   Authedge's confirmed-status UI fix must preserve server-returned
   inactive/active/invited status and fresh-props precedence, not timeout masking.
   It also resolves the old auth-access deleted action and library/gaps Continue
   helpers; do not report those as still absent.
4. Adapt remaining journey/world, real-email, visual/upload/security-header
   browser helpers for scanner-safe GET + Continue POST. Privacy runtime still
   uses the deleted portfolio action and GET-cookie assumption. Preserve real
   role/leak/cache/scanner assertions.
5. Keep `be3ba67`'s actual CI workdir/Auth-URL/project-name/root-project fixes,
   shared Firefox app-data helper and removed portfolio expected failure.
   Remaining gates: integration DB/JWT forwarding, production privacy inputs,
   Linux HEIC generation, explicit independent visual execution/discovery,
   hidden visual/upload fixture retries and required-engine coverage.
6. Fix migration drill's omitted actual size and direct Storage grant
   assumptions; rerun all phases and restore on the six-migration final tree
   with app-path byte hashes and trigger/RPC preservation.
7. Run real combined-head checks. Branch-reported journey/visual/auth passes do
   not certify this tree. Visual Firefox is blocked and WebKit has one narrow
   Base UI axe exemption, not an unqualified full-browser/zero-serious pass.
   Profile-Origin protection is now integrated; require its prior failing case
   to pass in the final run. No final combined-head result is available here.
8. Reconcile ~170-second overload finalise versus 2-minute takeover. Keep local
   load results scoped to macOS/contention. Cleanup scheduling, hosted trigger
   permission/restore, Linux packaging, owner inputs and real devices/email/
   deployment remain release gates. See the plan for concrete evidence.

## Validation and safety

- Earlier own-tree commands actually passed: frozen install on pnpm 10.30.1,
  `pnpm typecheck`, `pnpm lint`, `pnpm test` (12 files / 102 tests), `pnpm build`.
  Inputs remain unchanged, so these were not rerun for docs-only sweeps.
- No tests on hypothetical merges are claimed. Only Git object checks and
  documentation/scope validation ran in this final sweep.
- Scratch computations never changed application files, the index or branch
  refs. Own staging/commit uses only the two owned docs. No other worktree,
  remote/push/PR/deploy, `.env*` read or stack start/reset/reuse/stop.
- Reports: `/tmp/nabalens-merge-precheck-snapshot-{2,3,4,5}.json`,
  `/tmp/nabalens-merge-precheck-cumulative-{2,3,4,5}.json`,
  `/tmp/nabalens-merge-precheck-resolved-{3,4,5}.json`,
  `/tmp/nabalens-merge-precheck-secfix-{4,5}.json`, initial snapshot and baseline
  `/tmp/nabalens-mergeplan-{typecheck,lint,test,build}.log`. Portable results and
  final pinned refs are in the plan.

## Schedule stop

- Exact task ID:
  `scheduled-task:command:mcp:b3a0e250-3655-403d-ac2d-9fef67a814e6:schedule-task:nabalens-merge-precheck-20261030`
- Existing cadence was 1,200,000 ms; this was not the first scheduled run and
  the interval/prompt/binding were not reset.
- **Pause confirmed:** the exact task returned `enabled: false`,
  `nextRunAt: null`, and interval `everyMs: 1200000`. No further tick is due.
  Final snapshot and remaining active refs are recorded above. No schedule
  listing/polling, sleep or wait loop was used.
