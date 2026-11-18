# Sprint 3 release review

A read-only review of the merged Full App v1 head (`9d2fba603`), run by the coordinator while the acceptance journeys ran. Nine finders, one per lens: database access, migration safety, server code, staff upload, staff screens, manager, admin, docs against code, cross-task consistency. Their findings were de-duplicated, then each was checked by an independent verifier told to refute it and to drop anything already listed as K1 to K11 in [../sprint3-plan.md](../sprint3-plan.md). 25 were confirmed; the severity below is the verifier's.

Every finding goes to the Sprint 3 repair pass.

| ID  | Lens          | Severity   | Finding                                                                                                                                                            | File                                                      |
| --- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| V1  | db-auth       | minor      | Managers can replace or clear the venue's main reviewer, which is an admin action                                                                                  | `20261118113000_venue_reviewers.sql:339`                  |
| V2  | db-auth       | should-fix | Manager venue History shows admin-only security events such as MFA resets and their reasons                                                                        | `20261118113200_venue_history.sql:37`                     |
| V3  | db-safety     | should-fix | R28 withdraw/accept race is still open for place and amenity photos: those accept paths never lock the asset row                                                   | `20261118100100_coverage_decisions.sql:323`               |
| V4  | db-safety     | should-fix | R19 check in area_photo_reconfirm anchors to the latest acceptance, not the accepted run, so a level change lets a backdated 'Still right' clear a reported change | `20261118108400_area_photo_reconfirm_after_report.sql:52` |
| V5  | server        | should-fix | Change slot removes the old slot before the new one is saved, so a refused move leaves the photo with no slot                                                      | `actions.ts:215`                                          |
| V6  | server        | minor      | Every auth failure is reported as 'Sign in again', including MFA-required and database outages                                                                     | `actions.ts:73`                                           |
| V7  | staff-upload  | should-fix | Matched photos still queued when the venue changes reserve at the new venue (AC11)                                                                                 | `add-host.tsx:1025`                                       |
| V8  | staff-upload  | should-fix | Label catalogue is never reloaded on venue change, so a re-matched dish is dropped while Match shows Waiting                                                       | `add-host.tsx:1536`                                       |
| V9  | staff-upload  | should-fix | Match later lists photos from other venues and offers only the current venue's slots, so they can never be matched                                                 | `match-later.ts:13`                                       |
| V10 | staff-screens | should-fix | Asked-for notice opens an amenity check page with a request id                                                                                                     | `notices.ts:23`                                           |
| V11 | staff-screens | should-fix | Accepted photo set to needs_recheck shows as Waiting and offers Withdraw/Change slot instead of Ask to remove                                                      | `20261118111000_my_uploads.sql:86`                        |
| V12 | staff-screens | should-fix | set_media_area_label lets the uploader remove or move an accepted area photo                                                                                       | `20261116170000_area_photos.sql:275`                      |
| V13 | staff-screens | should-fix | Change slot lists the current venue's slots for a photo sent to another venue                                                                                      | `my-uploads.tsx:382`                                      |
| V14 | staff-screens | should-fix | Slot page loses the reviewer's exact retake reason once the retaken photo is past the first 30 uploads                                                             | `page.tsx:46`                                             |
| V15 | manager       | blocking   | A dish approval can accept a photo that was already marked Not used or Duplicate                                                                                   | `20261107100400_manager_item_photo_writes.sql:145`        |
| V16 | manager       | should-fix | Batch Not used always returns a conflict for a photo that was ever restored                                                                                        | `inbox.ts:438`                                            |
| V17 | manager       | should-fix | "Used again" does not put a photo's place or amenity rows back in the queue                                                                                        | `20261118110000_review_inbox.sql:527`                     |
| V18 | admin         | should-fix | Overview 'Oldest photo waiting' / waiting count links to the legacy checklist queue, not the queues it counts                                                      | `overview.ts:258`                                         |
| V19 | admin         | should-fix | A restored venue-corrected photo goes back into public use at the wrong venue with its old approvals                                                               | `20261118116000_library.sql:605`                          |
| V20 | admin         | should-fix | Overview 'Checks due' double-counts facilities and links dish rechecks to the facilities page                                                                      | `20261118115100_admin_group_overview.sql:159`             |
| V21 | admin         | should-fix | Overview review-age attention ignores the admin's backlog alert setting                                                                                            | `overview.ts:309`                                         |
| V22 | docs          | should-fix | Venues that were inactive before the migration show as Open, Open does nothing for them, and Temporarily closed turns them back on                                 | `20261118115000_admin_venues.sql:418`                     |
| V23 | docs          | minor      | Checklist rows cite departure IDs that do not exist, and A2-reviewer-responsibility names the removed venue_reviewers table                                        | `checklist.md:291`                                        |
| V24 | docs          | minor      | Design-system docs point at component files that no longer exist                                                                                                   | `catalogue.md:250`                                        |
| V25 | consistency   | minor      | My uploads restates the outcome words that status-chip.tsx already defines                                                                                         | `my-uploads.ts:104`                                       |

## V1: Managers can replace or clear the venue's main reviewer, which is an admin action

Lens db-auth. Finder severity should-fix, verifier severity **minor**. AC/spec: Spec §7 M5 (managers nominate a backup reviewer only), §8 A2 (admin sets reviewer responsibility). `supabase/migrations/20261118113000_venue_reviewers.sql:339`.

**Scenario.** Manager M of venue A calls public.set_venue_reviewer(A, 'main', M, null) through the manager Venue screen action (lib/server/manager/venue.ts setVenueReviewer / app/manager/venue/actions.ts setReviewerAction, which accept role 'main'). The only gate is private.reviewer_scope_venue -> assert_can_manage_venue, so this succeeds. The admin-named main reviewer is ended as 'replaced' and M becomes main. Calling set_venue_reviewer(A, 'main', null) also clears the main role. This path skips admin_set_venue_reviewer's revision check and its 'venue_reviewer_set' activity record. Spec §7 M5 lets a manager nominate only a backup reviewer; reviewer responsibility belongs to the admin venue screen (§8 A2).

**Fix.** In set_venue_reviewer, when not private.is_active_admin(), refuse p_role = 'main' with not_permitted / 42501. Also refuse a manager's move of the current main into the backup role through the 'moved' branch, since that empties the main role. Only admin_set_venue_reviewer, which calls it on an aal2 admin session, may set or clear main. Restrict the manager screen's role options to 'backup'.

**Verifier.** The main path happens as described, but two of the claimed side effects are wrong and the harm is small.

What is confirmed:

- `public.set_venue_reviewer` (supabase/migrations/20261118113000_venue_reviewers.sql:339-391) is granted to `authenticated`. Its only gate is `private.reviewer_scope_venue` -> `assert_can_manage_venue` (lines 117-128). It accepts `p_role` 'main' or 'backup' with no admin check.
- So a manager of venue A can call `set_venue_reviewer(A,'main',M)`. The admin-named main reviewer's row ends as 'replaced' and M becomes main. `set_venue_reviewer(A,'main',null)` clears the main role. Nominating the current main as backup ends their main row as 'moved', so main is left empty.
- No later migration overrides this. `admin_set_venue_reviewer` (20261118115000_admin_venues.sql:446-494) only wraps it.
- The manager UI is built to offer both roles. lib/server/manager/venue.ts:107 accepts all `REVIEWER_ROLES`, and the component comment at components/nabalens/manager/venue/reviewers-form.tsx:20 says the manager nominates "a main and a backup reviewer".
- This goes beyond the spec. §7 M5 (spec line 380) gives managers only "nominate a backup reviewer". §8 A2 (line 394) puts "reviewer responsibility" on the admin venue screen.
- It is not one of K1-K11. K8 covers reviewer eligibility and admin candidates, not who may set main. decisions.md has no FA decision about it.

What is refuted or overstated:

- Activity is still recorded. `end_reviewer_assignment` and `open_reviewer_assignment` call `private.record_activity` (lines 185 and 205), so a manager's change appears in Activity and venue history. Only the extra admin-specific 'venue_reviewer_set' event is skipped.
- The admin's conflict check still works. `private.admin_venue_reviewer_revision` (admin_venues.sql:130-132) is computed from row counts in `venue_reviewer_assignments`, so a manager's change moves the revision. A stale admin form then gets `reviewer_conflict` and does not silently overwrite.
- The main reviewer role grants no permission. The table is read only by the overview, the setup checklist and the admin venue JSON. The nominee must already be a manager at the venue (`venue_reviewer_eligible`). So there is no privilege escalation, data loss or failed AC.

Why minor rather than should-fix: the plan's own checklist row M5-review-assignments (checklist.md:330) also says "Nominate a main and a backup reviewer", so this was planned. It is a spec-vs-plan mismatch with low impact, not a security hole.

Fix:

- In `set_venue_reviewer`, refuse `p_role='main'` with `not_permitted`/42501 when `not private.is_active_admin()`.
- Also refuse the case where a non-admin nominates the current main as backup.
- Limit `REVIEWER_ROLES` in the manager form and in lib/server/manager/venue.ts to 'backup', and show main as read-only.
- Correct checklist row M5-review-assignments to match the spec, or record a decision in decisions.md if managers are meant to set main.

## V2: Manager venue History shows admin-only security events such as MFA resets and their reasons

Lens db-auth. Finder severity minor, verifier severity **should-fix**. AC/spec: FA-23, spec §7 M5 History. `supabase/migrations/20261118113200_venue_history.sql:37`.

**Scenario.** An admin resets manager X's authenticator with public.admin_reset_mfa_authorise(X, 'lost phone, identity checked by call'). record_activity files 'mfa_reset' with that reason under X's active venue (20261118115000_admin_venues.sql around line 717). Another manager at that venue opens Venue > History. venue_history -> venue_history_rows reads every activity_events row for the venue through private.activity_rows(). That manager then sees the mfa_reset row with the actor, the target profile id and the admin's free-text reason. Before this change those rows were readable only through admin_activity, which requires is_active_admin.

**Fix.** In private.venue_history_rows, leave out account-security and personnel actions from the activity source for non-admin callers, for example `where r.venue_id = p_venue_id and (private.is_active_admin() or r.action not in ('mfa_reset', ...))`. Better still, keep an allow-list of venue-change actions that History is meant to show (spec §7 M5) instead of passing through every activity row.

**Verifier.** The claim holds on the current head. I traced the full path:

1. **The table was admin-only.** `public.activity_events` (20261118106000_ops_activity.sql:62-64) has RLS on, and every grant is revoked except service_role. Its comment says it is "Read through public.admin_activity", which raises `not_admin` unless `private.is_active_admin()`.

2. **The MFA reset writes a venue-scoped row with the reason.** `public.admin_reset_mfa_authorise` (20261118115000_admin_venues.sql:717) calls `private.record_activity(v_target.venue_id, 'mfa_reset', 'profile', p_profile_id::text, null, null, v_reason, ...)`. So the row carries the target's venue_id and the admin's free-text reason. The uncommitted diff in that file does not touch this function.

3. **History passes every activity row through.** `private.venue_history_rows` (20261118113200_venue_history.sql:35-38) selects every `private.activity_rows()` row with `r.venue_id = p_venue_id`. Nothing filters by action or by caller role.

4. **Managers can call it.** `public.venue_history` scopes the venue with `private.reviewer_scope_venue` (20261118113000_venue_reviewers.sql:117-130). That uses `coalesce(p_venue_id, private.my_manager_venue_id())` plus `assert_can_manage_venue`, so any manager of the target's venue gets those rows. It returns action, actorName (the admin), actorRole and reason. No later 20261118* migration redefines venue_history_rows or venue_history.

5. **The UI shows it.** `lib/server/manager/venue.ts` calls the `venue_history` RPC. `parseVenueHistory` (lib/manager/venue.ts:147-172) keeps every item. `historyActionWords` turns unknown actions into words, so the row reads "Mfa reset". `venue-history-list.tsx` then prints the time, "by <admin name>" and the quoted reason. The target profile id is in the payload but is not displayed.

**Intended or not.** S2-MGR's ACTION_WORDS deliberately lists personnel rows (account_deactivated, account_role_changed, ...), so showing those is a design choice. mfa_reset was added later by S2-ADMIN (115000) and is not in that list. The spec (§3.2 and §7 M5) and FA-23 never say MFA resets belong in a manager's venue history. The item is not among K1-K11 and is not in the S1 review fixes.

**Severity.** should-fix, not blocking. The leak stays inside the organisation, reaching managers of the same venue, and does not expose credentials or factors. It does expose an admin-only account-security event and its free-text reason, which can hold personal or identity-check details.

**Fix.** In `private.venue_history_rows`, filter the activity source to an allow-list of venue-change actions, or at least add `and r.action <> 'mfa_reset'` unless `private.is_active_admin()`. Add a manager-venue security test asserting that an mfa_reset row is absent for a manager caller.

## V3: R28 withdraw/accept race is still open for place and amenity photos: those accept paths never lock the asset row

Lens db-safety. Finder severity should-fix, verifier severity **should-fix**. AC/spec: FA-21 (accepted originals are kept); AC33. `supabase/migrations/20261118100100_coverage_decisions.sql:323`.

**Scenario.** The R28 fix (20261118108600:203) makes delete_media_asset take `for update` on the media_assets row before it calls private.asset_is_accepted. Its comment assumes 'every acceptance path locks the asset row first'. That is true for dishes (review_menu_item_photo, set_menu_item_photo_level). It is false for the two newer decision stores. public.decide_area_photo_level locks only media_area_labels and reads media_assets with a plain SELECT (line 323). public.decide_amenity_photo locks only venue_amenity_checks (line 478) and reads the asset through private.amenity_photo_rows. The review_decide_* wrappers in 20261118110000 (lines 325, 370) lock the same label and check rows, not the asset. Race: a manager accepts a staff member's place photo (T1 inserts an area_photo_decisions 'accepted' row and has not committed). At the same moment the uploader withdraws it (T2). T2 is not blocked, because T1 holds no asset lock. T2 sees asset_is_accepted = false, sets deleted_at and commits. T1 commits. The reverse order also fails: T2 tombstones first, T1 reads the not-yet-committed asset row as live and inserts the acceptance. Either way an accepted original is removed by staff with no admin reason or impact snapshot. lib/server/lifecycle/remove-media.ts then deletes the stored files, and an accepted decision is left pointing at a deleted asset. The same applies to amenity photo decisions.

**Fix.** In decide_area_photo_level and decide_amenity_photo, after taking the label or check lock, run `select a.* into v_asset from public.media_assets a where a.id = <asset> for update` and re-check `deleted_at is null` and `upload_state = 'ready'` under that lock before inserting the decision. This matches the dish path and delete_media_asset. Do the same in set_slot_primary_photo, which only takes an advisory lock. Add a two-session test: concurrent decide_area_photo_level('accepted') and delete_media_asset on the same asset, where exactly one of them succeeds.

**Verifier.** The defect is real for place (area) photos. For amenity photos only part of it holds.

**Area photos: both race orders fail.**

- `public.decide_area_photo_level` (`supabase/migrations/20261118100100_coverage_decisions.sql`) locks only `media_area_labels ... for update` (line 319). It then reads the asset with a plain SELECT at line 323, with no `for update`.
- `public.review_decide_area_photo` (`supabase/migrations/20261118110000_review_inbox.sql:325`) also locks only the label row.
- `area_photo_decisions` (`supabase/migrations/20261116170000_area_photos.sql:79-91`) has no foreign key on `asset_id`. Its only FK is `(label_id, venue_id)` to `media_area_labels`. So inserting a decision does not even take a FOR KEY SHARE lock on the asset row.
- The R28 `delete_media_asset` (`supabase/migrations/20261118108600:203-246`) locks only the asset row. No trigger on `media_assets.deleted_at` touches `media_area_labels`. So nothing makes the two transactions wait for each other.
- Forward race: T1 (the manager) inserts an 'accepted' decision and has not committed. T2 (the uploader) takes the asset lock without waiting. `private.asset_is_accepted` (`supabase/migrations/20261118109400:27`) returns false, because T1's row is not committed. T2 tombstones the asset and logs 'withdrawn'. Then T1 commits. The result is an accepted area decision on a deleted asset, removed by staff with no admin reason or impact snapshot. This is the FA-21 failure that R28 was meant to close.
- Reverse race: T1 read the asset before T2 committed, so T1 inserts an acceptance on a tombstoned asset.
- The R28 write-up in `docs/plans/full-app-v1/reviews/S1-foundation-review.md:730` assumed that area photos lock the asset with `for update`. They never did: the original body at `supabase/migrations/20261116170000_area_photos.sql:433-438` is the same as the current one. So R28 rested on a false premise, and its fix is incomplete for this store.

**Amenity photos: only the reverse order fails.**

- `amenity_photo_decisions` has `amenity_photo_decisions_asset_fkey`, which references `media_assets (id, venue_id)` (`supabase/migrations/20261118100000_coverage_review_level.sql:156`). Inserting a decision therefore takes FOR KEY SHARE on the asset row, and that conflicts with `delete_media_asset`'s FOR UPDATE.
- So if T1 inserts the acceptance first, T2 waits, re-checks with a fresh snapshot and correctly refuses with `media_asset_retained`.
- Only the reverse order is open. T1 checks the asset through `private.amenity_photo_rows` with a plain read before T2 commits. T1's insert then waits for T2's lock and succeeds after T2 commits. That leaves an 'accepted' amenity decision pointing at a deleted asset: an inconsistency, not a staff deletion of an accepted original.

**Other checks**

- This is not one of K1-K11 in `docs/plans/full-app-v1/sprint3-plan.md`. No later migration redefines either function.

**Severity: should-fix**, the same grading R28 had. The window needs a manager and the uploader acting on the same place photo within milliseconds of each other, so it is not blocking.

**Fix**

- In `decide_area_photo_level` (and in `decide_amenity_photo` for the reverse order), after taking the label or check lock, run `select a.* into v_asset from public.media_assets a where a.id = v_label.asset_id for update`. Then re-check `deleted_at is null` and `upload_state = 'ready'` under that lock before inserting. This matches the dish path (`supabase/migrations/20261118100100_coverage_decisions.sql:226`).
- Correct the "every acceptance path locks the asset row first" comment in `supabase/migrations/20261118108600`.
- Add a two-session test where exactly one of `decide_area_photo_level('accepted')` and `delete_media_asset` succeeds.

## V4: R19 check in area_photo_reconfirm anchors to the latest acceptance, not the accepted run, so a level change lets a backdated 'Still right' clear a reported change

Lens db-safety. Finder severity minor, verifier severity **should-fix**. AC/spec: spec §9.3 (place photo freshness); review R17/R19. `supabase/migrations/20261118108400_area_photo_reconfirm_after_report.sql:52`.

**Scenario.** 20261118109000 (R17) changed private.area_photo_freshness to count checks from the start of the photo's current accepted run, because a review-level change (reference to public, or public to reference) inserts a new 'accepted' area_photo_decisions row. area_photo_reconfirm's R19 guard (108400 lines 48-54), however, only looks at change reports made after `max(d.decided_at) where action = 'accepted'`, which is the latest acceptance. Example: a photo is accepted as public on day 1. Staff report a change on day 10, and freshness reads check_due. On day 11 the manager changes its level to reference and back to public, which adds two accepted rows; freshness still reads check_due because the run start is unchanged. On day 12 the manager uses 'Still right' with checked_on = day 5. The guard finds no report after the day-11 acceptance, so it allows the reconfirmation. area_photo_freshness then takes the newest check, the backdated 'reconfirmed' row, and the slot reads current. A reconfirmation dated before the report clears the report, which is the defect R19 was meant to stop.

**Fix.** Use the same run anchor as area_photo_freshness. For each label, take the first 'accepted' decision whose id is greater than the latest non-accepted decision, i.e. `min(d.decided_at) ... and d.id > coalesce((select max(x.id) ... where x.action <> 'accepted'), 0)`. Better still, factor that into one private helper and have both functions call it.

**Verifier.** The defect is real on the current head, and it is not one of K1-K11 (none of those mention area photo freshness, reconfirm, R17 or R19).

1. A level change adds a new 'accepted' row. `decide_area_photo_level` (supabase/migrations/20261118100100_coverage_decisions.sql:346-361) allows `v_current = 'accepted'` to `p_action = 'accepted'` with a different level and inserts a new area_photo_decisions row. No later migration redefines that function or area_photo_reconfirm. Only 100100, 104000 and 108400 define them. The app reaches it through lib/server/album.ts:666 `decideAreaPhoto`, which passes the level straight through.

2. Freshness anchors to the start of the run. The R17 body of `private.area_photo_freshness` (20261118109000_int_coverage_wiring.sql:483-488) sets v_start to the first acceptance after the latest non-accepted decision. Then:
   - v_last is the newest check by id among reconfirmed, change_reported and replacement_needed, counted from v_start.
   - v_basis is greatest(v_start day, max(checked_on) of reconfirmed).
     So a reconfirmed row inserted after a change report clears it, whatever its checked_on.

3. The R19 guard anchors to the latest acceptance. In 20261118108400_area_photo_reconfirm_after_report.sql:48-54 the guard only counts reports with `c.created_at >= (select max(d.decided_at) ... where d.action = 'accepted')`, which is the latest acceptance, not the start of the run. A report made before a level change is ignored.

4. Trace. Day 1: accepted as public. Day 10: change_reported, so freshness reads check_due. Day 11: level changed to reference. One change is enough, because a reference photo is still `state = 'accepted'` in area_photo_rows and so still in area_photo_accepted_labels. Day 12: area_photo_reconfirm with checked_on = day 5.
   - Range check: day 5 is within 30 days, so it passes.
   - Guard: v_reported is null, because no report is newer than the day-11 acceptance. The call is allowed.
   - Freshness: v_start = day 1, v_last = the new reconfirmed row, v_basis = day 5. The result is 'current', with verifiedOn set to a day before the report.
   - The server layer (lib/server/knowledge/facts.ts:156-178 `reconfirmSpace`) adds no guard of its own.
     This is exactly what R19 forbids.

5. The fix: in 108400 lines 52-54, compute the anchor the same way 109000 does. Take `min(d.decided_at)` over accepted decisions with `d.id > coalesce(max(id) of non-accepted decisions for the label, 0)`. Better, move that anchor into one private helper such as `private.area_photo_run_start(label_id, now)` and call it from both area_photo_freshness and area_photo_reconfirm.

Severity: should-fix, not blocking. It takes a manager's level change followed by a backdated 'Still right'. The result is wrong freshness, a stale place photo shown as current and possibly counted as public_ok for export. There is no security breach or data loss.

## V5: Change slot removes the old slot before the new one is saved, so a refused move leaves the photo with no slot

Lens server. Finder severity should-fix, verifier severity **should-fix**. AC/spec: AC15 / spec §6 S4 (Change slot on a waiting photo). `app/staff/_me/actions.ts:215`.

**Scenario.** A staff member moves a waiting photo from a place slot to a dish slot. clearArea() calls set_media_area_label(null) and that commits. Then saveLabels runs and is refused: a stale expectedRevision (the concurrent-change case the docstring names), catalogue_changed, unavailable_items, or no active catalogue so versionId is null. The action returns an error, but the area label is already gone and the photo now belongs to no slot. The dish-to-place move has the same problem the other way: saveLabels([]) clears the dish labels and any content types first, and only then does setAreaLabel run and possibly fail (for example the place was retired). On retry or reload, `check.upload.slots` is empty, so line 180 returns STILL_WAITING ('A manager has just checked this photo...'). That message is false: nobody reviewed the photo. The photo also drops out of its slot's Waiting state in Album and Review.

**Fix.** Make the move one database transaction: add an RPC such as move_media_slot(asset, expected_revision, target) that checks the revision and replaces the dish or area label atomically. Until then, check that the target is valid before clearing (run the catalogue and revision check first). On a second-step failure, restore the first step (re-apply the previous area subject or dish labels). Also stop answering STILL_WAITING when `slots` is empty: return a 'Match this photo again' message instead.

**Verifier.** The claim holds on the current head. It is not one of K1-K11; K3 is about slot reports, a different thing.

`changeUploadSlotAction` (app/staff/_me/actions.ts:151-226) makes two separate RPC calls with no transaction around them:

- Area to dish or shared (lines 215-219): `clearArea()` calls `setAreaLabel(actor, assetId, null)` and so `set_media_area_label`. In 20261116170000_area_photos.sql:275-283 that sets `removed_at` on the live area label and returns, and the RPC commits on its own. Only then does `saveLabels` call `save_media_labels`, through `private.save_media_labels_as` (latest version in 20261110090145).
- `save_media_labels` can still refuse at that point:
  - `label_conflict` when `p_expected_revision <> v_revision` (line ~134 of the function). The area RPC does not touch `media_labels.revision`, so this fires only when the labels were changed somewhere else, which is the stale case the docstring names.
  - `menu_catalogue_conflict` (~175).
  - `menu_item_unavailable` (~209), when the dish was retired after the page loaded.
- When it refuses, the action returns `refused(problem)`, but the area label is already removed. Nothing restores it.
- Dish to place (lines 220-224) has the same gap the other way. `saveLabels([])` commits the cleared dish labels and content types first. Then `setAreaLabel` can raise `area_unavailable` (the place was retired), `area_wrong_venue` or `area_photo_withdrawn`, and the dish labels are not put back.

After that, the next try reads `getMyUpload` → `my_uploads`, which now returns an upload with no slots. In `stillWaiting` (lines 120-126), `[].every(...)` is true, so the check passes. Line 180 then hits `!from` and returns `refused(STILL_WAITING)`, the text "A manager has just checked this photo...". That is false, because nobody reviewed the photo.

Severity: no bytes are lost and the photo still exists, so this is not blocking. But the staff member hits wrong behaviour: the photo silently loses its slot (it drops out of the Waiting state for that slot) and the message is misleading. The triggers (another tab, a manager's label fix, or a dish or place retired between page load and the move) are uncommon but real.

Fix:

1. Best: do the move in one SECURITY DEFINER RPC, e.g. `move_media_slot(asset, expected_revision, catalogue_version, target)`. It locks the asset, checks the revision, the catalogue and the target first, then swaps the area label and the dish labels in one transaction.
2. Short of that: before the first write, check the target is valid (an active catalogue with the item available, or the place not retired) and check the revision. If the second step still fails, re-apply the earlier area subject or dish labels.
3. Either way, when `slots` is empty, return a "Match this photo again" style message instead of STILL_WAITING.

## V6: Every auth failure is reported as 'Sign in again', including MFA-required and database outages

Lens server. Finder severity minor, verifier severity **minor**. `app/manager/requests/actions.ts:73`.

**Scenario.** getAmenityActor or getMediaActor returns status 503 when the profile read fails, or 403 with 'Enter the code from your authenticator app' when an admin is on an aal1 session. createRequestAction and the other request actions collapse every !auth.ok into SIGNED_OUT ('Sign in again.'), and admin/library/actions.ts (line 33) and admin/publishing/actions.ts (line 24) do the same. A signed-in manager hitting a short database outage is told to sign in again, which does not help. An admin who needs a second factor gets no MFA prompt. A deactivated account is told to sign in instead of being told it is inactive.

**Fix.** Pass the actor's own message through, as the other actions do (e.g. `return { ok: false, error: auth.message }`), or map 401 to 'Sign in again', 503 to 'Try again in a moment' and 403 to auth.message. Apply the same change in app/admin/library/actions.ts and app/admin/publishing/actions.ts.

**Verifier.** Confirmed on the current head. This is not one of K1-K11, and no decision makes it intended.

**Where the specific reason is lost**

- `getMediaActor` (lib/server/media/context.ts:46-89) tells the cases apart. A failed profile read returns PROFILE_UNAVAILABLE (status 503, "Could not check your account right now. Try again in a moment."). Signed out is 401. MFA required is 403 ("Enter the code from your authenticator app to continue."). An inactive account is 403 ("Your account is not active."). A wrong role is ROLE_NOT_ALLOWED.
- `getAmenityActor` (lib/server/amenities/context.ts:26-40) keeps those cases as codes (unauthenticated, not_permitted, account_inactive, unavailable) and returns a message for each.
- app/manager/requests/actions.ts replaces all of them with SIGNED_OUT ("Sign in again.") at lines 73, 167, 185, 207, 228 and 250.
- app/admin/library/actions.ts does the same: `admin()` at lines 28-31 returns null for any failure, and each action then returns "Sign in again to continue." (lines 57, 68, 80, 92, 106, 121, 134, 154).
- app/admin/publishing/actions.ts does the same: `actor()` at lines 26-29, then "Sign in again." at lines 46, 58, 81, 97, 114.

**Other actions already pass the message through.** app/admin/venues/actions.ts, app/admin/settings/actions.ts, app/admin/menus/actions.ts, app/manager/account/actions.ts, app/_media/removal-actions.ts, app/_labels/*.ts and app/admin/library-actions.ts:27 all return `auth.message`. removal-actions.ts:64 maps only 401 to its signed-out copy.

**Failure scenario:** a signed-in manager saves a request while the profiles read fails (database blip). `getAmenityActor` returns 'unavailable' with the retry message, but the user sees "Sign in again." That sends them to sign out, which does not help. The same happens to a manager deactivated mid-session (they should see "Your account is not active."). It also happens to a manager who POSTs a library or publishing action without the role.

**Weak part of the claim:** the MFA case is unlikely in normal use, because admin pages are gated before the actions can be reached. Even so, the wrong message for outages and inactive accounts is real.

**Why minor:** only the error wording is wrong. Nothing is written, so there is no security issue, data loss or failed acceptance criterion.

**Fix:**

- In requests/actions.ts, replace `return SIGNED_OUT` with `return { ok: false, error: auth.message }`. `failed()` is not a fit: it expects an ApiError and appends `nextAction`.
- In library/actions.ts and publishing/actions.ts, have `admin()` and `actor()` return the whole auth result. Each action then returns `{ ok: false, error: auth.message }` (library) or `{ ok: false, message: auth.message }` (publishing).
- Keep the "Sign in again" copy only for status 401, as removal-actions.ts:64 does.

## V7: Matched photos still queued when the venue changes reserve at the new venue (AC11)

Lens staff-upload. Finder severity blocking, verifier severity **should-fix**. AC/spec: AC11. `app/staff/_shell/add-host.tsx:1025`.

**Scenario.** A staff member with memberships at A and B picks 10 photos in Match at A and matches them quickly. The outbox hands them all to the queue (room is maxBatchFiles=20), but only maxParallelUploads=2 run at once, so about 8 sit in the queue as 'queued' with no reservation yet. The venue then switches to B (VenueSwitcher does router.push + router.refresh, and AddHost is not remounted). revalidateVenue only takes back files still in `outbox`. Its comment assumes everything handed to the queue 'was reserved for the old venue, where the server now refuses them', but that is not true for these files. When their turn comes, reserveUpload calls reserve_media_asset without p_venue_id (lib/server/media/reserve.ts:168), so the RPC uses private.uploadable_venue_id(), which is now B. So photos the person matched to venue A's dishes and areas are uploaded into venue B's library and review scope. Their A labels are then refused (stage_media_labels venue mismatch, or the area label is refused), and the photos sit at B as unlabelled or 'Sent' photos. Photos of venue A end up in venue B's manager queue.

**Fix.** Bind each matched file to the venue of its run. One way: send the run's venueId with the reservation (pass p_venue_id from reserveUpload; the RPC already raises wrong_venue for staff when it differs). The other: in revalidateVenue, also cancel or pull back queue items that are still 'queued' with no assetId, and undo their outcomes the same way as the outbox files. Add a unit test where the venue changes while there are more queued items than the concurrency limit.

**Verifier.** The claimed defect is real on the current head. I checked each step of the scenario against the code.

1. The upload queue reserves late. In components/nabalens/upload-queue.ts, add() and start() only mark items 'selected' and then 'queued'. pump() (about line 505) starts at most maxParallelUploads items (2, set in lib/config/media.ts:16). The uploader, and so reserveUpload, runs only inside run(). So a queued item has no reservation and no assetId until its turn comes. The outbox in add-host.tsx (lines 831-847) hands the queue up to `room` (maxBatchFiles=20) files at a time. With 10 matched photos, about 8 sit 'queued' with no reservation.

2. The reservation takes the venue at reserve time. lib/server/media/reserve.ts:168-176 calls reserve_media_asset without p_venue_id, and app/staff/actions.ts reserveUpload passes nothing either. In the final RPC body (20261118109200_int_memberships.sql, about line 248), a non-admin gets `v_venue := private.uploadable_venue_id()`, which reads profiles.venue_id. switch_active_venue rewrites that column. So any queued item reserved after a switch is created at venue B.

3. Nothing pulls queued items back. revalidateVenue (add-host.tsx:1025-1054) only drops files still in `outbox` (setOutbox filter, and `undone` is built from `outbox`). Items already handed to the queue keep their PickOwner, with the A dish preset or area, and stay queued. Its comment says those files 'were reserved for the old venue, where the server now refuses them (upload_access_ended)'. That is wrong twice: queued items are not reserved yet, and after the R10 fix media_upload_venue_allowed accepts any open membership, so even reserved A uploads finish at A.

4. The switch is reachable. AddHost sits in app/staff/layout.tsx and stays mounted across navigation and router.refresh, because venueId is only a prop. VenueSwitcher is on staff Me (components/nabalens/me/me-account.tsx:130) and on /staff. A switch from another tab changes the server-side venue at once, even before this tab's prop updates. The same-tab path is broader than claimed. If the person closes Match (matchRun becomes null), revalidateVenue does nothing at all, and the queued items still reserve at B.

5. The result is wrong. After reserve, saveArea calls setAreaLabelAction with A's area, and preset dish labels are staged for A's item. The S2-ADD report says 'The database refuses other-venue labels', and the new asset belongs to B. So venue A's photos end up in B's library and B's unlabelled/manager queue, with no A label and no prompt to match them again.

AC11 says 'All subject assignments revalidate', and that is not met for these photos. The other half, 'no foreign-venue labels survive', still holds because the database refuses the labels.

This is not one of the known items. K2 is about the finalise.ts active-venue check, the opposite direction, and none of K1-K11 covers it. It is not R10 either: R10 fixed in-flight reservations, not unreserved ones.

Severity is should-fix rather than blocking. It needs a venue switch during a batch with more queued files than the two that run at once. When it happens, the photos land at the wrong venue and lose their match without warning, which users will hit.

The fix:

- Bind each file to its venue by passing the run's venueId through reserveAsset as p_venue_id. The RPC already raises wrong_venue for non-admins, so these photos would fail visibly instead of moving to B.
- In revalidateVenue, cancel or pull back queue items that are 'queued' or 'selected' with no assetId, and undo their outcomes the same way as outbox files.
- Correct the stale comment.
- Add a test that switches venue while more items are queued than maxParallelUploads.

## V8: Label catalogue is never reloaded on venue change, so a re-matched dish is dropped while Match shows Waiting

Lens staff-upload. Finder severity should-fix, verifier severity **should-fix**. AC/spec: AC11, AC09/§5.6 honest receipts. `app/staff/_shell/add-host.tsx:1536`.

**Scenario.** labelContext (the menu catalogue, lines 399-424) loads once, when catalogueWanted first turns true. It is never reset when the venueId prop changes. revalidateVenue reloads the Match board, so after a switch from A to B the person re-matches the undone photos to B's dishes. labels.seed then checks onMenu(catalogue, preset) against A's stale catalogue. That returns false, so seed returns null (line 1536). upload-label-drafts treats null as 'no labels' and never asks again. The photo finalises with no label, so its receipt is 'ready'. handleReady (lines 1258-1261) maps every receipt except 'label_not_saved' to 'waiting'. Match and the Album tile show Waiting, and the end summary counts the slot as filled, but no label or review entry exists. The same false Waiting shows when the menu load failed (seed 'unavailable') and the upload finished before a retry got the menu. The upload sheet's label panel also keeps offering venue A's menu after the switch.

**Fix.** Clear labelContext and reload it (reloadCatalogue) when venueId changes, alongside the board reload in revalidateVenue. In handleReady, for a Match owner with a dish preset or content types, report 'waiting' only when the receipt is 'sent_for_review' (labels saved by finalise) or the later label save is confirmed. Otherwise report 'sent', so the summary never counts a slot it did not fill.

**Verifier.** The claim holds on the current head.

**The menu is loaded once.** In app/staff/_shell/add-host.tsx (lines 399-421), the menu (labelContext) loads in an effect that depends only on [catalogueWanted, catalogueAttempt]. setLabelContext(null) and a new attempt happen only in reloadCatalogue (lines 422-425), and that runs only from a manual Retry or retrySeed. No code path resets or reloads it when the venueId prop changes. catalogueWanted is set to true at lines 508 and 956 and never goes back to false.

**The menu belongs to whatever venue was active when it loaded.** GET /api/upload-labels (app/api/upload-labels/route.ts) calls getLabellingCatalogue(actor, actor.profile.venueId). That is the venue active at the time of the request.

**AddHost stays mounted across a switch.** The venue switcher (components/nabalens/venue-switcher.tsx:69-70) calls router.push(home) and then router.refresh(). For staff to staff, app/staff/layout.tsx re-renders the same AddHost with a new venueId. There is no key prop, so the component's state survives the switch. revalidateVenue (lines 1025-1053) resets the outbox, outcomes, recent slots and the board, but not labelContext.

**A re-matched dish gets no label.** A dish slot's only record is the label. sendMatched (lines 887-895) sets owner.preset to B's itemId and does nothing else for dishes; areas go through saveArea instead. seed (line 1536) runs `if (preset && !onMenu(catalogue, preset)) return null` against venue A's menu, so it returns null. upload-label-drafts.ts:557-560 records the id in seedAsked and never asks for it again.

**The photo then reads Waiting.** With no labels, uploadReceipt (lib/upload/states.ts) returns "ready". handleReady (lines 1258-1261) maps every receipt except label_not_saved to "waiting", so Match and the tile show Waiting for a slot that has no label or review entry.

**The same stale menu affects every later upload in that tab, not only Match.** Our menu presets for B's dishes are dropped the same way. The sheet's label panel keeps offering A's menu, and a manual save posts venueId A for an asset at venue B.

**Not a known or fixed item.** It is not among K1-K11 in sprint3-plan.md and not among the S1 review findings.

**What I did not confirm.** The second case (the menu load failed and the upload finished first) is weaker. A seed of "unavailable" is not added to seedAsked, and the failed load retries with backoff, so a label is normally saved later.

**Severity: should-fix.** The photo still uploads, and the server should refuse a cross-venue label save, so I found no data corruption. But the dish label is silently lost and the receipt is false (AC11 revalidation, §5.6).

**Fix.**

1. In revalidateVenue, or in an effect on [venueId] when catalogueWanted is true, call reloadCatalogue() so labelContext resets to null and venue B's menu loads. Optionally also clear seedAsked for rows that are still pending.
2. In handleReady, for a Match owner with a dish preset or content types, report "waiting" only when the receipt is "sent_for_review" or a later label save is confirmed. Otherwise report "sent".

## V9: Match later lists photos from other venues and offers only the current venue's slots, so they can never be matched

Lens staff-upload. Finder severity should-fix, verifier severity **should-fix**. AC/spec: AC02, AC11. `app/staff/_shell/match-later.ts:13`.

**Scenario.** listMatchLater reads listOwnMedia (lib/server/media/library.ts:369), which filters only by uploader_id, never by venue. A staff member who uploaded unlabelled photos at venue A and now has B active (venue memberships, a venue switch or a transfer) sees A's photos under Match later and in the 'N photos to match' count on Album. The picker offers B's board (loadMatchBoardAction uses the active venue). saveUploadLabels sends B's venueId, and stage_media_labels refuses because v_asset.venue_id <> p_venue_id; setAreaLabelAction is refused too. Every attempt shows 'This photo can no longer be matched here', and the photo stays in the list and the count with no way to clear it.

**Fix.** Filter Match later to photos whose venue_id is the active venue: add a venue filter to the listOwnMedia query, or expose venueId on MediaItemView and filter in waiting(). Alternatively, label each photo with its venue and load that venue's board. Either way, a photo is only offered slots from its own venue.

**Verifier.** The defect is real on the current head. A staff member who is staff at two venues and switches venue sees photos from the other venue under Match later, and none of the actions can clear them.

How it happens:

1. `app/staff/_shell/match-later.ts:13-41`: `listMatchLater` pages through `listOwnMedia` and filters only by ready, image and no labels. `lib/server/media/library.ts:369-392`: `listOwnMedia` filters by `uploader_id` alone. The RLS policy `media_assets_select_own` (`supabase/migrations/20261029120100_nabalens_access.sql:163`) also has no venue term, and no 20261118 migration changes it. So the list holds every venue's unlabelled photos by this person.
2. Venue switching exists and keeps the person staff. `public.switch_active_venue` (`supabase/migrations/20261118108100_activity_membership_fixes.sql:32`) calls `membership_switch_profile`, which sets `profiles.venue_id` and role to the new venue. `private.is_active_staff()` only checks `profiles.role = 'staff'`. Staff at A and B can therefore switch from A to B and still open `/staff/album/match-later`, where A's photos appear.
3. The count is affected too: `app/staff/tasks/page.tsx:163,232` builds `MatchLaterRow count={later?.length}` from the same list.
4. The board and save both use the active venue:
   - `loadMatchBoardAction` (`app/staff/_shell/match-actions.ts:22-47`) loads the album and catalogue for `profile.venueId`, which is B.
   - `MatchLaterScreen.labelTarget` (`components/nabalens/album/match/match-later.tsx:131-150`) takes `venueId` from `loadUploadLabelContext`, which is B's catalogue (`app/api/upload-labels/route.ts:39-44` uses `actor.profile.venueId`).
   - `saveUploadLabels(B)` calls `stageAssetLabels`, which calls `stage_media_labels`. Its only definition (`supabase/migrations/20261110090145_knowledge_b02c_manager_upload_and_labels.sql:789-842`) raises `media_asset_not_found` when `v_asset.venue_id <> p_venue_id`. That comes back as `not_found` (`lib/server/labels/index.ts:597-608`), and the screen shows `MATCH_LATER_COPY.refused`.
   - This applies to dish matches and to "Not for a slot" (`share`), since both go through `saveLabels`.
   - Area slots are B's subjects, and the area action rechecks the venue.
5. As a result, the photo stays in the list and in the count. It only leaves after A's manager labels it, or after the person switches back to A, and nothing on screen says so.

Not a known item: K1 is about unifying the unlabelled rule across counts, not about scoping Match later by venue. K2 is about finalise's active-venue check. No FA decision makes Match later cross-venue, and spec §3.1 says the active venue filters what the person sees.

Fix: scope Match later to the active venue. Either add `.eq("venue_id", actor.profile.venueId)` in a Match-later-specific query, or expose `venueId` on `MediaItemView` and require `item.venueId === actor.profile.venueId` in `waiting()`. That keeps the list, the count and the board on one venue.

Severity is should-fix, not blocking: it only affects people with more than one staff membership, it loses no data and opens no security hole, but those users will get stuck photos and a wrong count.

## V10: Asked-for notice opens an amenity check page with a request id

Lens staff-screens. Finder severity should-fix, verifier severity **should-fix**. `lib/staff/notices.ts:23`.

**Scenario.** A manager makes a media request (S2-REQ) and names a staff member. private.media_request_notify (20261118114000_media_requests.sql:292) sends an 'assigned' notice with subject_type 'media_request' and subject_id = the request id. Its payload has requestId/slotKind/slotId but no checkId. noticeHref then falls back to id(n.subjectId) and returns /staff/tasks/amenities/<requestId>. CaptureScreen looks up a venue_amenity_check with that id, so the 'Asked for: X' notice opens a not-found or error page and the person never reaches the slot they were asked to photograph.

**Fix.** In noticeHref, branch on n.subjectType === 'media_request' (or p.source === 'media_request') before the checkId fallback. Send slotKind 'dish'/'area' with slotId to /staff/album/slot/<kind>/<slotId>, 'amenity' to /staff/tasks/amenities/<slotId>, and anything else to the Album or Asked-for list (/staff/tasks). Only fall back to subjectId for subjectType 'venue_amenity_check'. Add a unit test for a media_request notice.

**Verifier.** The defect is real: an 'Asked for' notice opens the amenity page with a request id, so the staff member lands on a not-found page.

How it happens on the current head:

- supabase/migrations/20261118114000_media_requests.sql:292-296: private.media_request_notify calls private.notify(..., 'assigned', 'media_request', p_request.id::text, ...). The payload carries source, requestId, slotKind and slotId, and no checkId.
- lib/staff/notices.ts:22-24: the 'assigned' case runs `const check = id(p.checkId) ?? id(n.subjectId)`. p.checkId is missing and n.subjectId is the request UUID, so it passes the UUID test and the function returns `/staff/tasks/amenities/<requestId>`. Nothing checks subjectType or source first.
- lib/ops/notifications.ts:121-126 does handle subjectType 'media_request' and titles the notice "Asked for: <subject>". components/nabalens/me/notices-inbox.tsx:163 then links that row to noticeHref(n).
- app/staff/tasks/amenities/[checkId]/page.tsx passes the id to CaptureScreen. That screen looks up a venue_amenity_check and calls notFound() when the lookup returns 'not_found' (screen.tsx:328-332). A request id never matches an amenity check id.

So any manager request that names a staff member gives that person an "Asked for" notice that leads to a not-found page, never to the slot they were asked to photograph.

Ways I tried to refute it: the amenity notice (20261118106200_ops_notifications.sql:349) is the only producer that sets payload.checkId. No later 20261118* migration changes media_request_notify. The unit tests (tests/unit/staff-s2-models.test.ts:519-528) only cover checkId amenity notices. This is not one of K1-K11; K10 only records the "Asked for" wording.

Fix: in noticeHref's 'assigned' case, first check `n.subjectType === 'media_request'` (or `p.source === 'media_request'`) and route by slot:

- slotKind 'dish' or 'area' with a valid slotId goes to `/staff/album/slot/<kind>/<slotId>`.
- slotKind 'amenity' with a valid slotId goes to `/staff/tasks/amenities/<slotId>`.
- anything else goes to /staff/tasks.
  Use the subjectId fallback only when subjectType is 'amenity_check', and add a unit test for a media_request notice.

## V11: Accepted photo set to needs_recheck shows as Waiting and offers Withdraw/Change slot instead of Ask to remove

Lens staff-screens. Finder severity should-fix, verifier severity **should-fix**. `supabase/migrations/20261118111000_my_uploads.sql:86`.

**Scenario.** A staff photo is accepted for a dish. A menu change then moves its menu_item_photos row to 'needs_recheck'. my_uploads maps needs_recheck to 'awaiting_review', so uploadActions (lib/staff/my-uploads.ts:300-313) counts it as undecided: the row shows Withdraw and Change slot, and hides Ask to remove (accepted=false). Tapping Withdraw passes stillWaiting but delete_media_asset refuses it, because private.asset_is_accepted counts needs_recheck as accepted, so the user gets an error. Change slot passes stillWaiting and saveAssetLabels relabels an accepted photo while its old menu_item_photos row stays. The person cannot ask for removal of their accepted photo. This breaks the spec §6 S4 / FA-21 rule that withdraw applies only to unreviewed photos and removal is asked for accepted ones.

**Fix.** Have my_uploads report needs_recheck as its accepted level (coalesce(review_level,'public')) with a recheck flag, or as a new outcome such as 'check_due' that the UI counts as decided and accepted. Make stillWaiting in app/staff/_me/actions.ts refuse such photos as well. Add a lib/staff/my-uploads test: a needs_recheck slot gives withdraw=false, changeSlot=false, removal=true.

**Verifier.** I confirmed this on the current head, and it is not one of K1-K11.

1. **The read maps it to "Waiting".** `public.my_uploads` is defined only in `supabase/migrations/20261118111000_my_uploads.sql`; no later migration overrides it. In its dish branch, at line 86, `when 'needs_recheck' then 'awaiting_review'` applies to the latest `menu_item_photos` row of the tuple.

2. **The state is reachable.** Spec §6 S4 and the S1-MENUS report call it the "presentation_changed" recheck. `20261118103100_menu_local_offerings.sql:355-359` updates the existing accepted row in place to `state='needs_recheck'`, so that row becomes the latest one. It keeps `review_level='public'`. The pending-tuple branch excludes `is_recheck`, so the slot comes back once, as `awaiting_review`.

3. **The UI then offers the wrong actions.** In `lib/staff/my-uploads.ts:300-317` the `DECIDED` set and the `accepted` check (`public`/`reference` only) both miss this slot. The result is `decided=false` and `accepted=false`, which gives `withdraw=true`, `changeSlot=true` (for a ready dish image with one slot) and `removal=false`. The status also shows "Waiting" (line 248).

4. **What happens on each action.**
   - **Withdraw:** `stillWaiting` in `app/staff/_me/actions.ts:115-127` passes, because every slot is `awaiting_review`. `delete_media_asset` (`20261118108600:231`) then raises `media_asset_retained`, because `private.asset_is_accepted` (`20261118109400:37`, latest body) counts `needs_recheck` as accepted. No data is lost, but the user sees an error.
   - **Change slot:** `stillWaiting` passes. `save_media_labels`/`save_media_labels_as` (`20261107140000`) has no decided or accepted guard. The accepted photo is relabelled while its `needs_recheck` `menu_item_photos` row stays on the old dish. This breaks the spec §6 S4 rule ("change an unreviewed label") and FA-21.
   - **Ask to remove:** it is hidden, even though `request_media_removal` (`20261118107100:272`) would accept the request, because the asset counts as accepted. So the uploader cannot ask for removal of their own accepted photo from the UI, which goes against FA-21.

The manager-side `asset_usages` (`20261118100200:309`) uses the same mapping. That is harmless there, but the staff actions here act on it.

**Severity:** should-fix, not blocking. The database refuses the withdraw and the photo stays retained. The harm is wrong wording and actions, an error on Withdraw, and a relabel the spec does not allow.

**Fix:**

- In `my_uploads`, map `needs_recheck` to `coalesce(p.review_level,'public')` plus a recheck flag, or to a decided outcome such as `check_due`, and make `uploadActions` treat that as decided and accepted.
- In `app/staff/_me/actions.ts`, make `stillWaiting` refuse it.
- Add a test: a `needs_recheck` slot gives `withdraw=false`, `changeSlot=false`, `removal=true`.

## V12: set_media_area_label lets the uploader remove or move an accepted area photo

Lens staff-screens. Finder severity should-fix, verifier severity **should-fix**. `supabase/migrations/20261116170000_area_photos.sql:275`.

**Scenario.** Staff photo P is accepted for place 'Garden' (area_photo_decisions action 'accepted'). The uploader calls set_media_area_label(P, null) or (P, otherPlace). The RPC is granted to authenticated and callable from the browser, and changeUploadSlotAction (app/staff/_me/actions.ts:225) reaches it when a manager accepts between the stillWaiting read and the save. The function only refuses after a 'withdrawn' decision. It sets removed_at on the accepted label, and area_photo_rows / coverage then drop the accepted credit: the Garden slot goes back to Needed and the photo returns as pending under another place. A staff member can undo a manager's decision, against spec §6 S4 (only an unreviewed label may be changed) and FA-21.

**Fix.** In a new 20261118 migration, create or replace set_media_area_label so it raises (for example 'area_photo_decided', P0001) when the live label's latest area_photo_latest action is not null (accepted or needs_another_photo), unless the caller manages the venue. The asset row is already locked FOR UPDATE, so this closes the race with decide_area_photo. Map the new error in lib/server/area-photos areaFailure to the STILL_WAITING wording.

**Verifier.** The defect is real on the current head. set_media_area_label is defined only once, in supabase/migrations/20261116170000_area_photos.sql:206, and no 20261117 or 20261118 migration replaces it. Line 820 grants it to authenticated, so the uploader can call it straight from the browser with their own session.

What the function checks (lines 230-273): the caller must be the uploader, the asset must not be deleted or failed, it must be an image, and the place must belong to the venue and not be retired. The only check on a decision is the 'withdrawn' one at lines 264-273, and it only applies when a new place is chosen. Nothing reads private.area_photo_latest for 'accepted' or 'needs_another_photo'. So once a manager has accepted the photo, the uploader can still call (P, null) or (P, otherPlace). Line 275 then sets removed_at on the accepted label.

Nothing else blocks it. media_area_labels_guard (lines ~101-121) allows that one-time close. RLS does not matter because the function is security definer. area_photo_rows and the coverage readers in 20261118100200_coverage_slots.sql and 20261118109000_int_coverage_wiring.sql all filter on l.removed_at is null, so the accepted credit and the place coverage disappear. If a new place was chosen, the photo reappears as pending there.

The app-layer guard is not enough. stillWaiting in app/staff/_me/actions.ts:~115-127 is called before changeUploadSlotAction (around line 225) runs clearArea or setAreaLabel. It can be bypassed by calling the RPC directly, and a manager's accept can land between that read and the save. lib/server/area-photos.ts:setAreaLabel (line ~178) has no check of its own either.

This is not a deliberate decision for Full App v1. tests/security/area-photos.test.ts:690-717 ('removes the credit when the uploader removes or changes the area') does assert this behaviour, but it is the G-9 Goals-sprint model. Spec §6 S4 (line 290) now allows changing only an unreviewed label, and reviewed photos go through 'request correction'. FA-21 lets staff withdraw only unreviewed uploads, and accepted ones go through an admin removal request. The Full App code follows that rule elsewhere: withdrawUploadAction says delete_media_asset refuses an accepted photo, and changeUploadSlotAction's comment says the change is refused once a manager has decided. The area-label RPC is the one write path left on the old model. It is not one of K1-K11.

Why should-fix and not blocking: nothing is lost, because the labels and the area_photo_decisions history are append-only. The person who can do it is the uploader, on their own photo. The effect is that a manager's acceptance can be undone and coverage for the place goes back to Needed, against S4 and FA-21. No acceptance criterion fails outright.

Fix: add a 20261118 migration with create or replace public.set_media_area_label. Once the live label is locked FOR UPDATE, and before line 275, raise 'area_photo_decided' (P0001) when private.area_photo_latest(v_live.id).action is not null. The asset is already locked FOR UPDATE, which closes the race with decide_area_photo. If a manager-side override is wanted, allow the caller who manages the venue. Map 'area_photo_decided' to STILL_WAITING in areaFailure in lib/server/area-photos.ts. Update tests/security/area-photos.test.ts:690-717 to expect the refusal.

## V13: Change slot lists the current venue's slots for a photo sent to another venue

Lens staff-screens. Finder severity should-fix, verifier severity **should-fix**. `components/nabalens/me/my-uploads.tsx:382`.

**Scenario.** A person works at two pubs (FA-22) and has a waiting photo sent to pub A while pub B is active. My uploads shows 'Sent to A' with Change slot. The dialog's loadMatchBoardAction (app/staff/_shell/match-actions.ts:22-47) builds the board from loadAlbum and the labelling catalogue of profile.venueId, which is pub B. Picking a B dish or place makes changeUploadSlotAction save against the photo's venue A: save_media_labels raises menu_item_wrong_venue or set_media_area_label raises area_wrong_venue. The person sees an error and cannot change the slot from Me, and the picker shows slots the photo can never go to.

**Fix.** Pass the upload's venueId to loadBoard: loadMatchBoardAction(venueId) checks the caller has a membership there and loads that venue's album and catalogue. Or offer Change slot only when item.venueId === currentVenueId, with a hint to switch venue. Add a test where the upload venue differs from the active venue.

**Verifier.** The defect is real on the current head. The trace:

1. `my_uploads` (`supabase/migrations/20261118111000_my_uploads.sql`, around lines 30-70) returns the caller's own uploads from every venue on purpose. Each row carries the asset's own `venue_id`, so a person at two pubs (FA-22) sees uploads from both.

2. `uploadActions` in `lib/staff/my-uploads.ts:296-318` sets `changeSlot` from the upload state, media type, outcome and slot count only. It never compares `item.venueId` with the current venue. The card already knows the venues differ: `components/nabalens/me/my-uploads.tsx:542` prints "Sent to A" when `item.venueId !== currentVenueId`. The Change slot button at line 573 is still shown.

3. `ChangeSlotDialog` (`my-uploads.tsx:639-670`) calls `loadBoard()` with no arguments. `app/staff/page.tsx:327` wires that to `loadMatchBoardAction`. In `app/staff/_shell/match-actions.ts:22-47`, that action builds the board from `loadAlbum(auth.actor)`, which calls the current venue's RPCs such as `album_slot_photos({})` and `album_area_states({})`. It also uses `getLabellingCatalogue(actor, profile.venueId)`. Both belong to the active venue (B), not the photo's venue (A).

4. `changeUploadSlotAction` (`app/staff/_me/actions.ts:151` onward) saves against `check.upload.venueId` (A), using A's catalogue version. The schema ties labels to the asset's venue:
   - `media_label_items` uses the foreign key `(item_id, venue_id)`, which points at `menu_items` (`20261030120100_media_labels.sql:62`).
   - `media_area_labels` uses the foreign key `(subject_id, venue_id)`, which points at `knowledge_subjects` (`20261116170000_area_photos.sql:66`).
   - The label RPCs check this and raise `menu_item_wrong_venue` or `area_wrong_venue`.

   So picking any dish or place from B fails, and the picker never lists A's slots. For these photos, Change slot from Me can never succeed. The "shared" target may still work, since it saves no venue item.

The plans don't cover this. It is not in K1-K11 of sprint3-plan.md, there is no decision on it, and the S1 review doesn't mention it.

Severity is should-fix rather than blocking. No data is corrupted, because the database refuses the save. Only people who work at more than one venue are affected. They can still switch venue and use Change slot from Me.

Fix: give `loadMatchBoardAction` an optional `venueId`. When it is set, check that the caller has a membership at that venue, then load that venue's album and catalogue. `ChangeSlotDialog` would call `loadBoard(item.venueId)`. Alternatively, offer Change slot only when `item.venueId === currentVenueId`, with a hint to switch venue first. Either way, add a test where the upload's venue differs from the active venue.

## V14: Slot page loses the reviewer's exact retake reason once the retaken photo is past the first 30 uploads

Lens staff-screens. Finder severity minor, verifier severity **should-fix**. `app/staff/album/slot/[kind]/[slotId]/page.tsx:46`.

**Scenario.** A staff member sends 30 or more photos after the one a manager asked to be retaken (my_uploads p_limit defaults to 30). They tap the Retake notice, which opens /staff/album/slot/dish/<item>. ownPhotos only searches getMyUploads' first page, so retakeOf is undefined. The slot state is still 'retake', so the screen shows the generic 'Your manager asked for another photo.' instead of the reviewer's exact reason (AC17, spec §6 S4), and 'Your photos here' leaves the photo out.

**Fix.** Read the slot's own photos directly: add a p_slot filter (kind and slot id) to my_uploads, or use listMyRetakeNotes, which the Me page already loads, for the reason. Do not rely on the newest page.

**Verifier.** The defect is real, and nothing in the code guards against it.

**Why it happens**

- `app/staff/album/slot/[kind]/[slotId]/page.tsx:46` calls `getMyUploads(actor)` with no cursor. `lib/server/staff/index.ts:87-103` defaults the limit to 30.
- `public.my_uploads` (`supabase/migrations/20261118111000_my_uploads.sql:52`, lines 66-74) returns only the newest uploads, `order by a.created_at desc limit v_limit` (between 1 and 60). It has no filter by kind or slot, only `p_asset_id`. No later 20261118* migration redefines it.
- Lines 51-64 of the page then search that one page for the slot's photos. If the retaken photo is not among the newest 30, `retakeOf` is undefined.
- The slot can still be in state `retake`: for dishes this comes from `loadAlbum` → `myRetakeItems` → `listMyRetakeNotes`, which has no limit. So lines 81-86 pass `{ reason: null }`, and `components/nabalens/album/slot-screen.tsx:143` shows the generic "Your manager asked for another photo." instead of the reviewer's exact reason.
- `ownPhotos` also leaves out the photo that needs retaking.

**Not excluded**

- None of K1-K11 covers this. K4 is about Label corrected, which is a different issue.
- No decision or report documents the newest-page limit. Only the page's own comment mentions it, and that comment claims the reason matches Me, which fails in this case.

**Severity: should-fix, not blocking**

- AC17's reason still appears on the Home/Me retake notice, because `listMyRetakeNotes` returns the reason.
- Only the screen the retake opens loses it. This needs 30 or more newer uploads while the retake is still open, which is plausible when gallery batches are added at a busy venue.

**Fix**

- Take the reason from `listMyRetakeNotes`. It already runs inside `loadAlbum`, and it is unbounded. Use the open or set-aside note whose `dish.itemId` (or area `requirement`) matches this slot.
- Load the slot's own photos with a new `p_kind`/`p_slot_id` filter on `my_uploads` instead of the newest page.

## V15: A dish approval can accept a photo that was already marked Not used or Duplicate

Lens manager. Finder severity blocking, verifier severity **blocking**. AC/spec: AC18, AC21. `supabase/migrations/20261107100400_manager_item_photo_writes.sql:145`.

**Scenario.** Manager A opens photo X in Review and marks it Duplicate of an accepted photo, or Not used. This writes only a review_dispositions row and does not bump the dish's item-photo head revision. Manager B still has the older queue open, selects X, and runs batch Approve for public use or Keep as reference (decideBatch -> setDishLevel -> set_menu_item_photo_level -> review_menu_item_photo). B's itemRevision still matches the head, and review_menu_item_photo never calls private.asset_set_aside. X is accepted, may become primary, and counts toward coverage and contribution credit. A's newer decision is silently overridden and a marked duplicate inflates the coverage count. The detail screen hides the dish buttons for set-aside photos, but the batch path and a direct POST to setDishLevelAction do not.

**Fix.** In a new 20261118* migration, make public.review_menu_item_photo raise when the asset is set aside and the decision is 'accepted' or 'better_photo_requested', for example raise 'already_set_aside' (40001 / review_conflict with the disposition detail) after the asset row lock. That covers set_menu_item_photo_level and decide paths. Map it in lib/server/review/inbox.ts WORDS so the batch outcome reads as a conflict. Add a SQL test: set aside a photo, then call set_menu_item_photo_level with the current head and expect the refusal.

**Verifier.** Confirmed on the current head. Nothing in the database or the server stops a dish acceptance of a photo that has been set aside.

1. public.review_menu_item_photo was last defined in supabase/migrations/20261107100400_manager_item_photo_writes.sql:21-226. It locks the asset (around line 145) and checks scope, self-review, menu item, label, relink, eligibility and the item head revision. It never calls private.asset_set_aside and never reads review_dispositions. No 20261118* migration redefines it. 20261118100100_coverage_decisions.sql:219 only calls it, and 20261118110000_review_inbox.sql only redefines menu_photo_pending_tuples and menu_photo_stale_label.

2. public.set_menu_item_photo_level (20261118100100_coverage_decisions.sql:139-275) has no set-aside check either. A waiting tuple goes through review_menu_item_photo('accepted'). An accepted tuple only changes level.

3. public.review_set_aside (20261118110000_review_inbox.sql:405-532) inserts a review_dispositions row and Not used rows for waiting places and amenities. It never calls private.bump_item_photo_heads. So the menu_item_photo_heads revision held by manager B's stale queue still matches, and the coverage_conflict check passes.

4. The server layer adds no guard. In lib/server/review/inbox.ts, decideBatch (390-460) calls setDishLevel (325-340), which calls setMenuItemPhotoLevel in lib/server/album.ts:590-640. That function only validates its inputs and then calls the RPC. app/manager/review/actions.ts:63 setDishLevelAction is reachable directly. Only the detail payload uses asset_set_aside (review_inbox.sql:834-835, for needsLabel), which is a UI hint, not a guard.

5. The worker report docs/plans/full-app-v1/reports/S2-REVIEW.md:48 says set-aside photos are never accepted ("can never be accepted, so it earns no coverage or credit"), and the migration header (review_inbox.sql:7-13) says the same. That rule is enforced only by dropping the photo from the queues, not on the write path. This is not in K1-K11 or the S1 review.

Failure: manager A marks X as Duplicate (the latest disposition is 'duplicate'). Manager B's older queue still shows X with head revision N. B runs batch Approve for public use: set_menu_item_photo_level, then review_menu_item_photo, and the head is still N. X is inserted as accepted (and becomes primary if the dish had none), so it counts for coverage and contribution credit while its latest disposition still says duplicate. That breaks AC18 (B's stale decision silently overrides A's newer one) and AC21 (a marked duplicate inflates coverage).

Fix: in a new 20261118* migration, redefine review_menu_item_photo so that after the asset row lock it raises when private.asset_set_aside(p_asset_id) is true. Use 'review_conflict' 40001 with private.review_conflict_detail('disposition', latest id), or 'already_set_aside'. Because set_menu_item_photo_level calls review_menu_item_photo, this also covers it. Optionally add the same check in set_menu_item_photo_level's accepted branch. Map the error in the lib/server/review/inbox.ts WORDS table so batch outcomes show a conflict. Add a SQL or security test: set a photo aside, then call set_menu_item_photo_level with the current head and expect the refusal.

## V16: Batch Not used always returns a conflict for a photo that was ever restored

Lens manager. Finder severity should-fix, verifier severity **should-fix**. AC/spec: AC37. `lib/server/review/inbox.ts:438`.

**Scenario.** Photo X was marked Not used, then restored with "Used again". Its latest review_dispositions row is 'restored' and it is back in the pending queue. The manager selects X with other photos and runs batch Not used with a reason. decideBatch calls setAsidePhoto without expectedDispositionId, so review_set_aside gets p_expected_disposition_id = null. The latest disposition id is not null, so it raises review_conflict, and the outcome says someone else decided first. Reloading does not help, because BatchItem carries no disposition id. Batch Not used can never succeed for that photo.

**Fix.** Carry the disposition id the queue saw into each BatchItem (add it to the manager_menu_photo_queue columns and the card model) and pass it as expectedDispositionId in decideBatch. A simpler alternative: let review_set_aside treat a null expected id as acceptable when the latest disposition is 'restored'. That is weaker, though, because it drops the stale check.

**Verifier.** The defect is real on the current head.

1. lib/server/review/inbox.ts:440-445. decideBatch calls setAsidePhoto with no expectedDispositionId. setAsidePhoto (lines 213-229) only sends p_expected_disposition_id when the value is a number, so the RPC gets its default of null.

2. review_set_aside in supabase/migrations/20261118110000_review_inbox.sql (line 405 onward) is the only definition; no later migration overrides it. It runs `if v_latest.id is distinct from p_expected_disposition_id then raise exception 'review_conflict'`. A photo that was set aside and then restored has a latest review_dispositions row with action 'restored' and a non-null id, so a null expected id always conflicts.

3. Restored photos are back in the queue. private.asset_set_aside is true only when the latest action is not_used or duplicate, so for 'restored' it is false. lib/review/inbox.ts:358-365 `batchable(card, "not_used")` accepts labelled/pending, unlabelled and stale cards, so the restored photo can be picked for batch Not used.

4. A reload does not help. BatchItem (lib/review/inbox.ts:345-351) and batchItemOf (lines 370-378) carry no disposition id. decideBatch builds items with only key, assetId, itemId, variantId and itemRevision. So every retry sends null again and fails the same way. The outcome is mapped to a conflict, which wrongly tells the manager someone else decided first.

5. Workaround: the single-photo detail screen (components/nabalens/manager/review/inbox-photo-detail.tsx:329-333) passes `expectedDispositionId: detail.disposition?.id`, so Not used one photo at a time still works.

6. This is not one of K1-K11 in sprint3-plan.md, and no decision documents it.

Severity is should-fix rather than blocking. Batch Not used (AC37) fails only for photos that were restored before, and the per-photo path is a workaround. No data is lost and there is no security impact.

Fix: add the latest disposition id to the queue card (manager_menu_photo_queue / QueueCard), carry it in BatchItem and batchItemOf, check it in decideBatch, and pass it as expectedDispositionId to setAsidePhoto. Keep the strict stale check in review_set_aside.

## V17: "Used again" does not put a photo's place or amenity rows back in the queue

Lens manager. Finder severity minor, verifier severity **should-fix**. AC/spec: AC16. `supabase/migrations/20261118110000_review_inbox.sql:527`.

**Scenario.** A photo labelled for a place (or an amenity) is marked Not used or Duplicate. review_set_aside writes an area_photo_decisions / amenity_photo_decisions row 'not_used' for each waiting row. The manager then clicks Restore ("Used again"), which per the function comment means "it waits again". Only the review_dispositions row is added. The place and amenity rows keep their 'not_used' decision, so the photo never comes back to the place or amenity queues or counts, while dish tuples do come back. It can only be found by opening the photo detail directly.

**Fix.** In review_set_aside, when p_action = 'restored', also restore the place and amenity rows whose latest decision is the 'not_used' row this photo's set-aside created. Either link those decisions to the disposition id, or allow a 'restored'/pending decision and re-queue them. Alternatively, change the copy and docs so Restore explicitly covers dish labels only.

**Verifier.** This is a real defect on the current head. In supabase/migrations/20261118110000_review_inbox.sql, review_set_aside (lines 405 onward) only writes place and amenity decisions inside `if p_action in ('not_used', 'duplicate')` (around lines 515-535). For each waiting place label it inserts an area_photo_decisions row with action 'not_used', and it does the same for each pending amenity row. The 'restored' branch only inserts the review_dispositions row. It never resets those place or amenity rows, yet the function comment says "restored: the photo is set aside now; it waits again". No later 20261118*.sql migration redefines review_set_aside. My grep shows it only in 110000. A restored photo can't get its place or amenity rows back either way. The place and amenity decisions are append-only. The transition rules in 20261118100100_coverage_decisions.sql (lines 351-353 and 499-501) allow not_used to go only to accepted, so there is no pending or reopen action. Both the place queue and the amenity rows treat the latest 'not_used' as not waiting. Dish tuples do come back, because private.menu_photo_pending_tuples only adds "not set aside", and that changes back when the latest disposition is 'restored'. The test (tests/security/review-inbox.test.ts:287-320) checks only the dish queue after restore, so this case is untested. The UI calls it "Use again" / "Used again" (components/nabalens/manager/review/inbox-copy.ts:107, 196). Nothing in K1-K11, decisions.md or the S2-REVIEW report says Restore covers dish labels only. The S2-REVIEW report line 49 only describes the set-aside side. The damage is limited. A manager can still accept the place or amenity row from the photo detail or the place queue's Not used filter, because not_used -> accepted is allowed. No data is lost and there is no security impact. The photo just never waits in the place or amenity queues or their waiting counts again, and staff still see it as Not used for those slots. This does not really fail an acceptance criterion: AC16 is about reference retention. So it is should-fix, not blocking. Suggested fix: record the disposition id on the place and amenity decisions that the set-aside writes. On 'restored', allow a reopen (back to pending) on rows whose latest decision is one of those, add that transition to the decide functions and queues, and add a test. Alternatively, change the copy and comment to say Restore only puts dish labels back.

## V18: Overview 'Oldest photo waiting' / waiting count links to the legacy checklist queue, not the queues it counts

Lens admin. Finder severity should-fix, verifier severity **should-fix**. AC/spec: AC39. `lib/admin/overview.ts:258`.

**Scenario.** admin_overview_row (20261118115100_admin_group_overview.sql) counts review.waiting and oldestAt from the new queues: private.menu_photo_pending_tuples (dish), undecided media_area_labels (place) and private.amenity_photo_rows state 'pending' (amenity). rowHrefs.review sends both numbers to /admin/coverage/{venue}/review. That page is ReviewScreen, which calls listReviewQueue -> coverage_items_page and reads the legacy public.coverage_submission_items checklist queue. Example: a venue has 4 dish photos waiting, the oldest 9 days old. Overview shows 'Oldest photo waiting 9 days' (the venue also goes to the attention group) and '4 waiting'. The linked page says there is nothing to review, because those photos are never coverage_submission_items. Amenity photos in the count can't be reviewed from any linked admin page: /admin/coverage/{venue}/menu-photos mounts ReviewBody and AreaReviewSection but not AmenityReviewSection. The Food/Drinks/Other coverage numbers (categoryHref -> /menu-photos) have a similar problem: they land on a review queue that shows no covered-of-total figure, so the 'n of N' can't be checked there.

**Fix.** Point rowHrefs.review at the admin page that lists the dish, place and amenity queues: /admin/coverage/{venue}/menu-photos, with AmenityReviewSection added there, the same set as /manager/review. Add a unit test asserting that the review link resolves to a page fed by the same three sources. For category links, use a page that lists the coverage_slots rows for that category, so numerator and denominator can be checked.

**Verifier.** The claim holds on the current head. lib/admin/overview.ts:258 sets `review: \`${base}/review\``, and the unit test tests/unit/admin-overview-model.test.ts:145 pins that value. The count and oldest age come from supabase/migrations/20261118115100_admin_group_overview.sql:124-139, which reads three sources: private.menu_photo_pending_tuples (dish photos, excluding rechecks), media_area_labels that have no area_photo_decisions row (place photos), and private.amenity_photo_rows with state 'pending' (amenity photos). The link target is app/admin/coverage/[venueId]/review/page.tsx. It renders the ReviewScreen in app/staff/manage/_shared/screens/review.tsx, which calls listReviewQueue from lib/server/coverage. That function (lib/server/coverage/venue.ts:237) calls the RPC coverage_items_page, the legacy coverage_submission_items checklist queue. So dish, place and amenity photos counted on Overview never show on the linked page. A venue with 4 waiting dish photos, the oldest 9 days old, shows '4 waiting' and 'Oldest photo waiting 9 days' on Overview and is put in the attention group (rowAttention, threshold 7 days). The linked page then shows its empty 'To review' state.

Amenity photos are the bigger gap. AmenityReviewSection is mounted only in app/manager/review/page.tsx. No admin route mounts it or reads amenity_photo_rows (searched with grep across app/ and lib/). The admin menu-photos page (app/admin/coverage/[venueId]/menu-photos/page.tsx) has ReviewBody and AreaReviewSection but no amenity section, so pending amenity photos in the count can't be reviewed from any admin page.

This is not one of K1-K11. K1 is about the unlabelled count, not the review link, and no FA decision or departure explains the link.

The category-link part of the claim (food, drinks and other going to /menu-photos, which shows no covered-of-total figure) is weaker. It is a gap in auditing coverage, not a wrong number, so I don't count it toward the severity.

I rate it should-fix rather than blocking. No data is lost and nothing is exposed, but admins following the attention signal land on an empty or unrelated queue.

Fix:

1. Point rowHrefs.review at `/admin/coverage/${row.venueId}/menu-photos`.
2. Mount AmenityReviewSection on that page, so it shows the same three queues as /manager/review.
3. Update the unit test at line 145 to match.

## V19: A restored venue-corrected photo goes back into public use at the wrong venue with its old approvals

Lens admin. Finder severity should-fix, verifier severity **should-fix**. AC/spec: AC32/AC35 (spec §11: correction must suspend affected approvals and re-review). `supabase/migrations/20261118116000_library.sql:605`.

**Scenario.** An admin finds that photo X uploaded at Barley Mow is really The Bell and calls admin_correct_asset_venue(X, Bell, reason). The function writes media_venue_corrections and a media_asset_withdrawals row ('approvals suspended until someone re-reviews'). Later any admin presses Restore on the asset page, for example to undo what looks like an ordinary withdrawal. library_restore_asset just deletes the withdrawal row and checks nothing about corrections. private.export_candidate_rows still keys on media_assets.venue_id (Barley Mow) and the old Barley Mow menu, place or amenity acceptance, so X is again a public export and publication candidate for Barley Mow's dish. No re-review happened, and the recorded correction to The Bell is ignored. Spec §11 (line 550) requires suspending the affected approvals and re-reviewing.

**Fix.** In library_restore_asset, refuse with a new error (for example 'venue_correction_pending') when the asset's latest media_venue_corrections row names a venue other than media_assets.venue_id, unless the declared-venue approvals have been decided again after the correction. Alternatively, have export_candidate_rows exclude assets with a correction whose corrected venue differs from the row's venue. Show the reason in the Restore dialog, and add a security test: correct, restore, then export_candidates('public') must not list the asset.

**Verifier.** The claim holds on the current head. Nothing later replaces the functions involved: no migration after 20261118116000 (117000/117100) redefines library_restore_asset or private.export_candidate_rows.

1. admin_correct_asset_venue (supabase/migrations/20261118116000_library.sql:621-665) records the correction and inserts a media_asset_withdrawals row with reason 'Venue corrected: ...'. The withdrawal is the only thing that suspends the photo's use; its comment says approvals are suspended 'until someone re-reviews'. media_assets.venue_id stays the declared venue (Barley Mow in the scenario).

2. library_restore_asset (same file, lines 587-615) loads the asset, deletes the media_asset_withdrawals row and writes a 'restored' event. It never reads media_venue_corrections and checks no re-review.

3. export_candidate_rows (same file, lines 239 onward) builds candidates from `a.venue_id = p_venue_id`. Its only Library guard is `not exists (... media_asset_withdrawals ...)`. It never looks at media_venue_corrections. Once the withdrawal row is gone, the asset's old Barley Mow menu_item_photos, area or amenity acceptances make it a public candidate for Barley Mow again. The primary-photo triggers also check the withdrawal alone, so it can be made a main photo at Barley Mow again.

4. Nothing in the UI stops this. app/admin/library/_components/asset-detail.tsx:534-538 shows Restore for any withdrawal. The notice at lines 113-121 says the photo can't be exported 'until it is restored'. The Restore dialog (lines 598-611) says it can be exported again 'as its reviews allow' and gives no warning about the correction. The S2-LIBRARY report (reports/S2-LIBRARY.md:22) says the correction is 'Partly built' and does not route the photo to the right venue's review queue. Neither that report nor sprint3-plan K1-K11 covers restoring a corrected photo. K11 is about suspend and coverage, not this. No decision in decisions.md allows it.

Result: correct X to The Bell, then restore it with any reason, and X is again a public export and primary candidate for Barley Mow's dish under its old approvals. No re-review happened. This breaks spec §11 (line 550: 'suspend affected approvals and re-review').

Severity is should-fix rather than blocking. It takes an admin's deliberate, reasoned and audited Restore. But nothing warns that admin, and the outcome is a wrong-venue photo published publicly.

Fix: in library_restore_asset, raise 'venue_correction_pending' when the latest media_venue_corrections row's corrected_venue_id differs from media_assets.venue_id. Also add the same condition to export_candidate_rows' `usable` CTE and to the primary triggers, so they never offer an asset with an open correction. Then hide or explain Restore in asset-detail.tsx when detail.corrections is not empty. Add a security test: correct the venue, try to restore (expect refusal), then check that export_candidates('public') does not list the asset.

## V20: Overview 'Checks due' double-counts facilities and links dish rechecks to the facilities page

Lens admin. Finder severity minor, verifier severity **should-fix**. AC/spec: AC39. `supabase/migrations/20261118115100_admin_group_overview.sql:159`.

**Scenario.** checksDue.total = coverage totals.checkDue + facts.check_due. In coverage_slot_rows (20261118109000) an amenity slot with a public photo is 'check_due' whenever its fact verification is not 'confirmed'. So a facility whose fact is check_due counts once as a slot and again in knowledge_fact_rows check_due. One facility needing a check shows as '2' ('1 photo · 1 fact'). Dish slots with a needs_recheck photo also count in totals.checkDue, but rowHrefs.checksDue (lib/admin/overview.ts:259) links to /admin/coverage/{venue}/amenities, which lists no dishes. Example: 2 dish rechecks plus 1 check-due facility with a photo shows '4 checks due', and the linked page shows 1 item to check.

**Fix.** Count slot checks without amenity slots whose check_due comes only from the fact (count the facts once, in facts.check_due), or count distinct subjects. Split the link so dish and place photo rechecks go to the review or album page and fact checks go to /amenities, or link to a page that lists all of them. Add a reproduction test with one dish recheck and one check-due facility.

**Verifier.** The claim holds on the current head. No later migration redefines the functions involved. I checked the full list: private.coverage_slot_rows and coverage_check_due were last replaced in 20261118109000, and knowledge_fact_rows has only one version, in 104000.

1. The same facility is counted twice. In 20261118109000_int_coverage_wiring.sql:408-416, an amenity slot is 'check_due' when `m.has_public and (m.progress = 'needs_recheck' or m.verification is distinct from 'confirmed')`. Its verification comes from private.coverage_amenity_facts, which calls private.knowledge_fact_verification(s.status, s.reason, s.detail) through knowledge_slot_state_b03. knowledge_fact_rows (104000:440ff) calls the same function, so it gives the same verification. For a facility answered Yes, with a required photo accepted for public use and its fact in check_due, the result is:

- the fact row is applicable (in scope, active, not "confirmed not_applicable"), so it counts in v_facts.check_due;
- the slot is counted (required and not not_here), so it adds 1 to coverage totals.checkDue.

20261118115100_admin_group_overview.sql:157,174-175 then sets total = v_check_due_slots + v_facts.check_due = 2. overview-view.tsx:347-352 shows "2" and "1 photo · 1 fact". Confirming that one fact clears both, so they are really one check. The "photo" part is wrong anyway: the photo itself is not due.

2. The link goes to the wrong page for most slot checks. totals.checkDue covers every category (coverage_slots_json in 100200 builds totals from all slots). That includes dish slots with needs_recheck photos (109000:382-383) and place slots whose freshness is check_due (109000:397). rowHrefs.checksDue (lib/admin/overview.ts:259) and the attention chip (overview-view.tsx:512) both point to /admin/coverage/{venue}/amenities. That page renders AmenitiesScreen, the facility checks only; places are on /amenities/places and dishes on /menu-photos. So dish and place rechecks are counted but are not on the linked page. Spec §8 A1 (line 388) says "Every number links to its underlying records", and AC39 needs the number to reproduce on the page it links to.

This is not one of K1-K11: K1 is unlabelled counts and K7 is the admin landing page. No decision in decisions.md covers it, and the S2-ADMIN report only says "photo and fact checks that are due".

Severity is should-fix, not blocking: the counts and links are wrong and admins will see this, but no data is lost and nothing is exposed.

Fix:

- Count each facility once. Either leave out amenity slots whose only reason for check_due is the fact verification (keep those whose progress = 'needs_recheck'), or count distinct subjects.
- Split the link, or link each part separately: dish rechecks to /menu-photos or /review, place rechecks to /amenities/places, facility and fact checks to /amenities. Alternatively, link to one list that shows them all.
- Add a test with one dish recheck and one check-due facility that has a public photo. The expected total is 2, not 3, and each part should link to a page that lists it.

## V21: Overview review-age attention ignores the admin's backlog alert setting

Lens admin. Finder severity minor, verifier severity **should-fix**. `lib/admin/overview.ts:309`.

**Scenario.** Settings stores ops_settings.backlog_alert_days (1-60, versioned with a reason), and ops monitoring (20261118106300 line 265) uses it. rowAttention and attentionFirst always use the default reviewAlertDays = 7, and overview-view.tsx:505 / attentionFirst never pass the setting. An admin sets the backlog alert to 3 days. A venue whose oldest photo has waited 5 days shows an exception in the monitoring panel at the top of Overview, yet stays in the 'rest' group with no 'Oldest photo waiting' attention chip. With a setting of 14, venues are flagged at 7 days.

**Fix.** Load ops settings in app/admin/overview/page.tsx (loadOpsSettings or the status payload's thresholdDays) and pass backlogAlertDays through OverviewView to rowAttention and attentionFirst.

**Verifier.** The claim holds on the current head. In lib/admin/overview.ts:293-311, rowAttention(row, now, reviewAlertDays = 7) flags review age only when days >= reviewAlertDays. attentionFirst (lines 335-344) calls rowAttention(row, now) with no third argument, and app/admin/overview/overview-view.tsx:505 (rowAttention(row, now)) and :644 (attentionFirst(rows, now)) do the same. So the threshold is always 7.

app/admin/overview/page.tsx loads only loadGroupOverview, loadOpsStatus and venues. It never reads ops_settings, and it passes no threshold to OverviewView.

The setting is configurable and stored. supabase/migrations/20261118106100_ops_settings.sql:40 defines backlog_alert_days (1-60, default 7), saved at :226 with a version and a reason. The monitoring exception in supabase/migrations/20261118106300_ops_monitoring.sql:262-267 uses v_settings.backlog_alert_days. That migration is the only later file that touches this; no later 20261118* migration overrides it. ExceptionsPanel on the same Overview page renders the result, with thresholdDays in its text (lib/ops/status.ts:179).

Both measures read the oldest photo waiting for review: admin_group_overview's review.oldestAt (20261118115100:124,170) and ops_venue_backlog's oldestWaitingAt. So with the setting at 3 days, a venue whose oldest photo has waited 5 days appears in the monitoring exceptions at the top of Overview. Yet it sits in the 'rest' group with no 'Oldest photo waiting' chip. With the setting at 14, venues get the chip at 7 days while monitoring stays quiet.

This is not one of K1-K11 in sprint3-plan.md, and I found no decision or departure that fixes the overview at 7 days.

There is also a small edge mismatch: SQL uses strictly older than the threshold, while the TS uses whole days >= threshold.

Fix: page.tsx should read backlog_alert_days, either through the ops settings loader or from the status payload's thresholdDays. Pass it into OverviewView, and from there to rowAttention(row, now, days) and attentionFirst(rows, now, days); attentionFirst needs a new parameter that it forwards to rowAttention. Align the comparison with the SQL rule.

## V22: Venues that were inactive before the migration show as Open, Open does nothing for them, and Temporarily closed turns them back on

Lens docs. Finder severity should-fix, verifier severity **should-fix**. AC/spec: Spec §8 A2 operating status; checklist A2-operating-status ('permanently closed archives ... reopen restores'). `supabase/migrations/20261118115000_admin_venues.sql:418`.

**Scenario.** 20261118100000_coverage_review_level.sql:49 adds venues.operating_status with default 'open' and never backfills it, so a venue that already had active=false (for example the seeded 'DEV FIXTURE Inactive Venue', or any production pub switched off before Full App) ends up as active=false with operating_status='open'. On /admin/venues it shows the 'Open' chip, while /admin/venues/[venueId] shows the 'Archived ... Reopen it under Status' notice. (1) The admin picks Open: line 418 sees v_old.operating_status = p_status and returns changed=false, so the venue stays archived and the instruction on screen cannot be followed. (2) The admin picks Temporarily closed, meaning to keep it shut: line 424 sets active = (p_status <> 'permanently_closed') = true and clears archived_at. Every remaining membership at that venue starts working again (venue_role_of requires v.active), and staff can add photos to a venue the admin just marked closed. This also breaks the column comment's rule that trading state is separate from venues.active.

**Fix.** Add a migration that backfills existing inactive venues: update public.venues set operating_status = 'permanently_closed', archived_at = coalesce(archived_at, now()) where not active and operating_status = 'open'. In admin_venue_set_status, treat the call as a no-op only when both operating_status and active already match the target (status = p_status and active = (p_status <> 'permanently_closed')). Add a security test: an inactive 'open' venue set to temporarily_closed must not grant access unless the admin reopens it on purpose, and setting it to Open must reopen it.

**Verifier.** The claim holds on the current head, and none of K1-K11 covers it.

**Why the state happens**

- `20261118100000_coverage_review_level.sql:49` adds `operating_status not null default 'open'` and never backfills it.
- `20261118115000_admin_venues.sql:47` adds `archived_at` (null) and never backfills it either.
- No other 20261118* migration writes `operating_status`. I grepped: the only other hit is the read in `admin_group_overview.sql:163`.
- `supabase/seed.sql:13` seeds 'DEV FIXTURE Inactive Venue' with `active=false`. It therefore ends up `active=false`, `operating_status='open'`, `archived_at=null`. Any production venue switched off before this change would end up the same way.

**What the screens show**

- `app/admin/venues/page.tsx:58` renders `operatingStatusChip(venue.operatingStatus)`, so the venue shows as Open in the archived list.
- `app/admin/venues/[venueId]/page.tsx:133` shows the same Open chip.
- `[venueId]/page.tsx:157-161` shows the Archived notice ("Reopen it under Status").

**(1) Open cannot be chosen**

- In `app/admin/venues/venue-forms.tsx`, the form starts with `choice = venue.operatingStatus` ('open'), and line 351 disables submit while `choice === venue.operatingStatus`. The admin cannot submit Open at all.
- Even through the RPC, `admin_venues.sql:420` (`if v_old.operating_status = p_status`) returns `changed=false` without touching `active`.
- So the on-screen instruction cannot be followed directly.

**(2) Temporarily closed turns the venue back on**

- `admin_venues.sql:424-427` sets `active = p_status <> 'permanently_closed'`, which is true, and clears `archived_at`.
- `private.venue_role_of` only refuses a venue when it is inactive (header comment, lines 11-13). So every membership at that venue starts working again, while the venue is labelled temporarily closed.
- Nothing else guards this. No other code path updates `venues.active`: the only `active =` write on venues in any migration is line 426, and I found no `venues` update in `lib`/`app`.

**Why should-fix, not blocking**

- Only an admin can trigger it, and only for venues that were inactive before the migration.
- Nothing is lost.
- Choosing Temporarily closed and then Open does reopen the venue.
- It is still wrong behaviour an admin will hit, and it breaks the A2 rule that closing archives and reopening restores.

**Fix**

1. Add a backfill migration: `update public.venues set operating_status='permanently_closed', archived_at=coalesce(archived_at, now()) where not active and operating_status='open'`.
2. Make the no-op check at line 420 also require `v_old.active = (p_status <> 'permanently_closed')`.
3. Add a security test for an inactive venue whose status is 'open'.

## V23: Checklist rows cite departure IDs that do not exist, and A2-reviewer-responsibility names the removed venue_reviewers table

Lens docs. Finder severity minor, verifier severity **minor**. `docs/plans/full-app-v1/checklist.md:291`.

**Scenario.** Rows 280, 287, 291, 292, 294, 298, 310, 311 (S2-ADD/S2-STAFF) and 320, 325 (S2-MGR) say 'built as departure A-3 / A-4 / A-5 / A-6 / A-7'. Rows 264 and 274 cite '(A-5)' and '(A-4)'. docs/design-system/departures.md has no A-3 to A-7 rows: the merge renamed them A-S1 to A-S3, A-D1 to A-D5, A-M1 and A-M2. A reviewer checking a 'built as departure' claim finds no justification under the cited ID, so the claim cannot be verified, and S2-MGR's 'A-4' points at the wrong concept. Row 369 (A2-reviewer-responsibility) says 'built: venue_reviewers main/backup'. The coordinator removed that table; admin screens now use venue_reviewer_assignments through admin_set_venue_reviewer (lib/server/admin/venues.ts:313).

**Fix.** Rewrite the cited IDs to the live ones: A-3 becomes A-D1 or A-S1 (tabs) as fits each row, the task batch row becomes A-D2, A-5 (tabs wording) becomes A-D3, A-6 becomes A-D4, A-7 becomes A-D5, S2-MGR's nav becomes A-M1 and coverage n of N becomes A-M2, and the staff '(A-4)'/'(A-5)' become A-S2/A-S3. Change row 369 to name venue_reviewer_assignments and admin_set_venue_reviewer. Do this in the K9 checklist pass.

**Verifier.** The claim holds, but it only affects documentation. In docs/design-system/departures.md, rows 102-116 hold A-1, A-2, A-E1, A-S1..A-S3, A-D1..A-D5, A-M1, A-M2, A-R1 and A-R2. There are no A-3 to A-7 rows. Even so, docs/plans/full-app-v1/checklist.md cites bare A-3..A-7 on lines 263, 264, 272, 274, 280, 287, 291, 292, 294, 298, 310, 311, 320 and 325. Line 291, for example, reads "built as departure A-3 (gallery first, FA-2; the OS picker offers the camera)", and that departure is now A-D1. The grep hits on lines 82, 339 and 345 are FA-3/FA-4/FA-5 decision IDs, not departures, so they are fine.

Line 369 (A2-reviewer-responsibility) says "built (S2-ADMIN): `venue_reviewers` main/backup". None of the 20261118 migrations, lib/ or app/ contains `venue_reviewers` as a table name. supabase/migrations/20261118115000_admin_venues.sql:62 states that one store is kept, `public.venue_reviewer_assignments`, and lines 130-149 read from it. So the row names a table that no longer exists.

Sprint3-plan K9 covers only the empty results for S1-COV, S1-MENUS, S1-FACTS, S1-EXPORT and S1-OPS. It says nothing about stale departure IDs or the reviewer table name, so this is not a known item. Severity is minor: these are traceability errors in a planning doc. No user behaviour, security or acceptance criterion depends on them.

Fix: during the K9 checklist pass, map each bare A-3..A-7 citation to the live ID by its wording: A-D1 gallery first, A-D2 task batch, A-D3 tabs/Upload wording or A-S1 staff tabs, A-D4 grouping, A-D5 confirmation, A-M1 manager nav, A-M2 coverage words, A-S2/A-S3 for the staff rows. Then change line 369 to name `venue_reviewer_assignments` written via admin_set_venue_reviewer.

## V24: Design-system docs point at component files that no longer exist

Lens docs. Finder severity minor, verifier severity **minor**. `docs/design-system/catalogue.md:250`.

**Scenario.** catalogue.md:250 lists PhotoSegments' users as 'tasks/monthly-progress-card.tsx and tasks/assignment-list.tsx', but components/nabalens/tasks/monthly-progress-card.tsx does not exist (PhotoSegments is now used only by month-card.tsx and assignment-list.tsx). departures.md:32 (P4) cites 'home/contribute-card.tsx:74' as the second use of the lighter blue, and no contribute-card.tsx exists anywhere in the repo. Anyone following AGENTS.md ('check catalogue.md before building a component') lands on missing files, and P4's open departure can no longer be checked against code.

**Fix.** In catalogue.md:250, drop tasks/monthly-progress-card.tsx and correct the file count. In departures.md P4, find where the light-blue link moved (if anywhere) and cite that file and line, or mark that half of P4 closed.

**Verifier.** I checked this and it holds. Neither `components/nabalens/home/contribute-card.tsx` nor `components/nabalens/tasks/monthly-progress-card.tsx` is in the tracked tree on `feat/full-app-v1`: `git ls-files` returns nothing for either name. Copies exist only in the stale `.claude/worktrees/*` checkouts. `git log --diff-filter=D` shows both files were deleted in commit 4e818aa45, "feat(ui): Album is Home (AL-8, A5)".

Three docs still cite the deleted files:

- `docs/design-system/catalogue.md:250` says PhotoSegments is used in 2 files, `tasks/monthly-progress-card.tsx` and `tasks/assignment-list.tsx`.
- `docs/design-system/departures.md:32` (P4, status open) cites `home/contribute-card.tsx:74`.
- `docs/design-system/components.md` cites `contribute-card.tsx` at lines 705-722 and 835. The claim did not mention these.

None of K1-K11 in `sprint3-plan.md` covers stale design-system docs, and S1-foundation-review does not either.

This is documentation drift only. No app behaviour, security or acceptance criterion is affected, so the severity is minor.

Fix:

1. In `catalogue.md:250`, remove `monthly-progress-card.tsx` and recount the PhotoSegments users, which are `month-card.tsx` and `assignment-list.tsx`.
2. In `departures.md` P4, either cite where the light-blue link now lives or mark that half closed. Keep the `shell/add-sheet.tsx:117` icon-disc half after re-checking that line.
3. Update the share-box rows in `components.md` (705-722, 835) so they describe the Album Home component that replaced `contribute-card.tsx`.

## V25: My uploads restates the outcome words that status-chip.tsx already defines

Lens consistency. Finder severity minor, verifier severity **minor**. `lib/staff/my-uploads.ts:104`.

**Scenario.** S2-STAFF added outcome_* entries with their words to components/nabalens/status-chip.tsx (lines 538-579: Waiting, In the album, Kept for reference, Retake, Label corrected, Not used, Withdrawn). It also defines OUTCOME_WORDS with the same strings in lib/staff/my-uploads.ts. my-uploads.tsx:506 and album/slot-screen.tsx:199 pass OUTCOME_WORDS as children, which replace the chip's own word. If a word is changed in status-chip.tsx, the chip on Me and on the slot screen still shows the old word. AGENTS.md says state words live in one component and must not be restated, and S2-REQ's requestChip follows that rule correctly.

**Fix.** Delete OUTCOME_WORDS. Render `<StatusChip state={OUTCOME_CHIP[s.outcome]} />` with no children in my-uploads.tsx and slot-screen.tsx. Wherever plain text is needed (aria labels, tests), read the word from the status-chip definitions.

**Verifier.** The restatement is real, but today it changes nothing users see. Only a later edit to one copy of the words would make screens show a stale word.

What the code shows:

- lib/staff/my-uploads.ts:103-111 defines OUTCOME_WORDS: Waiting, In the album, Kept for reference, Retake, Not used, Withdrawn, Label corrected.
- components/nabalens/status-chip.tsx:538-579 defines the same seven strings as the `word` of the outcome_* entries in CHIP_STATES.
- StatusChip renders `props.children ?? known?.word` (status-chip.tsx:687), so children replace the chip's own word.
- components/nabalens/me/my-uploads.tsx:506-507 and components/nabalens/album/slot-screen.tsx:199-200 both render `<StatusChip state={OUTCOME_CHIP[...]}>{OUTCOME_WORDS[...]}</StatusChip>`. The word on screen therefore comes from my-uploads.ts, not from the chip.
- The unit test (tests/unit/staff-s2-models.test.ts:249-262) checks only that the OUTCOME_CHIP keys exist in CHIP_STATES and pins OUTCOME_WORDS to literal strings. It never checks that OUTCOME_WORDS equals CHIP_STATES[key].word, so a drift would pass CI.

The rule it breaks: AGENTS.md says state words live in one component (status-chip.tsx) and must not be restated elsewhere. S2-REQ follows that rule: request-row.tsx:51 renders `<StatusChip state={requestChip(...)} />` with no children.

Not a known item: none of K1-K11 in sprint3-plan.md covers it, and decisions.md / DESIGN.md 1.4 record no exception for it. The closest is K4 (Label corrected never shows on Me), which is a separate issue.

Why minor: the two sets of strings match exactly on the current head, so no acceptance criterion fails and no user sees a wrong word now.

Fix:

1. Drop the children in my-uploads.tsx:506 and slot-screen.tsx:199, rendering `<StatusChip state={OUTCOME_CHIP[x]} />`.
2. Delete OUTCOME_WORDS, or derive it as `CHIP_STATES[OUTCOME_CHIP[k]].word`.
3. Build the OUTCOMES set in my-uploads.ts:124 from Object.keys(OUTCOME_CHIP).
4. Change the test to read the words from CHIP_STATES.
