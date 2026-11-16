# Goals, not tasks

**Status** · Model agreed 15 Nov 2026 ("proceed with recommended"). Nothing
built. Checked against the code on 15 Nov 2026 (eight read-only reviews of
the working tree and `main`); this revision folds in what they found. The
rules are in [v0.5](../spec/NabaLens-Goals-v0.5.md). This plan finishes what
`one-review-per-photo.md` started: ORP-1, 3a and 3b stay as built, and ORP-4
and ORP-5 are replaced by G-0 to G-5 below.

> **Read first.** This branch (`docs/design-system-batch-0`, HEAD `b583bff2`)
> is 6 commits behind `main` (`df766b3a`: #24, #25, #26, #27, #29, #30). `main`
> changes 640 files, and 94 of them are also changed in this working tree. On
> `main`, B02 (#26) already rebuilt staff Home: `HomeOverview`, a
> `homeLayout()` switch (`lib/config/home-layout.ts`, `"b01" | "b02"`), and
> `myRetakes`, which reads menu `better_photo_requested`. Month counts on
> `main` read `coverage_staff_progress_v2`. Every file reference below means
> `main` after G-0, unless it says HEAD.
>
> B02 made Home a **To do** list. This plan removes To do for menu work. That
> reverses part of a change that has just shipped, so confirm it with whoever
> owns B02 (`docs/knowledge/b02-design.md`) before G-1.

## Problem

Staff Home tells each person which task to do next, with a due date and an
Overdue state. The menu belongs to the whole team. Assigning "Starters" to one
person turns a shared job into personal homework, and it stops a colleague who
is standing by the dish from filling the gap. Since ORP-1, a labelled,
accepted photo already counts for the dish, the section and the month. For
food and drink photos, the task layer now decides nothing. It only adds dates
and ownership.

## The model

| Part          | Whose                       | What it answers                              |
| ------------- | --------------------------- | -------------------------------------------- |
| Our menu      | The whole venue             | Which dishes still have no accepted photo?   |
| Your month    | One person, private         | How am I doing against my monthly target?    |
| Retake note   | One person, when it happens | Someone asked for another photo of this dish |
| From the team | Everyone                    | What are my colleagues shooting?             |

Nobody owns a dish. Food and drink work has no due date, and nothing about it
is Overdue. Manager review still decides what counts. Ready photos are still
shared at once.

## What already exists (on `main`)

| Part          | In the repo                                                                                                                                                                                                                                                                                                                                   | Gap                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Our menu      | `getOurMenu` returns totals only (`menu-items.ts`). `listOurMenuItems` returns a fixed page of 50 with no limit input. `OurMenuCard` is a server component. `/staff/menu?filter=gaps` exists. Label pre-fill is a client `openAdd({preset})` call (`item-row.tsx`, `add-context.tsx`), not a URL.                                             | Home shows a count but no dishes. There is no read sized for 4 rows. Home drops `totals.needsRecheck`, so after a menu change it shows only a lower count. |
| Your month    | `coverage_staff_progress_v2`, `getMyMonth`, and ORP-1 credit in `private.monthly_credit_items`. The frames drawing exists twice: `PhotoSegments` (`month-card.tsx`, 4 callers) and `Progress mode="segments"` (`components/ui/progress.tsx`). `main` also has an opt-in venue completion target (`private.venue_monthly_completion_targets`). | "Waiting" and the month's photo list read sent photos only (`coverage_items_page`). Due and Overdue still render in `monthly-progress-card.tsx`.           |
| Retake note   | Menu `better_photo_requested`, read on Home by `myRetakes` → `listMyMenuPhotoDecisions({requestsOnly:true})`. A separate source: coverage `needs_another_photo` on photos sent to the month or to a non-menu task, which shows as a To do "replace" item.                                                                                     | No Later. The clear rule runs only in the browser, over the tiles Me has loaded (`staff-portfolio.tsx`). The two sources are not merged.                   |
| One review    | `/manager/review`, ORP-3a, ORP-3b.                                                                                                                                                                                                                                                                                                            | ORP-3a settles only v1 `coverage_staff_progress`. `main`'s v2 still counts settled items as pending (fixed in G-0).                                        |
| From the team | `ColleaguePosts`                                                                                                                                                                                                                                                                                                                              | None.                                                                                                                                                      |

## Decisions (15 Nov 2026, Aman Kumar Shrestha)

1. **Urgent needs.** A manager may put a "needed by" date on one dish. It
   moves the dish to the top of Still needed and shows the date. It never
   becomes Overdue: after the date, the dish stays at the top with the word
   "Needed".
2. **Two photos of one dish.** Each accepted photo counts toward its author's
   month. One of them is the menu photo. This is ORP-1, unchanged.
3. **Goal setting.** Each venue has a default monthly target. A manager may
   set a different number for one person. This replaces the v0.4 rule that
   there is no default. Decisions 16 and 17 say how.
4. **Ignored retake notes.** Nothing comes back and nothing escalates. A dish
   with no accepted photo stays in Still needed for everyone. A note clears
   when any photo of the same dish (`item_id`) at the venue is **newly
   accepted** after the note was written, whoever took or reviewed it.
   "Newly accepted" means a `menu_item_photo_events` row with action
   `accepted`. Rows that were carried over or set as primary do not count.
   Variants are ignored, as in Still needed. A later withdrawal or recheck of
   the clearing photo does not bring the note back.
5. **Month credit at launch** comes from labelled food and drink photos, plus
   photos sent to the month. Other photos (the bar set-up, the garden) follow
   in phase 3. Until then the copy says "Accepted food and drink photos you
   labelled, and photos you sent to the month, count", never "any photo
   counts".
6. **Design language** is Common Room (D1). The v3 prototype (the claude.ai
   canvas cited in DESIGN.md §5a) shows the model only, not tokens or
   components. The month "roll of frames" is **not a new component**. It is
   `Progress mode="segments"`, keyed Accepted / Waiting for review / Still to
   take. `PhotoSegments` moves onto it and is listed in `catalogue.md` as a
   duplicate being retired (DS-205). Any visual difference from the prototype
   goes in `departures.md`.
7. **No rows are deleted or rewritten.** Requirements, assignees, submissions
   and review events stay. Screens stop reading them, and admins can still
   read the history.
8. **Non-menu work keeps a way in.** Rule 28 leaves service, venue-specific
   and amenity requirements, and amenity checks, as they are, with due dates
   and Overdue. Today they are listed only in To do and All tasks, which G-1
   removes. Until G-10 they stay on one list page linked from Home. Only
   `menu_section` work leaves Home.

Answered 15 Nov 2026 (Q1 to Q4, Aman Kumar Shrestha):

9. **Goals replace To do everywhere (Q1).** For menu work, goal-led Home
   replaces B02's To do at every venue, not just the pilot. `"goals"` becomes
   `DEFAULT_HOME_LAYOUT`. `b01` and `b02` stay selectable through
   `NABALENS_HOME_LAYOUT` only as a rollback, and are removed one release
   after the cut-over.
10. **Other jobs (Q2).** Home shows one "Other jobs" row only when the person
    has non-menu requirements or amenity checks. It links to one list page of
    those jobs. This is the list page from decision 8.
11. **Still needed shows a state word (Q3).** A dish whose only photo is
    waiting for review stays in Still needed and in the count, marked
    "Waiting for review". A dish being rechecked after a menu change is
    marked "Being checked". Colleagues can still add a photo of either.
12. **One main action (Q4).** In order: Reshoot when a retake note is open,
    else the first Still needed dish, else Open camera when the menu is
    complete. The share box ("Take a photo") is removed from Home. The Camera
    tab still opens capture for any photo.

Answered 15 Nov 2026 (Q5 to Q10, Aman Kumar Shrestha):

13. **Four frame states (Q5).** The month roll shows Accepted, Waiting for
    review, Needs another photo and Still to take. A menu photo the reviewer
    wants redone takes the "Needs another photo" frame until it clears under
    decision 4.
14. **Later works on every retake note (Q6).** Menu notes and coverage
    "needs another photo" requests (month and non-menu sends) can both be set
    aside. The set-aside table references one or the other.
15. **Section shots go to the month (Q7).** A spread that shows a section
    rather than one dish is sent to the month. It counts for the author once
    accepted and fills no dish. ORP-4's send-to-task for menu sections is
    withdrawn.
16. **A separate photo-count default (Q8).** Each venue gets a default number
    of accepted photos per person per month. `main`'s venue completion target
    (dishes and checks) stays a separate venue goal. Order: the person's own
    number, then the venue default, then Needs setup.
17. **Managers set targets (Q9).** A manager account may set its own venue's
    default and a person's number at that venue. This needs a narrow
    exception to `deny_manager_coverage_writes` for target writes only, with
    security tests, and a team screen on `/manager`. v0.5 §4 stands as
    written.
18. **Telling the venues (Q10).** Aman Kumar Shrestha tells every venue on
    release day (amended 15 Nov 2026 by the user; it was "a week before the
    release"). The date goes in the release checklist.

### Coordinator decisions (15 Nov 2026)

Taken while integrating G-1 to G-8 on `feat/goals-sprint`.

19. **Labels and failed uploads stay on Home.** B02's "photos need labels"
    card and its failed-upload card stay on goal-led Home as compact rows
    under the retake note (`OwnWorkRows`). They are the person's own actions,
    not assignments. The labels row counts in the Home badge. Neither is ever
    the one blue action: decision 12 still holds.
20. **Retake notes include menu-section requests.** `my_retake_notes()`
    includes open "needs another photo" requests on `menu_section` sends made
    before the cut-over. Otherwise they would have no way in once To do goes;
    G-4 keeps the section's send page serving them.
21. **The retake note names the reviewer.** It follows DESIGN.md §5a ("who
    asked"), which replaces B02's OD-3 rule of hiding the name.
22. **Needed by is a date per dish.** Decision 1's "one dish" means a date on
    a dish, not one dish per venue. Several dishes may carry a date at once;
    they lead Still needed, earliest date first, then menu order.
23. **Other jobs is `/staff/tasks/other`** (`OTHER_JOBS_PATH`).
    `/staff/tasks/all` redirects there. It lists non-menu jobs, amenity
    checks and the working list, including questions waiting on the person.
24. **Venue areas are B03 places (G-9; the user, 15 Nov 2026).** Month credit
    for photos that are not a dish or a drink comes from labelled venue
    areas, and the areas are the venue's existing B03 knowledge places
    (entrances, routes, areas, rooms, facility points): no second list. Only
    the uploader's own area label counts, and only once a reviewer accepts
    the photo. No self-review: nobody, admins included, decides on a photo
    they uploaded or labelled. `deny_manager_coverage_writes` is unchanged.
    Decision 5's copy becomes "Accepted photos you labelled — dishes, drinks
    and venue areas — and photos you sent to the month, count". This amends
    v0.5 rule 25's "credit for photos that are not a menu item is not part
    of this amendment".

### Release repair pass (15 Nov 2026)

From the three release reviews of `636f8897`:

- A fresh send to a menu section is refused unless it answers an open
  request (`p_replaces_item_id`). The unassign-only call (an empty list)
  still ends pre-cut-over section assignments; assigning is still refused.
- A withdrawn area photo is final: the uploader cannot give it a new area
  (`area_photo_withdrawn`); clearing it is allowed.
- An uploader's live area label counts as a label: the photo leaves "needs
  labels" (Home's labels row, the badge, Me, `my_label_work`). The row now
  says "N photos need a label".
- The area field saves only a choice the person made; a batch with different
  areas starts at "No area".
- Managers open area-photo images through `/api/area-photos/{id}/…`, checked
  by `area_photo_asset` like menu review's route; `/api/media` is unchanged.
- A manager can move a person back to the venue default
  (`use_venue_default_target`, reason required); the rollover then stops at
  that month and does not bring their old number back.
- Every `20261116*` migration sets `lock_timeout = '5s'`, and the audit entity
  check is added `not valid`, then validated.

No decisions are open. G-10 waits for pilot counts.

## Order of work

G-0 comes first and lands alone. After it, each phase is one branch and one
bundled PR.

### Phase 0: catch up with `main`

| ID  | Step                                                                                                                                                                                                                                                                                                   | Accepted when                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-0 | Rebase the Common Room batch and ORP-1, 3a and 3b onto `main`, resolving the 94 overlapping files. Add a migration that applies `private.menu_settled` to `open_items` in `coverage_staff_progress_v2`. Point `staffProgress` in `tests/security/coverage-fixtures.ts` at v2, or assert both versions. | The batch sits on `main`. In v2, pending excludes items that a menu decision has settled. The ORP tests assert v2. `scope-guard` and `staff-shell-status` pass on the rebased tree. The batch merges as its own PR. |

**G-0 status (15 Nov 2026).** Rebased onto `main` `df766b3a` (local, not
pushed). 32 conflicts resolved. `main`'s B02 to B05 code was ported to the
Common Room dialect (52 files): `size="touch"` dropped, old type, colour and
variable names replaced, focus drawn with `focus-ring`, local field styles
moved onto `field-control.ts`. Buttons that relied on `main`'s old primary
default were made `variant="primary"`. `row-link` was kept as departure C20.
Added `20261115130000_v2_menu_settled.sql`, and `staffProgress` in
`coverage-fixtures.ts` now asserts that v1 and v2 photo counts match. Three
tests from `main` were updated to ORP-1 decision 1, where a labelled,
accepted photo counts toward the month: `completion-targets` (accepted 1 → 4) and `manager-uploads` (one credit row; no roster row).

Checks: typecheck 0 errors; eslint clean; `pnpm test` 331 files, 4332 tests
passed; security suite 66 of 67 files passed. Failures that were already on
`main`, not caused by this batch:

- `asset-search.test.ts`: "reads no evidence or group rows for another
  venue's check…" (a scan-counter check of B05 `asset_search`, which no
  migration here touches). Not reproduced on a clean `main` stack.
- `tests/migrations/lint.test.ts`: 23 `db lint` warnings, all in `main`'s
  `knowledge_*` and `schedule_*` functions.
- `tests/migrations/withdraw.test.ts`: it expects
  `save_media_labels_as` to allow only `('staff', 'admin')`. `main`'s
  B02c migration `20261110090145` added `'manager'`.

The lint findings are now listed in `KNOWN_FINDINGS`, and the withdraw
assertion includes `'manager'`. Neither change was re-run. The asset-search
check is still open: fixing it means redefining `asset_search`. Migration upgrade
(8) and reset (3) passed.

### Phase 1: staff Home

| ID  | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Accepted when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-1 | **Built (15 Nov 2026, `feat/goals-sprint`).** Goal-led Home as a third `homeLayout()` value, `"goals"`, which becomes the default (decision 9). The order is: setup notice (no venue, team or name); retake note (content owned by G-3); Our menu, with up to 4 Still needed rows that reuse `OurMenuItemRow` in a client list, and "See all N" from `totals.gaps` linking to `/staff/menu?filter=gaps`; Your month; From the team. The welcome entry, "Photos to review" for legacy-grant reviewers and the "Other jobs" row (decision 10) keep named slots; the share box goes (decision 12). Still needed rows carry "Waiting for review" or "Being checked" (decision 11), so the read returns a per-dish pending and recheck state. To do, the lead task card and assignments go for `menu_section` work. Add a validated `limit` (1 to 50) to `listOurMenuItems`. Redefine the Home tab badge.                                                                                         | A person whose only assignments are `menu_section` sees no task, due date or Overdue anywhere on Home, including the Your month card. A person with a venue-specific task or an amenity check reaches it from Home in at most two taps. In e2e, picking a file from a Home dish row saves a label for that dish, and a person who may not upload sees the dishes with no actions. Each of these has a UI test: `no_menu`, `empty`, `unavailable`, `needs_setup` (no camera dead end, no "complete"), ready with recheck items (the recheck word shows), complete (Open camera is the one primary action), a dish with a pending photo (still listed, "Waiting for review"), and an open retake note (Reshoot is the one primary action). The Home tab badge equals the number of actionable cards on Home and never counts dishes. The `?finding_sent=` notice still shows after an amenity send, and focus lands on a heading that exists. Still needed follows menu order until G-7. |
| G-2 | **Built (15 Nov 2026, `feat/goals-sprint`).** Your month reads both sources through one SQL source. A new self-scoped `my_month_photos` RPC replaces `coverage_items_page` for the month list. Built on `coverage_staff_progress_v2`, read-only, in the ORP style. Four frame states (decision 13).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Each (author, venue, month, photo) has one state: accepted, then needs another photo, then waiting, in that order of precedence, and the roll draws all four frame states. Waiting is distinct photos that are not credited and have either an unsettled own submission that meets the credit rule, or a pending menu label that the uploader added themself (not a recheck) in the upload's month. The list length matches the counts. Database tests cover: labelled + sent to a service task + accepted on the menu (accepted +1, waiting +0); an undecided send plus an undecided label (1 waiting); accepted for dish A and waiting for dish B (accepted only); two variants of one dish (counts once); withdrawal; a label removed and added again; a label added by an admin (not waiting); a send in a different month; a move to another venue.                                                                                                                               |
| G-3 | **Built (15 Nov 2026, `feat/goals-sprint`).** One retake note block. It shows (a) menu "needs another photo" notes the author can retake, where Reshoot opens the camera with the dish pre-filled, and (b) open coverage "needs another photo" requests on month and non-menu sends, through the existing `replacementHref`. Both use the words "Needs another photo". Later applies to both (decision 14). Storage is `public.retake_note_set_asides (id, staff_id, photo_id, photo_revision, submission_item_id, set_aside_at)`, insert-only, with a check that exactly one of `photo_id` and `submission_item_id` is set, and unique keys `(photo_id, photo_revision)` and `(submission_item_id)`. Writes go through `set_retake_note_aside(p_photo_id)`, security definer, using `assert_work_profile_owner()`. The read is `my_retake_notes()`, which decides on the server whether a note is open, cleared, set aside or retaken, and whether it can be retaken. Home and Me share it. | Later hides the note from Home after a reload and in a second browser, and the note stays on Me. A new revision of the same note shows again. The note clears under decision 4, including when the clearing photo is not among the tiles Me has loaded. Security tests: staff A cannot set aside B's note (same error, no row written); admins and inactive users are refused; setting aside an accepted, withdrawn or invalidated note is refused; a repeat call does nothing new; a set-aside changes no count and no manager queue; `authenticated` has no insert, update or delete grant on the table; nobody can read another person's set-asides.                                                                                                                                                                                                                                                                                                                                |
| G-4 | **Built (15 Nov 2026, `feat/goals-sprint`).** `/staff/tasks/[requirementId]` reads only `kind` and `menu_section_id`. A `menu_section` task with no open `?replaces=` request redirects to `/staff/menu?section=<id>&filter=gaps`. With an open request, the page is still served. Other kinds are unchanged. The non-menu list from decision 8 gets one name and is added to the `scope-guard` allow-list and the `staff-shell-status` page list. Home stays at `/staff/tasks`. Section shots go to the month send (decision 15). (`/staff/tasks/all` exists only in this working tree, not on `main`, so it has no bookmarks to keep.)                                                                                                                                                                                                                                                                                                                                                     | Visiting a menu-section task ends on `/staff/menu?section=…` (Playwright `toHaveURL`; `loading.tsx` makes this a soft redirect). A "needs another photo" on a menu section sent before the cut-over can still be answered. The not-found page links to Home and does not say "task" or "All tasks" for menu work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| G-5 | **Built (15 Nov 2026, `feat/goals-sprint`).** Copy, the welcome flow, docs and the design system. `tasks/copy.ts` belongs to G-5, and the other steps use temporary strings until it lands. Add a "Needed by …" / "Needed" formatter that is separate from `dueView`. The welcome page drops `dueLabel` and reads `getMyMonth`. Update `/ui-preview` Home fixtures. Update `usage-staff.md`, `usage-manager.md`, DESIGN.md §3, §5, §5a, §6 and §11 (rules 1, 7 and 8) with a 0.4 changelog entry, `catalogue.md` and `departures.md`. Write the release note for every venue, and put the date venues are told (decision 18) in the release checklist.                                                                                                                                                                                                                                                                                                                                       | A new unit copy guard (the `scope-guard.test.ts` scanner pattern) finds no `task`, `due`, `overdue` or `better photo` in staff Home, `/staff/menu`, month, welcome, Me or the `menu-photos` modules. Amenity, service and venue task screens are on an explicit allow-list. `design-citations.test.ts` accepts `§5a` (today its pattern captures digits only). The release checklist names who tells each venue, the date and the layout switch, as ordered steps for the user (environment changes need the user).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Parallel work.** After G-0, G-2, G-3, G-4 and the G-1 screens (on fixture
data) can be built at the same time. G-1 is then wired to the G-2 and G-3
reads, and G-5 runs last. Each migration gets its own timestamp. Workers do
not commit `lib/db/types.ts`; the coordinator regenerates it once. G-3 owns
`needs-another-photo-list.tsx` and G-5 owns `tasks/copy.ts`.

**Hold** DS-301, DS-302 and DS-401 until phase 1 merges. They touch the same
Home, chip and shell files. G removes the `overdue` chip from menu work only.
Non-menu work still uses it (rule 28).

### Phase 2: manager and admin

| ID  | Step                                                                                                                                                                                  | Accepted when                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-6 | **Built (15 Nov 2026, `feat/goals-sprint`).** Venue default monthly target. Monthly preparation uses the person's own number when a manager has set one, otherwise the venue default. | A new starter at a venue with a default gets a target without a manager doing anything. A venue with no default still shows Needs setup. Running preparation again creates no duplicates. |
| G-7 | **Built (15 Nov 2026, `feat/goals-sprint`).** "Needed by" on a dish, set and cleared on `/manager/menu`, with an admin surface as well.                                               | The dish leads Still needed, with its date, for everyone at the venue. It clears when a photo is accepted. No screen shows it as Overdue.                                                 |
| G-8 | **Built (15 Nov 2026, `feat/goals-sprint`).** Menu-section setup loses assignees and due dates. Oversight lists show dishes without a photo and month progress, not overdue work.     | A manager cannot assign a section to a person. `/admin/coverage` has no overdue list for menu work. Only the venue manager and admins can see the team roster.                            |

What the review found for phase 2:

- **G-6 scope (decisions 16 and 17).** Manager accounts cannot write
  `monthly_targets` or run preparation today (`deny_manager_coverage_writes`;
  `manager-denials.test.ts`), and `/manager` has no team screen. G-6 adds a
  new venue-default table, a narrow own-venue exception for target writes
  only (every other coverage write stays denied, and
  `manager-denials.test.ts` gains cases that prove it), and a `/manager`
  team screen. It does not touch `venue_monthly_completion_targets`.
  Rollover today
  copies the latest non-null target from any source
  (`20261102150000_coverage_procedures.sql`). Add the source
  `'venue_default'` and copy only manager-set rows. Otherwise use the current
  default, and failing that, Needs setup.
- **G-7 storage.** Put `needed_by` in a new table keyed by
  `(item_id, venue_id)`, not on `menu_item_photo_heads`. The update guard on
  that table bumps the revision that reviewers use for compare-and-set. The
  pinned order means dropping and recreating `menu_item_photo_items` and
  `manager_menu_photo_items`, with a wider cursor.
- **G-8 knock-ons.** Old assignee rows stay (decision 7), so
  `submit_coverage_photos` itself refuses a fresh send to a menu section
  (`menu_section_send_closed`); an answer to an open request still works
  (consistent with G-4 and decision 15). `views.ts` flags `no_assignees`, and that check and
  needs-reassignment must skip `menu_section`.
  `set_coverage_requirement_assignees` must refuse `menu_section`, admins
  included. `overdue_count` must leave out `menu_section`. The roster's due
  date and Overdue go (rule 23).

### Phase 3: beyond the menu

| ID   | Step                                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-9  | **Built (15 Nov 2026, `feat/goals-sprint`; decision 24).** Month credit for photos that are not a dish or a drink, through labelled venue areas (B03 places), reviewed on `/manager/review` and its admin twin. Migration `20261116170000_area_photos.sql`.                   |
| G-10 | Deferred until the pilot venues have real counts. Service and venue-specific requirements either become a venue goal or are retired. Decide with real counts from the pilot venues, together with the `/staff/manage` retirement date (D3). This ends decision 8's list page. |

G-9 is built. G-10 is deferred until the pilot venues have real counts, and
needs its own decision before a batch starts.

G-9 follow-ups (not built): retake notes for area photos (`my_retake_notes`
does not read them), area photos in the Review tab badge and "Also counts
for", paging past 50 in the area queue, and the area chip on Me outside the
label editor.

## Risks

- **B02 reversal everywhere.** Home's To do shipped in #26 with its own e2e
  (`home-todo.spec.ts`), and decision 9 replaces it at every venue at once,
  with no pilot stage. The rollback is the `NABALENS_HOME_LAYOUT` switch, and
  setting it is an environment change the user makes. Every venue is told on
  release day (decision 18).
- **Month target looks harder mid-pilot.** Anyone who relied on sending
  unlabelled photos to the month keeps that route until G-9 (decision 5), so
  nobody loses credit at the cut-over.
- **Menu changes.** A new active menu sends accepted photos to recheck and can
  reopen dishes. That is existing behaviour. Home must show the recheck
  state that `getOurMenu` already returns, not just a lower count.
- **Privacy of the month.** G-1 and G-8 must not add rankings or
  comparisons. The v0.4 exclusion of leaderboards stands.
- **Rebase size.** 94 overlapping files. G-0 is the riskiest step, and
  nothing else should start before it lands.

## Checks

Per `AGENTS.md`: `pnpm verify:change` with the named test files while
building. Run `pnpm test:security <isolated Supabase workdir>` (a stack
outside the 554xx ports; see `tests/security/run.mjs`) and
`pnpm test:migrations` for G-0, G-2, G-3, G-6 and G-7. `verify:change` has no
database kind, so record database runs as manual evidence in the
`verify:batch` notes. Then `pnpm typecheck`, `pnpm lint`, and
`pnpm verify:batch` to record the batch. Run `pnpm verify:release` once, on
the final head after a fresh rebase. Nothing in this plan applies a
migration to a hosted database.

## Focused tests per step

| ID  | Tests                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G-0 | `tests/security/menu-item-photos.test.ts`, `completion-targets.test.ts`, `coverage-hardening.test.ts`; `tests/unit/scope-guard.test.ts`; `tests/ui/staff-shell-status.test.tsx`                                                                                                                                                                                    |
| G-1 | `tests/ui/home-cards.test.tsx`, `home-page.test.tsx`, `tasks-views.test.tsx`, `staff-shell-status.test.tsx`, `app-shell.test.tsx`, `amenities-capture-home.test.tsx`, `amenities-finding-sent.test.tsx`; `tests/unit/gallery-completeness.test.ts`; `tests/e2e/home-todo.spec.ts` (rewritten as a goals spec), `coverage-staff.spec.ts`, `menu-completion.spec.ts` |
| G-2 | `tests/security/menu-item-photos.test.ts` (new describe), `coverage-access.test.ts`, `coverage-rules.test.ts`; `tests/migrations/coverage-withdraw-access.sql`, `withdraw.test.ts`; `tests/unit/coverage-services.test.ts`; `tests/ui/month-sent-total.test.tsx`                                                                                                   |
| G-3 | New `tests/security/retake-note-set-aside.test.ts`; `tests/migrations/lint.test.ts`; `tests/unit/my-menu-photo-decisions.test.ts`; `tests/ui/me-work-rows.test.tsx`; `tests/e2e/better-photo.spec.ts`                                                                                                                                                              |
| G-4 | `tests/e2e/coverage-routes.spec.ts`, `coverage-staff.spec.ts`, `coverage-acceptance.spec.ts` (AC-24, AC-29); `tests/ui/not-found.test.tsx`                                                                                                                                                                                                                         |
| G-5 | New `tests/unit/staff-copy-guard.test.ts`; `tests/unit/design-citations.test.ts`; `tests/ui/tasks-first-run.test.tsx`; `tests/e2e/visual.spec.ts` (re-baselined once, in the phase PR)                                                                                                                                                                             |

## Files

- Home: `app/staff/tasks/{page,loading,error}.tsx`, `lib/config/home-layout.ts`,
  `components/nabalens/tasks/{home-overview,tasks-overview,todo-list,month-card,monthly-progress-card,first-run,needs-another-photo-list,copy}.tsx|ts`,
  `components/nabalens/home/our-menu-card.tsx`,
  `components/nabalens/menu-photos/item-row.tsx`, `components/ui/progress.tsx`,
  `app/staff/_shell/shell-status.ts`, `components/nabalens/app-shell.tsx`
- Me and routes: `app/staff/page.tsx`, `app/staff/staff-portfolio.tsx`,
  `app/staff/tasks/[requirementId]/{page,not-found}.tsx`,
  `app/staff/tasks/{welcome,month}/page.tsx`, `app/_coverage/actions.ts`
- Server: `lib/server/coverage/{staff,menu-items,venue,views,types,time}.ts`,
  `lib/db/types.ts` (regenerated once), `scripts/db/lib/drill.ts`
- Database: `supabase/migrations/20261115100000_menu_photo_counts.sql`,
  `20261115110000_menu_settles_submissions.sql`,
  `20261102150000_coverage_procedures.sql`, and `main`'s
  `20261109120000_venue_monthly_completion_targets.sql`
- Phase 2: `app/manager/menu`, `app/staff/manage/_shared/screens/requirement.tsx`,
  `app/admin/coverage`
