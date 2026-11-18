# Release 1 completion review (coordinator workflow)

Five reviewers on head `de8746dec` (FA-51 to FA-54 and S3-R15); every defect was checked by a verifier told to refute it. Confirmed findings Y1 onward are for the S5 repair pass.

## packaged (meets decision: partly)

The FA-51 rule is in the right place, and the coverage_slot_rows body keeps every earlier fix. I extracted the definitions and diffed them: the 20261118133000 body differs from 20261118109000 only by the packaging join, `required = not optional` and the leading `when d.optional then 'inactive'` branch. The FA-45 duplicate suppression (pending counts and area/amenity duplicates), check_due (needs_recheck and coverage_check_due), coverage_temporarily_unavailable, knowledge_in_scope and Not here are all unchanged. album_admin_counts and menu_item_photo_summary are their 20261118100200 bodies plus one inactive filter each. No later migration redefines any of the three.

The readers that count by state leave an optional item out of both total and numerator: coverage_slots_json (metrics, admin overview and venue checks, How this is counted), the Album model, and the media-request settle and create paths. Requests already open on an item that becomes optional are cancelled as "No longer needed", and new ones are refused.

Permissions hold. The write goes through private.menu_manage_item, which calls assert_can_manage_venue: venue manager or private.is_active_admin(), which needs aal2 since 20261118107200. The read uses assert_can_manage_venue. The table has RLS with no grants, and staff, other-venue managers and anon are refused. Monthly credit is per acceptance and independent of slot state; I found no defect there.

The rule does not reach the older menu-photo readers, which compute their own status from private.menu_item_photo_rows. As a result the manager Overview's own "Menu photos" heading, the manager Menu "Needs photo" filter and staff Our menu's "Still needs a photo" list all still count or list a packaged item as missing.

### Y1: Manager Overview heading and 'items with no ready photo' still count optional packaged items (blocking)

- **File:** `supabase/migrations/20261107100500_manager_item_photo_reads.sql`
- **Scenario:** A manager marks Lager Packaged without Photo wanted. On /manager, the OverviewBody heading still reads 'Menu photos · X of N items covered' with Lager in N, and 'N items with no ready photo' still includes Lager. The same applies to the Menu filter counts in menu-filters.tsx. These come from public.manager_menu_photo_overview (latest definition 20261107100500, not touched by S5-PACKAGED), which counts every menu_item_photo_rows row as eligible and every uncovered one with nothing waiting as needs_photo. If Lager has an accepted photo it is also counted in the numerator. So on one page the Overview heading disagrees with the CategoryCoverage panel and with metrics, admin overview and Album, and a packaged item is shown as missing. That breaks FA-51's 'one rule in coverage_slot_rows; every count reads it' and 'never empty'.
- **Proposed fix:** Re-create manager_menu_photo_overview from its latest body, joining private.coverage_slot_rows(v_venue) on slot_kind='dish' and leaving out rows whose state is 'inactive' (in both the totals and the sections jsonb). Add an e2e or security assertion that compares the Overview heading's N and its no-photo count with coverage_slot_rows.
- **Verifier:** I could not refute it; the defect is real on HEAD. The latest definition of public.manager_menu_photo_overview is in 20261107100500_manager_item_photo_reads.sql. No later migration re-creates it: the 20261110* files only call it, and 20261118133000_packaged_items.sql does not touch it. Its body counts every row of private.menu_item_photo_rows(v_venue, true, v_admin) as eligible, takes `covered` from that row, and counts a row as needs_photo when it is not covered and nothing is waiting. It never reads private.coverage_slot_rows, which is where S5-PACKAGED puts the FA-51 rule (a packaged item without Photo wanted gets required=false and state 'inactive'). The packaged migration's own header claims "manager and admin overviews" follow the rule. But it only re-created coverage_slot_rows, album_admin_counts and menu_item_photo_summary; only menu_item_photo_summary gained the `where cov.state is distinct from 'inactive'` filter. The overview function was left as it was. On the app side, app/manager/page.tsx renders OverviewBody with read.overview, which comes from getManagerOverview in lib/server/menu-photos/read.ts and calls this RPC. In components/nabalens/manager/overview/overview-body.tsx, the heading is copy.heading(covered, eligible) (line 263), the "items with no ready photo" count is overview.needsPhotoItems (line 280), and the progress bar, gaps title and per-section counts use the same numbers. menu-filters.tsx statusCount also uses overview.eligible, needsPhotoItems and

### Y2: Manager Menu 'Needs photo' list and staff Our menu 'Still needs a photo' list still show optional packaged items as gaps (should-fix)

- **File:** `supabase/migrations/20261116150000_menu_item_needed_by.sql`
- **Scenario:** public.manager_menu_photo_items (/manager/menu?status=needs_photo) and public.menu_item_photo_items (staff /staff/menu?filter=gaps, via listOurMenuItems) filter gaps with `not x.covered` from menu_item_photo_rows. Neither was updated. A packaged Lager without Photo wanted is therefore listed under 'Still needs a photo' for staff and 'Needs photo' for the manager, with a needed-by date. Meanwhile the Our menu progress bar (menu_item_photo_summary, which was updated) leaves it out of eligible. Staff are told to photograph an item the plan says is optional, and the list disagrees with the count above it.
- **Proposed fix:** In the latest bodies of manager_menu_photo_items and menu_item_photo_items, mark an item as optional when coverage_slot_rows gives its dish slot state 'inactive'. Exclude it from the gaps/needs_photo filters and from needed_by, or return an optional flag the screens show as 'Optional'. Cover this in tests/security/packaged-items.test.ts.
- **Verifier:** I couldn't refute it; the defect is real on HEAD. The newest definitions of public.menu_item_photo_items and public.manager_menu_photo_items are still the ones in 20261116150000_menu_item_needed_by.sql. No later migration recreates either one: grep finds them only in 20261106130000, 20261107100500 and 20261116150000. Both build their rows from private.menu_item_photo_rows, and neither one reads menu_item_packaging or the dish state from coverage_slot_rows. menu_item_photo_items applies p_gaps_only as `not x.covered`, and it sets nb_date (needed_by) whenever the dish is not covered. manager_menu_photo_items works out status 'needs_photo' from r.covered and the waiting counts. 20261118133000_packaged_items.sql did update coverage_slot_rows (optional rows get state 'inactive'), album_admin_counts and the summary/eligible readers (`state is distinct from 'inactive'`). It did not touch these two list readers. The app does not filter optional items either: lib/server/coverage/menu-items.ts and lib/server/menu-photos/read.ts pass rows straight through, and nothing on the TS side mentions packaging. The feature can be reached today, because components/nabalens/manager/menu/packaging-control.tsx and app/manager/menu/local-actions.ts set packaging. So an uncovered packaged item without Photo wanted shows up under staff 'Still needs a photo' and manager 'Needs photo' (it can also show a needed-by date). The progress count leaves the same item out. FA-51 says such an item is listed but '

### Y3: Our menu shows 'empty' when every item on the active menu is an optional packaged item (minor)

- **File:** `supabase/migrations/20261118133000_packaged_items.sql`
- **Scenario:** In the new menu_item_photo_summary, the filter `where cov.state is distinct from 'inactive'` can remove every row. Take a venue whose active menu has only one drinks section, with all of it marked Packaged. The function then falls through to `if not found` and returns menu_state 'empty'. Staff Our menu and admin coverage show the 'no items to photograph' state and hide the item list, even though the items are listed and can still take photos.
- **Proposed fix:** Return 'ready' with zero-eligible section rows when the active version has items that are all optional. For example, filter optional items with count(*) filter (...) instead of the WHERE clause, so sections stay present with eligible 0.
- **Verifier:** I could not refute this, and it happens on HEAD. Only four migrations define public.menu_item_photo_summary, and the latest is 20261118133000_packaged_items.sql; nothing after it redefines the function. In that version, the line `where cov.state is distinct from 'inactive'` runs before the GROUP BY. An optional packaged item (packaged and not Photo wanted) gets coverage state 'inactive', set in coverage_slot_rows at about line 292. So if every item on the active menu is optional, the query returns no rows, `if not found` fires, and the function returns menu_state 'empty' even though the active version has items. The previous body in 20261118100200 had no such filter. In the app, getOurMenu (lib/server/coverage/menu-items.ts) passes that state through. app/staff/menu/page.tsx lines 54-55 then return early whenever menuState is not 'ready', so listOurMenuItems is never called and staff see the empty state with no item list. FA-51 says an optional packaged item "is listed, takes photos and can be accepted", so hiding the list breaks that decision. A related side effect: optional items' pending_candidates and oldest_candidate_at also drop out of the per-section sums (sum(r.candidate_count) runs after the filter), so their waiting photos are not counted either. The trigger is narrow: a venue whose whole active menu is packaged without Photo wanted, such as a drinks-only menu with every bottle marked Packaged. That fits the minor rating. The claim's suggested fix is sound: move the

## templates (meets decision: partly)

I read migration 20261118134000_shot_templates.sql against the latest definitions of is_active_admin (20261118107200, which needs aal2), clean_text, media_visible_to_caller (FA-20), knowledge_place_venue, record_activity, media_requests and library_review_state. I also read the app changes from branch fa/s5-templates. The unit test tests/unit/shot-templates.test.ts passes (9/9).

What holds up:

- **Admin-only with MFA.** Only an active admin on an aal2 session can write, list example choices or see the admin-only fields. shot_template_set checks this before it looks at any input. Every real change writes one activity_events row (shot_template_set, old and new revision, reason, before and after). A repeat with the same values records nothing.
- **Example photo rule.** One eligibility rule is re-checked on every read and in the thumbnail gate. It allows only a ready, not-deleted image with a thumbnail, not withdrawn, with no withdrawn use or public grant, and accepted at the public level (dish, area by its latest decision, amenity, or the legacy checklist). So an unreviewed colleague photo can never become an example.
- **Request reference photos.** In slot_briefs these are filtered through media_visible_to_caller, so FA-20 holds there.
- **Venue isolation.** slot_briefs and request briefs are limited to the caller's venue through knowledge_place_venue. A template example from another venue can be shown to staff. That is by design: the templates cover the whole organisation and the photo is already accepted for public use. Only its thumbnail and asset id are exposed.
- **Length limits in the database.** Instructions are 1 to 140 characters, trimmed, with no control characters (a table check plus clean_text in the function). The reason is limited to 500. Request briefs keep their own 140 limit.
- **Staff copy.** The only new staff words are "Example of a good photo". There is no task, request, due or approval wording. The scope-guard change only adds the admin route.

What fails: the brief order is not used everywhere a brief is shown. The manager review screen still builds its brief from album_briefs alone (details below). There are also two smaller problems in slot_briefs.

### Y4: Manager review screen ignores the FA-52 brief order (no request brief, no template, areas blank) (should-fix)

- **File:** `app/manager/review/_shared/album-review.tsx`
- **Scenario:** A manager sends a request on the dish Lamb shank with the brief "Side view showing the mash". Staff see that brief on Asked for, the tile and the slot page (slot_briefs). When the manager reviews the photo, the screen shows the section brief from getAlbumBriefs (fromMenuCard in components/nabalens/album/review/model.ts), or nothing if there is no section brief. For an area photo it always shows nothing (fromAreaCard brief: null), although staff saw the Spaces template. So the reviewer checks the photo against a different instruction than the one staff were given. Changing a template also never reaches this screen, against FA-52's "changes the brief shown everywhere it is the fallback".
- **Proposed fix:** Have the review loader read public.slot_briefs for the venue (include_requests true) and look up each card's brief by slot key (dish:itemId, area:subjectId, amenity:checkId). Keep album_briefs only as the fallback when the read fails.
- **Verifier:** The defect is real on HEAD. The review stage (app/manager/review/_shared/album-review.tsx, rendered by app/manager/review/page.tsx as the default thumb view) builds its briefs only from getAlbumBriefs, which reads album_briefs: the dish's own brief, else its section's. It never calls loadSlotBriefs or public.slot_briefs. fromMenuCard in components/nabalens/album/review/model.ts resolves itemBrief, then sectionBrief, then null. fromAreaCard hard-codes brief: null. Staff surfaces use a different source. loadAlbum in lib/server/album.ts goes through slotBriefsOrNone, then loadSlotBriefs, then the slot_briefs RPC with include_requests true. That RPC applies the FA-52 order (request, manager, catalogue, template), as lib/album/brief.ts documents. So the reviewer is not shown a request brief such as 'Side view showing the mash', a catalogue brief, or a category template, and area photos never get one. Editing a template therefore never changes the review screen, which goes against FA-52 ('changes the brief shown everywhere it is the fallback'). It also breaks DESIGN.md §2 principle 4 ('the reviewer judges against the same words') and the §5 definition of Brief ('Shown on the slot, in Match and in Review'). loadSlotBriefs already accepts a manager actor with venueId, so the proposed fix is feasible. Severity: should-fix rather than blocking. The screen still works and shows a brief for dishes that have a manager brief.

## pwa (meets decision: yes)

FA-53 meets the decision. I found no blocking or security defects.

- **Manifest** (`app/manifest.ts`): it has everything Chrome needs to install the app: a name and short name, `start_url` and `scope` set to "/", an id, `display: standalone`, and PNG icons at 192 and 512 plus a maskable 512. I checked the icon file sizes with `file`; they match. A separate 180 px Apple icon is served from `app/apple-icon.png`.
- **Signed out**: the proxy matcher skips `manifest.webmanifest` and all `.png` files, and `/` is not a protected path. So no redirect to sign-in and no session cookie work happens for these files.
- **Security headers**: the global `/:path*` headers in `next.config.ts` still apply to the manifest and icons. The CSP is unchanged.
- **No service worker** has been added.
- **Add to home screen button**: it shows only after the browser fires `beforeinstallprompt`. Answering the prompt either way removes it, and once the app is installed (accepted, or `appinstalled`) it never returns. Nothing shows when the app is already opened from the home screen.
- **iOS steps**: they show only on iOS, detected from the user agent or from iPadOS posing as a Mac with touch.
- **Wording**: the copy says nothing about a camera.
- **Tests**: `tests/unit/pwa-manifest.test.ts` passed, 8 of 8.

There is one minor copy and logic gap with a real user scenario, described below. It is not caused by this change, but the Permissions-Policy comment in `next.config.ts` still says "Camera for in-app capture" and allows `camera=(self)`, which is at odds with Album's gallery-first rule. This is outside FA-53's scope.

## import (meets decision: partly)

I read both migrations (20261118135000 and 135100), scripts/import/*, finalise.ts, and the latest definitions of complete_media_finalise_core, save_media_labels_as, reserve_media_asset, prepare_media_cleanup, knowledge_in_scope and the duplicate-serialise trigger. No tests were run.

What holds up:

- Nothing is ever accepted: no review decision is written, managers still cannot review their own photos, and imports earn no monthly credit.
- Dry run is the default and only reads.
- Exact-hash dedupe works, both in-run and against existing ready assets at the same venue. Each skipped line is recorded against the earlier asset with its own contributor, label and folder.
- Capture date is the manifest's, else EXIF/QuickTime (checked for credibility), else null with source 'unknown'. Date-only manifest dates become midday Europe/London; this is recorded decision 7.
- Storage keys match the real pipeline: {holder}/{asset}/original.{ext} (the same extension allowlist) plus preview.webp and thumb.webp from mediaObjectKeys. Renditions, the archive receipt and finalise's core are reused, and videos get no derivatives, the same as the real pipeline.
- Every new RPC is revoked from public, anon and authenticated, and granted to service_role only. The new tables have RLS with admin-only read, and authenticated writes are revoked.
- library_page is recreated with grants restored, and is security invoker. library_ref_ids('import') returns nothing for non-admins, and library_filter_lists asserts admin, so the Imported filter is admin-only.
- No keys or secrets are printed.

Two concrete defects:

1. An import matched to an amenity can drop out of every queue.
2. A line that failed transiently can never import under the same manifest once the 24-hour cleanup has run, even though the tool tells the operator to "run again".

### Y5: Import staged on an amenity that is off the venue's working list (or later archived) disappears from every review queue (should-fix)

- **File:** `supabase/migrations/20261118135100_legacy_import_reads.sql`
- **Scenario:** The script's readCandidates (scripts/import/legacy-import.ts) and the check in legacy_import_complete only require venue_amenity_checks.status = 'active'. Turning a question off the working list (knowledge_set_working_list sets knowledge_working_list.disabled_at) leaves its check 'active'. Example: the venue has turned 'pool_table' off, and a legacy photo labelled 'Pool table' matches exactly one candidate, so it is staged as amenity. private.amenity_photo_rows only shows checks where private.knowledge_in_scope(...) is true, so the photo never appears in the amenity queue. private.asset_unlabelled_reason excludes any import with staged_kind = 'amenity' whatever the check's state, so it is not in Needs label either. The photo is imported and never reviewed. The same happens if the check is archived after the import. An off-list amenity can also make a label wrongly 'ambiguous' when a dish or place has the same name.
- **Proposed fix:** Only offer and accept in-scope active checks: filter readCandidates by the venue's enabled knowledge_working_list keys, and check private.knowledge_in_scope in legacy_import_complete's amenity branch. In asset_unlabelled_reason, apply the amenity hold only while the staged check is active and in scope (or already decided), so the photo falls back to Needs label otherwise.
- **Verifier:** I could not refute it. The scenario happens on HEAD.

1. **The script offers off-list checks.** In scripts/import/legacy-import.ts, readCandidates offers every venue_amenity_checks row with status 'active' as an amenity candidate. It never looks at knowledge_working_list.
2. **legacy_import_complete accepts them.** Its amenity branch (20261118135000, around line 533) only checks c.status = 'active'.
3. **Off-list checks exist and stay active.** knowledge_set_working_list requires a check row for every key. Turning a question off only sets knowledge_working_list.disabled_at; the check stays active. So most venues have active checks that are off their working list, and a legacy label like 'Pool table' can match exactly one of them.
4. **The amenity queue hides the photo.** private.amenity_photo_rows (latest definition, 20261118135100) only reads checks that are active and pass private.knowledge_in_scope. Import rows are joined through those checks, so an import staged on an off-list or archived check is not listed. The admin overview pending count and the fix-label reads also go through amenity_photo_rows, so they miss it too.
5. **Needs label hides it too.** private.asset_unlabelled_reason (latest, 20261118135100) excludes any asset with an imported media_import_items row where staged_kind = 'amenity', whatever state the check is in. The photo therefore never reaches Needs label either.

The result is an asset awaiting review that no review queue shows. That breaks FA-54 ("Imp

### Y6: A transiently failed import line can never be imported under the same manifest once the 24-hour cleanup has tombstoned its reservation (should-fix)

- **File:** `scripts/import/legacy-import.ts`
- **Scenario:** Step 3 of importOne (ensureMediaOriginalArchived, derivative upload or recordRenditions) fails after legacy_import_reserve. The row stays 'uploading' with no media_import_items row, and the operator is told 'could not process the file; run again'. public.prepare_media_cleanup then tombstones every uploading/failed row older than 24 hours (deleted_at set) and removes its objects. On the rerun, importOne sees the row still exists, so it skips storing the original. legacy_import_reserve returns the deleted row unchanged, because it never checks deleted_at. Archiving then fails because the original is gone, and even if it passed, legacy_import_complete raises media_asset_not_found (it filters deleted_at is null). The line fails on every later run and the CLI keeps exiting 1, which breaks the report's claim that 'only failed lines are tried again'. The only way out is to edit the manifest so it becomes a new batch. While it waits, a reservation held by a staff contributor also counts against that person's open-upload limit.
- **Proposed fix:** In legacy_import_reserve, when the existing row of this batch is deleted and never reached ready, revive it (clear deleted_at, set state back to 'uploading') or make a new reservation. In the script, store the original again whenever the row is not ready and the object is missing, rather than only when no row exists. Add a test that fails a line, runs the cleanup, then reruns.
- **Verifier:** I could not refute it. On HEAD it happens as described:
  (1) importOne (scripts/import/legacy-import.ts:589-605) reads only `upload_state` and stores the original only when no row exists. A rerun of a failed line therefore skips the store whenever the row is still there, whatever its deleted_at.
  (2) legacy_import_reserve, the only definition (20261118135000_legacy_import.sql:315), returns any existing row of the same batch unchanged and never looks at deleted_at.
  (3) legacy_import_complete filters `a.deleted_at is null` and raises media_asset_not_found otherwise.
  (4) prepare_media_cleanup, latest definition 20261030160000_cleanup_skip_failed.sql, tombstones every row that is 'uploading' or 'failed', has updated_at older than 24 h (MEDIA_LIMITS.abandonedUploadWindowHours) and has no recent objects. It has no exemption for provenance='legacy_import', and the import migration does not redefine it. runMediaCleanup then removes the objects. Rows are never hard-deleted, so the tombstoned row stays.
  (5) Cleanup runs every hour from a Vercel cron (/api/internal/cleanup, "17 * * * *"), so any line that failed in step 3 and is not rerun within about 24 h becomes stuck.
  The batch id comes from the manifest sha256 (legacy_import_begin with p_manifest_sha256), and importAssetId hashes batchId and line, so the same manifest always lands on the dead row. The line then fails on every later run, and the only way out is to change the manifest.
  Nothing in the script, the SQL or decisions.md hand

## me-add (meets decision: yes)

S3-R15 does what R15-1 says, and I found no concrete defects with a user or security scenario. What I checked:

- **Gallery first.** In app/staff/staff-portfolio.tsx, the new secondary "Add a video" button (data-slot me-add-video) calls openAdd({ dialog: true }). That is the same call the retired "Add photos or videos" button made. In app/staff/_shell/add-host.tsx this opens the shell's UploadDialog with allowCamera={false}, so no input with capture is rendered for that sheet. The only capture="environment" left is the camera branch of components/nabalens/photo-source.tsx. Staff reach it only through the fallback UploadDialogs in submit-photos-panel and capture-form, which render only when there is no addQueue; the staff screens pass one. That is older code, not this round's.
- **Video still works.** The dialog path sets imagesOnly to opts.imagesOnly ?? (!!match || !!slot), which is false here, so the older sheet still accepts video.
- **One primary per view.** The header puts the secondary Add a video before the primary Add photos. The empty state reuses uploadButton("secondary"), and the AppBar's AlbumAddTrigger is secondary, so there is only one blue button.
- **Blocked or paused venue.** Both buttons are null when uploadBlocked is set. uploadBlockReason returns not_staff, no_venue or venue_inactive, which covers venues.active = false.
- **Legacy e2e helpers.** In commit 87003d83c, meSheetButton, uploadThroughDialog, openUploadDialog and meAddButton only swap the button locator; no expect was removed. The absence checks got stricter: gaps and visual now also require [data-slot="me-add"] to have count 0, profile-outage now matches /^Add (a video|photos)/, and auth-guards gains a new marker. The visual paused-text change follows the R-2 wording, as gaps.spec already does.
- **Focused tests.** tests/ui/add-upload-refresh.test.tsx and tests/unit/album-gallery-guard.test.ts both pass (13 tests).

Two things that are not defects:

- A venue set to temporarily_closed keeps active = true, so it can still take photos. The spec does not say a temporarily closed venue must stop uploads, and this predates R15.
- In staff-portfolio.tsx, ME_ADD_VIDEO_LABEL was inserted between ACCEPTED_HEADING and the doc comment written for it. That only misplaces a comment.
