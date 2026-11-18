# S2-STAFF: Staff Me and Album (report)

Branch `fa/s2-staff`, from `719fc0a24`. Spec §6 S3, S4, S5; AC17, AC36; decisions FA-1, FA-6, FA-7, FA-10, FA-20, FA-21, FA-34.

## Built

| ID                        | Result                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3-grid                   | built: category pills (Food, Drinks, Spaces, Facilities, Other present in the place) on `/staff/album/[placeId]`; places stay the grouping                            |
| S3-state-filters          | built: Needed / Waiting / In the album / Needs updating / All (`?show=`, `?cat=`); a chosen state is remembered (cookie `nl_album_show`); default All (departure A-5) |
| S3-card-content           | built: thumbnail, name, state word, and "n waiting" from `coverage_slots.pendingCount` (never a colleague's photo)                                                    |
| S3-subject-page           | built: `/staff/album/slot/dish/<itemId>` and `/staff/album/slot/area/<subjectId>`; amenity redirects to its question page                                             |
| S3-report-change          | built: Report a change on the slot page and the place screen; stored by `report_slot_change`; no public data changes                                                  |
| S4-sections               | built: "Your photos" (the spec's My uploads, in Album words) first on Me, with Needs attention / Sending / Waiting / Reviewed                                         |
| S4-row-content            | built: thumbnail, slot names, outcome chip, retake reason, venue when not the current one, sent and taken dates (Unknown), duplicate note                             |
| S4-withdraw               | built: Withdraw while undecided; re-read before delete, and `delete_media_asset` refuses accepted media                                                               |
| S4-retake                 | built: Retake opens the slot page with the reviewer's exact reason; the next photo of the slot shows `replacesAssetId` (derived, history kept)                        |
| S4-outcome-words          | built: In the album, Kept for reference, Retake, Label corrected, Not used, Withdrawn (`outcome_*` chips)                                                             |
| S4-your-month             | built: Your month adds "n slots in the album from your photos · n outdated photos replaced"                                                                           |
| S4-change-label           | built: Change slot (Match picker) for one undecided dish/area photo; label revision + undecided re-check. Old Needs labels kept (departure A-4)                       |
| S4-request-correction     | built: Ask for a correction (`report_slot_change` kind `photo`) and Ask to remove (`request_media_removal`)                                                           |
| S5-assigned-venues        | built: Help and account lists venues with role, and `VenueSwitcher` + `switchVenueAction`                                                                             |
| S5-contact-manager        | built: "Your managers" from `my_venue_managers` (name, job title). No phone/email exists to show                                                                      |
| S5-permission-format-help | built: "If you can't add photos" on the Photo guide (`/staff/tasks/guide#cant-add`), linked from Me                                                                   |
| S5-sign-out               | built (existing): Log out on Me with LeaveGuard's unsent warning; shared-device clearing is S1-PRIVACY's                                                              |
| S6-nav-tabs               | built as decided (FA-1): Album / Add photos / Me; departure A-3                                                                                                       |
| M4-staff-task-entry       | built as decided (FA-1): named jobs are slots on Album or rows under Other jobs                                                                                       |

Hand-off items: VenueSwitcher on Me (done); first sign-in notice with `CONTRIBUTION_NOTICE` + `acknowledgeNoticeAction` on the welcome, and Album's Start here stays until it is read (done); staff notices inbox `/staff/notifications` with preferences, and an unread badge on the Me tab (done); capture-time correction with `set_media_captured_at` (done, "Fix date taken"); request removal (done); receipt words from `lib/upload/states.ts` on Your photos and the three words in DESIGN.md §4 (done, departure A-2 closed); Check due tiles read "Needs checking" (already in `slot-tile.tsx`).

## Migrations (range 20261118111000 to 111900)

- `20261118111000_my_uploads.sql`: `public.my_uploads(p_before, p_before_id, p_limit, p_asset_id)`.
- `20261118111100_slot_change_reports.sql`: tables `slot_change_reports`, `slot_change_report_events` (append-only); `report_slot_change`, `my_slot_change_reports`, `withdraw_slot_change_report`, `slot_change_reports(venue, state, limit)`, `decide_slot_change_report`.
- `20261118111200_staff_account_reads.sql`: `my_venue_managers()`, `my_month_replacements(month)`.

All additive, RLS on, no table grants, security definer with empty search path, execute to `authenticated` only. Applied in order on a fresh reset of an isolated stack (594xx). `lib/db/types.ts` regenerated; only these additions kept.

## For Sprint 3 and other workers

- **S2-REVIEW / S2-MGR:** staff reports reach managers through `listVenueSlotReports` and `decideSlotReport` in `lib/server/staff` (`slot_change_reports`, `decide_slot_change_report`). They are not yet shown in the manager's queue: please surface them. Kind `photo` is a correction request on a reviewed photo (reasons `wrong_label`, `wrong_date`, `other`). Decisions are logged to `activity_events` (`slot_change_reported`, `slot_change_resolved`, `slot_change_dismissed`).
- **Label corrected:** the staff word and chip exist (`label_corrected`), but `my_uploads` cannot tell a manager's label fix yet. When S2-REVIEW records label corrections, map them to `label_corrected` in `my_uploads` (or tell the coordinator).
- **Album slot model:** `AlbumSlot` gains `category`, `pendingCount`, `needsUpdate`; helpers `filterPlace`, `slotMatchesShow`, `placeCategories`, `findSlot`, `slotHref`, `coverageSlotsByAlbumId` in `lib/album/model.ts`. Filled dish/area tiles now link to their slot page (role link, not group).
- **Shell:** `StaffShellStatus.meCount` (unread notices) and `AppShell` staff prop `meCount`.
- **Routes:** `/staff/album/slot/[kind]/[slotId]`, `/staff/notifications` (added to the scope guard and the staff shell test).
- **E2E journeys:** Me → Your photos sections (`data-slot="my-uploads"`, rows `data-slot="my-upload-row"`, `data-asset`); Retake link → slot page (`data-slot="album-slot"`, `data-slot="slot-retake"`); Report a change sheet (`data-slot="report-change-dialog"`); place filters (`data-slot="album-place-filters"`, pills named Needed, Waiting, In the album, Needs updating, All); Help and account (`data-slot="me-account"`, `data-slot="me-managers"`); inbox (`data-slot="notices-inbox"`); notice (`data-slot="contribution-notice"`). No seed data was added; the security test builds its own venues.
- **Existing staff will see Start here** on Album until they press I understand on the welcome (spec §3.2).
- **Departures:** A-3 (tabs), A-4 (Needs labels kept), A-5 (place default All) in `docs/design-system/departures.md`.

## Files outside my ownership (minimal changes)

`components/nabalens/app-shell.tsx` (Me badge), `app/staff/_shell/shell-status.ts` (unread count), `components/nabalens/status-chip.tsx` (outcome chips), `components/nabalens/tasks/first-run.tsx` (`notice` slot), `components/nabalens/album/your-month-card.tsx`, `components/nabalens/album/album-home.tsx` (filled tiles link), `lib/server/album.ts` and `lib/album/model.ts` (coverage extras, filters), `app/staff/tasks/page.tsx` and `welcome/page.tsx` (notice), `app/staff/tasks/guide/page.tsx`, `lib/db/types.ts`, tests `scope-guard`, `staff-copy-guard`, `staff-shell-status`, `album-home`, `album-match-r1`, the ui-preview album block, DESIGN.md §4 and changelog, catalogue.md, departures.md.

## Assumptions

- Report a change and correction requests share one table; managers resolve or dismiss with a note; nothing is changed automatically.
- The retake link to the earlier attempt is derived at read time (same person, same slot, earlier photo asked to be retaken), not stored.
- "Outdated photo replaced" counts an own public acceptance this month on a slot that had an earlier accepted, rechecked or retake-asked photo.
- The contact-manager route shows names and job titles only; the profile has no other contact detail.
- Change slot also allows "Not for a slot" (a shared photo), through the Match picker.
