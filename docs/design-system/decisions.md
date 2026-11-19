# Design system decisions

A decision is recorded here once, with who made it and when. `DESIGN.md` states the rule; this file says why it is the rule and what it replaced. Add new decisions at the end and never renumber.

Status is one of: **open** (needs an answer), **decided**, **deferred** (with the date it comes back).

## Open decisions

Raised by the Album release reviews, 17 Nov 2026. None blocks release; each has today's behaviour stated.

| ID  | Question                                                                                                                                                                                                                                                                    | Today                                                                                              | Owner               | Raised      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------- | ----------- |
| D10 | Should an amenity slot's state be the same for everyone at the venue? Staff Album knows only the viewer's own finding (sent: Waiting; sent back: Retake; a colleague sees Needed), while dish slots show Waiting to everyone and admin Albums uses the latest open finding. | Per viewer on staff Album; latest open finding on admin Albums. Built in batch V2 on branch `design/v2` (`docs/plans/design-v2/plan.md`); DESIGN.md becomes 2.0, keeping Album section numbers where the rule survives. | Owner, answering four questions in the coordinator session | 18 Nov 2026 |
| D11 | Should staff at an inactive venue still read its venue data (places, slot photos)? `active_staff_venue_id()` ignores `venues.active`, so they can while the venue's manager is refused.                                                                                     | Allowed, as for every older knowledge read. A change belongs to all venue reads, not one function. | Aman Kumar Shrestha | 17 Nov 2026 |
| D12 | Should Match later include photos added before Album, which have no label either?                                                                                                                                                                                           | Yes: every unlabelled photo of the person's (the newest 96) is listed.                             | Aman Kumar Shrestha | 17 Nov 2026 |

## Decided

D1 to D7 were answered together on 14 Nov 2026 with "proceed with recommended": each recommendation in [strategy.md](strategy.md) section 9 is the decision. D3 sets the direction only; the date `/staff/manage` is retired is still to be set, and nothing redirects until it is.

| ID  | Question                                                                                                                                                                                                                                               | Decision                                                                                                                                                                                           | Decided by          | Date        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------- |
| D1  | Is Common Room v0.3 signed off as the product's design language? The spec has been headed "proposal, not yet signed off by product" since 7 Nov 2026, the day it shipped to every screen.                                                              | Yes, with the changes in strategy.md section 4.3.                                                                                                                                                  | Aman Kumar Shrestha | 14 Nov 2026 |
| D2  | Theme policy. The spec says light by default and dark by choice. The app follows the OS, and the only control is pressing `d`.                                                                                                                         | Follow the OS. Add a visible setting (System, Light, Dark) on Me and on Account. Remove the hotkey from production.                                                                                | Aman Kumar Shrestha | 14 Nov 2026 |
| D3  | Which venue-manager workspace is canonical: `/manager`, or `/staff/manage` with its admin twin at `/admin/coverage/[venueId]`? When is the other retired?                                                                                              | `/manager`. New grants already go to manager accounts only. Redirect `/staff/manage` on a set date.                                                                                                | Aman Kumar Shrestha | 14 Nov 2026 |
| D4  | One verb and one resulting state per review decision. Today: "Ask for another photo" and "Ask for a better photo"; "Withdraw acceptance" and "Undo acceptance".                                                                                        | "Ask for another photo", giving "Needs another photo". "Undo acceptance".                                                                                                                          | Aman Kumar Shrestha | 14 Nov 2026 |
| D5  | Is "Done" banned as a button label, or only as a state word? Two buttons say "Done" today (`upload-dialog.tsx`, `session-guard.tsx`).                                                                                                                  | Only as a state word.                                                                                                                                                                              | Aman Kumar Shrestha | 14 Nov 2026 |
| D6  | Is "Ready" ever drawn as a chip? Which upload words do staff see? The spec, the chip table, the upload sheet and the media tile each use a different set.                                                                                              | Staff see Saved, Saving… and Needs attention. Ready is text on a tile, not a chip. Remove its reserved shape, or use it.                                                                           | Aman Kumar Shrestha | 14 Nov 2026 |
| D7  | Token names. Text uses the earlier names (`ink`, `ink-muted`, `line`); surfaces use the Common Room names (`surface`, `surface-2`). Which set is public?                                                                                               | Keep both as they are used, rename `bg` to `canvas` and `border-strong` to `edge-strong`, and make the shadcn slot names private. See strategy.md section 5.2.                                     | Aman Kumar Shrestha | 14 Nov 2026 |
| D8  | Replace Common Room entirely with Album: every venue as an album of slots (dishes, drinks, amenities, areas), gallery-first adding, match-to-slot, warm paper and bottle-green look? Proposal and prototype: [proposals/album.md](proposals/album.md). | Yes: option (a), adopt Album including the product changes in its section 7. Supersedes D1. Nothing of Common Room is kept; it ships until batch A5 retires it.                                    | Aman Kumar Shrestha | 17 Nov 2026 |
| D9  | When is a photo matched to what it shows: as it is added, or labelled after upload? Part of D8 (Album proposal section 7, item 1).                                                                                                                     | Matched as it is added. Staff choose photos from the gallery, then tap the empty slot each fills; "Match later" and "Not for a slot" keep the rest. This holds whatever D8 decides about the look. | Aman Kumar Shrestha | 17 Nov 2026 |
| D10 | Adopt "Naba-Lens design system v2" (owner package of 18 Nov 2026, now in `docs/design-system/v2/`): tokens, type, 21 components, SideNav? Several of its rules (Upload and Take photo, a Submit step, status words, four staff tabs) contradict D9, FA-1, FA-2 and FA-7. | Adopt v2's **visual system** in full: tokens (light and dark), Figtree body with Fraunces display, the 21 components, SideNav for managers and admins from 1100px. **Keep** Album's behaviour and words: gallery-first Add photos with Match on add and no in-app camera or Submit step, the FA-7 status words in `status-chip.tsx`, and the three staff tabs Album / Add photos / Me. Each kept rule is a departure from v2 in `departures.md`. Built in batch V2 on branch `design/v2` (`docs/plans/design-v2/plan.md`); DESIGN.md becomes 2.0, keeping Album section numbers where the rule survives. | Owner, answering four questions in the coordinator session | 18 Nov 2026 |

| ID  | Decision                                                                                                                                                                                                                                    | Decided by  | Date        | Notes                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | The repo is the source of truth for the design system. `docs/design-system/DESIGN.md` is the spec, `app/globals.css` holds the values, `components/nabalens/status-chip.tsx` holds the state words.                                         | Engineering | 14 Nov 2026 | Replaces the research folder named in `app/globals.css` and the claude.ai Design System artifact from PR #14. See "Superseded sources" in `DESIGN.md`. |
| R2  | Section numbers in `DESIGN.md` do not change. New material is added as a new section or a lettered subsection.                                                                                                                              | Engineering | 14 Nov 2026 | Code comments cite sections by number. `tests/unit/design-citations.test.ts` fails when a cited section is missing.                                    |
| R3  | On 17 Nov 2026 `DESIGN.md` became Album v1.0 with its own section numbers. Common Room's text, with its numbers, moved unchanged to `common-room.md`, and every code comment citing it moved with it. R2 applies to each file from then on. | Engineering | 17 Nov 2026 | `tests/unit/design-citations.test.ts` checks each citation against the spec it names.                                                                  |

## Decisions already in the Common Room spec

These were settled in the Common Room spec before it came into the repo. They bind the Common Room screens that still ship, and nothing else: Album ([DESIGN.md](DESIGN.md)) restates the rules it keeps in its own words.

| Rule                                                                                | Where                   | Why                                                                                           |
| ----------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| Three tones (ok, warn, info) plus neutral. Errors and warnings share the warn tone. | `common-room.md` §2     | State is carried by the word and the shape. A fourth colour would invite colour-only meaning. |
| Blue never marks a state or progress. Progress is green.                            | `common-room.md` §2     | Blue means "the next step" or "you chose this".                                               |
| Solid blue may mark a selection the person made.                                    | `common-room.md` §2, §9 | Added in v0.3 for ticked boxes, chosen radios and picked tiles.                               |
| Text is 17px or larger. The only exception is the 15px caption over a photo.        | `common-room.md` §2     | Staff read it mid-shift, at arm's length.                                                     |
| No toasts. Feedback is written on the page.                                         | `common-room.md` §5     | A message that disappears cannot be re-read.                                                  |
| Lists grow with "Load more". No page numbers, no infinite scroll.                   | Shipped behaviour       | One consistent pattern across every list.                                                     |
| The stepper's minus and plus carry no visible word.                                 | `common-room.md` §4     | They are drawn signs beside a labelled field, each with an `aria-label`.                      |

## Batch Match phone preview

- **D13**. The phone trial uses a separate gallery-first Home, a slot-first
  Album and a personal Me, with monthly progress in the header when a goal
  is set. Trial decision for DESIGN.md §6.1a, pending confirmation on phones.
- **D14**. Should gallery picks transfer into a private draft before staff
  commit their matches? The phone trial sends on confirmation and uses the
  existing Match later destination. Early transfer needs a decision about
  draft retention and recovery.

## Staff Home

- **D15** (18 Nov 2026, Aman Kumar Shrestha). Staff Home reminds the
  person to add photos and shows their recent activity (DESIGN.md §5c). It
  never chooses which dish, drink or space to photograph: only a reviewer's
  retake or a manager's request names one, and Album is where slots are
  browsed. The month card leaves Home (it stays on Me). Tried and dropped
  the same day: a second grid of empty slots (it repeated Album) and a
  daily list of five chosen slots ("today's shots"). Supersedes the Home
  content of D13 and §6.1a MT-4.

## Album shelves

- **D16** (18 Nov 2026, Aman Kumar Shrestha). Album opens on three parts,
  Menu (Food and Drinks, as a switch), Amenities and Spaces, as Google
  Business Profile groups a venue's photos (DESIGN.md §5d). Inside, sections
  sit on shelves (Spirits, Mains). The place (Bar, Kitchen pass) is a lens
  over every screen, not the top level. Shelves are one fixed Naba-Lens set;
  each section is suggested a shelf from words in its name and a venue's
  manager can move it (`album_shelves`). Amenities holds every feature a
  photo can show; the rest stay facts. Chosen over type or place as the top
  level, a Profile part (logo, cover, frontage: later) and code-only name
  rules. Plan: `docs/plans/album-shelves.md`.

## Me

- **D17** (19 Nov 2026, Aman Kumar Shrestha). Staff Me is a hub of rows
  (DESIGN.md §5b): profile, "n photos need you", Your photos, Your month,
  Notices, then Your venue, Settings and Help. Your photos
  (`/staff/photos` since D18), Settings (`/staff/me/settings`) and Help
  (`/staff/me/help`) get their own routes. My contributions, the media
  gallery, the accepted-photos grid, Needs labels and the retake notes leave
  Me: each repeated Your photos. Add photos stays a tab only. The legacy
  `/staff` page is unchanged until it is retired.

- **D18** (19 Nov 2026, Aman Kumar Shrestha). Five staff tabs in the photo
  preview shell: Today (was Home, `/staff/home`), Album, Add in the middle,
  My photos (`/staff/photos`, moved from Me) and Me (DESIGN.md §15, §5e).
  Retakes are counted on My photos, not Album. Add shows "Add" and is
  announced as Add photos. Chosen over keeping Home's name and over Home ·
  Venue · Add · Photos · Profile.

- **D19** (19 Nov 2026, Aman Kumar Shrestha). My photos is photo first
  (DESIGN.md §5e): one Needs you inbox (retakes, no slot yet, couldn't
  finish, labels not saved), a three-up grid grouped by day with All,
  Waiting and In the album, and a page per photo (`/staff/photos/[assetId]`)
  holding every action. Sending is a row, not a filter. Chosen over a
  compact list by day and over a bottom sheet for details.
