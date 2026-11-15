# One review per photo

**Status** · Agreed, 15 Nov 2026. Nothing built. The counting rules below are
decided (see Decisions). This replaces the rule in
`staff-portfolio-and-menu-completion.md` that kept the monthly and section
measures apart from menu photo review.

> **15 Nov 2026:** ORP-4 and ORP-5 are replaced by `goals-not-tasks.md`
> (G-1 to G-5). ORP-1, 3a and 3b stand.

## Problem

A food or drink photo can be reviewed twice, on two screens, with two
vocabularies. Since 7 Nov the two reviews can belong to different people:
manager accounts (`/manager/review`) decide menu photos only and are denied
every task and month write (`deny_manager_coverage_writes`), while task
photos are reviewed by staff with a legacy venue grant or by admins.

|                     | Task review                                                                                        | Menu photo review                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| How a photo gets in | Staff **send** it to a task, or to the month with no task (`submit_coverage_photos`)               | Staff **label** it with a menu item (`save_media_labels`)                                        |
| Record              | `coverage_submission_items`                                                                        | `menu_item_photos`                                                                               |
| Decision            | `review_coverage_item`: accept, or needs another photo                                             | `review_menu_item_photo`: accept, accept as menu photo, better photo requested, withdraw, relink |
| Screen              | `/staff/manage/review`, `/admin/coverage/[venueId]/review`                                         | `/manager/review`, `/admin/coverage/[venueId]/menu-photos`                                       |
| Counts toward       | The task's "N of M accepted" and the person's month                                                | Our menu ("N of M dishes have a photo")                                                          |
| Who can open it     | Staff with a legacy venue grant (`/staff/manage`), and admins; Home's "photos to review" counts it | Manager accounts (`/manager`, whose Review badge counts it), and admins                          |

Neither decision writes to the other table. A chef who labels a starter _and_
sends it to the Starters task creates two queue entries. If they only label it,
it never counts toward their month. If they only send it, Our menu never gains
the dish. The person has to know about both steps, and the manager has to do
both reviews.

## Goal

For a labelled food or drink photo: **staff do one thing (label it), the
manager makes one decision, and that decision counts everywhere it applies**:
the dish, the menu-section task containing that dish, and the uploader's month.

Out of scope: amenity findings (no review step, see `amenity-catalogue.md`),
and `amenity`, `service` and `venue_specific` tasks, which keep send-to-task.

## Proposal

### Staff

- Labelling a food or drink photo is the only step. "Send to task" disappears
  from menu-section task screens. They show the section's dishes with "Needs a
  photo", and taking a photo there pre-fills the label, as Our menu does.
- A photo that shows a section rather than one dish (a spread of starters) can
  still be sent to the task as now, without a label.
- Me and Home keep one vocabulary: **Needs another photo**, with the reviewer's
  reason. That is already the state word in `status-chip.tsx`; Me's "Better
  photo requested" heading (`MILESTONES.better` in `staff-portfolio.tsx`) goes.

### Manager

- One queue, `/staff/manage/review`, holding both labelled photos and photos
  sent to non-menu tasks. `/manager/review` becomes the same screen (or
  redirects to it). Its badge then counts the one queue.
- One card per photo. For a labelled photo the card names the dish and, under
  it, what accepting will also count for: "Also counts for: Starters task ·
  Priya's November". The reviewer never chooses where it counts.
- Decisions: **Accept**, **Accept as the menu photo**, **Needs another photo**
  (reason required), and **Not this dish** (relink, as now).

### Counting

One accepted `menu_item_photos` row for a still image counts:

1. **Our menu:** unchanged.
2. **Menu-section task:** toward the active `menu_section` requirement at the
   asset's venue whose section contains the item, if one exists. It follows
   the menu: when a menu change sends the row to `needs_recheck`, the task
   stops counting it until it is accepted again.
3. **Month:** toward the uploader's month in which the **upload started**
   (`uploaded_month`), the rule the month page already states. Month credit
   given once is **not** taken back by a later menu change or recheck.
   Only a withdrawal (the photo was wrong) removes it. This keeps "without
   rewriting historical credit".

A photo counts at most once per measure. If the same asset was already
accepted through a task before this change, it is not counted again.

## How it is built: read-through (ORP-1, decided 15 Nov 2026)

Accepting a menu photo writes nothing new. The two functions every task and
month count goes through also read accepted menu photos
(`supabase/migrations/20261115100000_menu_photo_counts.sql`):

- `private.monthly_credit_items` (the month, via `coverage_staff_progress`)
  adds still images in `accepted` or `needs_recheck` whose reviewed label was
  added by the uploader, in the London month the upload started. A photo
  already credited through a submission is not counted again.
- `private.requirement_status_rows` (tasks, via
  `coverage_requirement_progress` and `venue_coverage_summary`) adds
  `accepted` photos of dishes that are entries of the task's section in the
  task's menu version, counting distinct photos across both sources.

Write-through (a task row written on each menu decision) was the first
proposal. It was dropped because it needs an exception to
`deny_manager_coverage_writes`, a security boundary. Read-through needs none,
and withdrawal and recheck fall out of the menu row's state.

Known gaps until ORP-4: task and month screens list the photos sent to them,
so a count can be higher than the list under it. A photo matched by the
reviewer without the uploader's label counts for the dish and the task, not
the month.

## Build steps (one batch, one PR)

| ID    | Step                                                                                                                                                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORP-1 | Migration: month and task counts read accepted menu photos (read-through). Database tests for month and section counts, withdrawal, better photo, once-only counting and menu recheck.             |
| ORP-2 | Dropped 15 Nov 2026: each shell already counts the one queue its user can open (staff Home: tasks; `/manager`: menu photos). Adding the other count would point at a screen that user cannot open. |
| ORP-3 | One review screen. Planned below: ORP-3a (hide a decided photo from the task queue), ORP-3b (the "Also counts for" line), ORP-3c (who reviews non-menu task photos after the D3 cut-over).         |
| ORP-4 | Staff: menu-section task screens list dishes and label on capture; no send step for labelled photos. Section shots keep send-to-task.                                                              |
| ORP-5 | Copy: retire "better photo requested" on staff screens; update `usage-staff.md` and `usage-manager.md`.                                                                                            |

ORP-1 is worth shipping alone: it removes the need for a second review
without any screen change. The badge counts need no change (ORP-2, dropped). ORP-3 to ORP-5 can follow.

## ORP-3 plan: one review screen

### Where things stand

- **D3** (`docs/design-system/decisions.md`, 14 Nov 2026) makes `/manager`
  the canonical workspace and redirects `/staff/manage` on a set date. The one
  review screen is therefore `/manager/review`, with its admin twin
  `/admin/coverage/[venueId]/menu-photos`. It already uses D4's words ("Ask for
  another photo"); only "Withdraw acceptance" still differs from D4's "Undo
  acceptance".
- Task photos are reviewed only on `/staff/manage/review` (legacy grant
  holders) and `/admin/coverage/[venueId]/review`. Manager accounts are denied
  every coverage write, so after D3 **only admins** could review task photos.
- **Gap left by ORP-1:** a photo sent to a menu-section task and accepted on
  the menu counts in that task as accepted (menu) _and_ pending (the
  submission is still `submitted`). The task queue still shows it, and a
  second reviewer can decide it again.

### ORP-3a: a menu decision settles the task submission (built)

Migration `20261115110000_menu_settles_submissions.sql`. A `submitted` task
item is settled when its photo has a live menu decision (`accepted`,
`better_photo_requested` or `needs_recheck`) for a dish the task covers: any
dish for a monthly-only submission, a dish in the task's section for a
menu-section task, never for other task kinds. A settled item:

- leaves the task queue (`coverage_items_page` for reviewers) and every
  pending count (`requirement_status_rows`, `venue_coverage_summary`,
  `coverage_staff_progress`);
- reads as **Accepted**, with the menu reviewer and time, everywhere
  `coverage_items_page` is read, when the menu accepted it. The staff task and
  month screens therefore show it accepted with no app change.
- stays **Submitted** for its author while the menu reviewer has asked for
  another photo or a recheck. The request itself shows on Me.

No rows change and no write path changes, as in ORP-1. The stored item stays
`submitted`: a reviewer who opens it by id can still decide it.

### ORP-3b: "Also counts for" on menu review cards

Each labelled card on `/manager/review` names what accepting it also counts
for, read from the same rules as ORP-1: "Also counts for: Starters ·
Priya's November 2026". The month part appears only when the uploader
labelled the photo, and names the month its upload started. Built: a
read-only RPC, `menu_photo_also_counts` (migration
`20261115120000_menu_photo_also_counts.sql`), read alongside the queue in
`listReviewQueue`. The line shows only while accepting is still to do.

### ORP-3c: non-menu task photos after the D3 cut-over (decision needed)

Service, venue-specific and amenity tasks are photographed and sent, then
reviewed. After D3, manager accounts cannot review them. Options:

| Option                                               | What it means                                                                                                                                                                           | Cost                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **1. Admins review them (recommended for now)**      | No change: `/admin/coverage/[venueId]/review` stays the place. The D3 redirect sends legacy holders to `/manager`, which never shows them.                                              | None. Queue may grow if venues use these tasks. |
| 2. Manager accounts review them on `/manager/review` | Task cards join the menu queue. Needs an exception in `deny_manager_coverage_writes` for `review_coverage_item` on the manager's venue: a security boundary change, with its own tests. | Large.                                          |
| 3. Retire photo review for non-menu tasks            | Amenity checks (no review step) already cover amenities; service and venue-specific tasks become checklist items without photo review.                                                  | Product change to tasks.                        |

Decided 15 Nov 2026: 3a and 3b built; option 1 for 3c now, and decide 2 or 3
when the D3 cut-over date is set, with real numbers of non-menu task photos
per venue.

## Decisions (15 Nov 2026)

1. **A labelled, accepted photo counts toward the uploader's month.** It is
   the work the month target is meant to encourage.
2. **Month credit stays after a menu change** sends the dish for recheck.
   Only a withdrawal removes it.
3. **No backfill.** Nothing is rewritten. ORP-1 reads existing records, so a
   photo accepted on the menu before ORP-1 counts from the moment it ships.
4. **Self-review counts, as today.** An admin's or legacy grant holder's own
   accepted photo counts toward their month, recorded as self-review. Manager
   accounts still cannot decide their own photos.

## Files

- `supabase/migrations/20261102140000_coverage_domain.sql` (tables),
  `20261102150000_coverage_procedures.sql` (`review_coverage_item`, progress)
- `supabase/migrations/20261106130000_menu_item_photos.sql`
  (`review_menu_item_photo`, recheck trigger)
- `lib/server/coverage/review.ts`, `lib/server/menu-photos/decide.ts`,
  `lib/server/coverage/venue.ts` (`getManagerReviewCount`)
- `app/staff/manage/review`, `app/manager/review`,
  `app/admin/coverage/[venueId]/{review,menu-photos}`
