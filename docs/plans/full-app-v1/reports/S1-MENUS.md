# S1-MENUS worker report

Final report from the T3 worker, kept verbatim as the hand-off record (branch `fa/s1-menus`, merged into `feat/full-app-v1`).

S1-MENUS is done for the data, server, admin and manager-screen work; several checklist rows are only partly built, and a few are not built. Everything is committed on `fa/s1-menus` in 8 commits. Nothing was pushed, and my isolated stack is stopped.

## Checklist status

**Built**

- **AC26, S4.3-temp-unavailable, M5-temporary-availability:** a manager can mark a dish not available, with a reason and an optional end date. A security test shows the dish's photo request, accepted photo and primary photo are unchanged.
- **S4.3-scheduled-activation:** an admin can activate now or schedule a draft. A due schedule activates from a cron route (every 15 minutes) and whenever a manager or admin opens a menu page. Saving the draft clears its schedule. If the draft or the items it retires change after scheduling, the schedule is cancelled and logged instead of activating.
- **A3-csv-columns, A3-csv-template, A3-preview-diff, A3-reimport-idempotent:**
  - The CSV accepts `venue`, `menu`, `item_id`, `variant`, `active_from` and `active_to`, with errors reported per row.
  - Admins can download a template.
  - The preview separates "Changed presentation" (photos go back for a recheck) from other changes, and lists "Proposed retirements".
  - Importing the same file again opens the existing draft instead of a copy.
  - Activating or scheduling needs the retirements ticked (AC28).
- **S4.3-presentation-change, M5-appearance-reassessment:** a manager action moves accepted photos to recheck with the reason `presentation_changed`.
- **M5-active-future-menus:** a manager page shows the current and scheduled menus, and retired ones on request.
- **M5-display-name-override:** a local name for a dish, with a reason and an audit record. Staff screens don't use it yet.
- **M5-request-catalog-change:** managers send requests; admins accept, decline or ask for clarification on the venue's menu page.

**Partly built**

- **S4.3-local-specials, M5-local-specials, S3.3-local-specials:** managers create specials; staff suggest them and the manager accepts or declines. A special reads as "review due" after its end date until the manager ends or extends it. Its photos can't be labelled yet, because labelling only accepts dishes on the active menu.
- **AC29:** I added an `accommodation` setting per venue. It reads as not applicable until an admin changes it, with a reason and history. No catalogue has bedroom requirements today, so there are no bedroom slots. There is no admin screen for this yet.
- **S4.4-scope-audit:** there is a new archive/restore for amenity checks that needs a reason and records it; core checks are admin-only through it. The old archive without a reason still works, because the existing amenities screen uses it. Switching that screen over and then removing the old path is Sprint 2 work.
- **S4.1-upcoming, A3-future-menus:** a scheduled menu changes nothing until it starts (AC27), and managers see how many new items it adds. Collecting photos for those items early is not built.
- **S4.1-archive-filter:** done for menu versions and specials; not for the manager's menu item list or places.
- **S3.3-retire-offering-impact:** an impact read exists for one dish and for a draft. The whole-menu Retire dialog doesn't show it.
- **S11-venue-offering, S11-menu-version:** availability, local name, presentation revision and a scheduled start time are stored. There is no stored end date and no separate menu identity.
- **S4.3-stable-ids:** `item_id` in a CSV keeps a dish's identity. Marking a rename as a spelling correction is not built.
- **S4.4-states-reasons:** dishes have "temporarily unavailable" with a reason; amenities don't.

**Not built**

- **AC22, S4.3-multi-menu:** a venue still has one active menu, so the same dish on two menus can't be represented. It needs a menu identity table.
- **S4.2-packaged-drink-designation, S4.2-entrance-views, S4.2-event-brief, S4.2-explicit-extra, S4.3-variants:** these change the requirement model that S1-COV's coverage function reads, so I left them to avoid a clash.
- **S4.3-transactional-activation, S4.4-local-space-facility, S4.5-explicit-match, S9.2-imported-context-authority, S4.1-categories (owned by S1-COV).**

## Decisions I made (please review)

- **"Accept", not "approve":** the existing scope-guard test bans approval wording in app code. Change requests use `accepted`/`declined`/`clarification_requested`, and specials use an accept/decline decision. S2-REVIEW will need the same guard changed for "Approve for public use".
- **Activation now always confirms retirements.** The server calls `activate_menu_version_confirmed`. The old `activate_menu_version` is still there for compatibility and is admin-only.
- Re-import de-duplication is checked in the server code by the file's hash, not by a database index (existing data could already have duplicate drafts).
- Dates use Europe/London; the date-only fields use the existing `private.london_today()`.

## Migrations

All four apply in order on a fresh reset of my isolated stack:

- `20261118103000_menu_scheduled_activation.sql`
- `20261118103100_menu_local_offerings.sql`
- `20261118103200_menu_change_requests.sql`
- `20261118103300_venue_scope.sql`

`lib/db/types.ts` was regenerated; the diff from base is additions only.

## Files outside my ownership (kept small)

- `lib/menus/import/{index,matching,template}.ts`, `lib/menus/types.ts`
- `components/nabalens/menus/{activate-menu-dialog,menu-diff-view,index}.tsx`
- `app/api/internal/menus/activate-due/route.ts` and `vercel.json` (one new cron entry)
- `tests/unit/scope-guard.test.ts` (four routes added to the allow-list)
- `tests/ui/manager-access-ended.test.tsx` (mocks for the two new reads)
- `tests/security/menus-server.test.ts` (now confirms its one retirement)
- `tests/ui/menus-diff.test.tsx` (new group names)
- `docs/menus-import.md`

## Checks

- `pnpm typecheck`: no errors.
- `pnpm exec eslint . --ignore-pattern '.claude/**'`: no output.
- Prettier on changed files: everything passes except `docs/menus-import.md`, which was already unformatted on the base commit. I didn't reformat the whole file.
- My tests:
  - Security: `menus-schedule` 7/7, `menus-local-offerings` 13/13.
  - Unit: `menus-import-full-app` 12/12, `menus-local-services` 16/16.
  - UI: `menus-local-offerings` 9/9.
- `pnpm test`: 363 files and 4599 tests passed.
- Full security suite on my stack: 78 files and 1168 tests passed. It took 8:00, which is at the 8-minute limit.
- Skipped: `lci` and `verify:release` (not allowed for workers) and browser e2e (not run).

## For Sprint 2 screen workers

Every new function takes the caller's own session; managers can only act on their own venue.

| Area         | Functions (in `lib/server/menus/local.ts`)                                                                                                 | Who                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Menus        | `listVenueMenuVersions` (states `active`/`scheduled`/`retired`, plus `upcomingCount`, `retiringCount`)                                     | manager, admin                                                  |
| Dish state   | `getOfferingStates` (keyed by item: availability, local name, presentation revision)                                                       | everyone at the venue, so staff Album and Review should read it |
| Dish changes | `setItemAvailability`, `setItemDisplayName`, `markPresentationChanged`                                                                     | manager, admin                                                  |
| Specials     | `listSpecials`, `createSpecial`, `decideSpecial`, `reviewSpecial`; states `suggested`/`upcoming`/`running`/`review_due`/`declined`/`ended` | staff suggest; manager/admin decide                             |
| Requests     | `listChangeRequests`, `createChangeRequest`, `decideChangeRequest` (admin), `withdrawChangeRequest`, `getRetirementImpact`                 | manager, admin                                                  |
| Scope        | `getVenueScope`, `setVenueScope` (admin, reason required), `setAmenityApplicability`                                                       | see left                                                        |

- **Admin scheduling** (`lib/server/menus`): `scheduleMenuVersion`, `unscheduleMenuVersion`, `activateDueMenus`. `activateMenuVersion` now takes `retirements`.
- **Import:** `ImportPreview` gains `duplicate` and `activeDates`; `createMenuDraft` returns `existing`.
- **Pure helpers:** `splitChanged`, `menuCsvTemplate` and `isCsvDate` from `lib/menus/import`; `scheduleInstant` and `ActivationChoice` from the menus components.
- **Gate:** any new bedroom requirement must check `private.venue_scope_applies(venue, 'accommodation')`.
- **Recheck reason:** `presentation_changed` is new in the database. The TypeScript `RecheckKind` type and the review copy don't include it yet, so the existing reader skips it — S2-REVIEW should add it.
- **S2-MGR** should move the amenities archive screen to `amenity_check_set_applicability`, then remove execute on the old reasonless `amenity_archive_check`.
