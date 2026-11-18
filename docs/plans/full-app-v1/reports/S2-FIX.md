# S2-FIX worker report

Repairs of the Sprint 1 foundation review findings owned by S2-FIX ([reviews/S1-foundation-review.md](../reviews/S1-foundation-review.md)). Branch `fa/s2-fix`; nothing pushed. Proven on the isolated stack `nabalens-s2-fix` (601xx), which is stopped.

## Result per finding

| ID      | Result       | Migration / files                                                                                                                                                                                                                                                                                                                           |
| ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R5      | fixed        | `108000`: the three legacy profile triggers act on the venues a change is about (deactivation or a move to admin: every venue; a transfer: the venue left; a role change: the venue whose role changed). `convert_account_to_manager` / `convert_manager_to_staff` name the grant at the venues they change.                                |
| R6      | fixed        | `108000`: `remove_venue_member` deactivates only when no open membership remains anywhere. See "Assumptions" for the inactive-venue case.                                                                                                                                                                                                   |
| R7, R25 | fixed (once) | `108100`: `switch_active_venue` sets `nabalens.self_switch`; `profiles_activity` skips it. Admin role changes and removals that move the active venue still log.                                                                                                                                                                            |
| R26     | fixed        | `108100`: trigger on `venue_memberships` appends `membership_added` / `membership_ended` to `activity_events` (object `account`, the membership's venue). `lib/ops/activity.ts` has the two action words.                                                                                                                                   |
| R24     | fixed        | `108100`: `private.ops_venue_managers` reads open manager memberships plus `private.venue_role_of(...) = 'manager'`, whatever the active venue.                                                                                                                                                                                             |
| R8      | fixed        | `108200`: a BEFORE UPDATE trigger on `media_assets` (first write of `content_sha256` on a processing asset) takes `pg_advisory_xact_lock` on (venue, hash) and, with a fresh snapshot, links the earliest live ready copy. `complete_media_finalise` is not redefined.                                                                      |
| R10     | deferred     | Needs `private.media_upload_venue_allowed`, which S2-INT owns. Exact fix below.                                                                                                                                                                                                                                                             |
| R12     | fixed (core) | `108300`: the core-check admin rule moved into the 2-arg `amenity_archive_check`, which every archive path (2-arg, keyed 3-arg, `amenity_check_set_applicability`) goes through. The reason requirement on the old RPCs stays with S2-MGR (hand-off: move the screen, then remove execute).                                                 |
| R13     | fixed        | `108300`: new `menu_change_request_clarify(request, reply, revision)` (requester, still managing the venue): appends the reply to `detail` (thread within 1000 chars), sets status back to `open`, writes a `change_requested` menu event with `reply` and `question`. `menu_change_request_decide` also accepts `clarification_requested`. |
| R14     | fixed        | `108300`: new column `menu_versions.scheduled_retired_items uuid[]` stored by `schedule_menu_version`; `menu_promote_due` lapses with `retirements_changed` when the set differs. A trigger clears it whenever a schedule is cleared. Old schedules (NULL) keep the count rule.                                                             |
| R15     | fixed        | `108300`: `activate_menu_version` now calls `activate_menu_version_confirmed(..., null)`: an activation that retires anything is refused with `menu_retirements_unconfirmed`; one that retires nothing still works. Grants unchanged.                                                                                                       |
| R19     | fixed        | `108400`: `area_photo_reconfirm` refuses a `checkedOn` before the venue-local day of the latest change report (since that photo's current acceptance): `invalid_value`, problem `before_reported_change`, `reportedOn`. `area_photo_freshness` unchanged.                                                                                   |
| R23     | fixed        | `108500`: `private.publication_asset_states(asset_ids[])` computes publication pairs once; `export_candidates` and `export_package_detail` join it once; `publication_asset_state(asset)` wraps it (same JSON). `export_packages_list` (one `export_package_stale` per package, linear) is unchanged.                                       |
| R27     | fixed        | `108600`: `community_readable_assets`, `community_media_page`, `community_members` re-created from the `107000` bodies with `a.uploader_role is distinct from 'manager'` restored in the three M1 places.                                                                                                                                   |
| R28     | fixed        | `108600`: `delete_media_asset` reads the asset `for update` before `asset_is_accepted`.                                                                                                                                                                                                                                                     |

None of the 16 was refuted; each was reproduced first (all 17 scenario tests fail on the pre-fix schema `107200` for the stated reason, and pass on the head).

## R10: exact fix for S2-INT

The refusal comes from `private.media_upload_venue_allowed` (projection: `p.role = 'staff' and p.venue_id = p_venue`; manager branch via `manager_upload_venue_id`, also projection-based). Proposed body, same signature:

```sql
select p_uploader is not null and p_venue is not null and exists (
  select 1 from public.profiles p
  join public.venues v on v.id = p_venue and v.active
  where p.id = p_uploader and p.active
) and (
  (p_uploader_role is distinct from 'manager'
     and private.venue_role_of(p_uploader, p_venue) = 'staff')
  or (p_uploader_role = 'manager'
     and private.venue_role_of(p_uploader, p_venue) = 'manager')
);
```

and in `lib/server/media/finalise.ts` (around line 437) replace `actor.profile.venueId !== row.venue_id` for staff, and `managerUploadEnded`'s `data.venueId === venueId`, with a membership read (`person_venue_privileges(actor.id)` row for `row.venue_id` with `can_upload`). This conflicts with S2-INT hand-off item 6 ("an active membership and it is their active venue"); the coordinator should pick one rule. The R10 view is that an in-flight upload at a venue the person still belongs to should finish after a switch; the upload stays credited to the venue it was reserved at.

## Assumptions

- **R6, only inactive venues left.** A staff profile must point at an active venue (`profiles_staff_requires_venue`, `assert_venue_assignable`), so the person cannot be "moved" to a closed venue. When the removed venue is the person's active venue and every other membership is at an inactive venue: a manager is refused with `needs_admin` (P0001) and nothing changes (M5: managers never change another pub's memberships); an admin's removal deactivates as before. When the removed venue is not the active venue, only that membership ends. The app's `removeVenueMember` should show `needs_admin` as "Ask an admin" (S2-MGR / S2-ADMIN screens).
- **R7/R25.** A self-service switch writes nothing to Activity (no `venue_switched` kind). Membership commands that switch someone else (admin role change at the active venue, removal at the active venue) still log `account_*` rows.
- **R8.** In the race, the RPC's own result still says `duplicate_of_asset_id` null (it returns its own lookup); the stored column, which credit reads, is right. S2-INT can return the stored column when it next redefines `complete_media_finalise`.
- **R13.** The reply is appended to `detail` as `"\n\nReply: ..."`; the admin's question stays in `decision_reason` until the next decision.

## Behaviour changes other tasks must know

- `activate_menu_version` refuses retirements (R15). Test callers moved to `activate_menu_version_confirmed` with the real count: `tests/security/menus-fixtures.ts` `activate`, `tests/e2e/coverage-acceptance.spec.ts`, `tests/e2e/coverage-manager.spec.ts`. `scripts/ci/fixtures.ts` activates first menus only (no retirements), unchanged. `tests/security/menus-db.test.ts` race test now accepts the second activation being refused.
- Core amenity checks: only admins archive them, on every path (R12). `knowledge-confirm.test.ts` and `knowledge-b03-freshness.test.ts` archive core checks as the admin in set-up.
- Activity: new actions `membership_added`, `membership_ended` (R26). `ops.test.ts` filters to `account_*`.
- New RPC `menu_change_request_clarify`; new column `menu_versions.scheduled_retired_items` (`lib/db/types.ts` regenerated, only these additions).
- `tests/unit/scope-guard.test.ts`: `108500_publication_states_once.sql` added to the approval-workflow allow-list (it re-creates S1-EXPORT bodies).
- Redefined (not on S2-INT's list): `private.profiles_revoke_manager_grants`, `private.profiles_end_coverage_assignments`, `private.profiles_end_amenity_assignments`, `public.convert_account_to_manager`, `public.convert_manager_to_staff`, `public.remove_venue_member`, `public.switch_active_venue`, `private.ops_venue_managers`, `public.amenity_archive_check(uuid, integer)`, `public.menu_change_request_decide`, `public.schedule_menu_version`, `private.menu_promote_due`, `public.activate_menu_version`, `public.area_photo_reconfirm`, `private.publication_asset_state`, `public.export_candidates`, `public.export_package_detail`, `public.community_readable_assets`, `public.community_media_page`, `public.community_members`, `public.delete_media_asset`. A later task that redefines any of these must start from the `108xxx` body.

## Files

- Migrations: `supabase/migrations/20261118108000_people_per_venue_side_effects.sql`, `108100_activity_membership_fixes.sql`, `108200_upload_duplicate_serialise.sql`, `108300_menus_scope_fixes.sql`, `108400_area_photo_reconfirm_after_report.sql`, `108500_publication_states_once.sql`, `108600_privacy_manager_era_and_withdraw_lock.sql`.
- App: `lib/ops/activity.ts` (two action words), `lib/db/types.ts`.
- Tests: new `tests/security/foundation-repairs.test.ts` (21 tests, R5 to R28); `tests/security/manager-uploads.test.ts` (OD-9 test now accepts the manager-era upload: R27); touched `menus-db`, `menus-fixtures`, `ops`, `knowledge-confirm`, `knowledge-b03-freshness`, `tests/unit/ops-models.test.ts`, `tests/unit/scope-guard.test.ts`, two e2e specs (not run here).
