# S4-DOCS: release documentation

Branch `fa/s4-docs`, based on `d4b5ccf49` (Sprint 3 repaired and verified checkpoint). Docs only: no code, test or migration changed. Nothing pushed; no PR, deploy, hosted migration, `lci` or `verify:release`. The owner was asleep, so every choice took the recommended option; choices are listed below.

## What changed

| Task                    | Commit      | Files                                                                                                            |
| ----------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| 1 Spec reconciliation   | `54210d098` | `docs/plans/full-app-v1/checklist.md`                                                                            |
| 2 One set of guides     | `82c7de917` | `docs/usage-staff.md`, `usage-manager.md`, `usage-admin.md`, `docs/release-checklist.md`; `docs/guides/` deleted |
| 3 DESIGN.md, departures | `a8281d27f` | `docs/design-system/DESIGN.md` (1.5), `docs/design-system/departures.md`                                         |
| 4 Release notes         | `4deadc375` | `docs/release/full-app-v1-release-notes.md`                                                                      |

### 1. Checklist

Every one of the 493 rows has a final result with its proof (report, e2e spec, test or decision). The summary at the top has counts, AC01 to AC40 with their e2e specs, the deferred items with their decisions, and the 58 repair-pass items (V1-V25, K1-K11, D1-D4, E1-E9, W1-W9) with their final state.

| Final result | Rows |
| ------------ | ---- |
| built        | 409  |
| partial      | 37   |
| deferred     | 30   |
| owner action | 13   |
| not built    | 4    |

- All repair items are fixed except E3 (not a defect: a harness ordering problem; AC05 passed 9 of 9) and K8's database half (not a defect, S3-R5).
- **AC04** is built, not deferred: the app has no AI, so capture, search, labels and send always work without it; FA-44 defers the AI itself.
- **S11-collection** (listed under R2) is built: S2-LIBRARY built collections.
- **Not built, no decision covers them** (owner call: build next batch or add an FA decision deferring to R2): S4.2-packaged-drink-designation, A7-shot-templates, S15.3-pwa, S20-legacy-import.
- **Owner action** rows are the real-device, 4G and pilot measurements (§15.2, §15.3, §21), session expiry, AC38's hosted restore rehearsal and the OD-11/12/14 forms.
- Judgement calls (no report names the row): S9.2-imported-context-authority, S4.4-local-space-facility (partial); S4.4-states-reasons, S4.5-explicit-match, S4.3-transactional-activation, M3-suspend (built); AC37 and S15.1-touch-kbd-sr built with no recorded screen-reader run (points at the S15.3-real-devices owner action).

### 2. Usage guides

`docs/usage-*.md` are the one set. Each was rewritten to the Full App screens, folding in what was right in `docs/guides/` (S3-R7), and opens with a table keeping sent, approved, covered and published apart. Every bold UI phrase was grepped in `app/`, `components/`, `lib/` and `supabase/`: admin 205 and manager 216 phrases all found; staff 229 with 10 misses that are example values ("41 slots still empty"). Corrections where the old guides disagreed with the code include: staff tabs are Album, Add photos, Me; outcome words are FA-7's; the manager's Ask again reasons; the conflict message "Someone else decided this photo first"; admin nav is the seven sections plus More; "Activate for labelling" and "Schedule activation". The phrases `tests/journeys/menus-observations.spec.ts` (o3) and `scope-guard.test.ts` rely on are still true in the UI and kept. No live doc linked to `docs/guides/`; historical reports that mention it are records and were left. `docs/release-checklist.md` had one stale anchor (now `#your-month`).

### 3. DESIGN.md and departures

DESIGN.md 1.5, no section renumbered: §4 report words (`coverage_*`) and Withdrawn; §5a Full App rows (Unfinished photos, blocked notice, Asked for); new §5b Me (Your photos, Your month, Help and account, Notices, slot page); new §6a manager screens (navigation, Overview, Review, Requests, Metrics, Venue and Reported changes); new §6b admin screens (`ADMIN_NAV` and More, Overview, Venues, Library and Suspend from use, Publishing, People, Settings & activity); §7 manager and admin words; §10 `slot-ring-check`; §12 changelog.

Departures: owners filled for A-D3, A-D5, S3, C6, C9, C10, C11, C14, C18, N4. New rows A-REV-1 (manager review action names), A-REV-2 (single-reviewer venues), A-L1 (managers label I'm not sure photos), A-LIB-1 (Library approval words), A-CD1 (Check due shares a chip shape, open). Every repo path in DESIGN.md, catalogue.md, components.md and departures.md exists. `catalogue.md` needed no change.

### 4. Release notes

Plain-words changes per role, the migrations and the ones that change existing data (read from each header and its top-level statements: `100000`, `101000`, `102000`, `104000`, `109300`, `117000`, `121200`, `125000`, plus `107200` and `107000` which change access without changing rows), new cron routes, twelve ordered owner actions, known limits and deferred items.

**Migration count.** The brief and `progress.md` say 64 Full App migrations; the tree has **73** (`20261118100000` to `20261118129000`): Sprint 1 23, S2-FIX `108000`-`108600` 7, Sprint 2 20, Sprint 3 repair 23. The release notes say 73. `progress.md` was left as the checkpoint record; the coordinator may correct it.

## Code findings (not fixed; for the next batch)

None is a correctness defect; all are wording or navigation seams found while checking the docs against the code.

1. Admin Library opens a page headed "Content", People one headed "Staff"; the admin not-found page says "Go to Content".
2. The manager Album tab opens a page headed "Menu".
3. Review words differ: one-at-a-time review says Accept / Ask again, the photo detail says Approve for public use; a retake has four manager-facing spellings ("Asked for another", "Another photo asked for", "Another photo requested", "Asked for another photo"); waiting reads Waiting, Awaiting review or Waiting for review.
4. Album place filter says "Needs updating" while the tile says "Needs checking".
5. The Check due report chip borrows Menu changed's shape (departure A-CD1); "Withdrawn" has two chips with different icons.
6. The manager exports note says to record publication "on the Publishing page", which only admins can open (`app/admin/publishing/_components/copy.ts`).
7. Albums, all-venue Coverage, admin Metrics and the Knowledge pages have no nav item (reached by Overview links or address).
8. Me's "Add photos or videos" opens the older sheet, not Match.
9. A manager can switch venue only from Team.
10. A comment in `app/manager/requests/page.tsx` says Requests has no nav tab; it has one.
11. Gaps also in the checklist: no place-photo relabel in Fix label; no admin upload screen; an admin's original download is not recorded as an export.

## Checks

- `pnpm install --frozen-lockfile`: done (fresh worktree).
- `pnpm exec prettier --check` on every changed doc: "All matched files use Prettier code style!"
- `pnpm exec vitest run tests/unit/docs-references.test.ts tests/unit/design-citations.test.ts tests/unit/scope-guard.test.ts tests/unit/staff-copy-guard.test.ts`: Test Files 4 passed (4), Tests 30 passed (30).
- `pnpm test`: **Test Files 419 passed (419), Tests 5128 passed (5128)**, 60.7 s.
- The o3 usage-docs Playwright check (`tests/journeys/menus-observations.spec.ts`) was not run: its config builds and starts a Next server. The same nine `includes()` checks were run in Node and all hold.
- Skipped: typecheck and ESLint (no code changed), e2e and security suites (docs only; their last results on `b3f726411` are in `progress.md`), `verify:batch`/`verify:release`/`lci` (coordinator only).
