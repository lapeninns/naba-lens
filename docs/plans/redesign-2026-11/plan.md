# Whole-app redesign with Open Design (batch R, 21 Nov 2026)

Owner: Aman Kumar Shrestha. Asked on 21 Nov 2026: redesign the whole app
with Open Design (the desktop design workspace), staff first, then manager,
then admin, and implement it in this repo. Design partner: Open Design,
reached through its MCP server (`open-design`, see the owner's local setup).

Rules that do not change: design system v2 on Album's behaviour (D10),
tokens in `app/globals.css`, components from `catalogue.md`, no in-app
camera, StatusChip words, no messaging or approval-workflow features
(scope guard), WCAG 2.2 AA, 48px staff targets, 320px and 200% zoom.

## Tasks and acceptance

| ID  | Task                                               | Done when                                                                                                                                                                |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R0  | D21: immediate Album posting on by default         | Switch defaults on, `=0` restores D9, legacy tests pin it off, docs updated                                                                                              |
| R1  | Staff shell fixes from the audit                   | Staff error and loading boundaries name the right page and keep the tab bar; no "Home" leftovers; tabs light correctly; Me subpages use one back link                    |
| R2  | Staff photo workflow per the 20 Nov handoff        | Added photos screen with Label now / Label later, tick-then-label batch labelling with a confirm bar and a saved result naming the folder, Unlabelled first in My photos |
| R3  | Staff Today, Me hub and subpages per the prototype | Today is one "Needs you" list; Me, Settings, Help, notices, people use the shared subpage frame                                                                          |
| R4  | Manager IA and screens per Open Design             | One meaning for "Album"; every section reachable from nav; boundaries per section; VenueBar on review                                                                    |
| R5  | Admin IA and screens per Open Design               | No orphan routes; correct active section; boundaries per section; back links on detail pages                                                                             |
| R6  | Auth screens on v2                                 | Sign-in, confirm, MFA and blocked off Common Room                                                                                                                        |
| R7  | Validation                                         | typecheck, lint, unit, focused UI tests for each change, browser pass at 360/390/1280 on a local stack, axe on key screens                                               |

The audit that motivated these tasks is in `audit.md` next to this file.
Release: one bundled PR; production needs the two pending migrations
(20261120120000, 20261120130000) applied before merge, by the owner.

## Status (21 Nov 2026, end of the overnight run)

| ID  | State              | Evidence                                                                                                                                                                                                      |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0  | Done               | `e5de55379`; legacy D9 tests pin the switch off                                                                                                                                                               |
| R1  | Done               | staff boundaries, Today back links, tab lighting, BackLink                                                                                                                                                    |
| R2  | Done               | tick-label-confirm-undo, Photos added with Label now/later, Unlabelled first in My photos; tried end to end on a local stack with the Old Crown menu                                                          |
| R3  | Done (photo parts) | Today and Me speak of labelling; Recent photos and Me use BackLink. The prototype's Today "Needs you" list and Questions screens are not built                                                                |
| R4  | Done               | Open Design route map: tabs, titles, back links, boundaries, Needs you today, review words, amenity screens as Album tabs                                                                                     |
| R5  | Done               | Open Design route map: lit sections, tabs and picks, orphans reachable, boundaries, one Review per venue                                                                                                      |
| R6  | Done               | sign-in on v2, one frame, Retry boundary                                                                                                                                                                      |
| R7  | Local checks done  | typecheck, lint, 5392 unit tests; every staff, manager and admin route renders (200, no error state) as its fixture; axe WCAG 2.2 A/AA: no violations on 14 screens. Not run: integration, security, e2e, lci |

Still open:

- e2e specs that assert old titles or words will need updating when they run.
- Manager: VenueBar on review, counts on Album tabs, one shared Your photos list; `triage-card`, `overview-body`, `review-card` still import Common Room.
- Admin: the Overview cell-tint table and the shorter check-dates form from the handoff.
- Staff: the prototype's Today "Needs you" list, venue Questions and the Me subpages' new layouts; "I'm not sure" while posting (removed by D20, the handoff wants it back with who gets the photo).
- Open Design's open questions for the owner: whether "Keep in the album" also means approved for public use; nine or ten venues; venue names and towns.

## Batch S2: the second Open Design handoff (21 Nov 2026)

Open Design's second run (`redesign-handoff-2.html`, `screens-2.md` in the
Open Design project "nabalens-manager-admin-and-sign-in-redesign") drew the
screens the first handoff left out. Built on `redesign/remaining` from three
branches: `redesign/s2-staff` (15 rows), `redesign/s2-manager` (15) and
`redesign/s2-admin` (23).

Partly done, with the reason:

- Manager reported changes: a dish or space report shows no photo (one more
  read needed).
- Manager search keeps today's filter row (already one row on desktop).
- Admin This month keeps two tally groups instead of six tallies in one.
- Admin Collections rows have no cover photos (needs a light read of two
  cover ids per collection).

Resolved by the owner (21 Nov 2026, D22; `redesign/s2-decisions`):

- Amenity finding decisions read "Use this answer" / "Keep the current
  answer" instead of Confirm / Don't confirm.
- Manager and admin capture also say "Send answer".
- The finding chip "Couldn't establish" reads "I couldn't find out".
- "Items and facts" on Progress folds like the other references.
- The shared category label in `lib/album/model.ts` says Amenities; the
  admin override (`adminCategoryLabel`) and the separate category word
  lists now read it.

Open for the owner:

- Removal requests read each photo's label with one detail read (capped at
  50); a label field on the request would be the lasting fix.
- Staff folder covers are the newest post, not the manager's menu photo,
  and staff tiles read "posted" after acceptance (D21).
