# Album: Naba-Lens design system

Version 1.5 · 18 Nov 2026 · Status: adopted on 17 Nov 2026 (decisions D8 and D9 in [decisions.md](decisions.md)). Batches A0 to A5 are built on `design/inn-identity` (§12): Album is the staff Home, adding is gallery first with Match, Review and admin Albums are Album screens. Full App v1 (decisions FA-1 to FA-50 in [the Full App decisions](../plans/full-app-v1/decisions.md)) adds Me's Your photos (§5b), the manager screens (§6a) and the admin screens (§6b). Other screens keep their layout in Album colours and type and stay cited to [common-room.md](common-room.md) until a later batch.

Applies to every Naba-Lens surface: the staff app (phone first), the venue manager screens (phone, tablet, desktop) and the admin desktop app.

| Subject                                      | Where it lives                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Every rule, and what each token is for       | This file                                                                            |
| Token values in code                         | `app/globals.css` (Album values arrive in batch A1; until then it holds Common Room) |
| The prototype                                | <https://claude.ai/artifact/GZUbKcemggcPgV5Rh1Qwyg> (private)                        |
| Why Album, and the product changes it brings | [proposals/album.md](proposals/album.md)                                             |
| The screens that still ship Common Room      | [common-room.md](common-room.md) (frozen)                                            |

Code comments cite this file by section number ("DESIGN.md §4"). Section numbers never change; new material goes in a new section or a lettered subsection. `tests/unit/design-citations.test.ts` fails when a cited section is missing.

## 1. Goal and idea

**Goal.** Every slot at every venue has an accepted photo: each dish and drink on the active menu, each amenity, each area. The system is judged by how quickly the number of empty slots falls.

**Idea.** Every venue is an **album**. Every thing that needs a photo has a **slot** in it. Empty slots are drawn as gaps you can tap. Staff take photos with their phone's own camera whenever service allows, and add them from their gallery later.

## 2. Principles

1. **The gap is the screen.** Album (Home) opens on what is missing, drawn as empty slots and grouped by place. A count alone is never the first thing on a screen.
2. **Gallery first.** The main action always opens the phone's photos. There is no in-app camera (§9).
3. **Match on add.** Choose many photos at once, then tap the empty slot each one fills (D9). Nobody labels a photo after it has been sent.
4. **Show what good looks like.** Every slot has a one-line brief. Staff read it before they add the photo; the reviewer judges against the same words.
5. **Every photo moves the album.** A matched photo fills its slot at once as Waiting for review. Review confirms it or reopens it.
6. **Finish lines you can reach.** A section (Desserts, Games, The garden) is a small finish line. Finishing one is marked on the page and the next nearest gap is offered.
7. **Review in a thumb.** One photo beside its brief, Accept or Ask again with a reason, then the next.
8. **Never lose a photo.** Uploads queue and resume. A photo that is not matched waits under Match later.
9. **One goal on the Album screen.** The album belongs to the venue. A person's own month is on Me, and nobody is ranked against a colleague.

## 3. Tokens

Hex values, sRGB. Batch A1 writes them to `app/globals.css` in OKLCH and adds each pair below to `tests/unit/token-integrity.test.ts`. The app follows the phone's light or dark setting, with a choice on Me (System, Light, Dark).

### 3.1 Colour

| Token          | Light                  | Dark                      | Use                                                                          |
| -------------- | ---------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| `canvas`       | `#f6f1e7`              | `#151714`                 | Paper behind everything                                                      |
| `surface`      | `#fffdf8`              | `#1f221e`                 | Cards, bars, sheets, empty slot fill                                         |
| `surface-2`    | `#ece5d6`              | `#2c302a`                 | Secondary buttons, fields, empty part of a bar                               |
| `raised`       | `#e0d7c4`              | `#393d36`                 | Hover and press on `surface-2`                                               |
| `ink`          | `#1f2a22`              | `#efeadf`                 | Text and icons                                                               |
| `ink-muted`    | `#575c52`              | `#b8b3a6`                 | Secondary text, counts beside a heading                                      |
| `line`         | `#e3dccd`              | `#393d36`                 | Hairline edges of cards and rows                                             |
| `edge`         | `#7a7466`              | `#878274`                 | Dashed edge of an empty slot, field edges, outline tags                      |
| `accent`       | `#1d4d36`              | `#2b6e4c`                 | The one main button on a screen                                              |
| `accent-hover` | `#153b29`              | `#235c3f`                 | Main button hover and press                                                  |
| `accent-text`  | `#1d4d36`              | `#8fd1aa`                 | Active tab, links, the plus in an empty slot                                 |
| `accent-soft`  | `#dcebe0`              | `#1d3a2b`                 | A choice the person made (place chip, an amenity answer, nav item)           |
| `focus`        | `#1d4d36`              | `#8fd1aa`                 | Focus ring                                                                   |
| `ok-fg`        | `#1b5e3a`              | `#8fd1aa`                 | Accepted tag fill (light) and text (dark), filled part of a bar              |
| `ok-bg`        | `#d9eedd`              | `#173323`                 | Tint behind ok text                                                          |
| `ok-waiting`   | `#9fcfae`              | `#3f6b52`                 | The waiting part of a bar                                                    |
| `ok-half`      | `oklch(0.87 0.05 153)` | `oklch(0.39 0.055 157.5)` | Admin Albums: a cell half or more filled (§6.6), between `ok-bg` and `ok-fg` |
| `warn-fg`      | `#9a3412`              | `#ffb49d`                 | Retake word, errors                                                          |
| `warn-bg`      | `#fbe3d6`              | `#4d231a`                 | Retake row, retake tag, reason chips                                         |
| `ring-retake`  | `#c2683f`              | `#b3654c`                 | Ring round a photo that needs another                                        |
| `ring-waiting` | `#e0d7c4`              | `#8a8576`                 | Ring round a photo waiting for review                                        |
| `hatch`        | `#ece5d6`              | `#2c302a`                 | Hatching on a Not here slot                                                  |
| `stage`        | `#0e0f0d`              | `#0e0f0d`                 | Surround of a photo shown large (Match, Review, viewer), both themes         |
| `on-stage`     | `#f2efe8`              | `#f2efe8`                 | Text on the stage                                                            |
| `scrim`        | `#0e0f0d` at 55%       | `#000000` at 65%          | Behind sheets and dialogs                                                    |

**Green is rationed.** Solid `accent` fills one control per screen: the main button. A choice the person made uses `accent-soft` with a 2px `accent` edge, never the solid fill. Accepted is a small filled `ok-fg` square tag on a photo, never a control. The main action and Accepted are both green; they are told apart by form and place, and Accepted always has its tick and its words.

In dark, the main button's fill is 2.6:1 against a card, so it carries a 1px `accent-text` edge.

### 3.2 Contrast (computed, WCAG 2.x)

| Pair                                     | Light     | Dark      |
| ---------------------------------------- | --------- | --------- |
| ink on canvas                            | 13.2      | 15.0      |
| ink on surface                           | 14.6      | 13.4      |
| ink on surface-2                         | 11.9      | 11.2      |
| ink-muted on surface                     | 6.8       | 7.7       |
| ink-muted on surface-2                   | 5.5       | 6.4       |
| white on accent (main button)            | 9.7       | 6.1       |
| white on accent-hover                    | 12.4      | 7.9       |
| accent-text on surface                   | 9.5       | 9.1       |
| ink on accent-soft                       | 12.0      | 10.3      |
| accent-text on accent-soft (chosen chip) | 7.8       | 7.0       |
| on-stage on stage                        | 16.7      | 16.7      |
| ok / warn text on tint                   | 6.4 / 5.9 | 7.7 / 7.8 |
| focus on canvas (non-text)               | 8.6       | 10.2      |
| edge on surface / surface-2 (non-text)   | 4.6 / 3.7 | 4.2 / 3.5 |

Batch A1 recomputes every pair from `app/globals.css` in `tests/unit/token-integrity.test.ts`.

### 3.3 Type

| Role                          | Family                     | Size / line / weight                              |
| ----------------------------- | -------------------------- | ------------------------------------------------- |
| Display                       | Fraunces                   | 34 / 1.05 / 700, -0.01em                          |
| Page title                    | Fraunces                   | 30 / 1.1 / 700                                    |
| Section heading               | Fraunces                   | 21 to 22 / 1.2 / 600                              |
| Count                         | Fraunces                   | 44 to 48 / 1 / 700, tabular                       |
| Body                          | Atkinson Hyperlegible Next | 17 / 1.5 / 400                                    |
| Strong body, labels           | Atkinson Hyperlegible Next | 17 / 1.5 / 700                                    |
| Button                        | Atkinson Hyperlegible Next | 18 / 1.2 / 700                                    |
| Meta, counts in a line, times | Atkinson Hyperlegible Mono | 17 / 600, tabular                                 |
| Slot name on a photo          | Atkinson Hyperlegible Next | 15 / 1.15 / 700, white on the photo's lower scrim |
| Section full stamp            | Fraunces                   | 17 / 700 caps, +0.08em                            |

Fraunces is used only at 17px caps or 21px and up, where a serif stays legible on a phone. Everything read at length is Atkinson. Product text is 17px or larger; the only exception is a slot name over a photo tile. Fallbacks: `system-ui, -apple-system, "Segoe UI", sans-serif`.

### 3.4 Space, size, shape, motion

- 4px base: `4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40`. Screen gutter 12, card padding 16, slot gap 6 (4 across) or 8 (3 across).
- Sizes: main button 64, other buttons 52 to 56, every other target 48 or more with 8 between, field 52 to 56, row 60 to 64, place chip 64, tab bar 68.
- Radius: main button 14, other buttons 12, field 10 to 12, card 14, slot tile 10 to 12, sheet top 20, chips and pills full, Accepted tag 4, stamp 2.
- Edges, not shadows: cards and rows have a 1px `line` edge. Only sheets and dialogs cast a shadow (`0 12px 28px` at 18%).
- Motion: a slot fills in 200ms, sheets rise in 240ms, press moves 1px. Reduced motion turns all of it off. Nothing moves on its own except real progress.
- Design sizes: phone 390 × 844, narrow phone 320 wide, tablet 1024 × 768, desktop 1280 × 800.

## 4. Slot states

A slot's state is shown by its frame, an icon and a word. Colour is never the only signal, and no two states share a frame.

| State                   | Frame                                    | Icon and word                                                         | Counts as filled          |
| ----------------------- | ---------------------------------------- | --------------------------------------------------------------------- | ------------------------- |
| **Needed**              | 2px dashed `edge`, `surface` fill        | + Add                                                                 | No                        |
| **Sending**             | The photo, no ring                       | Sending 40% (mono) · Saved on this phone · Checking · Couldn't finish | Shown in the waiting part |
| **Waiting for review**  | The photo, 3 to 4px `ring-waiting` inset | ↑ Waiting                                                             | Shown in the waiting part |
| **Needs another photo** | The photo, 3 to 4px `ring-retake` inset  | ↩ Retake, with the reviewer's reason                                  | No                        |
| **Accepted**            | The photo, no ring                       | ✓ In the album, filled `ok-fg` square tag                             | Yes                       |
| **Check due**           | The photo, 4px `ok-waiting` ring inset   | ⟲ Needs checking                                                      | Shown in the waiting part |
| **Not here**            | 2px dotted edge, `hatch` hatching        | Not here, with the reason                                             | Leaves the total          |

**Reserved forms.** The dashed empty frame belongs to Needed alone. The filled green square tag with a tick belongs to Accepted alone. The double-bordered stamp belongs to a full section alone. No other element may use them.

**Receipt words** (Full App v1, S1-UPLOAD and S2-STAFF; departures.md A-2). A photo on its way reads Saved on this phone (not yet sent), Sending (its bytes are on their way), Checking (the server has it and is preparing it), then Waiting once its slot is saved with it. Sent means it was prepared but no slot was saved with it; Couldn't finish means preparing it failed; Not sent means the transfer stopped. The words are `RECEIPT_WORDS` in `lib/upload/states.ts`. After review, a person's own photo reads In the album, Kept for reference, Retake (with the reviewer's reason), Label corrected or Not used (FA-7); the chips are `outcome_*` in `components/nabalens/status-chip.tsx`. A photo its owner withdrew before review reads Withdrawn.

**Report words** (Full App v1, S2-METRICS; FA-7, FA-8). Manager and admin reports name the same slot states in the spec's words, from the same coverage rule. The chips are `coverage_*` in `CHIP_STATES` (`components/nabalens/status-chip.tsx`):

| Slot state (staff word)              | Report word             | Counted                                 |
| ------------------------------------ | ----------------------- | --------------------------------------- |
| Accepted (In the album)              | Covered                 | In the numerator                        |
| Check due (Needs checking)           | Check due               | In the total, not covered               |
| Waiting for review (Waiting)         | Awaiting review         | In the total, not covered               |
| Needs another photo (Retake)         | Another photo requested | In the total, not covered               |
| Needed                               | Missing                 | In the total, not covered               |
| Not here                             | Not here                | Leaves the total                        |
| A slot nothing needs a photo for now | No photo needed         | Leaves the total (never shown to staff) |

Staff never see a report word, and a report never shows a staff-only word for a slot. Publication, package and request words are §7 (manager and admin words).

**Counts.** The album count is the number of empty slots ("41 slots still empty"). Its bar has three parts: Accepted (`ok-fg`), Waiting and Sending (`ok-waiting`), empty (`surface-2`), with the numbers written under it in mono ("65 in · 7 waiting · 113 in all"). Not here slots are not in the total. Check due (FA-11, Full App v1) is a filled slot whose routine or change-triggered check is due: a manager confirms it, so it sits in the waiting part and is not counted as filled. Every state comes from one coverage rule (`public.coverage_slots`).

## 5. Components

Each component is built once (catalogue: [catalogue.md](catalogue.md)) and named here.

- **Slot tile.** Square. Needed: dashed frame, plus in `accent-text`, the name in 15 to 17px bold. Filled states: the photo, the state's ring and tag top left, the name over a lower scrim. The whole tile is one target. Tapping Needed opens the gallery for that slot; tapping a filled slot opens the slot.
- **Album count.** Display count, a three-part bar, the mono line under it. One per screen, at the top.
- **Place chip.** 64px tall, place name and its empty count. The current place uses `accent-soft` and `accent-text`. Chips scroll sideways; the last one is never cut off without a visible edge.
- **Retake row.** Full-width `warn-bg` row: thumbnail with the retake ring, "↩ 1 retake", the reason in a few words, chevron. Shows only when there is one.
- **Main button.** Full width, 64px, `accent`, white text, a leading icon. Always a verb plus its object or count: "Add photos from your gallery", "Add garden photos · 6 to go".
- **Secondary button.** `surface-2`, ink text, 52 to 56px.
- **Brief.** One line under a slot's name: what the photo must show. Shown on the slot, in Match and in Review.
- **Match picker.** The chosen photos as a strip (current one ringed in `accent`), the venue under the title ("For The Bell"), the current photo on the stage, "Which empty slot is this?", the person's recent slots (the ones matched in this visit first), suggested empty slots as dashed buttons, a search over all slots (other names and small spelling slips forgiven; a slot that already has a photo is never hidden: matched just now or waiting shows ↑, in the album or needing its check shows a photo icon, each with "another photo is welcome" in a plain edge, never the dashed frame; Not on the menu? only follows a search that found no slot), and three secondary buttons: Match later, Not for a slot, I'm not sure. Under the photo, "Same slot for the next photos too?" lists the next photos; under the picker, Add a note (collapsed).
- **Answer pair.** For amenity slots: the guest question as the title, Yes and No as two 60px buttons. The chosen one uses `accent-soft` with a 2px `accent` edge.
- **Section stamp.** "SECTION FULL", Fraunces caps, 4px double border, 2px radius.
- **Reason chips.** For Ask again: 48px `warn-bg` pills with a `ring-retake` edge. Choosing one sends the decision.
- **Review bar.** Ask again (secondary) and Accept (main) side by side at the bottom, 64px.
- **Tab bar.** Three tabs: Album, Add photos, Me. Icons with labels under them. Add photos opens the gallery directly.
- **Field, search field.** 52 to 56px, 1.5px `edge`, label above, never a placeholder as the only label.
- **Sheet.** Rises from the bottom, 20px top radius, `scrim` behind it, keeps its scroll while its content changes.

## 5a. Album (Home, staff)

Top to bottom, on a phone:

1. "The Bell album" (mono), then the album count.
2. The retake row, when there is one.
3. "Where are you?" and the place chips. The current place is the one the person last opened, else the place with the most empty slots.
4. "Empty at the bar" and up to six Needed slot tiles from that place, with "All 8" to open the place.
5. A "Match later" row with the number of unmatched photos, when there are any.
6. An "Other jobs" row (assigned tasks, amenity checks and venue questions waiting on the person), when there are any or the count can't be read.
7. A "Start here" row for new staff, until they dismiss the welcome or add a photo.
8. The main button: "Add photos from your gallery".
9. The tab bar: Album (its badge counts open retakes), Add photos, Me.

The screen shows nothing else: no colleague feed, no personal month (it is on Me), no ranking.

**Full App v1 rows.** The step numbers above are cited in code and stay. In the shipped order, Start here (step 7) sits under the album count, so a new starter sees it first. Full App v1 adds three rows under the retake row, in this order:

- **Unfinished photos** (spec §6 S1): "3 photos didn't finish · Open them to send again. Nothing is sent twice." on `warn-bg`, for photos that stopped or failed on this phone or were picked in an earlier visit and never finished. It opens Add, which shows them first with Retry. Shown only when there are any (`components/nabalens/album/unfinished-row.tsx`).
- **A blocked notice**, when the person cannot add photos at this venue, saying why.
- **Asked for** (S2-REQ, FA-5, FA-50; departure A-R1): a manager's open requests, drawn as the slots themselves (§5 slot tile) with the manager's brief under each and, when dated, "Needed by 30 Nov" as meta text (then "Needed"). The person's own come first, six at most, then "n more in the album". Tapping a Needed slot opens the gallery for that slot; a request with no slot shows its subject and opens Match. Never "task", "request", a due date or Overdue (§7). The component is `AskedFor` (`components/nabalens/requests/staff-requests.tsx`).

Requests never change the album count.

## 5b. Me (staff)

Me holds the person's own work and their account (FA-1; departure A-S1). Top to bottom:

1. **Your photos** (FA-48: the spec's My uploads in Album's words). Filters Needs attention, Sending, Waiting and Reviewed. Each row: thumbnail, slot names (or "No slot yet"), the outcome word (§4), the reviewer's reason on a retake, the venue when it is not the current one, sent and taken dates ("Unknown" when the date taken is not known) and "Already sent before: it doesn't count twice" for an exact copy (FA-35). Actions sit on the row: Retake opens the slot with the reviewer's reason; Change slot (the §5 Match picker) and Withdraw while the photo is undecided; Fix date taken; Ask to remove once it is accepted (FA-21). The component is `components/nabalens/me/my-uploads.tsx`.
2. **Your month** (FA-34): the person's own target and "n slots in the album from your photos". It is never compared with a colleague's (§9).
3. **Help and account** (spec §6 S5): Your venues with the person's role and the venue switcher, Notices, "If you can't add photos" (on the Photo guide) and Your managers (`components/nabalens/me/me-account.tsx`).

Older blocks follow (Needs labels, accepted photos, findings; departure A-S2). Log out is on Me on phones and in the AppBar from md.

**Notices** (FA-10) are an inbox page, `/staff/notifications`, reached from Me: newest first, each with what happened and a link to it, then what to be told about. An unread notice puts a count badge on the Me tab. There are no toasts and no push (§6.7, FA-43). The component is `components/nabalens/me/notices-inbox.tsx`.

**Slot page** (`/staff/album/slot/[kind]/[slotId]`): the slot's photo when it is in the album or due a check, its brief, its state word, "n waiting" when colleagues' photos wait (never the photos themselves, FA-20), Add photos for the slot and Report a change.

## 6. Patterns

### 6.1 Adding photos

1. The person taps Add photos (tab or main button) or a Needed slot.
2. The phone's photo picker opens. From the tab they may choose up to 20; from a slot, one.
3. From a slot, the photo goes straight to that slot. From the tab, Match opens.
4. Match shows one photo at a time. Suggestions are the empty slots of the current place, then of the place where the person last matched. Capture time orders the photos; location in the photo is never read.
5. Each tap fills a slot (Sending 40%, then Checking, then Waiting, each on the end's row with Retry when a photo did not send) and moves to the next photo. The next photo of the same dish is one tap under Recent, wherever it sits in the strip. Match later keeps the photo unmatched on the phone and on Home. Not for a slot sends it as a shared photo with no slot. I'm not sure sends it to the manager, who chooses the slot (FA-4). A run of one subject takes one answer: tap the last photo of the run under "Same slot for the next photos too?" (or All N left), then the slot; nothing is grouped until the person says so. A dark, blurred or small photo gets a one-line hint under the stage that never stops the send.
6. At the end: "5 slots filled", the venue and photo count, what happens next, and See the album.

### 6.2 A place

Every slot in one place, by section (for the bar: Drinks on the menu, Games and amenities, The space), each section with its "9 of 14" count. The main button adds photos for the place's empty slots.

### 6.3 Amenity slots

The guest question comes first. Yes asks for the evidence the catalogue requires (photo, video or both) with the brief. No marks the slot Not here and says that the manager sees the answer.

### 6.4 Finishing a section

When the last slot of a section is accepted, the next visit to that place shows the stamp, the section's photos and who added them, the new album count and the nearest next gap as the main button.

### 6.5 Review

The queue count is the page title. One photo on the stage with its name, brief, author, time and place. Accept moves to the next. Ask again shows reason chips; choosing one sends the decision and moves on. Nobody reviews their own photo.

### 6.6 Admin albums

Venues down, sections across (Food, Drinks, Amenities, Areas), each cell "filled of total" with a tint that darkens as it fills. Under it, the biggest gaps. Tables scroll inside their box on a narrow screen.

### 6.7 Feedback

Feedback is written on the page, in the place the person is looking: the slot changes, the count moves, Match ends with a summary. There are no toasts. An error says what happened and what to do, beside what failed, and keeps whatever the person chose.

### 6.8 Offline

When the signal drops, matched photos show "Saved on this phone" on their slots and send when it returns. Nothing asks the person to wait.

## 6a. Manager screens

The manager workspace (Full App v1, spec §7) draws in Album tokens and §5 components on phone, tablet and desktop. It shows counts as "n of N" with the percentage as secondary text (FA-8; departure A-M2) and uses the spec's names for review actions, requests and publication (FA-7; §7).

- **Navigation.** Five tabs: Overview, Review (its badge counts photos waiting), Album, Requests, Venue. Add sits in the header on phones and as "Add photos" from md (departure A-M1). Below about 416px the tab labels scale under 17px (departure A-R5-1). Metrics, Team and Search have no tab and are linked from Overview.
- **Overview** (spec §7 M1). "Do next" first: "Review next · n photos waiting" is the one main button, then the spec's other actions as rows: Check venue details, Request missing photos and Resolve outdated public content (`lib/manager/overview.ts`). To confirm, Needs labels and publication issues are rows of their own with their counts. Then "Collecting and reviewing" (Still to collect and Waiting for your review, two separate counts that are never added), Coverage by category ("18 of 24" per Food, Drinks, Spaces, Facilities and Other, and confirmed facts), This venue (active menu with its monthly Still right, main and backup reviewers), then rows to Requests, Team and Metrics.
- **Review** (spec §7 M2, M3). The bare page is Review in a thumb (§6.5): Accept and Ask again. A filter or `?view=list` opens the full queue, oldest first, with Needs label photos in the main queue (FA-4), filters for category, contributor, section, age, possible duplicate, needed-by and media type, and a batch of at most 24. The photo detail (`/manager/review/photo/[assetId]`) shows the subject, the other photos sent with it, the album's public photos for each slot, provenance, flags (Needs label, Possible duplicate, Small) and history, and acts with the spec's names: Approve for public use, Keep as reference, Ask for another photo (reason chips, §5), Fix label, Mark duplicate, Not used, Withdraw (departure A-REV-1). Nobody decides on their own photo, except at a venue an admin marked single-reviewer (FA-9; departure A-REV-2).
- **Requests** (`/manager/requests`, spec §7 M4; FA-5). Open requests first, Blocked, Open and Submitted, by priority and date, each with its kind, slot or subject, person and state chip (`request_*`). New request starts from a slot or as a New brief. A request on a slot has "Needed by" and never reads Overdue; only a New brief or a shot list has a due date. Shot lists show "n of N completed". Cancel always asks for a reason. Staff see requests only as Asked for (§5a).
- **Metrics** (`/manager/metrics`, spec §18; AC39). Period and category filters, then coverage as "n of N" per category, review delay (median and 90th percentile), label corrections, the Needs label backlog, useful contributions, content use and reliability. "How this is counted" lists every slot with its report word (§4). No number about one named person (§9).
- **Venue** holds To confirm (facts and space photos due a check, with Still right), Reported changes, history, menus, specials, reviewers, team and exports. **Reported changes** (`/manager/venue/reports`) lists staff reports on a slot and photo correction requests, oldest first: what it is about (linked), kind and reason, the staff note, who and when, then Dealt with or Dismiss, each with an optional note.

## 6b. Admin screens

The admin app (Full App v1, spec §8) is desktop first and works at 320px. Every list puts what is blocked or failing first (§11 rule 3) and every number links to the records behind it.

- **Navigation.** Seven sections in the spec's order, kept in `ADMIN_NAV` (`components/nabalens/app-shell.tsx`): Overview, Venues, Menus & catalog, Library, Publishing, People, Settings & activity. From lg the bar shows all seven with the short labels Menus and Settings; below lg it shows Overview, Venues, Library and More. **More** (`/admin/more`) lists all seven by their full names, each with a one-line description, as 64px link rows (departure A-ADMIN-1). Coverage, Albums and Metrics light up Overview.
- **Overview** (spec §8 A1). Monitoring exceptions and venues needing attention first, then each venue's coverage by category, confirmed facts, Needs label backlog, oldest waiting review, checks due and publication errors as "n of N" or counts. Filters (venue, categories, menu, month) live in the URL. A failed monitoring read is a notice in its place, never a failed page. Admin albums (§6.6) and Metrics (the §6a report across venues) open from here.
- **Venues** (spec §8 A2). Venues whose setup is not complete first, then the rest by name; archived venues on request. A venue's page: Setup checklist first, then Reviewers (the main reviewer, and the single-reviewer setting with the decisions people made on their own photos for spot checks, FA-9), Name and location (with timezone), Menus, What this venue collects (templates and scope, with an impact preview before a required reason) and Status (archive and restore, each with a reason and an impact preview).
- **Library** (spec §8 A4). Every photo and video across the group, with search, filters, collections, tags, compare and removal requests. Library state words live in `lib/library/model.ts` (departure A-LIB-1). An asset's page offers **Suspend from use**: a confirm dialog with a required reason that withdraws the photo and every approval it holds, so each slot it filled counts only its other photos. Restore never brings approvals back.
- **Publishing** (spec §8 A5, §10). What needs following up first, then export packages and manual Published records, in publication words (§7; departure A-E1). Exported is never Published.
- **People** (spec §8 A6). Invites, per-venue roles (FA-22), admins and MFA resets (FA-23).
- **Settings & activity** (spec §8 A7). Settings: what needs attention first, then operations, Rules for every venue, media limits, categories and integrations. **Activity** (`/admin/activity`): who changed what, where, when and why, newest first, filtered by venue, kind of change and person with a plain form that works without JavaScript.

## 7. Words

British English, sentence case, no exclamation marks, no "please", "oops" or "successfully".

| Use                           | Not                                    |
| ----------------------------- | -------------------------------------- |
| Album, slot, place            | Task, requirement, checklist, coverage |
| Add photos                    | Upload, take a photo, capture          |
| Which empty slot is this?     | Label this photo                       |
| Match later, Not for a slot   | Skip, discard                          |
| Waiting, Retake, In the album | Pending, rejected, approved, published |
| Accept, Ask again             | Approve, reject                        |
| Not here                      | N/A, not applicable                    |
| 41 slots still empty          | 64% complete                           |

**Manager and admin words** (FA-7). Managers and admins see the spec's names where Album's would hide a distinction they act on. The words are in `CHIP_STATES` and are never shown on a staff screen:

- Review actions on the photo detail: Approve for public use, Keep as reference, Ask for another photo, Fix label, Not used (Review in a thumb keeps Accept and Ask again; departure A-REV-1).
- Report words for slots: §4.
- Requests (`request_*`): Missing photo, Replacement, Optional angle, Fact confirmation, Campaign; Open, Submitted, Completed, Blocked, Cancelled (departure A-R2).
- Publication (`publication_*`): Not exported, Exported, Queued, Published, Update pending, Withdrawal pending, Withdrawn, Failed or unknown. Packages (`package_*`): Ready to download, Exported, Needs rebuilding, Can't be downloaded. Internal only marks a file in an internal package (FA-46). See departure A-E1.

Staff screens show no due date and no Overdue for food, drink, amenity or area slots. A manager's "Needed by 30 Nov" is plain meta text and orders the slots; after the date it reads "Needed".

## 8. Accessibility

- WCAG 2.2 A and AA on every screen, both themes. Text 4.5:1, large text and non-text 3:1 (§3.2).
- State is never colour alone (§4). Every icon has a visible label or an `aria-label`.
- Every target is 48px or more, except where the platform's own picker takes over.
- Focus is a 3px `focus` ring with a 2px offset and is never hidden by a sticky bar.
- Reflows at 320px and 200% zoom with no sideways scroll except inside a table's own box.
- Reduced motion turns off every animation. Forced colours keep every frame and tag visible.
- Tested on Safari for iPhone as well as Chromium, since most staff use iPhones.

## 9. Not in this system

- An in-app camera, a shutter, or a camera tab. The phone's own camera is used (§2).
- Labelling a photo after it has been sent.
- Toasts and snackbars.
- Leaderboards, rankings or comparisons between staff.
- Due dates or overdue states for slots.
- Reading location from photos.

## 10. Names in code

Batch A1 (17 Nov 2026) wrote the Album values to `app/globals.css` under the public names the code already used, so every screen, including those still built as Common Room, now draws in Album colours, type and shape. Utilities are the token after a Tailwind prefix: `bg-canvas`, `text-ink-muted`, `inset-ring-ring-retake`.

| §3 name                   | Custom property                                                                                | Utility stem  | Note                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------- |
| canvas … raised           | `--canvas`, `--surface`, `--surface-2`, `--raised`                                             | same          |                                                                         |
| ink, ink-muted            | `--ink`, `--ink-muted`                                                                         | same          | `--ink-subtle` (#616559 / #a6a194) stays for tertiary text              |
| line                      | `--line`                                                                                       | `line`        | Decoration only                                                         |
| edge                      | `--edge-strong`                                                                                | `edge-strong` | Name kept: the `edge` utility is already the hairline recipe            |
| accent …                  | `--accent`, `--accent-hover`, `--accent-text`, `--accent-soft`, `--on-accent`, `--accent-edge` | same          | `accent-edge` is the 1px dark-theme edge of the main button             |
| focus                     | `--focus`                                                                                      | `focus`       | Drawn with the `focus-ring` recipes                                     |
| ok                        | `--ok-fg`, `--ok-bg`, `--ok-waiting`, `--ok-half`, `--on-ok`                                   | same          | `on-ok` is text on the filled Accepted tag (white light, dark ink dark) |
| warn                      | `--warn-fg`, `--warn-bg`                                                                       | same          |                                                                         |
| ring-retake, ring-waiting | `--ring-retake`, `--ring-waiting`                                                              | same          | Drawn with the `slot-ring-retake` and `slot-ring-waiting` recipes       |
| hatch                     | `--hatch`                                                                                      | `hatch`       | `bg-hatch` is the recipe that draws the hatching                        |
| stage, on-stage           | `--stage`, `--on-stage`, `--on-stage-muted`                                                    | same          | The same in both themes                                                 |
| scrim                     | `--scrim`, `--plate`                                                                           | same          | `plate` sits under a slot name on a photo                               |

Recipes added in A1: `slot-needed` (2px dashed `edge-strong`), `slot-not-here` (2px dotted, with `bg-hatch`), `slot-ring-waiting`, `slot-ring-retake` (4px inset rings). Full App v1 adds `slot-ring-check`, the 4px `ok-waiting` inset ring of Check due (§4, FA-11). Type recipes: `type-display`, `type-page-title`, `type-section-title` and `type-count` are Fraunces; `type-heading-sm` and `type-tab-label` moved to Atkinson. Fonts: `next/font` sets `--font-fraunces` (with the `opsz` axis), `--font-atkinson-next` and `--font-atkinson-mono` on `<html>`. Radius: control 12, card 14, sheet 20.

Still to remove in batch A5, once no screen uses them: `info-*`, `stamp-fg`, `select` and `on-select`, `bg-stripe`, and the rail recipes. `tests/unit/token-integrity.test.ts` recomputes every contrast pair in §3.2 from the sheet.

## 11. Rules every screen meets

1. It names the venue.
2. It has at most one main button, and it is a verb plus its object.
3. Its first content is what is missing or waiting, not a total.
4. Adding a photo is one tap away from it, and opens the gallery.
5. Every slot shown has its state frame, icon and word.
6. Every target is 48px or more, and text 17px or more (§3.3 exception aside).
7. It works at 320px, at 200% zoom, in dark, with reduced motion and in forced colours.
8. It uses only §3 tokens and §5 components. A deliberate exception is recorded in [departures.md](departures.md).

## 12. Sources and history

### Delivery

| Batch | What                                                                   | Status      |
| ----- | ---------------------------------------------------------------------- | ----------- |
| A0    | This spec; Common Room frozen as `common-room.md`; citations repointed | 17 Nov 2026 |
| A1    | Tokens, fonts, slot tile, token tests                                  | 17 Nov 2026 |
| A2    | Album (Home) and place screens over a slot read model                  | 17 Nov 2026 |
| A3    | Adding from the gallery, Match, Match later                            | 17 Nov 2026 |
| A4    | Review and admin albums                                                | 17 Nov 2026 |
| A5    | Album is Home; gallery only; old Home layouts retired                  | 17 Nov 2026 |

### Superseded

- **Common Room** (v0.4, 15 Nov 2026), frozen in [common-room.md](common-room.md). Replaced by decision D8. Its rules apply to the screens that still ship it and to nothing new.
- **Inn** (17 Nov 2026), the first proposal of the same day: a new look on Common Room's rules. Folded into Album, which kept its look and dropped the rest.

### Changelog

- **1.5** (18 Nov 2026, Full App v1 S4-DOCS): §4 gains the report words (`coverage_*`) and Withdrawn; §5a lists the Full App rows (Unfinished photos, the blocked notice, Asked for) and where Start here sits; new §5b (Me: Your photos, Your month, Help and account, Notices, the slot page), §6a (manager screens: navigation, Overview, Review, Requests, Metrics, Venue and Reported changes) and §6b (admin screens: `ADMIN_NAV` and More, Overview, Venues, Library and Suspend from use, Publishing, People, Settings & activity); §7 gains the manager and admin words; §10 gains `slot-ring-check`. No section was renumbered.

- **1.4** (18 Nov 2026, Full App v1 S2-STAFF): §4 gains the receipt words (Checking, Sent, Couldn't finish) and the staff outcome words. A place screen filters by category and by Needed, Waiting, In the album, Needs updating and All (`?show=`, `?cat=`); filled dish and place tiles open a slot page (`/staff/album/slot/[kind]/[slotId]`) with Report a change. Me opens with My uploads and adds Help and account.
- **1.3** (17 Nov 2026): batches A3 to A5 built (docs/plans/album-a3-a5.md, tasks AL-1 to AL-8, release reviews and repair R-1 to R-4):
  - A3: Match on add (§6.1) with an outbox that feeds the upload queue, Match later (`/staff/album/match-later`), the three-tab shell, Your month on Me, the remembered place.
  - A4: one-line briefs per section and dish (`20261117130000_album_briefs.sql`), Review one photo at a time with reason chips (§6.5), admin Albums (`/admin/albums`, `20261117140000_album_admin.sql`, new `ok-half` token), slot photos staff can see (`20261117150000_album_slot_photos.sql`, `/api/album/[assetId]/thumb`).
  - A5: Album is the only staff Home (the goals, B01 and B02 layouts and `NABALENS_HOME_LAYOUT` are gone), no in-app camera anywhere for staff, §7 words on staff screens. §5a gains the Other jobs and Start here rows. Remaining Common Room screens and tokens (`info-*`, `stamp-fg`, rails) stay until a later batch.
- **1.0** (17 Nov 2026): Album adopted (D8, D9). Written from the prototype canvas and [proposals/album.md](proposals/album.md).
- **1.2** (17 Nov 2026): batch A2 built: places for menu sections and amenity categories (`supabase/migrations/20261117120000_album_places.sql`, set at `/manager/album`), the slot read model (`lib/album/model.ts`, `lib/server/album.ts`), Album Home and `/staff/album/[placeId]`. Album Home is opt-in per venue with `NABALENS_HOME_LAYOUT=album` or `NABALENS_HOME_LAYOUT_ALBUM_VENUES` until A5. Amenity and area slots show no thumbnail yet: staff cannot open a colleague's amenity or area photo today.
- **1.1** (17 Nov 2026): batch A1 built. §10 now maps every token to its name in code; `ink-subtle` darkened to #616559 to hold 4.5:1 on `surface-2`.
