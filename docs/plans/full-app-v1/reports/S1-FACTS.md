# S1-FACTS worker report

Final report from the T3 worker, kept verbatim as the hand-off record (branch `fa/s1-facts`, merged into `feat/full-app-v1`).

S1-FACTS is built on branch `fa/s1-facts`: 5 commits, one migration (`20261118104000_facts_freshness.sql`), nothing pushed. Of the 20 checklist items, 12 are built and 8 partly built; none is left unbuilt, but three need an owner or coordinator decision. Two changes will hit live data the day the migration goes out (see "Behaviour changes on release").

## Checklist status

| ID                                                     | Result                | Notes                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S9.3-90-day-reminders                                  | Built                 | Seeded 90-day rules (14-day warning before due) for facts and space photos. Changing a duration means adding a new version of the rule. Added the hourly job route `/api/internal/knowledge-rechecks` and its cron.                                                                                                                                                                 |
| S10-fact-verification, S10-fact-verification-states    | Built                 | One SQL mapping and a matching TypeScript one give the five states (Unconfirmed, Confirmed, Check due, Superseded, Withdrawn), separate from the answer value. Superseded only applies to older answers in history.                                                                                                                                                                 |
| S9.3-reconfirm-without-reshoot, M5-confirm-facts, AC30 | Built                 | `knowledge_reconfirm` ("Still right") restores Confirmed without a new finding or photo, closes open rechecks and raises the slot revision. A manager can set an earlier next check, never a later one. For spaces, `area_photo_reconfirm` does the same for a place.                                                                                                               |
| S2-check-vs-replace                                    | Built                 | Space photos read Current, Check due, Needs replacing or Expired. Staff can report a change (Check due); only a manager can mark a known change (Needs replacing).                                                                                                                                                                                                                  |
| S18-fact-coverage                                      | Built                 | `knowledge_fact_coverage` gives numerator and denominator by catalogue group. Confirmed No and Limited answers count; a confirmed Not applicable leaves both totals.                                                                                                                                                                                                                |
| S14.3-structured-answer                                | Built (data contract) | `knowledge_guest_answers`, service role only. Only a currently confirmed fact carries a value; an overdue one never turns into a No. I did not change the existing reader HTTP route; the spec doesn't need a guest-answer feature in R1.                                                                                                                                           |
| S9.2-source-types                                      | Built                 | Derived, no new column: operating policy, business record, manager inspection, staff check (confirmed or not).                                                                                                                                                                                                                                                                      |
| AC25, S9.2-wifi-actual-provision                       | Built                 | Wi-Fi rule version 2: a venue manager confirms, so a staff Yes with photo, video and test notes stays Unconfirmed.                                                                                                                                                                                                                                                                  |
| S9.2-garden-open-state                                 | Built                 | `outdoor_seating` moves to the facility form, so seasonal or temporarily-unavailable-until-a-date is recorded. Existing answers carry over unchanged.                                                                                                                                                                                                                               |
| S9.3-review-due-excluded-numerator                     | Partly                | Excluded from fact coverage and from guest answers. Album's `amenityState` is in S1-COV's file and needs their Check due state, so I left it to them (see below).                                                                                                                                                                                                                   |
| S9.3-change-triggered                                  | Partly                | Space change reports are built; reported fact changes already read as disputed, which maps to Check due. Telling a menu rename from new plating belongs to S1-MENUS / S1-COV.                                                                                                                                                                                                       |
| S9.3-explicit-expiry                                   | Partly                | End dates for space photos (`area_photo_set_end_date`). Menu photo end dates belong to S1-MENUS.                                                                                                                                                                                                                                                                                    |
| S9.2-structured-fact-record                            | Partly                | Fact states return answer, conditions, verified date, source and next check. Moving dogs and step-free to their detailed forms is not done: those are open owner decisions (OD-11, OD-12, OD-14), and step-free is a pilot question used throughout the existing tests.                                                                                                             |
| S9.2-dogs-policy, S9.2-step-free-entrance              | Partly                | Same reason. Dog answers already need a manager's confirmation.                                                                                                                                                                                                                                                                                                                     |
| S4.2-policy-fact                                       | Partly                | The fact is confirmed separately from any photo. **Needs a coordinator decision:** a policy Yes (dogs, Wi-Fi) still has to include a photo, because the evidence rule sits in the amenity catalogue. Making media optional (binding decision FA-32) needs catalogue version 2, which raises every slot's revision and touches the amenities screens. I didn't take that on unasked. |

## Migration

- `20261118104000_facts_freshness.sql`, in my range. It applied cleanly through `supabase db reset` on my isolated stack (58521/58522), and the stack is stopped with `--no-backup`.
- New tables, both append-only with RLS on and no client access: `knowledge_fact_checks` and `area_photo_checks`.
- Recreated with the same signatures: `private.knowledge_slot_freshness` and `public.knowledge_freshness_preview`.
- Widened two checks: rules gain the basis `verified_on`; history events gain `fact_reconfirmed`.

**Assumption to review:** a fact's check date counts from the latest of the day it was checked, confirmed, saved or reconfirmed. Most questions don't record "Checked on", and the old counting rule would have made every answer read as missing its date.

## Behaviour changes on release

1. Existing answers last verified more than 90 days ago will read Check due straight away. That is the spec's intent, and "Still right" clears each in one tap. The owner can see the count first with the admin preview (`knowledge_freshness_preview`) before running the hosted migration.
2. Existing staff Wi-Fi answers with no manager confirmation will read Unconfirmed.

## Files changed

- **Mine:** the migration, `lib/knowledge/facts.ts` (new), `lib/knowledge/contract.ts`, `lib/server/knowledge/facts.ts` (new), `index.ts`, `errors.ts`, `app/_knowledge/actions.ts`, `lib/db/types.ts` (only my additions).
- **Tests:** `tests/security/facts-freshness.test.ts` (new) and `tests/unit/knowledge-facts.test.ts` (new).
- **Outside my ownership, kept small:**
  - `app/api/internal/knowledge-rechecks/route.ts` (new) and one cron line in `vercel.json`.
  - `components/nabalens/knowledge/copy.ts`: wording for the new check-date basis.
  - `tests/unit/scope-guard.test.ts`: allow the new route.
  - Existing knowledge suites, `tests/security/album-slot-photos.test.ts` and `knowledge-fixtures.ts`: they assumed question version 1, no check dates and staff Wi-Fi answers going live without confirmation. Detail fixtures now record the latest question version, and I added a `confirmWaiting` helper.

## Checks

- `pnpm typecheck`: passes.
- `pnpm exec eslint . --ignore-pattern '.claude/**'`: no output, exit 0.
- Prettier `--check` on changed files: all pass. I skipped the SQL file (no parser) and `vercel.json`, which isn't Prettier-formatted on main either; I kept its existing style.
- `pnpm test`: 361 files, 4583 tests passed.
- Security suites on a fresh reset:
  - facts plus all `knowledge-*` suites: 30 files, 376 passed;
  - area, album, amenities, asset-search-answers and coverage: 13 files, 180 passed;
  - `asset-search.test.ts` on its own: 35 passed.
- **One open item:** one asset-search test ("reads no evidence or group rows for another venue's check") failed when it ran after about 550 other tests had filled the database. It passes on a fresh database with my migration, and the base commit also passes fresh, so it looks sensitive to database contents rather than caused by this change. Your full run will settle it.

## For Sprint 2 workers

- **Server functions** (`@/lib/server/knowledge`): `getFactStates`, `getFactCoverage`, `reconfirmFact`, `listSpacePhotoFreshness`, `reconfirmSpace`, `reportSpaceChange`, `setSpacePhotoEndDate`, `readGuestAnswers`.
- **Actions** (`app/_knowledge/actions.ts`): `factStatesAction`, `factCoverageAction`, `reconfirmFactAction`, `spacePhotoFreshnessAction`, `reconfirmSpaceAction`, `reportSpaceChangeAction`, `setSpacePhotoEndDateAction`.
- **Types and helpers** (`@/lib/knowledge/facts`): `FactVerificationState` with its labels, `factVerificationState(status, reason, detail)`, `FactStateView`, `FactCoverageView`, `GuestAnswer`, `FactSourceType` with its labels, `SpacePhotoState`, `spacePhotoCounts`, `coverageWords(n, d)` ("5 of 6" plus a percentage, per FA-8).
- **For S1-COV:** have the coverage function read `private.area_photo_freshness(label_id)` for space photo state. In `amenityState`, a complete check whose answer isn't available should become Check due and not count as filled. Use `factVerificationState` on `answerInUse`.
- **For S2-REQ:** a fact-confirmation request can treat a "confirmed" fact state, or a `knowledge_reconfirm` result, as done.
- **For S2-MGR / S2-ADMIN / S2-METRICS:** use `knowledge_fact_coverage` per venue for "n of N". "Facts awaiting confirmation" are the items reading Unconfirmed or Check due.
- **Error codes:** new `knowledge_reconfirm_not_allowed` (409) and `area_photo_not_found` (404).
