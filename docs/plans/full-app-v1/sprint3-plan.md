# Full App v1: Sprint 3 plan (review, acceptance and repair)

Sprint 2 (ten tasks: eight screen tasks, S2-INT and S2-FIX) is merged into `feat/full-app-v1`. Every one of the 50 Full App migrations applies in order on a fresh stack. Reports are in [reports/](reports/). The coordinator fixed two merge defects: S2-ADMIN's duplicate reviewer table (admin screens now use S2-MGR's `venue_reviewer_assignments`) and S2-LIBRARY's copy of `export_candidate_rows`, which would have undone S2-INT's review-level rule.

Sprint 3 has three parts. Reviews and acceptance journeys run in parallel on the merged head. Then **one repair pass** takes every confirmed finding, every acceptance failure and the known items below.

## Part 1: release reviews (coordinator workflow, read-only)

| ID       | Scope                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| S3-REV-A | Database and security: every Full App function, RLS and grant, AC12 to AC14, AC36, AC40, migration safety on existing data |
| S3-REV-B | Staff experience: upload and labelling ease (AC01 to AC11, spec §5, §6, §15), wording, 320 px layouts                      |
| S3-REV-C | Manager and admin (AC15 to AC35, AC39), docs and decisions                                                                 |
| S3-REV-D | Cross-task consistency: one rule per concept (coverage, unlabelled, reviewer, visibility, words), dead or duplicate code   |

Each finding is checked by an independent verifier told to refute it. Confirmed findings are written to `reviews/S3-release-review.md`.

## Part 2: acceptance journeys (T3)

| ID       | Account | Scope                                                                                                                                                                           |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3-E2E-1 | team-01 | Staff and access: AC01 to AC14, AC34, AC36, AC37 (staff flows), AC40; and keep the existing staff, upload, album, community and auth specs passing on the new behaviour         |
| S3-E2E-2 | team-02 | Manager and admin: AC15 to AC33, AC35, AC37 (review flows), AC39; and keep the existing manager, review, menus, amenities, library and admin specs passing on the new behaviour |

AC38 (restore from backup) is covered by the existing restore drill (`docs/backup-restore.md`); a hosted rehearsal needs the owner. ACs that the decisions defer (AC04 AI, AC20 edited versions, AC22 multi-menu, AC33 integrated withdrawal) get a spec that pins today's documented behaviour, or a written reason.

Each journey runs on phone (390 × 844 and 320 px where layout matters) and desktop (1280 × 800) projects as the existing config allows.

## Part 3: repair pass (T3, after parts 1 and 2)

Findings are grouped by area so that no two repair workers touch the same files. Each fix gets a regression test. The coordinator then re-runs the full checks on the repaired head.

## Known items for the repair pass

Found while merging Sprint 2. Each needs one owner in the repair pass.

| ID  | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | **One unlabelled rule.** Four counts exist: S2-REVIEW's Needs label queue (food or drink tag, no dish), S2-ADD's `label_help_queue` (I'm not sure, Match later over 7 days), S2-MGR's `private.venue_unlabelled_photos` and S2-ADMIN's `private.asset_unlabelled`, plus S2-LIBRARY's `labels=unlabelled` filter. FA-4 needs I'm not sure and 7-day Match later photos in the manager's main queue. Make one rule and have every count and list read it. |
| K2  | **R10, app side.** `lib/server/media/finalise.ts` (lines around 437 to 442, `managerUploadEnded`) still checks the active venue; S2-INT moved the database rule to "holds a role at the upload's venue".                                                                                                                                                                                                                                                |
| K3  | **Slot change reports** (S2-STAFF `listVenueSlotReports`, `decideSlotReport`) have no manager screen. Show them in Review or Venue › To confirm.                                                                                                                                                                                                                                                                                                        |
| K4  | **Label corrected** never shows on staff Me: `my_uploads` cannot see S2-REVIEW's Fix label records.                                                                                                                                                                                                                                                                                                                                                     |
| K5  | **Instrumentation gaps** (S2-METRICS): the I'm not sure event (`trackFlow` in S2-ADD's flow) and the request route are not sent.                                                                                                                                                                                                                                                                                                                        |
| K6  | **FA-9 single-reviewer venue** is not built: an admin venue setting, and the decision functions allowing a manager's own photo there, listed for admin spot checks.                                                                                                                                                                                                                                                                                     |
| K7  | **Admin landing.** Sign-in still lands admins on `/admin` (Library); spec §8 puts Overview first. Recommended: land on `/admin/overview` and update the e2e journeys that assert `/admin`.                                                                                                                                                                                                                                                              |
| K8  | **Reviewer eligibility.** S2-MGR's model nominates managers only; S2-ADMIN's venue screen may offer admins as candidates. Align the admin screen's candidate list and its error copy (`reviewer_not_eligible`).                                                                                                                                                                                                                                         |
| K9  | **Checklist results** are empty for S1-COV, S1-MENUS, S1-FACTS, S1-EXPORT and S1-OPS (their reports hold the results). Fill them, and the S3 section, from the reports and Sprint 3 evidence.                                                                                                                                                                                                                                                           |
| K10 | **Decisions to record** in `decisions.md`: a copy of an accepted photo never covers any slot (S2-INT); reference photos may appear in internal packages, never public (S2-INT); amenity catalogue version 2 (S2-INT); "Your photos" for My uploads (S2-STAFF); admin nav short labels and More (S2-ADMIN); Requests shown to staff as "Asked for" (S2-REQ).                                                                                             |
| K11 | **Media type filter** in Review (S2-REVIEW partial) and the **suspend** action that makes a slot count as empty again (M3-suspend; S2-LIBRARY's withdraw keeps coverage).                                                                                                                                                                                                                                                                               |
