# S2-ADMIN report: Admin overview and venues

Branch `fa/s2-admin`. Spec §8 intro, A1, A2; FA-23, FA-33; AC23, AC27, AC29, AC39.

## Checklist

All 18 rows are built (none Release 2). Details are in the Result column of [checklist.md](../checklist.md).

| ID                         | Result                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A1-coverage-by-category    | built: Food, Drinks, Spaces and Facilities per venue (Other as a filter), counted by the `coverage_slots` rule                         |
| A1-fact-coverage           | built: confirmed facts as n of N                                                                                                       |
| A1-unlabelled-backlog      | built (see the Library caveat below)                                                                                                   |
| A1-oldest-review-age       | built                                                                                                                                  |
| A1-overdue-checks          | built: photo and fact checks that are due                                                                                              |
| A1-publication-errors      | built: failed plus withdrawal pending                                                                                                  |
| A1-numbers-link            | built                                                                                                                                  |
| A1-blocked-first           | built                                                                                                                                  |
| A1-filters                 | built: venue, categories, menu (current or next scheduled) and reporting period (a month)                                              |
| A2-venue-crud              | built                                                                                                                                  |
| A2-timezone                | built                                                                                                                                  |
| A2-operating-status        | built: archive and restore, both with a reason; archiving shows an impact preview first                                                |
| A2-menu-assignments        | built as a link to the venue's menus, as the gap map advised; R1 has no shared-menu model                                              |
| A2-reviewer-responsibility | built                                                                                                                                  |
| A2-setup-checklist         | built                                                                                                                                  |
| A2-templates               | built                                                                                                                                  |
| A2-scope-impact-preview    | built: a preview and then a required reason. Its slot counts are honest zeros, because no requirement source checks the scope gate yet |
| A0-admin-nav               | built (departure A-ADMIN-1)                                                                                                            |

Hand-off items:

- **Scope settings screen.** Built with `getVenueScope` and `setVenueScope`. It lives on the venue page under "What this venue collects".
- **Admin reset of another person's lost authenticator.** Built on `/admin/staff/[id]` (the MfaResetPanel).
- **Timezone and operating status edits.** Built.
- **Admin navigation at 320 px.** Checked; see Checks.
- **`admin_set_venue_membership`.** No change was needed in my screens. Reviewer candidates are read with `private.venue_role_of`, so a person who is a manager at one venue and staff at another is offered only where they manage.

## Migrations (range 115000 to 115900)

- **`20261118115000_admin_venues.sql`**
  - `venues` gains `address`, `revision`, `archived_at` and `updated_at`.
  - New table `venue_reviewers`: `main` and `backup`. Its history is in `activity_events`.
  - Private functions: `venue_setup_checklist`, `venue_reviewers_json`, `venue_json`, `venue_slug_for`, `is_iana_timezone`, `venue_template_rows` and `venue_template_assert`.
  - Admin-only public functions:
    - `admin_venues_list(include_archived)`
    - `admin_venue_detail(venue)`
    - `admin_venue_archive_impact(venue)`
    - `admin_venue_save(venue|null, name, locality, address, timezone, revision, reason?)`
    - `admin_venue_set_status(venue, status, reason, revision)`
    - `admin_set_venue_reviewer(venue, main|backup, profile|null, reason, revision)`
    - `admin_venue_template_preview(venue, source?)`
    - `admin_venue_apply_template(venue, source|null, reason)`
    - `venue_scope_impact(venue, key, applicable)`
    - `admin_reset_mfa_authorise(profile, reason)`
  - Every write records a row through `private.record_activity`.
- **`20261118115100_admin_group_overview.sql`**
  - `private.asset_unlabelled(asset)`.
  - `private.admin_overview_row`.
  - `public.admin_group_overview(venue_ids?, menu, from, to, include_archived)`.
- Both migrations apply in order on a fresh `db reset` of my isolated stack. They depend on no other Sprint 2 migration. `lib/db/types.ts` holds only my additions.

## Files

- **New:**
  - `lib/admin/{venues,overview}.ts`: pure parsers, filters, links and words.
  - `lib/server/admin/venues.ts`
  - `app/admin/overview/**`
  - `app/admin/venues/**`: list, new, `[venueId]`, actions, forms, loading, error and not-found.
  - `app/admin/more/page.tsx`
  - `app/admin/staff/[id]/mfa-reset-{actions.ts,panel.tsx}`
  - `app/(dev)/ui-preview/admin-overview-fixture.ts`
  - Tests: `tests/security/admin-venues.test.ts`, `tests/unit/admin-overview-model.test.ts` and `tests/ui/admin-venues.test.tsx`.
- **Outside my ownership (minimal changes):**
  - `components/nabalens/app-shell.tsx`: admin navigation, `ADMIN_NAV` exported, tab bar and More below lg.
  - `components/nabalens/status-chip.tsx`: new chips `setup_in_place`, `venue_open`, `venue_temporarily_closed` and `venue_archived`.
  - `app/admin/staff/[id]/page.tsx`: mounts the MFA panel.
  - `app/(dev)/ui-preview/ui-preview.tsx`: an Admin overview section and renamed notes.
  - `tests/ui/app-shell.test.tsx`: the navigation expectations.
  - `tests/unit/scope-guard.test.ts`: five admin routes added to the allow-list.
  - `tests/e2e/app-bar-fit.spec.ts`: admin widths now start at 1024.
  - Docs: `docs/design-system/{departures,catalogue}.md` and the checklist.

## Assumptions

1. **Sign-in landing stays at `/admin` (the Library).**
   - About a dozen e2e journeys assert that URL after sign-in.
   - Overview is first in the nav, and the logo links to it.
   - To make Overview the home, change `homePathFor('admin')` and those journeys.
2. **Navigation labels.**
   - The AppBar shows short labels (Menus, Settings) from lg.
   - Below lg the tab bar shows Overview, Venues, Library and More, and `/admin/more` lists all sections by the spec's names.
   - Coverage and Albums stay reachable from Overview, which they light up.
3. **Unlabelled.**
   - A ready general upload with no menu label, place or amenity link.
   - The Library's `labels=unlabelled` filter (`library_page`) counts only `media_labels.has_labels`, so it also lists photos that are linked to places or amenities. The overview number can therefore be lower than the list it links to.
   - **S2-LIBRARY:** adopt `private.asset_unlabelled` in `library_page` so the two match (AC39).
4. **Reporting period.**
   - A London month. It drives the "Added in <month>" column and its Library date range.
   - Coverage, facts and backlog are current states.
5. **Next scheduled menu.**
   - Counts the earliest scheduled draft's dishes.
   - A dish counts as covered when it has a live public photo.
6. **Publication errors** link to `/admin/publishing`, which has no venue filter.
7. **Archiving.**
   - Sets `active` to false and stores `archived_at`. Memberships and every other row are left untouched.
   - `venue_role_of` already refuses inactive venues.
   - People for whom it was their only venue lose access; the impact preview counts them.
8. **MFA reset.**
   - Allowed for any other person, admin or manager, never oneself.
   - The database checks and records the reset first. The server then deletes the factors with the service-role Auth admin API, because direct writes to `auth.*` are not supported on hosted projects.
   - If the API call fails, the Activity row says a reset was requested.
9. **Reviewers.**
   - Only a person whose `venue_role_of` is manager or admin can be named.
   - A reviewer who is later demoted is still shown, marked not eligible, and the setup item reopens.
   - Reviewer handover inside `remove_venue_member` is left to S2-MGR.

## Checks

- **Typecheck:** `pnpm typecheck` exits 0.
- **Lint:** `pnpm exec eslint . --ignore-pattern '.claude/**'` exits 0 with no output.
- **Prettier:** clean on every changed file except the `.sql` migrations, which have no parser.
- **Security tests (isolated stack, ports 598xx, fresh reset):**
  - `admin-venues.test.ts`: 10/10.
  - With `venue-memberships`, `coverage-slots` and `menus-local-offerings`: 69/69.
  - The callers checked are anon, staff, a manager at their own venue, a manager at another venue, an inactive admin, and an admin without a second factor (aal1).
- **Unit and UI tests:**
  - `admin-overview-model` 16/16.
  - `admin-venues` UI 10/10.
  - `app-shell` 12/12.
  - `scope-guard` 15/15.
  - `design-citations` passes.
- **`pnpm test`:** see the final summary.
- **Layout:** Playwright against `/ui-preview` (dev server on my stack):
  - At 320 px the overview stacks with no sideways scroll. The page's existing "Open the design system gallery" link overflows by 7 px, which is not from this task.
  - At 768 the admin tab bar shows.
  - At 1024 and 1280 the AppBar shows all seven sections and fits.

## For Sprint 3 reviewers and e2e writers

- **Routes:**
  - `/admin/overview`, with query `venue`, `category` (repeatable), `menu=current|next` and `period=YYYY-MM`.
  - `/admin/venues`, with `?archived=1` to include archived venues.
  - `/admin/venues/new`
  - `/admin/venues/[venueId]`, with anchors `#setup` and `#reviewers`, and `?created=1` after creating a venue.
  - `/admin/more`
  - The MFA panel on `/admin/staff/[id]`.
- **Test ids:**
  - Overview: `overview-filters`, `overview-attention`, `overview-table`, `overview-row` (with `data-venue`), and `overview-{food,drinks,spaces,facilities,other,facts,unlabelled,review,checks,publication,added}`.
  - Venue page: `venue-add`, `venue-row`, `setup-checklist`, `setup-{inventory,reviewers,staff,spaces,collection}` (with `data-done`), `reviewer-{main,backup}`, and `venue-{name,locality,address,timezone,save,status-save,menus-link}`.
  - Archive, scope and template: `archive-impact`, `scope-accommodation`, `scope-preview`, `scope-impact`, `venue-template`, `template-source`, `template-preview-button`, `template-preview` and `template-apply`.
  - Other: `admin-more-<section>` and `mfa-reset`.
- **Journeys:**
  - Create a venue, copy the catalogue template, name a main and a backup reviewer, and see the setup checklist move.
  - Archive a venue: a reason is required and the impact preview shows first. Then reopen it.
  - Turn accommodation on with a preview and a reason.
  - On the overview, check each number's link and the filters; at 320 px each venue reads as one labelled block.
  - An admin resets another admin's authenticator; that admin must enrol again at the next sign-in.
- **Seeded data:** none. The `/ui-preview` "Admin overview" section uses fixtures in `app/(dev)/ui-preview/admin-overview-fixture.ts`.
- **Not done here:**
  - Reviewer handover inside `remove_venue_member` (S2-MGR).
  - A venue filter on `/admin/publishing` and `/admin/staff`.
  - Bedroom requirement sources that would make the scope preview's slot counts non-zero (they must call `venue_scope_applies` and extend `venue_scope_impact`).
