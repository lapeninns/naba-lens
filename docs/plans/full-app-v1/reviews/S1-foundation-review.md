# Sprint 1 foundation review

An adversarial review of the 23 Sprint 1 migrations and their server code, run by the coordinator on the merged head (`719fc0a24`) while Sprint 2 ran. Eight finders (one per Sprint 1 task) reported 30 findings. Each was checked by an independent verifier told to refute it; 29 were confirmed. One was refuted and is listed at the end.

Owner of each fix: **S2-INT** (coverage, acceptance, export and admin-gate wiring, migrations `20261118109000` onward) or **S2-FIX** (the rest, migrations `20261118108000` to `108900`). Some findings repeat across areas (R1, R18, R20 and R21 are one defect); fix each once.

| ID  | Owner  | Severity   | Finding                                                                                                                                                                          | File                                               |
| --- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| R1  | S2-INT | blocking   | Public export and 'published' records ignore review levels and amenity photo decisions (FA-31, FA-32)                                                                            | `20261118105000_export_packages.sql:344`           |
| R2  | S2-INT | blocking   | asset_is_accepted ignores amenity_photo_decisions: staff can delete accepted amenity photos, and colleagues never see them                                                       | `20261118107000_privacy_colleague_media.sql:55`    |
| R3  | S2-INT | should-fix | Coverage freshness hook is never wired: expired or 'needs replacement' space photos still count as covered                                                                       | `20261118100200_coverage_slots.sql:62`             |
| R4  | S2-INT | minor      | Exact duplicates still add dish photo counts and can cover a slot (FA-35, AC21)                                                                                                  | `20261118100100_coverage_decisions.sql:94`         |
| R5  | S2-FIX | should-fix | Legacy account-wide triggers still revoke manager grants and end work at every venue on any role or venue change that is not a switch, which breaks per-venue roles (FA-22/AC14) | `20261118101000_venue_memberships.sql:385`         |
| R6  | S2-FIX | minor      | A manager's remove_venue_member deactivates the whole account and ends memberships at other pubs when those pubs are temporarily inactive                                        | `20261118101100_venue_membership_commands.sql:475` |
| R7  | S2-FIX | minor      | Every self-service venue switch writes account_role_changed and account_venue_changed rows to the admin activity log                                                             | `20261118101100_venue_membership_commands.sql:160` |
| R8  | S2-FIX | blocking   | Concurrent finalise of identical bytes at one venue links neither as duplicate, so both earn credit (FA-35 / AC21)                                                               | `20261118102000_upload_pipeline.sql:541`           |
| R9  | S2-INT | should-fix | Duplicate stays uncredited after its original is withdrawn, removed or rejected, so the only accepted copy earns nothing                                                         | `20261118102000_upload_pipeline.sql:665`           |
| R10 | S2-FIX | should-fix | Switching active venue (FA-22) kills in-flight uploads at a venue the person still belongs to                                                                                    | `20261118102000_upload_pipeline.sql:221`           |
| R11 | S2-INT | minor      | New security definer private.monthly_credit_items keeps default PUBLIC execute (no revoke/grant)                                                                                 | `20261118102000_upload_pipeline.sql:652`           |
| R12 | S2-FIX | should-fix | Applicability gate (core checks need an admin, a reason is required) can be bypassed through the old archive/restore RPCs, which the app still calls                             | `20261118103300_venue_scope.sql:224`               |
| R13 | S2-FIX | should-fix | A change request sent back for clarification can never be decided again                                                                                                          | `20261118103200_menu_change_requests.sql:132`      |
| R14 | S2-FIX | minor      | A scheduled activation lapses only when the retirement count changes, not when the set of retired items changes                                                                  | `20261118103000_menu_scheduled_activation.sql:394` |
| R15 | S2-FIX | minor      | Legacy activate_menu_version stays granted and skips the retirement confirmation (AC28)                                                                                          | `20261030120000_menu_catalogue.sql:1174`           |
| R16 | S2-INT | blocking   | Space-photo freshness never reaches coverage or export: expired or needs-replacement photos still count as covered and still export as public                                    | `20261118104000_facts_freshness.sql:55`            |
| R17 | S2-INT | should-fix | Changing an accepted area photo's review level silently resets its freshness and clears reported changes and end dates                                                           | `20261118104000_facts_freshness.sql:822`           |
| R18 | S2-INT | should-fix | Export candidates ignore review_level: reference-only dish and area photos export as public (FA-31)                                                                              | `20261118105000_export_packages.sql:343`           |
| R19 | S2-FIX | minor      | "Still right" for a place can be backdated to before a reported change and still clear it                                                                                        | `20261118104000_facts_freshness.sql:914`           |
| R20 | S2-INT | blocking   | Public export eligibility ignores review_level: reference-approved dish and place photos are exported and published as public (FA-31)                                            | `20261118105000_export_packages.sql:344`           |
| R21 | S2-INT | blocking   | Amenity photos are public-exportable without any amenity photo review and with any in-force grant, including internal-audience grants                                            | `20261118105000_export_packages.sql:369`           |
| R22 | S2-INT | should-fix | Admin removal of an accepted asset does not check manual publication records, so 'never while it is published' is not enforced                                                   | `20261118107100_media_removal.sql:404`             |
| R23 | S2-FIX | minor      | export_candidates and export_package_detail rebuild the whole venue's candidate set once per row (quadratic work)                                                                | `20261118105200_export_publication_api.sql:150`    |
| R24 | S2-FIX | should-fix | Venue managers resolved through the profile's active venue only, so multi-venue managers get no digest and venues show a false 'no manager' setup gap                            | `20261118106300_ops_monitoring.sql:186`            |
| R25 | S2-FIX | should-fix | Account activity trigger logs every active-venue switch as a role change and a venue change                                                                                      | `20261118106000_ops_activity.sql:166`              |
| R26 | S2-FIX | minor      | Admin Activity leaves out per-venue role grants and removals (venue_memberships / venue_manager_grants)                                                                          | `20261118106000_ops_activity.sql:201`              |
| R27 | S2-FIX | blocking   | 107000 recreates the three community reads from the 20261107 bodies and drops the M1 manager-era upload filter added in 20261110091603                                           | `20261118107000_privacy_colleague_media.sql:186`   |
| R28 | S2-FIX | should-fix | delete_media_asset checks asset_is_accepted without locking the asset, so a concurrent acceptance lets staff permanently delete an accepted original (FA-21)                     | `20261118107100_media_removal.sql:210`             |
| R29 | S2-INT | should-fix | FA-23 gap: private.can_read_asset_labels admits admins by p.role = 'admin' without aal2, so an aal1 admin session can read every venue's labels                                  | `20261118107200_admin_mfa.sql:25`                  |

## R1: Public export and 'published' records ignore review levels and amenity photo decisions (FA-31, FA-32)

Owner S2-INT. Severity blocking. Area cov. `supabase/migrations/20261118105000_export_packages.sql:344`.

**Scenario.** private.export_candidate_rows is the only eligibility rule for public export packages and for publication_record (20261118105200 line 708). Its header (line 39) says it is 'the single place to tighten' once S1-COV lands, but it never was. (a) Menu: line 344 takes any p.state = 'accepted' row and line 391 marks it approval_level 'public'. It has no review_level check, so a dish photo a manager chose 'Keep as reference' (set_menu_item_photo_level) goes into a public package and can be recorded as published. (b) Areas: line 359/398 do the same for an area_photo_decisions row with action 'accepted' and review_level 'reference'. (c) Amenities: lines 365-380 still take every photo on the current confirmed-Yes submission. They never read amenity_photo_decisions, so a photo a reviewer marked not_used, needs_another_photo, withdrawn or reference is still a public candidate. A photo accepted for public use from an open contribution is never offered. This breaks FA-31 (reference is not for public use) and FA-32 (the photo's review is separate from the fact). Because a level change does not remove the row from the candidates, export_package_stale also does not invalidate an existing public package when a photo is moved to reference.

**Fix.** Tighten export_candidate_rows. For menu, add `and (p.review_level = 'public' or p_mode = 'internal')` and mark a reference row 'internal'. For areas, select d.review_level in the lateral and give approval_level 'public' only when action = 'accepted' and review_level = 'public'. For amenities, derive candidates from private.amenity_photo_rows(p_venue_id) with state = 'accepted' and review_level = 'public' (keep the use_state / knowledge_public_media_eligible gate), using the amenity_photo_decisions row id as approval_id and version, so a later decision makes the package stale. Add regression tests: a reference dish or area photo, and a not_used amenity photo, must be absent from export_candidates('public') and rejected by publication_record('published').

**Verifier.** The defect is real. `private.export_candidate_rows` is defined only once, in `20261118105000_export_packages.sql` at line 299. No later migration, including `105100`-`105300` and `107xxx`, replaces it.

(a) Menu: the `menu` CTE keeps any row with `p.state = 'accepted'` and never reads `review_level`. Line 391 then sets `approval_level` to 'public' whenever the state is 'accepted'. A 'Keep as reference' row still has state 'accepted': `menu_item_photos.review_level` is a separate column (`100000`:62), and `set_menu_item_photo_level` (`100100`:139+) accepts the photo first and only then sets the level. So a reference dish photo is a public candidate.

(b) Areas: the lateral subquery selects only `d.id` and `d.action`. Public is decided by `ar.action = 'accepted'` alone. The constraint `area_photo_decisions_level` allows `action='accepted'` together with `review_level='reference'`, so a reference area photo also counts as public.

(c) Amenities: the `amenity` CTE joins `venue_amenity_checks` -> `current_submission` -> `amenity_submission_assets` (photo) and never reads `amenity_photo_decisions` or `private.amenity_photo_rows`. A photo marked not_used, needs_another_photo, withdrawn or reference is still a candidate whenever `use_state` is 'granted' and media is public-eligible. Photos accepted outside the current submission are never offered.

Publishing: `publication_record` (`105200`:708) uses `export_candidate_rows(venue, 'public')` as its only eligibility test for 'published', so these photos can be recorded as Published. `export_package_stale` also relies on candidate membership, so moving a photo to reference does not mark a public package stale.

The project's docs confirm this is still to do. The header comment at line 39, `reports/S1-EXPORT.md`:68 ("it currently treats 'accepted' as public") and `sprint2-handoff.md` S2-INT item 4 ("a reference photo is never exportable or publishable (AC16)") all list it as deferred integration work. That makes it a known open gap that breaks FA-31, FA-32 and AC16 on the current head, not a false alarm.

## R2: asset_is_accepted ignores amenity_photo_decisions: staff can delete accepted amenity photos, and colleagues never see them

Owner S2-INT. Severity blocking. Area cov. `supabase/migrations/20261118107000_privacy_colleague_media.sql:55`.

**Scenario.** S1-COV made the amenity photo's own review (public.decide_amenity_photo, plus the 'carried' backfill in 20261118100000 line 220) the thing that fills an amenity slot. private.asset_is_accepted (S1-PRIVACY) recognises amenity acceptance only through knowledge_decisions with decider_basis 'venue_manager'/'admin', or venue_amenity_fact_media. It never reads amenity_photo_decisions. Concrete case: a staff member sends a photo with an open knowledge contribution. private.amenity_photo_rows lists photos from open contributions, so the manager can accept it for public use with decide_amenity_photo, and the slot shows 'covered'. The fact is still unconfirmed, so asset_is_accepted returns false. (1) The uploader then calls public.delete_media_asset (20261118107100 line 224). The 'media_asset_retained' guard does not fire, the accepted original is soft-deleted and the slot silently drops back to missing. That breaks FA-21. The same applies to carried decisions on checks completed under basis 'self'/'rule', and request_media_removal (line 272) will not even offer the request path. (2) media_visible_to_caller is false for other staff, so album_slot_photos and album_slot_asset hide the tile and community reads hide the photo, even though the slot counts as covered. (3) media_removal_impact_of reports accepted=false and lists no amenity photo decisions or slot_primary_choices, so an admin's impact preview understates what removal touches.

**Fix.** Add an amenity_photo_decisions branch to private.asset_is_accepted: the latest decision for (check_id, asset_id) has action = 'accepted' (any level, matching how reference is treated for menu and area). Do this in a new forward migration with `create or replace`, ordered after 20261118107000. Add the latest amenity photo decisions, and any slot_primary_choices that point at the asset, to private.media_removal_impact_of. Test: an uploader's delete_media_asset on an amenity photo accepted through decide_amenity_photo raises media_asset_retained, and a colleague sees it through album_slot_photos.

**Verifier.** The claim holds up after reading the migrations, triggers and the server layer.

1. **What the function checks.** `private.asset_is_accepted` (20261118107000_privacy_colleague_media.sql lines 55-97) looks at six sources: menu_item_photos, coverage_submission_items, area_photo_decisions (through media_area_labels), venue_amenity_fact_media, and knowledge_decisions joined through amenity_submission_assets or knowledge_contribution_assets. The knowledge_decisions branches require decision confirmed/reaffirmed and decider_basis venue_manager/admin. It never reads public.amenity_photo_decisions. No later migration replaces it: 107100 and 107200 are the last files, and 107100 only calls it.

2. **The scenario can happen.** `private.amenity_photo_rows` (20261118100100 lines 387-436) includes photo evidence from any open contribution (`not private.knowledge_is_terminal(k.id)`), plus the current submission's photos and any photo already decided. `decide_amenity_photo` (lines 444-515) only needs a row in that set, a manager caller and a reviewer who is not the uploader. It inserts an 'accepted' row and leaves the fact untouched ("The fact is untouched (FA-32)"). Coverage slots (20261118100200 lines 134-152) count an amenity slot as covered from `amenity_photo_rows` state='accepted' and level='public'. So a photo from an open contribution can be accepted and fill the slot while no knowledge_decision exists, and `asset_is_accepted` returns false for it. The same applies to the 'carried' backfill rows (20261118100000 line 220). These are taken from complete checks with answer yes, and nothing requires a venue_manager/admin knowledge_decision for them.

3. **No other guard catches it.**
   - `delete_media_asset` (20261118107100 lines 197-237) uses only `asset_is_accepted` before setting deleted_at.
   - The server layer (lib/server/lifecycle/remove-media.ts) just calls the RPC and maps `media_asset_retained` to 409.
   - The update triggers on media_assets (pipeline_guard, use_baseline_guard, uploader_role_guard, evidence_withdrawn, activity, notify) do not block a soft delete of an accepted asset. evidence_withdrawn only logs an event.
   - After deletion, `amenity_photo_rows` filters out `deleted_at is null` assets, so the slot drops from covered.
   - `request_media_removal` (line 272) raises 'withdraw_instead' for the uploader because `asset_is_accepted` is false.

4. **Other effects in the claim.**
   - `media_visible_to_caller` (lines 119-136) depends on `asset_is_accepted`, so other staff cannot see the accepted amenity photo through the gated reads (lines 201, 251, 296, 332, 366).
   - `media_removal_impact_of` (107100 lines 105-140) reports `accepted` through the same function and has no amenity_photo_decisions or slot_primary_choices section, so the admin's removal preview understates the impact.

The proposed fix fits: add a branch that is true when the latest amenity_photo_decisions action for (check_id, asset_id) is 'accepted', at any review level, and extend the impact preview with those decisions and with slot_primary_choices that point at the asset. Severity is medium rather than high: this is not a privacy leak, since it hides photos rather than exposing them. It does break the FA-21 rule that accepted media is retained, lets coverage silently regress, and hides accepted photos from colleagues.

## R3: Coverage freshness hook is never wired: expired or 'needs replacement' space photos still count as covered

Owner S2-INT. Severity should-fix. Area cov. `supabase/migrations/20261118100200_coverage_slots.sql:62`.

**Scenario.** private.coverage_check_due and private.coverage_temporarily_unavailable are stubs that return false. The header says S1-FACTS and S1-MENUS replace them, and 20261118104000_facts_freshness.sql line 55 says 'The coverage function (S1-COV) reads private.area_photo_freshness'. No migration in 20261118* (or later) redefines either hook, and coverage_slot_rows never calls area_photo_freshness. So when a manager records public.area_photo_report_change ('check_due'), public.area_photo_set_end_date with a date that has passed ('expired'), a known change ('needs_replacement'), or the 90-day space_photo policy runs out, the place still shows 'covered' in coverage_slots, album_area_states, album_admin_counts and the per-category n-of-N. That contradicts spec §9.3 and §18.1 (a check-due slot is not in the covered numerator) and AC30. Dish availability from S1-MENUS (menu_item_availability_set) is never shown as 'unavailable' either.

**Fix.** Add a forward migration that replaces private.coverage_check_due for p_kind = 'area'. It should return true when any accepted public label of the subject has private.area_photo_freshness(label) ->> 'state' in ('check_due', 'needs_replacement', 'expired'). Better: make 'expired' and 'needs_replacement' drop has_public (treat the photo as not covering, giving replacement_needed or missing) rather than only marking it check_due. Replace private.coverage_temporarily_unavailable('dish', ...) with the S1-MENUS availability state. Add a test where report_change or an end date in the past moves the place from covered to check_due, or to replacement_needed, in coverage_slots totals.

**Verifier.** The claim holds. In supabase/migrations/20261118100200_coverage_slots.sql, lines 50-71 define private.coverage_temporarily_unavailable and private.coverage_check_due as `select false;`. The header (lines 27-30) says S1-MENUS and S1-FACTS replace them in later migrations. A grep over every migration on this branch, and over every local and remote branch's supabase/migrations, finds no other file that redefines either function. The only hits are their definitions, the call sites at lines 162/168/175/181/192/198 and the revoke statements at 571-572.

20261118104000_facts_freshness.sql creates private.area_photo_freshness (line 801). It returns check_due, needs_replacement or expired from public.area_photo_checks, plus check_due once the space_photo policy runs out. Its header (line 55) says "The coverage function (S1-COV) reads private.area_photo_freshness", but nothing does. Outside its own migration, the function is read only by public.area_photo_freshness_list and area_photo_set_end_date's return value.

There is no other guard:

- The writers area_photo_report_change, area_photo_set_end_date and area_photo_reconfirm only insert into area_photo_checks. They write nothing to area_photo_decisions, which is the only table coverage_slot_rows' `area` CTE reads for has_public, pending and retake (the area_live lateral join to area_photo_decisions).
- In the server layer, lib/server/album.ts and lib/server/album-admin.ts take coverage_slots and album_area_states directly from the RPCs and add no freshness. Only lib/server/knowledge/facts.ts reads area_photo_freshness_list, for the separate facts screen.

So a place whose photo was reported changed, marked as needing replacement, or given an end date that has passed still shows 'covered' in coverage_slots and in every read built on the same rule (album_area_states, album_admin_counts). That contradicts the S1-FACTS header's own statement and the §9.3 note in the coverage_slots header that check_due is not in the covered numerator. Likewise, the dish `unavailable` flag is always false, because no migration replaces the availability hook.

Severity is medium: the coverage counts are wrong and contradict the spec, but nothing is exposed and no data is corrupted.

## R4: Exact duplicates still add dish photo counts and can cover a slot (FA-35, AC21)

Owner S2-INT. Severity minor. Area cov. `supabase/migrations/20261118100100_coverage_decisions.sql:94`.

**Scenario.** S1-UPLOAD (20261118102000) sets media_assets.duplicate_of_asset_id at finalise and removes duplicates from monthly credit. The coverage rule in private.menu_item_photo_rows and coverage_slot_rows, private.amenity_photo_rows, and the area_live CTE never look at duplicate_of_asset_id. Re-uploading the same file and having it accepted on the same dish raises accepted_count, because count(distinct p.asset_id) counts a different asset id with the same SHA-256. Labelling the duplicate to another dish, place or amenity and accepting it covers that slot with a byte-identical photo. FA-35 says a duplicate never adds coverage, and AC21 says coverage counts must not grow from a duplicate.

**Fix.** In the coverage readers, exclude assets with duplicate_of_asset_id is not null whose original is already accepted for the same slot, or count by coalesce(a.duplicate_of_asset_id, a.id) instead of asset_id. Decide with the product owner whether a duplicate may ever cover a different slot, and record the decision in decisions.md.

**Verifier.** I could not refute this. It is real on the current head, and the team already knows about it: the Sprint 2 hand-off has it as an open item.

**What the code does now**

- In 20261118100100_coverage_decisions.sql (lines 77-102), `private.menu_item_photo_rows` picks the covering photo and computes `accepted_count` as `count(distinct p.asset_id)`. Its only filters are `state`, `review_level = 'public'`, `upload_state = 'ready'`, `deleted_at is null` and `media_type = 'image'`. Nothing checks `duplicate_of_asset_id`.
- `private.menu_item_effective_primary` has the same gap, and so do the S1-COV readers in 20261118100200_coverage_slots.sql. Grepping all 20261118*.sql files for "duplicate" finds only the upload pipeline and an unrelated export check (`export_item_duplicate`).
- In 20261118102000_upload_pipeline.sql, `complete_media_finalise` sets `duplicate_of_asset_id` and then runs `complete_media_finalise_core`, which stores the labels. So a duplicate still gets its dish/area/amenity labels and goes into the review queues.
- I found no guard anywhere that stops a duplicate being reviewed or counted:
  - The only duplicate filter is the `private.monthly_credit_items` wrapper, and it covers monthly credit only.
  - The only TS use is `lib/server/media/finalise.ts:607`, which just returns a `duplicate: true` flag.
  - The pipeline guard trigger only freezes the link once set.
  - No RLS policy or later migration excludes duplicates from coverage.

**Concrete case**
Upload the same file twice at one venue, labelled to the same dish. The second upload's asset gets `duplicate_of_asset_id` set. Accept both at public level and `accepted_count` goes from 1 to 2, because the two asset ids differ. That breaks FA-35 in decisions.md:44 ("a duplicate never adds coverage") and AC21 ("Exact duplicates don't inflate coverage or contribution counts").

**It is a known, deferred gap**

- docs/plans/full-app-v1/sprint2-handoff.md:39, item 3 of the S2-INT task: "Duplicates add no coverage. Coverage ignores assets with duplicate_of_asset_id set (AC21; S1-UPLOAD)."
- checklist.md:75 marks AC21 "partial", with the note "partly: no monthly credit for duplicates; coverage read is S1-COV".

**Limits on the claim**

- For the same slot, the covered yes/no does not change, because the original already covers it. Only `accepted_count` grows.
- The "covers a different slot" case is weaker. checklist.md S4.5 lets one asset meet several slots if a reviewer confirms each match, so a byte-identical copy covering a slot the original never covered may be allowed. That needs a product decision, as the proposed fix says.

Severity: medium. Coverage counts are inflated, but no access or security boundary is affected.

## R5: Legacy account-wide triggers still revoke manager grants and end work at every venue on any role or venue change that is not a switch, which breaks per-venue roles (FA-22/AC14)

Owner S2-FIX. Severity should-fix. Area people. `supabase/migrations/20261118101000_venue_memberships.sql:385`.

**Scenario.** The migration recreates profiles_revoke_manager_grants, profiles_end_coverage_assignments and profiles_end_amenity_assignments. Its only change is a WHEN clause that skips a venue switch. The function bodies are unchanged: private.profiles_revoke_manager_grants (20261107100100:80-84) runs `update venue_manager_grants ... where g.staff_id = new.id and g.revoked_at is null`, which hits every venue. profiles_end_coverage_assignments (20261102140000:780-783) ends every open assignment, also at every venue. Example 1: P works as staff at B (active venue) and is manager at A (open grant, manager membership). An admin runs convert_account_to_manager(P, B). Its `update profiles set role='manager'` is not a switch, so the trigger also revokes the grant at A (role_changed). venue_manager_grants_sync_memberships then ends P's manager membership at A, and P silently loses venue A. convert_manager_to_staff at A does the same to any other managed venue C. Example 2: an admin's legacy transfer of P from A to C (a direct profiles.venue_id update) ends P's membership at A as intended. It also revokes P's grant at B and ends all of P's coverage assignments at B, but P's staff membership at B stays open. The work is dropped with end_kind 'transferred'. Also, convert_* `select g.id into v_old_grant ... where staff_id = p and revoked_at is null` now picks one grant at random out of several, so the audit row names the wrong grant.

**Fix.** Make the legacy side effects per venue now that roles are per venue. In profiles_revoke_manager_grants, revoke only grants at old.venue_id on a venue change or role change, and all grants only on deactivation or a change to admin. Scope profiles_end_coverage_assignments and profiles_end_amenity_assignments to old.venue_id unless the account is deactivated or becomes admin. Or route convert_account_to_manager, convert_manager_to_staff and admin transfers through admin_set_venue_membership / membership_switch_profile. In the convert_* functions, select the grant for the specific venue.

**Verifier.** I could not refute it. All three trigger bodies are unchanged, and the only new guard is the venue_switch WHEN clause.

- **Grant revoke (20261107100100:58-92):** private.profiles_revoke_manager_grants revokes grants `where g.staff_id = new.id and g.revoked_at is null`, with no venue filter. 20261118101000 never redefines it. The new unique index venue_manager_grants_one_open on (staff_id, venue_id) means a person can hold several open grants, so every one of them is revoked.
- **Coverage (20261102140000:754-794):** profiles_end_coverage_assignments ends every open assignee row for the person, at every venue, on a transfer, a deactivation or a move to a non-staff role.
- **Amenity (20261107120000:662-689):** profiles_end_amenity_assignments clears assignees wherever `c.venue_id is distinct from new.venue_id`. That means every other venue, or all of them on a role change away from staff.
- **Trigger guard (20261118101000:385-404):** the triggers skip only when `nabalens.venue_switch='on'`. Only private.membership_switch_profile sets that flag (20261118101100:150-165).

**The state in Example 1 can exist.** P is granted manager at A, which requires role=manager and venue_id=A. P then switches to a staff membership at B, and the switch skips the triggers. The profile now reads role=staff, venue_id=B, with an open grant at A.

**convert_account_to_manager accepts that state.** It checks only `v_p.role <> 'staff'`, then runs `update profiles set role='manager', venue_id=p_venue_id` without the switch flag. The revoke trigger therefore revokes the grant at A as role_changed. venue_manager_grants_sync_memberships (20261118101000:502-544) then ends the manager membership at A. convert_manager_to_staff has the same path.

**Both paths are reachable in the app.**

- Conversion: app/admin/staff/actions.ts (convertToManagerAction / convertToStaffAction) calls lib/server/accounts/conversion.ts, which calls the RPCs. account-type-panel.tsx has no multi-venue guard.
- Legacy transfer (Example 2): lib/server/accounts/manage.ts:107-113 updates profiles.venue_id directly. The trigger then revokes grants and ends coverage at the other venues. profiles_sync_venue_memberships (around line 472) ends only the membership at old.venue_id, so a staff membership at B stays open while P's coverage work at B is ended as 'transferred'.

**Grant lookup.** In both convert_* functions, `select g.id into v_old_grant ... where staff_id = p and revoked_at is null` is a non-STRICT SELECT INTO with no venue filter. With several open grants it takes an arbitrary first row, so the audit row's "before" grantId can name the wrong grant. This is minor.

**This is already known, but nothing enforces it.** docs/plans/full-app-v1/reports/S1-PEOPLE.md:85 says the old conversion path "still act[s] on the whole account and revoke[s] manager rights at other venues" and that admin screens "should use admin_set_venue_membership for anyone with more than one venue". Neither the UI nor the server layer enforces this, and the transfer path is not mentioned.

**Severity is medium:** only admins can trigger it and grants can be given again. But access and work at other venues are lost with no warning, which goes against FA-22/AC14.

## R6: A manager's remove_venue_member deactivates the whole account and ends memberships at other pubs when those pubs are temporarily inactive

Owner S2-FIX. Severity minor. Area people. `supabase/migrations/20261118101100_venue_membership_commands.sql:475`.

**Scenario.** v_next only considers memberships at active venues where venue_role_of is not null. Example: X is staff at A and staff at C, and C is temporarily inactive (a seasonal closure). The manager of A removes X from A, v_next is NULL, and the function sets profiles.active = false. The sync trigger then ends X's membership at C too (end_kind 'deactivated'), and the server bans the auth user (memberships.ts removeVenueMember). When C reopens, X has no access. Spec M5 says managers 'cannot change another pub's memberships'.

**Fix.** Deactivate only when the person has no other open membership at all (any venue, active or not). Otherwise end only the membership at p_venue_id. If the remaining venues are all inactive, leave the profile's active venue as is, or move it to the remaining membership without deactivating. Alternatively, allow the deactivation branch only for admins and return a 'needs_admin' outcome to managers.

**Verifier.** I traced the scenario through the code and it holds as described.

1. remove_venue_member (20261118101100_venue_membership_commands.sql:475-490) picks v_next only from memberships whose venue has `v.active` and where `private.venue_role_of(...)` is not null. venue_role_of (20261118101000_venue_memberships.sql:231-254) also joins `public.venues v ... and v.active`, so it returns NULL for an inactive venue. A staff membership at inactive venue C therefore never becomes v_next.
2. When v_next is NULL, the function runs `update public.profiles set active = false` and returns 'deactivated'. Nothing checks whether the person still has other open memberships, and nothing checks that the caller is an admin. `private.assert_can_manage_venue(p_venue_id)` only needs the caller to manage venue A, and the staff-role check passes for an ordinary staff member.
3. The profiles sync trigger, private.profiles_sync_venue_memberships (20261118101000_venue_memberships.sql, the `old.active and not new.active` branch), loops over every open membership of the person at any venue and calls `membership_end(..., 'deactivated', ...)`. So the membership at C ends too.
4. lib/server/accounts/memberships.ts:354-408 (removeVenueMember) bans the auth user with `updateUserById(..., { ban_duration })` whenever the outcome is 'deactivated'. Both app/manager/team/actions.ts and app/admin/staff/actions.ts call it.
5. Nothing elsewhere prevents this. There are no triggers on public.venues, so making a venue inactive does not end its memberships, and they stay open. The later 20261118*.sql migrations do not redefine remove_venue_member or venue_role_of. RLS does not apply because the function is security definer.

Limits on the scenario: the app has no screen that makes a venue inactive, so venues.active=false has to be set outside the app. The column is clearly meant for this, though: many functions filter on v.active and the admin menus screen reads it. A smaller variant also exists. A manager membership at C whose grant was revoked makes venue_role_of return NULL even while C is active, with the same result.

This conflicts with checklist item M5-no-privilege-grant ("Managers cannot ... change another pub's memberships", docs/plans/full-app-v1/checklist.md:552), which is marked done. Here the manager of A ends X's membership at C and bans X's account.

## R7: Every self-service venue switch writes account_role_changed and account_venue_changed rows to the admin activity log

Owner S2-FIX. Severity minor. Area people. `supabase/migrations/20261118101100_venue_membership_commands.sql:160`.

**Scenario.** membership_switch_profile updates profiles.venue_id and role. The venue_switch flag suppresses only the three legacy triggers. The S1-OPS trigger profiles_activity (20261118106000:136-168, after update of active, role, venue_id) has no such exemption. So a person who is staff at B and manager at A creates an 'account_venue_changed' row, plus an 'account_role_changed' row, each time they switch. These rows go into the append-only important-changes activity, so routine switching floods the log and reads like admin role changes.

**Fix.** Give profiles_activity the same WHEN (coalesce(current_setting('nabalens.venue_switch', true), '') <> 'on') clause, or have private.activity_on_profile_change return early when private.venue_switch_active(). If switches should be visible, record them as a separate 'venue_switched' kind.

**Verifier.** The claim holds, with one correction: a switch always writes `account_venue_changed`, but it writes `account_role_changed` only when the person's role differs between the two venues.

- **The switch path:** `public.switch_active_venue` (20261118101100:306-333), called from the app at `lib/auth/venues.ts:88`, calls `private.membership_switch_profile` (lines 151-166). That function sets `nabalens.venue_switch='on'` and then updates `profiles.venue_id` and `role`.
- **What the flag suppresses:** only the three legacy triggers that 20261118101000:385-405 recreated with `WHEN (coalesce(current_setting('nabalens.venue_switch', true), '') <> 'on')`, namely `profiles_revoke_manager_grants`, `profiles_end_coverage_assignments` and `profiles_end_amenity_assignments`.
- **The S1-OPS trigger has no exemption:** `profiles_activity` (20261118106000:166-168) is declared `after update of active, role, venue_id on public.profiles`, with no WHEN clause. Its function `private.activity_on_profile_change` (lines 136-164) never checks `private.venue_switch_active()`. When `venue_id` changes it calls `record_activity(..., 'account_venue_changed', ...)`, and when `role` changes it also writes `'account_role_changed'`.
- **No later fix:** no later migration redefines the trigger or the function. A grep for `profiles_activity`, `activity_on_profile_change` and `venue_switch` outside 101000 and 101100 finds only the original definitions.
- **The log is append-only:** `activity_events` has the `append_only_guard` triggers, so these rows cannot be removed.
- **The admin screen shows them unfiltered:** `private.activity_rows()` and `public.admin_activity` read `activity_events` without filtering by action. `lib/ops/activity.ts:115-116` displays the two actions as "Changed an account's role" and "Moved an account to another venue".
- **Result:** a manager at A who is staff at B adds one or two rows to the important-changes log every time they switch venue. The actor is the person themselves, but the wording reads like an admin account change.
- **Other paths:** `remove_venue_member` and `admin_set_venue_membership` (lines 493, 560, 578) also go through `membership_switch_profile`. Logging those may be intended, since they are real membership changes.
- **Why low severity:** this is noise and misleading wording in the audit log, not a security or data-integrity problem. The fix the claim proposes, a WHEN clause on the trigger or an early return when `private.venue_switch_active()` is true, would work. A separate action kind is an option if switches should stay visible.

## R8: Concurrent finalise of identical bytes at one venue links neither as duplicate, so both earn credit (FA-35 / AC21)

Owner S2-FIX. Severity blocking. Area upload. `supabase/migrations/20261118102000_upload_pipeline.sql:541`.

**Scenario.** complete_media_finalise only locks the asset's own row (FOR UPDATE at line 530). The duplicate lookup at lines 542-550 matches only other assets that are already `upload_state = 'ready'` and committed. Suppose the same photo is picked twice in one batch (the uploader runs maxParallelUploads = 2), or two staff send the same file at the same moment. Both finalise transactions run the lookup before either has committed `ready`. Each finds no match, both commit with duplicate_of_asset_id = NULL, and the guard trigger (lines 149-151) then stops the link from ever being added. Both copies pass the private.monthly_credit_items wrapper, so contribution credit is inflated, which is exactly what AC21 forbids.

**Fix.** Serialise the lookup per (venue, hash) before running it: `perform pg_advisory_xact_lock(hashtextextended('nabalens_dup:' || v_asset.venue_id || ':' || p_content_sha256, 0));` when p_content_sha256 is not null. Then the second transaction waits for the first commit and sees its ready row. Another option is to also match `processing` rows that already hold the same content_sha256 (store the hash first under the same lock). Add a concurrency test that finalises two same-hash assets in parallel.

**Verifier.** The race holds up. I read the code and found nothing in SQL or the server layer that blocks it.

In supabase/migrations/20261118102000_upload_pipeline.sql, complete_media_finalise takes `FOR UPDATE` only on its own asset row (around line 530). The duplicate lookup (lines 542-550) is a plain SELECT. It matches only other rows with `d.upload_state = 'ready'` and `d.deleted_at is null`. Under the default READ COMMITTED isolation, a concurrent transaction's hash and `ready` state stay invisible until it commits.

Nothing else closes the gap:

- **No lock or unique index:** there is no advisory lock on (venue, hash). The index at lines 123-125, media_assets_venue_sha256_idx, is non-unique, so the second insert is not blocked or failed. Advisory locks appear only in reserve (`nabalens_reserve:` per user, line 411), venue_scope and coverage_decisions. None of them covers finalise.
- **No repair later:** the guard trigger (lines 149-151) raises on adding duplicate_of_asset_id once `old.upload_state = 'ready'`, so a missed link can never be backfilled. No later 20261118* migration and no code in lib/, app/ or components/ sets duplicate_of_asset_id. The only reference outside the migration is finalise.ts:607, which just reads the RPC's return.
- **No server-side serialisation:** lib/server/media/finalise.ts computes the hash and calls `rpc("complete_media_finalise")` per request.
- **Credit effect:** the private.monthly_credit_items wrapper (lines 652-668) filters only `a.duplicate_of_asset_id is null`. Both racing copies therefore count, which breaks AC21.

On how it happens: two uploads of the same picked file in one batch may be partly mitigated on the client. upload-queue.ts has a `resumed` path for "an earlier upload of the same file". So that variant is the weaker one. Two staff at the same venue finalising the same bytes at nearly the same moment, or two separate File objects with the same bytes (maxParallelUploads = 2 in lib/config/media.ts:16), are not mitigated anywhere.

Severity is medium. The window is narrow (only between the lookup and commit), but it bypasses an explicit acceptance criterion and cannot be repaired afterwards. The proposed fix closes the window: a `pg_advisory_xact_lock` on venue_id plus hash, taken before the lookup.

## R9: Duplicate stays uncredited after its original is withdrawn, removed or rejected, so the only accepted copy earns nothing

Owner S2-INT. Severity should-fix. Area upload. `supabase/migrations/20261118102000_upload_pipeline.sql:665`.

**Scenario.** Link and credit are both one-way. duplicate_of_asset_id is fixed at finalise (the pipeline guard forbids changing it). The credit wrapper then drops every row where `a.duplicate_of_asset_id is not null`, without checking whether the original still exists or is credited. Example: staff member X uploads photo P (ready, unreviewed). X or a colleague uploads P again, and it is linked as a duplicate of the first. The first is withdrawn (FA-21 allows withdrawing one's own unreviewed upload, and 20261118107100 sets deleted_at) or rejected as mislabelled. The second copy is sent and accepted. monthly_credit_items now returns no row for either asset, so a legitimate accepted contribution earns zero credit. That breaks spec §19 item 5, which requires deduplicating 'without losing legitimate associations or attribution'. The duplicate lookup also matches any colleague's unreviewed ready asset, so the accepted copy can lose credit because of someone else's rejected upload.

**Fix.** In the wrapper, exclude a duplicate only while its original still counts. For example, keep a row when the original is deleted (`deleted_at is not null`) or has no credit of its own: `where a.duplicate_of_asset_id is null or not exists (select 1 from public.media_assets o where o.id = a.duplicate_of_asset_id and o.deleted_at is null and <original accepted/credited>)`. Alternatively, credit the earliest accepted asset per (venue, content_sha256) instead of relying on the frozen link.

**Verifier.** I could not refute it. Every step of the scenario holds in the code.

1. The link is set once and nothing ever clears it. `complete_media_finalise` (20261118102000, around lines 538-556) sets `duplicate_of_asset_id` to the earliest live (`deleted_at is null`), `ready` asset at the same venue with the same hash. That asset can be anyone's. Its review state is not checked. The update uses `coalesce(a.duplicate_of_asset_id, v_duplicate)`. `media_assets_pipeline_guard` (lines 136-158) blocks moving the link, and blocks adding one once the asset is ready. It does allow clearing the link, but I found no code that does: a grep of `supabase/migrations`, `lib` and `app` finds `duplicate_of_asset_id` written only in finalise. It is read in `finalise.ts:607`, which only returns a `duplicate: true` flag, and in the tests. The column has no foreign key, so nothing cascades either.

2. The original can lose its credit after the link is made.
   - Withdrawal: `delete_media_asset` (20261118107100, lines 199-240) lets the active-staff uploader set `deleted_at = now()` on an asset that is not yet accepted (`private.asset_is_accepted`).
   - Rejection: the base credit function only credits accepted rows. The `submitted` part needs `i.state = 'accepted'`, `menu` needs an accepted event, and `area` needs `r.state = 'accepted'`. All three also drop an asset removed before month end (`deleted_at is null or deleted_at >= london_month_end`). So a rejected or withdrawn original earns nothing from `monthly_credit_items_base`.

3. The copy loses its credit through the wrapper. The new `private.monthly_credit_items` (lines 655-669) joins `media_assets` and keeps only rows `where a.duplicate_of_asset_id is null`. It never checks whether the original still exists or was credited. No later 20261118* migration redefines the wrapper or the base; only 102000 touches `monthly_credit_items` that day. The migration comments say every credit caller reads through this name.

4. Nothing upstream stops the copy being sent or accepted. The client gets only a `duplicate: true` flag (`lib/upload/uploader.ts:222`, `queue-adapter.ts:238`). No review or submission check looks at the link.

Result: original A (ready, unreviewed) is withdrawn or rejected, and copy B (`duplicate_of = A`) is sent and accepted. The base returns no row for A, and the wrapper drops B, so the only accepted contribution earns zero credit. Because the lookup matches any colleague's ready asset at the venue, B can lose its credit through someone else's upload. This contradicts the plan docs:

- checklist S18-useful-contrib: "first approved fulfilment ... duplicates and extras do not count"
- checklist M2: "keeps attribution without duplicate coverage credit"

Here B is the first approved copy, not an extra. The existing test (`tests/security/upload-pipeline.test.ts:270-285`) only checks that the link is set, not this path. The impact is wrong contribution and credit counts, not a security or data-exposure problem, hence medium severity.

## R10: Switching active venue (FA-22) kills in-flight uploads at a venue the person still belongs to

Owner S2-FIX. Severity should-fix. Area upload. `supabase/migrations/20261118102000_upload_pipeline.sql:221`.

**Scenario.** private.media_upload_venue_allowed checks only the profile projection, `p.role = 'staff' and p.venue_id = p_venue`. Under 20261118101000/101100, profiles.venue_id and role are just the ACTIVE venue, and public.switch_active_venue rewrites them. Example: a person is staff at venues A and B and reserves an upload while A is active. Mid-transfer they switch to B, which is still an open membership. The storage write trigger (guard_media_original_write) then raises media_reservation_closed, and complete_media_finalise raises upload_access_ended. finalise.ts (lines 437-442) also returns ACCESS_ENDED because actor.profile.venueId differs. The upload is lost even though the person is an active staff member of A. The same happens to a person who is staff at A and manager at B. The rule treats 'not my active venue' as 'access ended', which AC12 does not intend for a member.

**Fix.** In the staff branch, check for an open venue_memberships row instead of the active-venue projection: `exists (select 1 from public.venue_memberships m join public.venues v on v.id = m.venue_id and v.active where m.profile_id = p_uploader and m.venue_id = p_venue and m.role = 'staff' and m.ended_at is null)`, with the profile still active. Keep the manager branch, or move it to the manager membership and open grant. Make the same change to the staff check in lib/server/media/finalise.ts at lines 437-442.

**Verifier.** The mechanism is real. I could not refute it. One part of the claim is overstated, and the defect conflicts with a stated design choice.

How it fails:

- private.media_upload_venue_allowed (supabase/migrations/20261118102000_upload_pipeline.sql:211-238) uses only the profile projection.
  - Staff branch: `p.active and p.role='staff' and p.venue_id = p_venue`.
  - Manager branch: `private.manager_upload_venue_id(p_uploader) = p_venue`. That function (20261110090145:92-102) also needs `p.role = 'manager'` on the profile, and goes through effective_manager_venue_id.
- No later 20261118* migration redefines this rule or guard_media_original_write. The only redefinitions are older migrations.
- public.switch_active_venue (20261118101100:306-333) calls private.membership_switch_profile (lines 151-166). That runs `update public.profiles set venue_id = p_venue, role = p_role`. So a switch rewrites the exact columns the rule reads.
- After a switch, all three checks refuse a reservation made at the old venue:
  - the storage policy (can_upload_media_object);
  - the write trigger (guard_media_original_write raises media_reservation_closed);
  - complete_media_finalise (raises upload_access_ended, lines 484/537).
- The server does the same. lib/server/media/finalise.ts:437-442 returns ACCESS_ENDED for staff when `actor.profile.venueId !== row.venue_id`. For manager accounts, managerUploadEnded (lines 377-400) compares `my_venue_capabilities.venueId` with the asset venue, so it fails in the same way.
- The client treats a 403 as `finalise_refused`, which cannot be retried (lib/upload/types.ts:106, lib/upload/errors.ts:26-35). The item is shown as refused for good, not as something to retry after switching back.
- The membership is never ended, so this is not the revocation case AC12 describes. The checklist defines AC12 as "Membership revoked during upload refuses finalisation".

What I could not refute, and the caveats:

1. **Reachability is narrower than claimed.** VenueSwitcher is rendered only on app/manager/team/page.tsx. The S1-PEOPLE report says staff can't switch until S2-STAFF adds it to Me. So the claim's main example (staff at A switching to staff at B) is not reachable through today's UI. It is reachable through the public server action or the RPC, and through the UI once S2-STAFF ships.
2. **The mixed-role case is reachable today.** A person manages B (active) and is staff at A. They upload at B, then switch to A on the Team screen, for example in another tab while the queue runs. Their profile role becomes 'staff', manager_upload_venue_id returns null, and the in-flight manager upload is refused.
3. **The design does say rights follow the active venue.** The S1-PEOPLE report says a person "gets manager rights only at A, and only while working at A", and the membership migration says switching "filters existing permissions". So the refusal follows the projection model. Still, nothing in S1-UPLOAD or S1-PEOPLE covers in-flight uploads during a switch. The upload migration header lists only "moved to another venue, deactivated, or whose venue closed". The user also gets a misleading "access ended" result that can't be retried, for a venue they still belong to.
4. **Some data may survive.** The reservation row stays 'uploading' and is not deleted, so the bytes may still be recoverable from the device journal. The queue still marks the item as refused.

On the proposed fix: the staff branch would correctly key on an open venue_memberships row (role 'staff', active venue, active profile). The manager branch would need the same treatment: an open manager membership plus an open grant for that venue, not the projection-based manager_upload_venue_id. Otherwise the mixed-role case stays broken. finalise.ts lines 437-442 and managerUploadEnded would need matching changes.

## R11: New security definer private.monthly_credit_items keeps default PUBLIC execute (no revoke/grant)

Owner S2-INT. Severity minor. Area upload. `supabase/migrations/20261118102000_upload_pipeline.sql:652`.

**Scenario.** The old function is renamed to monthly_credit_items_base, which keeps its revoked privileges. The new wrapper is a fresh CREATE FUNCTION, and the migration ends with only a comment ('Privileges as the earlier body had them'), with no REVOKE or GRANT. Postgres therefore grants EXECUTE to PUBLIC. authenticated has USAGE on schema private (20261029120100 line 9), so any authenticated SQL session can call this security definer function and read every venue's credit rows (author_id, venue_id, asset_id). PostgREST does not expose `private` today, so the impact is limited. It still breaks the repo rule and the original 20261102150000 grant set, which allowed service_role only.

**Fix.** Add `revoke all on function private.monthly_credit_items(date) from public, anon, authenticated; grant execute on function private.monthly_credit_items(date) to service_role;` after the CREATE.

**Verifier.** Confirmed by reading the migrations. supabase/migrations/20261118102000_upload_pipeline.sql:650 renames the old function to monthly_credit_items_base. That function keeps the grant set from 20261102150000_coverage_procedures.sql:2698-2718: revoked from public, anon and authenticated, granted to service_role. Line 652 then runs a fresh `create function private.monthly_credit_items(p_month date) ... security definer`, not CREATE OR REPLACE, so none of the old privileges carry over. The file is 671 lines long and ends at line 671 with only the comment "-- Privileges as the earlier body had them (the rename keeps the base's)". There is no REVOKE or GRANT for the new function.

Nothing else fixes this:

- None of the other 20261118*.sql migrations mention monthly_credit_items.
- No migration has `alter default privileges` for schema private.
- The blanket `revoke all on all functions in schema private from public, anon` at 20261029120100_nabalens_access.sql:64 ran once, back then. It does not cover functions created later.

So Postgres's built-in default applies, and PUBLIC gets EXECUTE on the new function. authenticated has `grant usage on schema private` (20261029120100 line 9), so any authenticated role can call this SECURITY DEFINER wrapper. It returns author_id, venue_id, asset_id, decided_at and evidence_removed for every venue, and it reads monthly_credit_items_base as the owner, which gets round that function's revoke.

The impact is limited. supabase/config.toml exposes only `schemas = ["public", "graphql_public"]`, so PostgREST cannot reach `private` and end users have no direct path today. It only matters for a direct SQL session or a future public-schema bridge. The only test (tests/security/upload-pipeline.test.ts:608-615) checks results through psql as a superuser, not privileges, so it would not catch this.

Still, it is a real regression from the original service_role-only grant set, and it contradicts the migration's own comment. The proposed fix is correct: `revoke all ... from public, anon, authenticated; grant execute ... to service_role`.

## R12: Applicability gate (core checks need an admin, a reason is required) can be bypassed through the old archive/restore RPCs, which the app still calls

Owner S2-FIX. Severity should-fix. Area menus. `supabase/migrations/20261118103300_venue_scope.sql:224`.

**Scenario.** amenity_check_set_applicability refuses non-admins on core checks (is_core) and requires a reason recorded in amenity_scope_events (AC29: you must not be able to improve completion by excluding a real required item). But public.amenity_archive_check(uuid,integer) and (uuid,integer,uuid), plus amenity_restore_check (20261107120000_amenity_catalogue.sql:1151/1174 and 20261110010334...:179/190), are still granted to authenticated. They only check private.assert_can_manage_venue, so a venue manager can archive a core check with no reason and no amenity_scope_events row. That removes the check from the venue's required set. lib/server/amenities/writes.ts archiveCheck/restoreCheck still calls amenity_archive_check directly, so even the normal UI takes the ungated path.

**Fix.** Put the core/admin rule and the required reason in one place that every path goes through. Either revoke execute on the 2-arg and 3-arg amenity_archive_check/amenity_restore_check from authenticated and switch lib/server/amenities/writes.ts to amenity_check_set_applicability, or add the is_core/admin check to private.amenity_lock_managed_check (or to archive/restore) and require a reason there. amenity_add_checks also restores archived checks without a reason or a scope event; give it the same gate.

**Verifier.** I could not refute it. Every link in the scenario holds in the code.

1. **The old RPCs are still open.** 20261107120000_amenity_catalogue.sql:1575-1577 grants the 2-arg `amenity_archive_check`, `amenity_restore_check` and `amenity_add_checks` to authenticated. 20261110010334_knowledge_b02a_commands_and_draft_guard.sql:802-805 does the same for the 3-arg keyed versions. No later migration redefines or revokes them; I grepped 2026111*.sql, and the only later reference is the wrapper call at venue_scope.sql:233-234.

2. **They have no core or reason check.** The 2-arg archive/restore (amenity_catalogue.sql:1151/1174) call only `private.amenity_lock_managed_check` (line 427). That function runs `amenity_readable_check`, `assert_can_manage_venue`, `amenity_assert_venue_active` and a revision check. The 3-arg versions go through `private.amenity_keyed_check_write`, which only adds idempotency. Neither path checks `is_core`, takes a reason, or writes `amenity_scope_events`. Only `amenity_check_set_applicability` (venue_scope.sql:198-244) has those checks, and it is a wrapper on top of the ungated functions, not a guard inside them. Its own `assert_can_manage_venue` plus a separate `is_active_admin` check confirms that a non-admin manager passes `assert_can_manage_venue`.

3. **The real UI takes the ungated path.** `app/staff/manage/_shared/screens/amenities-controls.tsx:157-158` wires archive/restore to `archiveCheckAction`/`restoreCheckAction` (`app/_amenities/actions.ts:65-70`). Those call `lib/server/amenities/writes.ts` `archiveCheck`/`restoreCheck`, which RPC `amenity_archive_check`/`amenity_restore_check` directly through `actor.db` (`lib/server/amenities/rpc.ts`). `setAmenityApplicability` (`lib/server/menus/local.ts:741`) is the only caller of the gated RPC, and nothing calls it.

4. **The impact is real.** `coverage_slots.sql:155` counts only `c.status = 'active'` amenity checks. Archiving a core check therefore removes it from the venue's required slots, with no reason and no scope event. That is the AC29 bypass the venue_scope header says it prevents. Core checks are the ones `amenity_enable_venue` seeds (`is_core`, amenity_catalogue.sql:1072).

5. **Restore is lower risk.** Restoring and `amenity_add_checks` (which un-archives without a reason) only add to the required set, so they don't improve completion. They do skip the reason/audit trail the migration says applies to restore.

Severity is medium: a venue manager can bypass an integrity and audit control through the normal UI. It exposes no data and does not raise anyone's privileges.

## R13: A change request sent back for clarification can never be decided again

Owner S2-FIX. Severity should-fix. Area menus. `supabase/migrations/20261118103200_menu_change_requests.sql:132`.

**Scenario.** An admin calls menu_change_request_decide(..., 'clarification_requested', reason, rev). The status becomes clarification_requested. decide only accepts status = 'open' (line 132), and no function lets the requester reply or reopen. The only way out is withdraw. So a request that needed clarification can never be accepted or declined. The manager has to withdraw it and file a new one, which loses the thread. This breaks the spec §8 A3 queue flow (ask for clarification, then decide).

**Fix.** Either let decide act on status in ('open','clarification_requested'), or add a requester command (e.g. menu_change_request_clarify(p_request_id, p_detail, p_revision)). It would lock the row, check requested_by, venue manage rights and revision, append the reply, set status back to 'open', bump revision and write a menu_events row.

**Verifier.** The claim holds. I read the code and found no guard or later path that lets a request out of clarification_requested.

1. In supabase/migrations/20261118103200_menu_change_requests.sql, menu_change_request_decide raises 'menu_change_request_not_open' when v.status <> 'open'. The comment above it says "Only an open request is decided." When it sets clarification_requested it writes decided_by, decided_at and the reason, and bumps revision. Nothing ever sets the status back to 'open'.

2. menu_change_request_withdraw is the only other write function. It accepts ('open','clarification_requested') but can only set 'withdrawn'.

3. Direct writes are not possible. The table has RLS on and all privileges revoked from public, anon, authenticated and service_role, with only SELECT granted back to service_role. No other migration in supabase/ references menu_change_requests (grep found only this file), and none of the later 20261118*.sql migrations add a clarify or reopen RPC.

4. The server layer adds no way out. lib/server/menus/local.ts only wraps create, decide, withdraw and list. app/admin/menus/change-requests.tsx (line 128) filters to r.status === "open", so once a request is sent back for clarification it drops out of the admin queue. app/manager/menu/versions/page.tsx only shows the label "Admin asks for more detail". It has no reply action.

5. Spec §8 A3 (docs/spec/...v1.0.md:410) lists "ask for clarification" as a step in the queue, and the checklist marks A3 as partial. With the current code, clarification is a dead end for the thread: the manager can only withdraw it and file a new request.

Severity: this is a workflow or functional gap, not a security or data-integrity problem.

## R14: A scheduled activation lapses only when the retirement count changes, not when the set of retired items changes

Owner S2-FIX. Severity minor. Area menus. `supabase/migrations/20261118103000_menu_scheduled_activation.sql:394`.

**Scenario.** Active menu A = {x,y,z}. Draft D = {x,n} is scheduled, and the admin confirms 2 retirements (y,z). Before D is due, an admin activates another draft E = {x,z,w}. D now retires {z,w}: still 2 items, so menu_promote_due's check (menu_retired_count <> scheduled_retirements) passes. D activates and retires w, which nobody confirmed, from current coverage. The header comment promises that a schedule whose retirements changed lapses. The same gap exists for any change to the active menu that keeps the count the same.

**Fix.** At schedule time, store the confirmed retirement set: a sorted uuid[] of item_ids, or a hash of it, in a new scheduled_retired_items column. In menu_promote_due, lapse with 'retirements_changed' when the current menu_retired_items set differs, not just the count.

**Verifier.** The claim holds. I read supabase/migrations/20261118103000_menu_scheduled_activation.sql and searched every later migration for anything that would guard against it. Nothing does.

1. Only the count is stored. schedule_menu_version (lines 309-312) saves `scheduled_retirements = v_count`, a single integer. The columns at lines 41-50 hold no item ids or hash of the confirmed set.
2. Only the count is checked. At line 394, menu_promote_due lapses the schedule only when `private.menu_retired_count(v_version.id) <> v_version.scheduled_retirements`. menu_retired_items (lines 81-97) works out the retired set again from whatever menu is active at promotion time, and then it is only counted.
3. Nothing stops the active menu changing while a draft is scheduled. activate_menu_version_confirmed (lines 231-266) only clears the schedule on the draft it activates. It does not check for, block or clear another draft's schedule at the same venue. menu_activate_locked (lines 157-194) changes only the new draft and the old active version, so the scheduled draft's revision stays the same and the 'draft_changed' check at line 390 does not fire either. The schedule-cleared trigger (lines 199-220) fires only when that draft's own revision changes. No other trigger on menu_versions or menu_entries in earlier migrations bumps other drafts' revisions. No 20261118* migration redefines menu_promote_due or touches scheduled_retirements. The only other reference, line 256 of 20261118103200_menu_change_requests.sql, is a read.
4. The scenario plays out as described. Active A={x,y,z}. D={x,n} is scheduled with 2 confirmed retirements (y,z). The admin then activates E={x,z,w} through activate_menu_version_confirmed. When D is due it would retire {z,w}. The count is still 2, so D activates and retires w, which nobody confirmed.
5. The existing test does not cover this. tests/security/menus-schedule.test.ts lines 300-347 test 'retirements_changed' only for a count change, from 1 to 2.
6. The behaviour breaks what the header (lines 18-19) promises: "A schedule whose draft or retirements changed since it was confirmed lapses instead". It also falls short of AC28's intent that retirements are explicitly confirmed.

I rate it medium rather than high. Only an admin can trigger it, and it needs a second activation while a draft is scheduled. Retiring an item removes the dish from current coverage, but its photos, labels and history are kept, so nothing is lost and it can be undone. The proposed fix looks right: store a sorted uuid[] or hash of the retired item ids at schedule time, and compare sets in menu_promote_due. An alternative is to make activate_menu_version_confirmed lapse or refuse any other draft scheduled at the same venue.

## R15: Legacy activate_menu_version stays granted and skips the retirement confirmation (AC28)

Owner S2-FIX. Severity minor. Area menus. `supabase/migrations/20261030120000_menu_catalogue.sql:1174`.

**Scenario.** 20261118103000 keeps public.activate_menu_version(uuid,integer) 'for compatibility' and executable by authenticated. Any active admin can call it over PostgREST to activate a draft that drops items from the current menu without confirming the retirement count. That defeats activate_menu_version_confirmed / menu_retirements_unconfirmed (AC28). It also leaves the draft's schedule columns in place and writes no retirements detail. The app no longer calls it (lib/server/menus/index.ts uses activate_menu_version_confirmed).

**Fix.** In the S1-MENUS migration, revoke execute on public.activate_menu_version(uuid, integer) from authenticated. Or replace its body with a call to private.assert_menu_retirements(p_version_id, NULL), so it fails whenever there are retirements.

**Verifier.** The claim checks out. public.activate_menu_version(uuid, integer) is defined at supabase/migrations/20261030120000_menu_catalogue.sql:1174 and granted to authenticated at lines 1394-1400. supabase/migrations/20261118103000_menu_scheduled_activation.sql:31-32 says it "stays for compatibility". No later migration touches it: grep finds it only in 103000, in comments. Its body runs the draft, revision, needs_review and empty checks, then retires the old version and activates the new one. It never calls private.assert_menu_retirements or menu_retired_count. So an active admin calling rpc('activate_menu_version') over PostgREST can activate a draft that drops items from the current menu without the count confirmation that activate_menu_version_confirmed enforces (menu_retirements_unconfirmed, AC28). Its 'activated' event also has no 'retirements' detail.

No other guard covers this:

- No trigger on menu_versions checks retirements. The only new trigger, menu_versions_schedule_cleared, fires only when status stays 'draft' and the revision changes.
- RLS does not apply, because the function is security definer.
- lib/server is not involved; callers go straight to PostgREST.

Why severity is low:

- Only callers who pass private.assert_active_admin() can do this. That same admin could call activate_menu_version_confirmed with the count from menu_version_activation_impact. The bypass weakens a confirmation step, not an authorisation boundary, so nobody gains privilege.
- The schedule-columns part is harmless. If the legacy function activates a scheduled draft, scheduled_* stays set on the now-active version. menu_promote_due only selects status='draft', the one-scheduled-per-venue index only covers drafts, and the column comment says the value is "Kept on the version after promotion as its record".

Caveat on the fix: revoking execute from authenticated would break existing callers. tests/security/menus-db.test.ts (lines 248, 293, 325, 333, 423, 892), tests/security/menus-fixtures.ts:86, tests/e2e/coverage-acceptance.spec.ts:200 and tests/migrations/sibling-era-seed.sql all still call activate_menu_version. Alternative: replace the body with a call to private.assert_menu_retirements(p_version_id, NULL). Activations with no retirements keep working, so the fixtures should pass.

## R16: Space-photo freshness never reaches coverage or export: expired or needs-replacement photos still count as covered and still export as public

Owner S2-INT. Severity blocking. Area facts. `supabase/migrations/20261118104000_facts_freshness.sql:55`.

**Scenario.** The 104000 header says the S1-COV coverage function reads private.area_photo_freshness. No migration does. private.coverage_check_due (20261118100200_coverage_slots.sql:62) is still the `select false` stub, and nothing in 20261118* replaces it. private.export_candidate_rows (20261118105000_export_packages.sql:349-360) keeps an area photo as long as its latest decision is 'accepted'. Example: a manager sets an end date on the garden photo (area_photo_set_end_date) or marks it replacement_needed after a renovation. area_photo_freshness_list then shows expired or needs_replacement, but coverage_slots still counts the garden as covered, and the photo stays an approval_level 'public' export and publication candidate. This breaks AC30 and spec §9.3 ('past it, the photo leaves eligibility'). The same gap means an area photo past its 90-day space_photo rule is never check_due in coverage.

**Fix.** Add a forward migration that replaces private.coverage_check_due for p_kind='area'. It should return true when any public-level accepted label of the subject has private.area_photo_freshness(label) ->> 'state' in ('check_due','needs_replacement','expired'). Expired and needs_replacement should probably drop the photo from covered entirely, not just mark it check_due. In export_candidate_rows' area CTE, public mode should keep only labels whose freshness state is 'current'; that also makes export_package_stale invalidate packages built before the photo expired.

**Verifier.** The defect is real. I read the migrations and could not refute it.

(1) private.coverage_check_due (20261118100200_coverage_slots.sql:62-71) is still `select false`. It is created once and never replaced: a grep across all migrations, 20261118* included, finds no other definition, and coverage_slot_rows is not redefined either. In the coverage `area` CTE (lines ~124-133), has_public is `bool_or(action='accepted' and review_level='public')` over the latest area_photo_decisions row only. Nothing reads area_photo_checks or private.area_photo_freshness, so an expired, needs_replacement or 90-day-overdue garden photo still reads 'covered' (line 175-176). Outside its own migration, private.area_photo_freshness is called only from area_photo_set_end_date and area_photo_freshness_list in 104000. The header line 55 ("The coverage function (S1-COV) reads private.area_photo_freshness") is false.

(2) private.export_candidate_rows (20261118105000_export_packages.sql:349-360) keeps an area label when its latest decision is 'accepted', and line 398 sets approval_level to 'public' when ar.action='accepted'. The only asset gate is media_asset_use_state, which is not 'withdrawn'. area_photo_checks is never consulted. The 105000 header (line 39-40) defers this: "fact freshness (S1-FACTS) land in parallel; when they do, export_candidate_rows is the single place to tighten". No later migration (105100-107200) does that tightening; grep finds no freshness references there.

(3) None of the writers changes decisions or asset state. area_photo_set_end_date, area_photo_report_change(p_replacement=true) and area_photo_reconfirm only insert into append-only area_photo_checks. They do not insert into area_photo_decisions or touch media_assets, so neither coverage nor export sees the change.

(4) Nothing in the app layer compensates. lib/server/knowledge/facts.ts only exposes the freshness list. docs/plans/full-app-v1/sprint2-handoff.md:38 lists "Freshness into coverage: replace the stub private.coverage_check_due ... private.area_photo_freshness(label_id) for places" as open Sprint 2 work, which confirms the gap. The sprint plan's S1-FACTS scope ("review-due excluded from coverage numerator and public exports", AC30) is unmet on this branch.

Scenario: a manager calls area_photo_set_end_date(garden_label, yesterday-or-today) and the date passes, or calls area_photo_report_change(garden, 'renovated', true). area_photo_freshness_list then shows expired or needs_replacement. coverage_slots still counts the garden as covered, and export_candidates(public) still returns that asset with approval_level='public'.

Severity is medium. It is a documented, known-deferred correctness gap, not a security hole: stale photos can be exported and published as public, and coverage overstates completeness.

## R17: Changing an accepted area photo's review level silently resets its freshness and clears reported changes and end dates

Owner S2-INT. Severity should-fix. Area facts. `supabase/migrations/20261118104000_facts_freshness.sql:822`.

**Scenario.** private.area_photo_freshness takes v_latest as the newest area_photo_decisions row and only reads area_photo_checks with created_at >= v_latest.decided_at. decide_area_photo_level (20261118100100_coverage_decisions.sql:347-356) allows accepted -> accepted when the level changes, and it inserts a new decision row. Example: staff report a change and a manager marks the bar's photos replacement_needed, or an end date has passed. Any manager then toggles the photo reference -> public, or calls decide_area_photo on a reference photo, which re-accepts it as public. The new acceptance hides every earlier check. The photo reads 'current', and its verifiedOn and 90-day clock restart from the level change, though no one re-inspected the place and no new photo was taken.

**Fix.** Anchor freshness to the first acceptance in the current accepted run, not the latest decision row. Take the latest decision whose action is not 'accepted', then the earliest 'accepted' after it. Or keep reading checks from that run start, so a level-only change does not discard change_reported, replacement_needed or end_date_set rows. Alternatively, have decide_area_photo_level refuse a level change while the photo is check_due, needs_replacement or expired.

**Verifier.** I tried to refute this by reading the code and could not. The defect is real.

**Freshness anchors on the newest decision row.** `private.area_photo_freshness` (`20261118104000_facts_freshness.sql:801-860`) takes `v_latest` as the newest `area_photo_decisions` row (`order by d.id desc limit 1`). It only checks that row's action is 'accepted'. All three check queries filter on `c.created_at >= v_latest.decided_at`:

- `end_date_set`
- `reconfirmed`, `change_reported` and `replacement_needed`
- the `max(checked_on)` basis

`v_basis` falls back to `v_latest.decided_at` when no reconfirmation follows it.

**A level-only change writes a new 'accepted' row.** In `decide_area_photo_level` (`20261118100100_coverage_decisions.sql:284-365`), the no-op short-circuit fires only when the level is also unchanged: `v_current = p_action and (p_action <> 'accepted' or v_current_level = v_level)`. The allowed transitions include `v_current = 'accepted' and p_action in ('accepted','withdrawn')`. So accepted reference to accepted public, or the reverse, inserts a fresh 'accepted' row with `decided_at = now()`. `decide_area_photo` (line 368) always passes 'public', so calling it on an accepted reference photo does the same.

**Managers can call both.** Both functions are granted to `authenticated` (line 729) and gated by `can_manage_venue`. The only restriction is self-review. They are used from `lib/server/area-photos.ts` and `lib/server/album.ts`.

**No later migration fixes it.** No later migration redefines either function; only these two files touch them. The header of facts_freshness (line 57) says "Not touched: area_photo_decisions and decide_area_photo (S1-COV adds review levels)". That suggests the two migrations were written in parallel and the level-change row was never considered.

**Effect.** After a level toggle, every earlier `change_reported` or `replacement_needed` check and every earlier end date fall before `v_latest.decided_at`. They are ignored. The photo reads 'current', and its verifiedOn and the space_photo clock restart at the toggle, with no reconfirmation and no new photo.

**Why this matters beyond reconfirmation.** `area_photo_reconfirm` can legitimately clear `check_due` or `needs_replacement`, but it can never clear a passed end date: the end-date query ignores reconfirmations. A level toggle silently clears expiry, which no intended path allows. The audit trail also loses the link between the outstanding report and the photo's state.

**Not critical.** Only a venue manager or admin who did not upload or label the photo can trigger it, and the history rows stay, because the tables are append-only. That is why I rate it medium.

## R18: Export candidates ignore review_level: reference-only dish and area photos export as public (FA-31)

Owner S2-INT. Severity should-fix. Area facts. `supabase/migrations/20261118105000_export_packages.sql:343`.

**Scenario.** 20261118100000_coverage_review_level.sql adds review_level ('public' | 'reference') to menu_item_photos and area_photo_decisions. The export CTEs that run after it still test only p.state = 'accepted' (menu) and d.action = 'accepted' (area), and label those rows approval_level 'public'. Example: a manager keeps a staff photo 'as reference', which means it is not for guests. The photo still appears in public export_candidates, can be packaged and downloaded through the website or social profiles, and can be recorded as published. This contradicts FA-31: a reference photo never closes a public requirement and is not public. The header (lines 39-40) says to tighten this function once S1-COV lands; that was not done.

**Fix.** In export_candidate_rows, compute approval_level = 'public' only when the decision is accepted and review_level = 'public', for both p.review_level and the area decision's review_level. Treat accepted reference photos as internal-only rows. Add the review level to approval_version so export_package_stale invalidates packages when the level changes.

**Verifier.** Confirmed by reading the code. In supabase/migrations/20261118105000_export_packages.sql, private.export_candidate_rows filters menu photos with `p.state = 'accepted'` (line 344) and area labels with `d.action = 'accepted'` (line 359). It then sets approval_level to `case when m.state = 'accepted' then 'public'` (line 391) and `case when ar.action = 'accepted' then 'public'` (line 398). Neither check reads review_level. The final filter `where p_mode = 'internal' or r.approval_level = 'public'` therefore lets reference photos into public mode.

A reference photo really does have an accepted state. 20261118100000_coverage_review_level.sql adds review_level ('public'|'reference') to menu_item_photos and area_photo_decisions. On areas, the constraint `action = 'accepted' or review_level = 'public'` means a reference decision is always stored with action='accepted'. In 20261118100100_coverage_decisions.sql, the menu level setter (around line 245) changes only review_level and revision and keeps state='accepted'. The area decider (around line 360) inserts a new decision row with action='accepted' and review_level='reference'.

The coverage code itself applies the stricter rule. It requires `review_level = 'public'` in the same migration (lines 87, 100, 123, 618, 624) and in 20261118100200_coverage_slots.sql (lines 125-137). That shows the intended FA-31 semantics.

Nothing later fixes it. No later migration redefines export_candidate_rows (grep found no `create or replace` of it). 20261118105100_publication_records.sql:213 and 20261118105300_export_asset_thumb.sql:40 call it with 'public' and inherit the bug. lib/server/exports/service.ts passes export_candidates and export_package_create straight through to the RPC with no review-level filter.

The header at lines 38-39 says export_candidate_rows is "the single place to tighten" once S1-COV lands, and that tightening was never done.

Scenario: a manager keeps a dish or area photo as reference. It still appears in the public export_candidates, can go into a package and be downloaded under a public profile, and can be recorded as published.

One small correction to the proposed fix: invalidation already partly works. A menu level change bumps `revision`, which is the approval_version. An area level change inserts a new decision row with a new id, which is the approval_id and approval_version. So existing packages built before a reference change are probably detected as stale already. The core defect, reference photos being listed and packaged as public, is real.

## R19: "Still right" for a place can be backdated to before a reported change and still clear it

Owner S2-FIX. Severity minor. Area facts. `supabase/migrations/20261118104000_facts_freshness.sql:914`.

**Scenario.** area_photo_reconfirm accepts any checked_on from today back to 30 days before. area_photo_freshness picks the latest check row by id, so a reconfirm inserted after a change_reported or replacement_needed row returns the photo to 'current'. The day the manager says they checked is never compared with the report time. Example: staff report on 15 Nov that the patio was closed for works. On 18 Nov a manager reconfirms with checked_on = 10 Nov, an inspection made before the change. The photos become current, with verifiedOn 10 Nov and nothing raised as due.

**Fix.** In area_photo_reconfirm, reject a checked_on earlier than the venue-local date of the latest change_reported or replacement_needed row since the current acceptance (invalid_value on checkedOn). Or have area_photo_freshness treat a reconfirm whose checked_on predates the latest report as not clearing it.

**Verifier.** I read the code in /Users/amankumarshrestha/LapenInns Project/platform/nabalens/supabase/migrations/20261118104000_facts_freshness.sql and the scenario can happen as described.

1. public.area_photo_reconfirm (lines 892-933) checks only `v_checked > v_today or v_checked < v_today - 30`. It never reads area_photo_checks for an earlier change_reported or replacement_needed row. It then inserts a 'reconfirmed' row with that checked_on for every accepted label of the place.

2. private.area_photo_freshness (lines 801-870) picks v_last as the newest of the reconfirmed, change_reported and replacement_needed rows, ordered by id desc and limited to rows created since the latest acceptance. Only a report row as v_last gives check_due or needs_replacement. A reconfirm inserted later has a higher id, so it becomes v_last and the code falls through to the policy path. There v_basis = greatest(acceptance date, max(checked_on)), so with the backdated date the state is current and verifiedOn is that date (or the acceptance date if later). Nothing compares checked_on with the report's created_at.

3. Nothing else blocks it:

- The server layer (lib/server/knowledge/facts.ts reconfirmSpace, about line 156) only runs optionalDate on checkedOn and passes it to the RPC.
- No later 20261118* migration redefines either function. grep finds area_photo_reconfirm and area_photo_freshness only in this migration.
- The table's checks only require checked_on to be present on reconfirmed rows.
- RLS is not involved, because the function is security definer.

4. The sibling knowledge_reconfirm in the same file (lines 662-748) has the guard that is missing here. It rejects `v_checked < v_saved`, a date before the answer ("not before the answer" in its comment). It also refuses a disputed or reopened answer with knowledge_reconfirm_not_allowed. So the area photo version is inconsistent with the stated design.

Mitigating factors:

- Only a venue manager or admin can do this, through the can_manage_venue check.
- The date can only go back 30 days.
- Clearing a report with today's date is intended behaviour.

The harm is a misleading record: a check made before the reported change clears the report, and verifiedOn shows an inspection that does not cover it. That is why severity is low.

## R20: Public export eligibility ignores review_level: reference-approved dish and place photos are exported and published as public (FA-31)

Owner S2-INT. Severity blocking. Area export. `supabase/migrations/20261118105000_export_packages.sql:344`.

**Scenario.** 20261118100000 added menu_item_photos.review_level and area_photo_decisions.review_level ('public' | 'reference'). A reviewer marks a dish photo 'Kept as reference' (state='accepted', review_level='reference'). private.export_candidate_rows (menu CTE, line 344; area CTE, line 359) only tests p.state = 'accepted' / d.action = 'accepted', and sets approval_level 'public' from state alone (lines ~391 and ~398). So the reference photo is returned by export_candidates(venue,'public'), a manager can put it in a public package, and nothing marks it internal_only. publication_record('published') passes because it uses the same candidate rows, and publication_pairs reports it as published_confirmed. Spec §14.1 says reference material goes only in a separate internal/reference export. The comment at line ~39 of the header ('when they [review levels] land, export_candidate_rows is the single place to tighten') was never acted on, even though S1-COV's migration runs before this one.

**Fix.** In export_candidate_rows, define public approval as menu: p.state = 'accepted' and p.review_level = 'public'; area: d.action = 'accepted' and d.review_level = 'public'. Rows that are accepted at reference level go in internal mode only, with approval_level 'internal' (they then get the internal_only restriction). Include review_level in approval_version so a public-to-reference change makes existing packages stale (export_package_stale compares approval_id only for menu items, and the photo id does not change when the level changes).

**Verifier.** I tried to refute the claim and could not. The code on the current head behaves as described.

1. The column exists and a reviewer can set it. 20261118100000_coverage_review_level.sql adds review_level ('public' | 'reference', default 'public') to menu_item_photos (line 62) and to area_photo_decisions (line 100). On the dish table it is a mutable column. In 20261118100100_coverage_decisions.sql around lines 245-254, a level change runs `update ... set review_level = p_level, revision = revision + 1` and leaves state = 'accepted'. For places, a new decision row is written with action 'accepted' and review_level 'reference', which the area_photo_decisions_level constraint permits. Coverage code in 100100 and 100200 does filter on `review_level = 'public'`, so the rule was applied there.

2. Export eligibility ignores the column. private.export_candidate_rows in 20261118105000_export_packages.sql:

- The menu CTE filters only on `p.state = 'accepted' or (internal and ...)`.
- The area CTE takes the latest decision and filters only on `d.action = 'accepted' ...`.
- The rows CTE sets approval_level with `case when m.state = 'accepted' then 'public'` and `case when ar.action = 'accepted' then 'public'`.
- review_level is never selected. The final `where p_mode = 'internal' or r.approval_level = 'public'` therefore lets reference photos through in public mode.

3. No later code adds a guard. I grepped every migration for review_level, and the matches are only in 100000, 100100 and 100200. export_candidate_rows is never redefined. Its other callers all use it unchanged:

- 105100 publication_records (line 213, 'public')
- 105200 export_candidates (line 152) and the publication check (line 708, 'public')
- 105300 export_asset_thumb (line 40)

lib/server/exports/service.ts has no review-level filter. So export_candidates(venue, 'public') returns the photo, export_package_create accepts it, and the publication record and pairs checks pass on the same rows.

4. Staleness is also missed. When a dish photo goes from public to reference, the photo id stays the same (only revision bumps). export_package_stale compares only approval_id for public packages, so an existing public package is not marked stale. Area changes do write a new decision id, so place packages would go stale. However, the photo is still a public candidate under the new id, so a rebuild would put it back.

Mitigating context, which does not refute the claim: the gap is known. docs/plans/full-app-v1/sprint2-handoff.md, S2-INT item 4, says: "Exports use the review level. private.export_candidate_rows (S1-EXPORT) accepts only public-level decisions ... a reference photo is never exportable or publishable (AC16)". checklist.md S14.1-default-public is marked 'missing'. The defect is real on the integrated Sprint 1 head and is scheduled for Sprint 2, not yet fixed.

Separately, the amenity branch does not consult the new amenity_photo_decisions table either. That is a related gap, not part of this claim.

## R21: Amenity photos are public-exportable without any amenity photo review and with any in-force grant, including internal-audience grants

Owner S2-INT. Severity blocking. Area export. `supabase/migrations/20261118105000_export_packages.sql:369`.

**Scenario.** The amenity CTE treats every photo-evidence asset on the check's current submission as a candidate. It never reads public.amenity_photo_decisions (FA-32, 20261118100000/100100). public_ok (line 381) is only `use_state = 'granted' and knowledge_public_media_eligible(...)`, and private.media_asset_use_state returns 'granted' when any grant of any audience, destination or subject is in force. Case 1: an amenity photo the reviewer marked not_used, needs_another_photo, withdrawn or reference-only, with an internal-audience grant (or a public grant for another subject), is listed as approval_level 'public' and can be exported and recorded as Published. Case 2: an asset whose public grant was withdrawn but which still has an internal grant reads as 'granted', so a public withdrawal does not invalidate public packages for it.

**Fix.** Join the latest amenity_photo_decisions row per (check_id, asset_id). For public use require action = 'accepted' and review_level = 'public', and use that decision's id as approval_id/approval_version. Replace use_state = 'granted' with an audience-specific check: a public-audience media_use_grants row in force for this asset (and question subject_key) with no withdrawal. Internal mode can keep the broader set, marked internal.

**Verifier.** I confirmed the logic defect in the code. I also checked the guards and could not find one that stops it once grants exist.

1. In `supabase/migrations/20261118105000_export_packages.sql`, the `amenity` CTE (around lines 362-377) takes every `evidence_kind='photo'` asset on `c.current_submission_id` as a candidate. It never joins `public.amenity_photo_decisions`. That table comes from FA-32 in 20261118100000; its comment says "The latest row per (check, photo) is its state", and its actions are accepted (public or reference), needs_another_photo, not_used and withdrawn. The menu and area CTEs do filter on their own decision rows. The amenity CTE does not, so a photo marked not_used, needs_another_photo, withdrawn or reference-only is still a candidate. Its `approval_id` is the submission id, not a decision id, so `export_package_stale` (which compares `approval_id`) cannot notice a later photo decision either.

2. `public_ok` (line 381) is `use_state = 'granted' AND knowledge_public_media_eligible(...).eligible`. `private.media_asset_use_state` (in 20261113140000 at lines 335-355) returns 'granted' when `bool_or(state='in_force')` holds for any `media_use_grants` row on the asset. It ignores `audience`, destination, purpose and subject. The `media_use_grants` table does have an `audience` column ('internal' or 'public').

`knowledge_public_media_eligible` (in 20261110104955 at line 709) only checks the question: its public_media setting, scope, policy, availability and freshness. It never looks at the asset's grants. The migration's own header promises "a public use grant is in force", and the code does not enforce that.

3. Case 2 also holds. If an asset's public grant is withdrawn but an internal grant is still in force, `use_state` stays 'granted'. The asset stays in `usable` and stays `public_ok`, so public packages are not invalidated.

4. No later fix exists. 105100, 105200 and 105300 only call `export_candidate_rows` and do not redefine it. `lib/server/exports/service.ts` has no amenity filter.

5. Why it cannot happen today: `media_use_destinations` is never seeded ("rows by migration only", and no insert exists anywhere in `supabase/`). The only clearance version, 'proposal-1', is inserted with `active=false`. `media_use_grant_create` needs both an active destination and an active clearance version, and it refuses any `p_profile_key` with `profile_unavailable`, so no public-audience grant can be created at all. That means no grant exists today, `use_state` is never 'granted', and every amenity row comes out `approval_level='internal'`.

As soon as the owner activates a clearance version and a migration adds an internal destination, the only grants anyone can create are internal ones. One example: purpose `general_gallery` with subject `none`, which skips the per-question eligibility check inside grant_create. Any such grant would make that venue's amenity photos public-exportable whenever their question has `public_media='with_grant'`, whatever their FA-32 decision says.

The proposed fix is correct. Join the latest `amenity_photo_decisions` row per (check_id, asset_id); require action='accepted' and review_level='public' for public mode; use that decision id as the approval id and version. Replace the `use_state='granted'` test with a check for an in-force grant with audience='public' and no withdrawal, matching the asset and the question's `subject_key`.

## R22: Admin removal of an accepted asset does not check manual publication records, so 'never while it is published' is not enforced

Owner S2-INT. Severity should-fix. Area export. `supabase/migrations/20261118107100_media_removal.sql:404`.

**Scenario.** admin_delete_media_asset blocks only when media_use_grants has an active public grant (publicUses). Menu and place photos become public-exportable and publishable without a grant: export_candidate_rows needs only use_state <> 'withdrawn'. publication_record also accepts 'published' for a photo with use_baseline 'legacy_unknown' or 'not_granted'. So an admin can preview the impact (which says nothing about publication_events) and soft-delete a file recorded as Published (confirmed) on the venue's website. The header promises the removal never happens while the file is published, and spec §16 says published references must be handled first. The publication then silently turns to withdrawal_pending.

**Fix.** In media_removal_impact_of, add a 'publications' count: private.publication_pairs(array[venue]) rows for the asset in state published_confirmed, or withdrawal_pending where the latest action is published. Block admin_delete_media_asset (media_asset_published) while that count is greater than 0, the same way publicUses blocks it.

**Verifier.** The defect is real. I traced the full path and found no other guard that stops it.

1. The removal guard only looks at grants. In 20261118107100_media_removal.sql, `media_removal_impact_of` has no field for publications; its counts cover menu items, areas, coverage sends, amenity answers, public and internal grants, and open requests. `admin_delete_media_asset` (about line 404) only raises `media_asset_published` when `publicUses > 0`, which counts `media_use_grants` rows with `audience = 'public'` that are not withdrawn or expired. `media_removal_impact` sets `blocked` from `publicUses` alone. Nothing reads `publication_events` or `private.publication_pairs`.

2. A photo can be recorded as published without any public grant. `publication_record` (20261118105200, lines 616-747) is admin only. For the `published` action it only needs a row from `private.export_candidate_rows(venue, 'public')`. In 20261118105000 (lines 299-411), `usable` only drops assets whose use_state is `withdrawn`. `media_asset_use_state` (20261113140000:335) returns `legacy_unknown` or `not_granted` when no grant exists. So an accepted menu photo (`p.state = 'accepted'`, item on the active menu) or an accepted place photo comes out at `approval_level = 'public'` with no grant. Only amenity photos need a public grant in force (`public_ok`). Having just an internal grant gives use_state `granted`, and `publicUses` is still 0.

3. Nothing else blocks the removal. The later migrations in 20261118* add only these triggers on `media_assets`: the pipeline guard (102000), `activity_on_media_removed` (106000) and notifications (106200). None of them checks publications. The server wrapper `removeAcceptedMediaAsset` in lib/server/lifecycle/removal.ts calls the RPC directly. It then also deletes the storage objects through `removeTombstonedObjects`.

4. Result: `deleted_at` is set, so the asset drops out of `export_candidate_rows`. `publication_pairs` then shows the destination as `withdrawal_pending`, because the latest action is `published` and the file is no longer eligible. The original file is gone while the venue's website still shows it.

5. This breaks the stated rules. The migration header says an admin removes an accepted asset "never while it is published", and `lib/media/removal.ts:4` says the same. Spec §16 (docs/spec/NabaLens-Full-App-Specification-v1.0.md) says "Published references, dependent renditions and required history must be handled first."

6. One point against the claim: the header does define its refusal as "Refused while a public use grant is active (media_asset_published)". The narrower check therefore looks deliberate. Even so, it does not meet the header's own wording or §16, because Published (confirmed) records exist without grants.

Severity is medium. Only an admin can do it, after a preview, and the record shows the result as withdrawal pending. Still, a confirmed publication can lose its original with no warning or block. The proposed fix fits: count rows from `publication_pairs` for the asset that are `published_confirmed`, or `withdrawal_pending` with `latest_action = 'published'`. Include that count in the impact (and so in the token), and block on it.

## R23: export_candidates and export_package_detail rebuild the whole venue's candidate set once per row (quadratic work)

Owner S2-FIX. Severity minor. Area export. `supabase/migrations/20261118105200_export_publication_api.sql:150`.

**Scenario.** Every candidate row calls private.publication_asset_state(asset). That calls private.publication_pairs(array[venue]), which scans the venue's publication_events, and whenever any published record exists it re-runs private.export_candidate_rows for the whole venue. Each of those runs calls media_asset_use_state per asset and knowledge_public_media_eligible per amenity check. A venue with a few hundred candidates and one published record does hundreds of full candidate evaluations in one stable RPC, so the export selection screen can hit statement timeouts. export_package_detail (up to 200 items) and export_packages_list (export_package_stale per package, up to 100) have the same pattern.

**Fix.** Work out the publication pairs and the eligible set once per call: call publication_pairs(array[venue]) one time in export_candidates and join it to the candidate rows by asset_id, or add a set-returning publication_asset_states(venue, asset_ids[]) helper.

**Verifier.** I read the code and the claim holds. No later migration redefines these functions: grep across 20261118*.sql finds publication_asset_state and publication_pairs defined only in 20261118105100_publication_records.sql.

1. Per-row call. In 20261118105200_export_publication_api.sql:150, public.export_candidates calls private.publication_asset_state(c.asset_id) in the select list once for every row of private.export_candidate_rows(v_venue.id, p_mode). There is one row per (asset, subject) pair, so an asset with several subjects is evaluated several times.

2. Nothing caches it. publication_asset_state (105100:233) is a security definer SQL function with SET search_path. Postgres cannot inline such a function and does not memoise scalar calls in a select list. Every call runs `cross join lateral private.publication_pairs(array[a.venue_id])` again.

3. The rebuild. publication_pairs (105100:171) has a CTE `venues as (select distinct l.venue_id from latest l where l.action = 'published')` and a CTE `eligible as (... cross join lateral private.export_candidate_rows(v.venue_id, 'public') c)`. The final select left-joins eligible, so both CTEs are evaluated once per publication_pairs call.
   - If the venue has any published record, each call re-runs export_candidate_rows for the whole venue.
   - Each of those runs calls private.media_asset_use_state(a.id, now()) for every ready image at the venue (105000:325). It also calls knowledge_public_media_eligible and knowledge_check_service_end for each amenity row.
   - Total work is about candidates × venue assets. If the venue has no published record, venues is empty and the lateral never runs, which matches the scenario's condition.

4. The same pattern elsewhere.
   - export_package_detail (105200:332) calls publication_asset_state for every package item. There are up to 200 items, and each call does the same full-venue rebuild.
   - export_packages_list calls export_package_json(p, true) for up to 100 packages. That calls export_package_stale, which runs export_candidate_rows per venue per package. This one is linear in packages, but each step is a full evaluation.
   - export_package_detail also calls export_package_stale once.

5. Nothing elsewhere prevents it. Neither the RLS checks nor the access checks limit the row count, and every function involved is STABLE with no shared materialisation.

Severity is medium. The results stay correct; the cost is performance only. A venue with a few hundred candidates and one published record would mean roughly 10^4 to 10^5 media_asset_use_state evaluations in one RPC, which could plausibly hit Supabase's statement timeout for authenticated users (8 s by default) on the export selection or package detail screen.

The proposed fix is sound. Compute publication_pairs(array[venue]) once per call and join it to the candidate rows by asset_id, or add a set-returning helper that takes the venue and an array of asset ids.

## R24: Venue managers resolved through the profile's active venue only, so multi-venue managers get no digest and venues show a false 'no manager' setup gap

Owner S2-FIX. Severity should-fix. Area ops. `supabase/migrations/20261118106300_ops_monitoring.sql:186`.

**Scenario.** FA-22 (20261118101000) lets one person hold open manager memberships and grants at venues A and B, with profiles.venue_id set to whichever venue is active. private.ops_venue_managers calls private.effective_manager_venue_id(p.id), which (20261107100100) requires p.venue_id = g.venue_id. Take a manager whose active venue is A. (1) ops_run_notification_jobs never sends that manager a review digest for B, however long B's backlog has waited. (2) If that person is B's only manager, private.ops_exceptions reports B as 'venue_setup' with noManager=true, and every admin gets a weekly exception notice for a venue that does have a manager. Both results change whenever the person switches active venue.

**Fix.** Find managers per venue from memberships, not from the active-venue projection: `select p.id from public.profiles p where p.active and private.venue_role_of(p.id, p_venue_id) = 'manager'`. venue_role_of needs an open manager membership AND an open grant, and does not depend on profiles.venue_id. Add a test with a two-venue manager whose active venue is the other one.

**Verifier.** I tried to refute this and could not; the code works as the claim says.

1. Line 186 of supabase/migrations/20261118106300_ops_monitoring.sql: private.ops_venue_managers(v) returns the profiles where `private.effective_manager_venue_id(p.id) = p_venue_id`.

2. The latest definition of that function is in 20261107100100_manager_account_access.sql. It joins profiles on `p.venue_id = g.venue_id` and ends in `limit 1`, so it returns only the grant for the profile's active venue. No 20261118* migration redefines it or ops_venue_managers. A grep finds both names in only 20261118101000 and 20261118106300.

3. FA-22 (20261118101000_venue_memberships.sql) makes a two-venue manager possible. Line 281 drops the one-open-grant-per-person index and replaces it with one per person and venue. Memberships are per venue, and the header says profiles.venue_id is only the active-venue projection, which switch_active_venue changes. private.venue_role_of(p_user, p_venue) returns 'manager' when there is an open manager membership and an open grant at that venue, without reading profiles.venue_id.

4. The two places the claim names both use ops_venue_managers:
   - Line 409, the digest loop in ops_run_notification_jobs, notifies only the managers it returns. A manager whose active venue is A never gets B's review digest.
   - Lines 269-273 in ops_exceptions report 'venue_setup' with `noManager = not exists(ops_venue_managers(v))`. If that person is B's only manager, B is flagged as having no manager, and every admin gets a weekly notice for it (the period key is IYYY-"W"IW for venue_setup).

5. Nothing else blocks the scenario. private.notify checks only that the recipient is active and their preferences, not their active venue. There is no RLS on these security-definer paths. Both results flip when the person switches active venue.

One mitigating point: the grant table comment (101000:286) says a grant is "effective only for an active account whose active venue is the granted venue". So for access control the active-venue rule is on purpose. Monitoring is a different question: "does this venue have a manager" and "who should get its backlog digest" depend on membership, so the projection is the wrong source. venue_role_of(p.id, venue) = 'manager' is the right per-venue rule.

Severity is medium. No data is exposed or corrupted. The harm is digests that never reach a real manager, and repeated false 'no manager' notices to admins, for any manager of more than one venue.

## R25: Account activity trigger logs every active-venue switch as a role change and a venue change

Owner S2-FIX. Severity should-fix. Area ops. `supabase/migrations/20261118106000_ops_activity.sql:166`.

**Scenario.** public.switch_active_venue -> private.membership_switch_profile (20261118101100) updates profiles.venue_id and profiles.role, with nabalens.venue_switch='on' set to mark it as a switch, not a transfer. The 20261118101000 migration added a WHEN clause on that flag to the three legacy profile triggers, but profiles_activity has no such guard. A person who is staff at A and manager at B and switches A->B gets two activity_events rows: 'account_role_changed' {role: staff} -> {role: manager} and 'account_venue_changed'. The actor is themself, so admin Activity shows people changing their own roles. This floods the append-only audit log, cannot be cleaned up, and hides real role changes.

**Fix.** Create the trigger with the same guard as the legacy triggers: `after update of active, role, venue_id on public.profiles for each row when (coalesce(current_setting('nabalens.venue_switch', true), '') <> 'on') execute function private.activity_on_profile_change();`. Another option is to return early in the function when private.venue_switch_active() is true.

**Verifier.** I confirmed this by reading the code. Nothing later in the 20261118* migrations guards against it: grep finds no other reference to `profiles_activity` or `activity_on_profile_change`.

- **The trigger has no guard.** `supabase/migrations/20261118106000_ops_activity.sql:166-168` creates `profiles_activity` as `after update of active, role, venue_id on public.profiles for each row execute function private.activity_on_profile_change()`. There is no WHEN clause. The function (lines 136-164) never checks `nabalens.venue_switch` or `private.venue_switch_active()`. It inserts `account_role_changed` when the role differs and `account_venue_changed` when venue_id differs, each through `private.record_activity`, with actor = `auth.uid()`.
- **The legacy triggers do have the guard.** `20261118101000_venue_memberships.sql:385-403` recreates `profiles_revoke_manager_grants`, `profiles_end_coverage_assignments` and `profiles_end_amenity_assignments`, each with `when (coalesce(current_setting('nabalens.venue_switch', true), '') <> 'on')`. The S1-PEOPLE report also says the three old side-effect triggers skip a switch.
- **The path to the bug.** `public.switch_active_venue` (`20261118101100:306-333`) checks that the user is active, not an admin, and a member of the target venue. It sets `v_role := private.venue_role_of(uid, p_venue_id)` and calls `private.membership_switch_profile(uid, p_venue_id, v_role)`. That function (lines 151-165) sets `nabalens.venue_switch` to 'on', then runs `update profiles set venue_id = p_venue, role = p_role` when either value differs. A non-deferred AFTER ROW trigger fires inside that statement, so it does fire. `venue_role_of` returns 'manager' for a venue where the person has a manager membership and an open grant, and 'staff' where they only have a staff membership. So a person who is staff at A and manager at B, switching A to B, gets two rows: `account_role_changed` {role: staff} to {role: manager}, and `account_venue_changed`. The actor is the person themselves, because `auth.uid()` is the caller and the profile exists. Any switch to another venue logs at least `account_venue_changed`.
- **Admin Activity shows them.** `lib/ops/activity.ts:115-116` labels these rows "Changed an account's role" and "Moved an account to another venue", which misdescribes a self-service switch.

Note on the proposed fix: `membership_switch_profile` is also called from the membership commands at lines 493, 560 and 578 of 20261118101100. Two of these, at lines 560 and 578, are admin role changes (demote to staff, promote to manager). A blanket WHEN guard would also stop those from writing `account_role_changed`. They do still write `manager_grant` rows to `coverage_audit_events` (granted/revoked), which may cover them. The fix needs to tell a self-service switch apart from an admin role change, for example by setting a separate flag only in `switch_active_venue`, or by having those admin paths call `record_activity` explicitly.

## R26: Admin Activity leaves out per-venue role grants and removals (venue_memberships / venue_manager_grants)

Owner S2-FIX. Severity minor. Area ops. `supabase/migrations/20261118106000_ops_activity.sql:201`.

**Scenario.** Under FA-22, an admin_set_venue_membership, remove_venue_member or manager_invite_staff call at a venue that is not the person's active venue writes only venue_memberships (and grants), not profiles. The profiles_activity trigger never fires for these, and no command calls private.record_activity (nothing outside the 106000/106100 migrations references it). private.activity_rows does not union venue_memberships or venue_manager_grants. So an admin making someone manager at a second venue, or a manager removing staff, never appears on the Activity screen, which spec A7 requires for role and venue changes.

**Fix.** Add venue_memberships to private.activity_rows: one 'membership_granted' row per open row (granted_at/granted_by/grant_reason) and one 'membership_ended' row per end (ended_at/ended_by/end_kind/end_reason), with object_type 'account' and the venue_id. Also consider venue_manager_grants grant and revoke events. Update the cursor source list to match.

**Verifier.** Mostly confirmed, with one correction: manager grants and revocations do show up in Activity. Staff membership grants and removals do not.

Not logged:

- private.activity_rows (supabase/migrations/20261118106000_ops_activity.sql:201-272) unions activity_events and 11 history tables. venue_memberships is not one of them.
- The only callers of private.record_activity are the two triggers in 106000 and admin settings (20261118106100_ops_settings.sql:278). lib/server/accounts/memberships.ts only makes the RPC calls and writes no audit row of its own.
- profiles_activity fires only `after update of active, role, venue_id on public.profiles`.

So these paths write only venue_memberships and leave nothing on the Activity screen:

- manager_invite_staff for an existing user at another venue (20261118101100_venue_membership_commands.sql:376-385). It calls only private.membership_ensure. For a brand-new user it inserts into profiles, and the update-only trigger does not fire either.
- admin_set_venue_membership(role 'staff') at a venue that is not the person's active venue (101100:557-565). It calls only membership_ensure, which may end the old row as 'role_changed' and insert a new one.
- remove_venue_member for a staff membership at a non-active venue (101100:468-497). It calls membership_end, and membership_switch_profile is skipped because v_p.venue_id <> p_venue_id. The only possible trace is coverage 'assignment auto_ended' rows, written only if the person had open assignments there.

Logged (the claim is wrong here):

- In admin_set_venue_membership, both the grant (101100:568-574) and the revoke (101100:551-557) insert into coverage_audit_events with entity 'manager_grant' and action 'granted' or 'revoked'.
- remove_venue_member also logs the revoke when it removes a manager membership (101100:462-472).
- coverage_audit_events is unioned in activity_rows as source 'coverage', so "admin makes someone manager at a second venue" does appear in Activity.

Changes at the person's active venue go through membership_switch_profile, which updates profiles, so profiles_activity does record them. No later 20261118* migration (106100-107200) redefines activity_rows or adds membership logging.

The proposed fix (union venue_memberships grant and end events into activity_rows) is valid. venue_manager_grants does not need adding, because coverage_audit_events already covers it.

## R27: 107000 recreates the three community reads from the 20261107 bodies and drops the M1 manager-era upload filter added in 20261110091603

Owner S2-FIX. Severity blocking. Area privacy. `supabase/migrations/20261118107000_privacy_colleague_media.sql:186`.

**Scenario.** 20261110091603_knowledge_b02c_review_repairs.sql (M1) added `a.uploader_role is distinct from 'manager'` to the community arm of community_readable_assets, to community_media_page and to the media_count in community_members. 107000 says its bodies are the ones from 20261107130000 and runs `create or replace` on all three, so that filter is gone in the shipped bodies (lines 186-201, 236-251, 280-296). Example: a manager account uploads general photos at venue X (uploader_role='manager'). An admin accepts one, then runs convert_manager_to_staff. That photo now shows up in colleagues' Photos feed and through /api/media/[id]/* for staff at venue X, and member counts include it. A staff-held venue manager at X sees all of that person's manager-era uploads, accepted or not, because media_visible_to_caller admits can_manage_venue. Before this migration none of these were visible to colleagues.

**Fix.** Restore `and a.uploader_role is distinct from 'manager'` in the community arm of community_readable_assets (next to is_community_member), in community_media_page's WHERE and in community_members' count subquery. Change the header comment to cite 20261110091603 as the base body, and add a regression test that a converted manager's accepted manager-era upload stays hidden from colleagues.

**Verifier.** The claim holds. 20261110091603 (M1) added `a.uploader_role is distinct from 'manager'` in three places: the community arm of community_readable_assets (line 60), community_media_page's WHERE (line 108) and community_members' media_count subquery (line 151). 20261118107000 rebuilds all three with `create or replace`. Its header (line 44) and per-function comments (lines 152, 208, 262) say the bodies come from 20261107130000, and none of the new bodies has the uploader_role filter. The only new condition is `private.media_visible_to_caller(a.id)`.

Nothing else restores the filter:

- No migration after 107000 (107100, 107200) touches these functions.
- No migration after 091603 other than 107000 redefines them. 095909 and 095910 only call community_readable_assets.
- The app code doesn't filter on uploader_role for these reads. The RPCs are the gate.
- media_visible_to_caller doesn't check uploader_role. It admits own media, can_manage_venue(a.venue_id), or can_view_venue_album plus asset_is_accepted.
- is_community_member checks only the uploader's current role being 'staff', and after convert_manager_to_staff (still defined in 091603, and it doesn't touch media) that check passes.

The scenario can happen:

- Managers can reserve 'general' purpose uploads, stored with uploader_role='manager' (upload pipeline, media_upload_venue_allowed).
- After conversion, a manager-era upload that has been accepted (menu, area, coverage or amenity) passes every check, so colleagues at the venue get it through community_readable_assets (the /api/media gate), see it in community_media_page, and media_count includes it.
- A staff-held venue manager at that venue gets these uploads even when they were never accepted, through the can_manage_venue arm.

The existing regression test (tests/security/manager-uploads.test.ts around line 765, 'keeps manager-era uploads out of colleagues' Photos after the account becomes staff (OD-9)') still passes only because the manager's upload `mine` is never accepted. Only the colleague's asset gets acceptAsset. The acceptance gate is hiding the missing uploader_role filter, so the OD-9 invariant is no longer tested for accepted assets.

Severity is medium: a privacy regression that needs an account conversion plus an accepted upload, or a staff-held manager at the venue.

## R28: delete_media_asset checks asset_is_accepted without locking the asset, so a concurrent acceptance lets staff permanently delete an accepted original (FA-21)

Owner S2-FIX. Severity should-fix. Area privacy. `supabase/migrations/20261118107100_media_removal.sql:210`.

**Scenario.** Every acceptance path locks the asset row first (review_menu_item_photo, coverage decisions at 20261118100100:226, area photos, all `select ... from media_assets ... for update`). delete_media_asset reads the asset with a plain SELECT, evaluates private.asset_is_accepted() at line 224, and only then runs UPDATE. Under READ COMMITTED: T1 (manager accepting the photo) holds the row lock and inserts the accepted decision. T2 (the uploader withdrawing) reads asset_is_accepted = false because T1 has not committed, then blocks on the UPDATE. T1 commits. T2 rechecks only `deleted_at is null`, which is still true, so it tombstones the asset. The app (lib/server/lifecycle/remove-media.ts) then deletes the stored original and derivatives with the service role. The result is an accepted original that a staff member removed irreversibly, with no admin reason and no impact snapshot, and with accepted menu, area or coverage rows still pointing at it.

**Fix.** Lock before deciding: `select a.uploader_id, a.venue_id, a.deleted_at into ... from public.media_assets a where a.id = p_asset_id for update;` and evaluate asset_is_accepted after taking the lock. This uses the same lock order as the review functions, so they serialize. Also make sure each accept path rechecks `deleted_at is null` after it takes the asset lock.

**Verifier.** I checked this against the code and the race is real. Nothing elsewhere closes it.

1. In `supabase/migrations/20261118107100_media_removal.sql`, lines 210-233, `delete_media_asset` reads `uploader_id`, `venue_id` and `deleted_at` with a plain SELECT (no FOR UPDATE). It then calls `private.asset_is_accepted(p_asset_id)` at line 224. That function (`20261118107000_privacy_colleague_media.sql:55`) is a STABLE SQL function that reads `menu_item_photos`, `coverage_submission_items`, `area_photo_decisions` and similar tables under the statement snapshot, so it cannot see a transaction that has not committed. Only after that does the function run `UPDATE media_assets SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL`.

2. The accept path locks the asset first. The latest `review_menu_item_photo` (`20261107100400_manager_item_photo_writes.sql`, "Lock order: asset row ...") runs `select a.* ... from public.media_assets a where a.id = p_asset_id for update`. It checks `deleted_at` after taking that lock, then inserts the accepted `menu_item_photos` row. The coverage path at `20261118100100:226` takes the same lock. So whichever transaction locks first, the deletion runs its check without the lock.

3. Interleaving under READ COMMITTED:
   - T1 (manager accepting) holds the row lock and has inserted the accepted row.
   - T2 (uploader withdrawing) does its plain select, sees `deleted_at` null and `asset_is_accepted` false, then blocks on the UPDATE.
   - T1 commits.
   - T2's UPDATE rechecks only `deleted_at is null`, which T1 did not change, so it sets the tombstone and logs a 'withdrawn' event.
     The same thing happens without any blocking if T1 commits between T2's check and T2's UPDATE.

4. No guard stops it.
   - No trigger on `media_assets` blocks setting `deleted_at` on an accepted asset. I checked `media_assets_guard`, `use_baseline_guard`, `pipeline_guard`, `discard_pending_labels`, `amenity_evidence_lost`, `knowledge_evidence_withdrawn`, activity and notify. These either clean up or log; none of them rejects the change.
   - The server does not recheck either. In `lib/server/lifecycle/remove-media.ts`, `removeMediaAsset` calls the `delete_media_asset` RPC. On success, `removeStoredObjects` checks only that `deleted_at` is set, then deletes every stored object for the asset with the service client.
   - The result: an accepted original is removed irreversibly by a staff member, with no admin reason or impact snapshot, and the accepted menu, coverage or area rows still point at it.

5. The proposed fix is correct. Adding `for update` to the initial select in `delete_media_asset` serializes it with the review functions, which already lock the asset row first. If the deletion waits for an acceptance, PostgreSQL re-reads the latest row version after the lock is granted, and `asset_is_accepted` then runs as a new statement that sees the committed acceptance. If the deletion commits first, review already rejects on `deleted_at` with `evidence_removed`.

Severity is medium: the window is narrow and needs two people acting at the same moment, only the uploader (or an admin) can trigger it, but the loss is a permanent storage deletion that bypasses the FA-21 retention rule.

## R29: FA-23 gap: private.can_read_asset_labels admits admins by p.role = 'admin' without aal2, so an aal1 admin session can read every venue's labels

Owner S2-INT. Severity should-fix. Area privacy. `supabase/migrations/20261118107200_admin_mfa.sql:25`.

**Scenario.** 107200 only requires aal2 in private.is_active_admin() and says every admin path goes through it. The latest private.can_read_asset_labels (20261110090145_knowledge_b02c_manager_upload_and_labels.sql:487, first defined in 20261030120100_media_labels.sql:219) checks `p.role = 'admin' and a.upload_state = 'ready'` directly. That function is the RLS SELECT policy on public.media_labels and public.media_label_items (20261030120100:306-309). An admin who signs in with a password but has not passed TOTP (or a stolen password with no second factor) can query /rest/v1/media_labels and media_label_items with the aal1 JWT and read label rows (content types, notes, menu item links) for every ready asset at every venue. The app's /auth/mfa redirect does not stop direct PostgREST calls.

**Fix.** In 107200, or a follow-up migration, `create or replace private.can_read_asset_labels` with the admin arm written as `(private.is_active_admin() and a.upload_state = 'ready')`, and keep the staff and manager arms. Also grep for other admin checks written as `role = 'admin'` that do not go through is_active_admin. Add a security test that an aal1 admin JWT reads zero media_labels rows.

**Verifier.** The claim holds. The latest definition of private.can_read_asset_labels is at supabase/migrations/20261110090145_knowledge_b02c_manager_upload_and_labels.sql:472 (first defined at 20261030120100_media_labels.sql:204). It is SECURITY DEFINER and admits a caller through `(p.role = 'admin' and a.upload_state = 'ready')`, which joins public.profiles on auth.uid() and p.active. It never calls private.is_active_admin() and never checks auth.jwt()->>'aal'.

20261118107200_admin_mfa.sql:25-37 adds the aal2 requirement only inside private.is_active_admin(). Its own header says "nearly all" admin paths go through that function, which admits that some do not.

None of the 20261118* migrations redefines can_read_asset_labels. A grep for "function private.can_read_asset_labels" finds only the two definitions above. A grep for "aal" finds nothing outside 107200, and no migration creates an `as restrictive` policy that would add a second gate.

The exposure path:

- media_labels and media_label_items grant SELECT to authenticated (20261030120100:291-293).
- Their only SELECT policies are media_labels_select and media_label_items_select, both `using (private.can_read_asset_labels(asset_id))` (20261030120100:306-309).
- Because the function is SECURITY DEFINER, RLS on media_assets does not narrow it.

So an active admin with an aal1 session (password only, TOTP not completed) can call /rest/v1/media_labels or /rest/v1/media_label_items with that JWT. They get label rows (content types, notes, menu item links) for every ready, non-deleted asset at every venue. The app's /auth/mfa redirect is in the Next.js layer and does not cover direct PostgREST calls.

By contrast, media_label_events and menu_item_suggestions use is_active_admin() (20261030120100:311-315), so those are correctly gated.

Other admin checks also test p.role = 'admin' directly, for example 20261118101100:190 and 289, 20261118101200:197, and 20261118101000:239. These are outside this finding but worth the audit the proposed fix suggests.

Severity is medium. It requires a valid admin password, and it exposes label metadata, not media bytes. But it defeats the stated FA-23 guarantee that an aal1 admin session "reads like an account without admin rights."

## Refuted

- (export) Public-mode packages with the Original profile ship unstripped GPS and device metadata: The mechanics are as claimed. render.ts:36 passes the stored original bytes through unchanged. Stored originals keep their EXIF: finalise.ts hashes them as-is and only the preview and thumbnail renditions record metadata "stripped". export_package_create (20261118105200_export_publication_api.sql:161) accepts profile 'original' in either mode. Calling this a defect does not hold up:

1. "Public" mode means the package holds public-approved photos. It does not mean the package gets published. The package goes to the manager or admin who made it, and READ-ME says "Exported does not mean publishe
