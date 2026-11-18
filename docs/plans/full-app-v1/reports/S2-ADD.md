# S2-ADD worker report

Final report from the T3 worker (branch `fa/s2-add`, merged into `feat/full-app-v1`).

S2-ADD is finished on `fa/s2-add`: 11 commits, working tree clean, my stack stopped. Of my 26 checklist rows, 23 are built (5 of them as recorded departures), 2 are partly built and 1 is kept as designed. Nothing was pushed or deployed.

**Measured taps** (from the UI tests; picking photos in the phone's own picker is not counted):

- **1 photo for a requested slot:** 1 tap. Tapping the empty slot opens the gallery and the photo goes straight to that slot. No typing.
- **10 photos of 3 dishes (4 + 3 + 3):** 7 taps. Add photos, then for each dish: tap the last photo of the run, then tap the dish. The last group uses "All 3 left". Matching one photo at a time would take 11.

I first built "use for the next N photos" as a +/− counter. It saved no taps, so I replaced it with a row of the next photos where one tap selects every photo up to the one tapped.

## Checklist results

| ID                                                                                        | Result                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC05, S5.4-batch-groups                                                                   | Built. Groups are made inside Match ("Same slot for the next photos too?", decision FA-3, departure A-6), with an "N not matched yet" count.                                                                                     |
| AC11, S5.4-venue-change-revalidate, S2-one-venue-batch                                    | Built. If the active venue changes while Match is open, choices not yet sent are undone and the slot list is reloaded for the new venue, with a notice. The database refuses other-venue labels and "I'm not sure" after a move. |
| S5.1-venue-visible                                                                        | Built. "For {venue}" under Match's title and on the end screen.                                                                                                                                                                  |
| S5.1-note                                                                                 | Built. An optional note, collapsed by default, saved as the photo's label note.                                                                                                                                                  |
| S5.3-not-sure, S2-not-sure                                                                | Built: the staff side and the database queue. The manager's screen for it belongs to S2-REVIEW.                                                                                                                                  |
| S5.3-alias-search                                                                         | Built. Search uses the menu's other names and forgives plurals and one-letter typos.                                                                                                                                             |
| S5.4-batch-limit                                                                          | Built. 20 photos everywhere, including label batches (previously 10).                                                                                                                                                            |
| S5.4-no-mixed-default                                                                     | Built. Nothing is grouped until the person asks; the upload sheet's shared field now says "These go on all N photos".                                                                                                            |
| S5.5-quality-checks                                                                       | Built. Dark, blurred and small photos get a hint in the browser, and a photo already sent gets "Sent before". Neither ever blocks sending.                                                                                       |
| S5.2-task-satisfied                                                                       | Built. Security test: a later photo of an already-covered dish is kept and coverage does not change.                                                                                                                             |
| S1-interrupted-upload                                                                     | Built. A new row on Album Home: "N photos didn't finish".                                                                                                                                                                        |
| S1-job-order, S1-work-area-pref                                                           | Built. Slots with a manager's needed-by date come first, then retakes. With no remembered place, Album opens on a place that fits the person's work areas.                                                                       |
| S2-task-preselect-cancel, S2-shared-flow                                                  | Built.                                                                                                                                                                                                                           |
| S5.2-camera-buttons, S5.2-task-multi-and-video, S5.3-tabs-wording, S2-confirmation-screen | Built as recorded departures A-3, A-4, A-5 and A-7 (gallery first, one photo from a slot, existing tab names, sending per choice).                                                                                               |
| S11-upload-batch                                                                          | Partly. The batch and item IDs from Sprint 1 exist, but one Match pick can span several queue batch IDs when the queue is full.                                                                                                  |
| S1-pending-not-urgent                                                                     | Partly. Slots with a photo already waiting appear in Match search and Recent as "another photo is welcome". The slot page's "Add another" is S2-STAFF's.                                                                         |
| S1-jobs-list                                                                              | Kept as the design system has it: up to six slot tiles on Home.                                                                                                                                                                  |

The Sprint 1 items handed to me: the Match states `checking`, `sent` and `unfinished`, and the dialog's `onProcessing`, were already wired by S1-UPLOAD; I added tests for them. Staff can now suggest a local special from Match when a search finds nothing (`suggestSpecialAction`, which uses `createSpecial`).

## Migration

`20261118112000_label_help.sql` adds a `media_label_help_requests` table and three functions:

- `request_label_help(asset)`: for the uploader only; same venue rule as finalise; asking again returns the first request.
- `my_label_help(asset ids)`.
- `label_help_queue(venue, limit)`: for the venue's managers and admins (admins must name the venue). Oldest first: "I'm not sure" photos, plus photos left unmatched for 7 days or more.

A request closes by itself once the photo has a label, so there is no extra write. The migration applies on a fresh reset. `lib/db/types.ts` contains only my additions.

## Files outside my area (all small)

- `lib/album/model.ts`: slot order, and `currentPlace` takes work areas.
- `app/staff/tasks/page.tsx`, `app/staff/layout.tsx` (passes `venueId`).
- `components/nabalens/album/album-home.tsx` (one row added), `components/nabalens/shell/add-context.tsx` (new `earlier` field).
- `components/nabalens/upload-dialog.tsx`: `onReady` gets a 4th `duplicates` argument.
- `components/nabalens/labels/upload-label-panel.tsx`, `lib/menus/types.ts` (label batch limit 20).
- Docs: `DESIGN.md` §5 Match picker and §6.1 (step numbers unchanged), departures A-3 to A-7, catalogue.
- `/ui-preview` album block, and five existing tests updated for the new limit, `onReady` argument and slot order.

## Checks

- `pnpm typecheck`: clean.
- `pnpm exec eslint . --ignore-pattern '.claude/**'`: clean.
- Prettier: clean on every changed file except the `.sql` file, which Prettier cannot parse.
- `pnpm test`: final run 388 files, 4817 tests passed. The run before it had 27 failures, all HEAD-image (HEIC) and media timeouts plus the gallery guard. The machine load average was about 124 on 18 cores; the gallery guard passes on its own and the next full run was clean. I changed nothing in `lib/media`.
- Security, on my stack: `label-help` 13/13 and `add-photos` 2/2, both again after a clean reset. `upload-pipeline`, `labels-db` and `coverage-slots` also pass (82/82 in all).
- **Not done:** a rendered check at 320 px and desktop. The layout uses wrapping and scroll-inside-its-box, but nobody has looked at it in a browser. This belongs to the coordinator's rendered checks.

## For Sprint 3 reviewers and e2e writers

- **Route:** staff `/staff/tasks` (Album). Add photos opens Match; tapping an empty slot sends one photo straight to it.
- **Test ids (`data-slot`):** `match-venue`, `match-open-count`, `match-group`, `match-group-photo` (with `aria-pressed`), `match-unsure`, `match-note-toggle`, `match-note`, `match-quality`, `match-special`, `match-summary-venue`, `match-summary-chips`, `match-summary-unsure`, `unfinished-row`.
- **Button names:** "Photo N too", "All N left", "I'm not sure", "Add a note", "It's food".
- **S2-REVIEW** should build the manager's Needs label view on `label_help_queue` (`getLabelHelpQueue` in `lib/server/label-help.ts`). The note is in `media_labels.note`.
- **Seed:** none. Assets older than 7 days with no label show in the queue as "unmatched".
- **Assumptions:**
  - The quality hints run in the browser rather than at finalise, so no media worker is needed; HEIC photos the browser cannot decode get no hint.
  - A special suggested from Match runs from today for 7 days.
  - Recent slots are remembered per phone and per venue.
