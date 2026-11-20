# Naba-Lens design system

Version 2.5 · 19 Nov 2026 · Status: adopted. **The look is design system v2** (decision D10, 18 Nov 2026): its tokens in light and dark, Figtree and Fraunces type, its 21 components and the SideNav. **The behaviour and the words are Album's** (decisions D8 and D9, 17 Nov 2026; Full App v1 decisions FA-1 to FA-51 in [the Full App decisions](../plans/full-app-v1/decisions.md)): every venue is an album of slots, adding is gallery first with Match on add, the FA-7 status words, and the three staff tabs Album / Add photos / Me. Where v2 and Album disagree, D10 says which wins (§13), and each place the product keeps Album's rule is a departure from v2 in [departures.md](departures.md).

Applies to every Naba-Lens surface: the staff app (phone first), the venue manager screens (phone, tablet, desktop) and the admin desktop app.

| Subject                                      | Where it lives                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Every rule, and what each token is for       | This file                                                                                                                                   |
| The v2 package: values, components, screens  | [v2/](v2/README.md): `GUIDELINES.md`, `SCREENS.md`, `components/<Name>/README.md`, `tokens.css` (reference only; never copied into the app) |
| Token values in code                         | `app/globals.css` (v2's values since batch V2, under the role names of §10)                                                                 |
| Which component plays each v2 role           | [catalogue.md](catalogue.md), section "Design system v2 (D10)"                                                                              |
| The living reference                         | `/ui-preview/v2` (dev only): every v2 component in light and dark at phone and desktop widths                                               |
| Why Album, and the product changes it brings | [proposals/album.md](proposals/album.md)                                                                                                    |
| How batch V2 mapped v2 onto the app          | [V2-A report](../plans/design-v2/reports/V2-A.md) (token and component mapping)                                                             |
| The screens that still ship Common Room      | [common-room.md](common-room.md) (frozen)                                                                                                   |

Code comments cite this file by section number ("DESIGN.md §4"). Section numbers never change; new material goes in a new section or a lettered subsection. `tests/unit/design-citations.test.ts` fails when a cited section is missing. Version 2.0 kept every Album section number and the rule each one names: §1, §2 and §4 to §7 and §9 keep Album's behaviour and words; §3, §8, §10 and §11 now state v2's visual rules; §13 to §16 are new (v2 and D10, status tones, navigation, interaction states).

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

v2's principles (v2 GUIDELINES, "Principles") hold beside these: the photograph is the content and the chrome is quiet (paper, surface, ink, with bottle once per view); states are honest and say exactly what has happened; never colour alone; phone first and thumb sized; no typing where a tap will do.

## 3. Tokens

The values are v2's ([v2/tokens.css](v2/tokens.css), [v2/GUIDELINES.md](v2/GUIDELINES.md) "Colour", "Type", "Space, shape and depth"). `app/globals.css` holds them in OKLCH under v2's names (`--paper`, `--bottle`, `--brass`, `--sky`, `--signal` ...) and points the role names the code uses (§10) at them, so a screen reads a role, never a v2 name. Hex below is sRGB. The app follows the phone's light or dark setting, with a choice on Me and Account (System, Light, Dark; decision D2).

### 3.1 Colour

| Role (code)                             | v2 token         | Light                  | Dark                   | Use                                                                                        |
| --------------------------------------- | ---------------- | ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `canvas`                                | paper            | `#f6f3ec`              | `#121613`              | The page behind everything                                                                 |
| `surface`                               | surface          | `#ffffff`              | `#1b201c`              | Cards, bars, sheets, with a 1px `line` outline                                             |
| `surface-2`                             | surface-sunken   | `#ebe6da`              | `#262c27`              | Empty slots, tracks, the neutral chip, disabled controls, loading blocks                   |
| `raised`                                | surface-hover    | `#f1ede3`              | `#232924`              | Hover and press on outlined controls and rows                                              |
| `line`                                  | line             | `#d9d2c3`              | `#333a34`              | Hairline outlines of cards and rows; decoration only                                       |
| `edge-strong`                           | line-strong      | `#857d6d`              | `#7f877b`              | Control borders, the dashed edge of an empty slot                                          |
| `ink`                                   | ink              | `#1c211d`              | `#eef0ea`              | Text and icons                                                                             |
| `ink-muted`                             | ink-muted        | `#565c54`              | `#a9b0a6`              | Secondary text, meta                                                                       |
| `accent`, `accent-text`                 | bottle           | `#1f4d3a`              | `#7fcba4`              | The one main button; active tab, links in the chrome, the + of an empty slot               |
| `accent-hover`                          | bottle-strong    | `#163a2b`              | `#9ad9b7`              | Main button hover and press                                                                |
| `on-accent`                             | on-bottle        | `#ffffff`              | `#0e1f17`              | Text on the main button (never plain white in dark)                                        |
| `accent-soft`, `ok-bg`                  | bottle-soft      | `#dcebe2`              | `#1c3a2c`              | A choice the person made, the current SideNav item; the positive chip's ground             |
| `ok-fg`                                 | bottle           | `#1f4d3a`              | `#7fcba4`              | Positive tone: In the album, Covered; the covered part of a bar                            |
| `brass`, `ring-retake`                  | brass            | `#b87c12`              | `#e0a640`              | Attention fills and marks beside a word; the ring round a photo that needs another         |
| `warn-fg` / `warn-bg`                   | brass-ink / soft | `#6e4605` / `#f7e8c6`  | `#f0c67a` / `#3d2c0c`  | Attention tone: Retake, Needs checking, Needs label, reason chips                          |
| `info-fg`, `ring-waiting`, `ok-waiting` | sky              | `#1b5584`              | `#8cc2ec`              | Progress tone: Sending, Waiting; the ring round a waiting photo; the waiting part of a bar |
| `info-bg`                               | sky-soft         | `#dceaf5`              | `#16324a`              | Progress chip ground                                                                       |
| `signal` / `on-signal`                  | signal           | `#b0331a` / `#ffffff`  | `#f08a6b` / `#2a0d05`  | Problem tone (the only solid chip), danger buttons, field errors                           |
| `signal-soft`                           | signal-soft      | `#fbe4da`              | `#47190d`              | Ground behind a problem notice                                                             |
| `focus`                                 | focus            | `#1c211d`              | `#eef0ea`              | The focus outline (ink)                                                                    |
| `scrim`, `plate`                        | scrim            | 64% `#121613`          | 72% `#080a09`          | Behind sheets and dialogs; under text on a photo (`on-photo`)                              |
| `hatch`                                 | line             | `#d9d2c3`              | `#333a34`              | Hatching on a Not here slot                                                                |
| `stage`, `on-stage`                     | dark paper, ink  | `#121613`, `#eef0ea`   | the same               | Surround of a photo shown large (Match, Review, viewer), dark in both themes               |
| `ok-half`                               | (none in v2)     | `oklch(0.82 0.06 161)` | `oklch(0.42 0.06 161)` | Admin Albums: a cell half or more filled (§6.6); the Check due ring (§4)                   |

**Bottle is rationed** (v2 "Principles"). Solid `accent` fills one control per view: the main button. A choice the person made uses `accent-soft` (with an `ink` fill and a tick for a pick chip, §16), never the solid fill. The positive chip (In the album, Covered) is bottle on bottle-soft with its tick and word, never a control; the main action and In the album are told apart by form and place.

**Brass marks attention, sky marks progress, signal marks a problem** (v2 "Colour"). None of them is decoration. The five chip tones that use them are §14.

### 3.2 Contrast (computed, WCAG 2.x)

| Pair                                     | Light     | Dark      |
| ---------------------------------------- | --------- | --------- |
| ink on canvas                            | 14.8      | 15.9      |
| ink on surface                           | 16.3      | 14.4      |
| ink on surface-2                         | 13.1      | 12.4      |
| ink-muted on surface                     | 6.9       | 7.4       |
| ink-muted on surface-2                   | 5.5       | 6.4       |
| on-accent on accent (main button)        | 9.6       | 8.9       |
| on-accent on accent-hover                | 12.5      | 10.6      |
| accent-text on surface                   | 9.6       | 8.6       |
| ok-fg on ok-bg (positive chip)           | 7.8       | 6.5       |
| info-fg on info-bg (progress chip)       | 6.4       | 6.9       |
| warn-fg on warn-bg (attention chip)      | 6.8       | 8.4       |
| on-signal on signal (problem chip)       | 6.3       | 7.4       |
| on-stage on stage                        | 15.9      | 15.9      |
| focus on canvas (non-text)               | 14.8      | 15.9      |
| edge-strong on surface / surface-2       | 4.1 / 3.3 | 4.5 / 3.8 |
| brass on surface (retake ring, non-text) | 3.5       | 7.6       |

`tests/unit/token-integrity.test.ts` recomputes every pair from `app/globals.css` in both themes.

### 3.3 Type

Two families (v2 "Type"), loaded with `next/font/google`: **Fraunces** 600 (`display`) for names of things and big numbers, **Figtree** 400 to 700 (`sans`) for everything people read and tap. Fallbacks: Georgia, serif for Fraunces; `system-ui, -apple-system, "Segoe UI", sans-serif` for Figtree. Atkinson Hyperlegible is retired.

| v2 style | Family   | Size / line / weight      | Use                                                    | Album role names (aliases in code)                  |
| -------- | -------- | ------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| display  | Fraunces | 32 / 36 / 600, -0.01em    | What the screen is about, once per screen              | `type-display`, `type-page-title`, `type-count`     |
| title    | Fraunces | 22 / 28 / 600             | Section and sheet titles                               | `type-title`, `type-section-title`                  |
| figure   | Fraunces | 28 / 32 / 600, tabular    | Coverage counts                                        | `type-figure`                                       |
| heading  | Figtree  | 17 / 24 / 600             | Card and row titles                                    | `text-heading`, `heading-sm`, `item-title`          |
| body     | Figtree  | 16 / 24 / 400             | Running text, field text                               | `text-body`, `lead`, `field`                        |
| label    | Figtree  | 15 / 20 / 600             | Buttons, tabs, pick chips, field labels, a slot's name | `text-label`, `button`                              |
| caption  | Figtree  | 13 / 18 / 500 (chips 600) | Metadata and chips; tab labels at 600                  | `text-caption`, `meta`, `mono`, `chip`, `tab-label` |

Nothing is smaller than caption (13px); staff body text is never below 16px. Times, counts and percentages in a line use Figtree with tabular lining numerals (`font-mono`); there is no third face. The section stamp keeps Fraunces caps (§5). Text reflows at 200% zoom; no text container has a fixed height.

### 3.4 Space, size, shape, motion

- Space: v2 `space-1` to `space-7` = 4, 8, 12, 16, 24, 32, 48 (Tailwind 1, 2, 3, 4, 6, 8, 12). Phone gutter and card padding 16 (`page-gutter`, `gutter`); sections 24 apart. Album grids are fluid: tiles at least `tile-min` (152px) wide, 8 between.
- Sizes: staff actions 48 (`target-staff`: Button md and lg, fields); compact controls 44 below 1100px and 40 from 1100px (`target-compact`, managers and admins on desktop; departure V2-4); row thumbnail 56; tab bar 64 plus the safe area; SideNav 240 (`rail`); content at most 1200 (`max-w-page`); sheets and dialogs at most 480 (`max-w-dialog`).
- Radius: 12 (`radius-md`) for buttons, fields, cards, tiles and rows; 6 for row thumbnails; 20 for sheets; full for chips and the round Add photos button; the stamp keeps 2.
- Depth: cards and rows are flat with a 1px `line` outline. `shadow-raised` is for what floats: sheets, menus, the tab bar and sticky bars.
- Motion: 150ms ease-out for presses and chip changes, 250ms for sheets; a slot fills in the same 150ms. Progress moves with real progress only. Reduced motion removes every transition.
- Breakpoints: `md:` 768 (v2 `bp-tablet`: two columns where they help, sheets become dialogs), `desktop:` 1100 (v2 `bp-desktop`: SideNav for managers and admins). Design sizes: phone 390 × 844, narrow phone 320 wide, tablet 1024 × 768, desktop 1280 × 800.

## 4. Slot states

A slot's state is shown by its frame, an icon and a word. Colour is never the only signal, and no two states share a frame. Since 2.0 the tile is v2's SubjectCard (§5): a 4:3 photo box, the slot's name under it, then the state mark as a v2 chip in the tone of §14. The frames are Album's and stay on top of v2's card (departure V2-13).

| State                   | Frame                                      | Mark (tone, icon and word)                                                         | Counts as filled          |
| ----------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------- |
| **Needed**              | 2px dashed `edge-strong`, on paper         | + Add in `accent-text` (the gallery, never a camera; departure V2-2)               | No                        |
| **Sending**             | The photo, no ring                         | Progress: Sending 40% (tabular), Saved on this phone; then the receipt words below | Shown in the waiting part |
| **Waiting for review**  | The photo, 4px `ring-waiting` (sky) inset  | Progress: ↑ Waiting                                                                | Shown in the waiting part |
| **Needs another photo** | The photo, 4px `ring-retake` (brass) inset | Attention: ↩ Retake, with the reviewer's reason                                    | No                        |
| **Accepted**            | The photo, no ring                         | Positive: ✓ In the album                                                           | Yes                       |
| **Check due**           | The photo, 4px `ok-half` ring inset        | Attention: ⟲ Needs checking                                                        | Shown in the waiting part |
| **Not here**            | 2px dotted `edge-strong`, `hatch` hatching | Not here, with the reason, on a surface plate                                      | Leaves the total          |
| **Optional** (FA-51)    | Empty: 1px solid `edge-strong`, `surface`  | + Add, Optional; with a photo, its state                                           | Leaves the total          |

**Reserved forms.** The dashed empty frame belongs to Needed alone. The double-bordered stamp belongs to a full section alone. No other element may use them. A chip tone is not reserved: several states share a tone and are told apart by icon and word (§14), except that Needs checking (attention) and a problem (solid signal) never share one.

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

**Counts.** The album count is the number of empty slots ("41 slots still empty"; departure V2-14). Its bar is v2's CoverageMeter: Accepted (`ok-fg`, bottle), Waiting and Sending (`ok-waiting`, sky), empty (the `surface-2` track), with the numbers written under it in tabular figures ("65 in · 7 waiting · 113 in all"). Not here slots are not in the total. Check due (FA-11, Full App v1) is a filled slot whose routine or change-triggered check is due: a manager confirms it, so it sits in the waiting part and is not counted as filled. Every state comes from one coverage rule (`public.coverage_slots`).

## 5. Components

Each component is built once (catalogue: [catalogue.md](catalogue.md)) and named here. Since 2.0 each is drawn as the v2 component named in brackets ([v2/components/](v2/components/)); the catalogue's v2 table says which file plays each v2 role. What a component does and says is Album's; how it looks is v2's.

- **Slot tile** (SubjectCard). A 4:3 photo box (`radius-md`), the name under it in `label`, then the state mark (§4). Needed: the dashed frame and + Add. Filled states: the photo with the state's ring. The whole tile is one target. Tapping Needed opens the gallery for that slot; tapping a filled slot opens the slot.
- **Album count** (`display` figure and CoverageMeter). The count in `type-count`, a three-part bar, the tabular line under it. One per screen, at the top.
- **Place chip** (PickChip). Place name and its empty count, at least 48px tall. The current place is on (`ink` fill, paper text, a tick; §16). Chips scroll sideways; the last one is never cut off without a visible edge.
- **Retake row** (JobCard on the attention tone). Full-width row: 56px thumbnail with the retake ring, "↩ 1 retake", the reason in a few words, chevron. Shows only when there is one.
- **Main button** (Button primary). Full width, 48px, `accent` fill, `on-accent` text, a leading icon. Always a verb plus its object or count: "Add photos from your gallery", "Add garden photos · 6 to go".
- **Secondary button** (Button default). Outlined: `surface` with an `edge-strong` border, ink text, 48px; `raised` on hover.
- **Brief.** One line under a slot's name: what the photo must show. Shown on the slot, in Match and in Review.
- **Match picker.** The chosen photos as a strip (current one ringed in `accent`, v2 ThumbPick), the venue under the title ("For The Bell"), the current photo on the stage, "Which empty slot is this?", the person's recent slots (the ones matched in this visit first), suggested empty slots as dashed buttons, a search over all slots (other names and small spelling slips forgiven; a slot that already has a photo is never hidden: matched just now or waiting shows ↑, in the album or needing its check shows a photo icon, each with "another photo is welcome" in a plain edge, never the dashed frame; Not on the menu? only follows a search that found no slot), and three secondary buttons: Match later, Not for a slot, I'm not sure. Under the photo, "Same slot for the next photos too?" lists the next photos; under the picker, Add a note (collapsed).
- **Answer pair.** For amenity slots: the guest question as the title, Yes and No as two 48px buttons. The chosen one is on, as a pick chip is (§16), never colour alone.
- **Section stamp.** "SECTION FULL", Fraunces caps, 4px double border, 2px radius. Album's own; v2 has none.
- **Reason chips** (PickChip in a Sheet). For Ask again: 48px pills. Choosing one sends the decision.
- **Review bar** (DecisionBar). Ask again (secondary) and Accept (main) side by side at the bottom, on `surface` with a `line` above and `shadow-raised`.
- **Tab bar** (TabBar). Three tabs: Album, Add photos, Me (departure V2-1). 24px icons with caption labels under them; the current tab is bottle with a bar along its top. Add photos is v2's round bottle button with the gallery icon, never a camera, and opens the gallery directly. Managers and admins: §15.
- **Field, search field** (Field). 48px on `surface`, `edge-strong` border, label above in `label`, hint in `caption`, never a placeholder as the only label. An error thickens the border to 2px `signal` and says what to do beside it, with the triangle icon.
- **Sheet** (Sheet). Rises from the bottom with a grip, 20px top radius, `scrim` behind it, `shadow-raised`; a dialog of at most 480px from 768px. Keeps its scroll while its content changes. On phones the safe choice comes first in reading and focus order (departure V2-5).
- **Notice** (Notice). A soft tone ground with the tone's icon and a title; actions under the text. Page-level messages and blocked actions.
- **Empty state** (EmptyState). No card: a 32px icon, a title and one line saying what to do.
- **Lists and details** (ListRow, MetaList, DataTable). Rows with a 20px lead icon, a `label` title and `caption` meta; label/value pairs as a MetaList, never a hand-written `<dl>`; tables with caption headers over an `edge-strong` rule and 56px rows, scrolling inside their own box when narrow.

## 5a. Album (Home, staff)

Top to bottom, on a phone:

1. "The Bell album" (caption), then the album count.
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

Me is the person's account hub: one screen of rows, each opening the page that does that job (D17). Their photos are the My photos tab (§5e, D18), not a row here. Every job has one home; nothing on Me repeats another page. Top to bottom, on a phone:

1. **The profile card** (`ProfileHeader`): face, name, role and venue. Edit profile is on Settings.
2. **Unfinished photos** (`UnfinishedRow`), when there are any.
3. **Your month**: "6 of 10 this month", or "Not set up yet" → `/staff/tasks/month`. Never compared with a colleague's (§9).
4. **Notices**, with the unread count → `/staff/notifications`.
5. **Manage The Bell** (managers only) and **Other jobs** (when there are any).
6. **Your venue**: Colleagues' photos (`/staff/community`) and People (`/staff/people`).
7. **Settings** (`/staff/me/settings`) and **Help** (`/staff/me/help`).
8. Log out (phones; from md it is in the AppBar).

Add photos is the tab (§5 Tab bar), not a button on Me; Album's Menu is the menu (§5d), not a link here.

**Settings** (`/staff/me/settings`): Edit profile (name and photo), Work details (`/staff/profile`), Your venues with the venue switcher (FA-22), Add to home screen (FA-53), Appearance (System, Light, Dark) and Log out.

**Help** (`/staff/me/help`): How Naba-Lens works, the Photo guide, If you can't add photos (spec §6 S5) and Your managers.

The older blocks (Needs labels, accepted photos, My contributions and the media gallery; departure A-S2) are gone from Me in the tray shell: each repeated Your photos. The legacy `/staff` page keeps them until it is retired.

**Notices** (FA-10) are an inbox page, `/staff/notifications`, reached from Me: newest first, each with what happened and a link to it, then what to be told about. An unread notice puts a count badge on the Me tab. There are no toasts and no push (§6.7, FA-43). The component is `components/nabalens/me/notices-inbox.tsx`.

**Slot page** (`/staff/album/slot/[kind]/[slotId]`): the slot's photo when it is in the album or due a check, its brief, its state word, "n waiting" when colleagues' photos wait (never the photos themselves, FA-20), Add photos for the slot and Report a change.

## 5c. Home (staff): a reminder to add photos

Home **reminds the person to add photos** and shows what happened to the ones they sent (D15). It never chooses which dish, drink or space to photograph: Album is where slots are browsed, and only a person (a reviewer's retake, a manager's request) ever names one. It is the landing tab of the three-tab staff shell (§6.1a MT-4, `/staff/home`). Top to bottom, on a phone:

1. **Start here**, for a new starter (as §5a step 7).
2. **Unfinished photos** (`UnfinishedRow`), when there are any.
3. **The retake row** (§5a step 2), when the person has retakes: named by the reviewer, not by Home.
4. **Asked for** (§5a, S2-REQ), when a manager has open requests: named by the manager, not by Home.
5. **The reminder** (the page title and the main button, in one card). The title and line follow when the person last added photos at this venue:
   - none yet: "Add your first photos" · "Dishes, drinks and corners of the venue you took on shift. Pick them from your gallery."
   - some today: "Got more from today?" · "You've added 3 photos today."
   - earlier: "Got photos from today?" · "Your last photos were yesterday." or "… 3 days ago."
   - can't be read: "Got photos from today?" with no line.
     Under it, "237 slots still empty at The Bell" (V2-14) when the album can be read, then **Add photos** (`AlbumAddTrigger`, the same button as the tab, §6.1): the gallery for many photos, then Match. When the person cannot add photos at this venue, the blocked notice says why in place of the button. The card names no slot.
6. **Match later** and **Other jobs** rows, when there are any.
7. **Recent activity**: the person's six newest photos at this venue, each with its thumbnail, slot names (or "With your manager", "Shared photo", "Photo without a slot"), sent and taken dates and its outcome chip (§4, FA-7), and "See all" to My photos (§5e). Empty: "Photos you send to this venue will appear here." Can't be read: "Recent activity couldn't be loaded. Reload to try again."

The screen shows nothing else: no list of slots to fill, no month card (the header carries the month's line when a target is set, §6.1a MT-6; the card is on Me), no feed of colleagues, no ranking (§9) and no setup notice the person cannot act on themselves. "Today" is the venue's calendar day.

The page is `app/staff/home/page.tsx`; the reminder is `AddReminder` and the list `RecentActivity`, both in `components/nabalens/home/`; the reminder's words come from `addReminder` in `lib/staff/home.ts`.

## 5d. Album (staff): Menu, Amenities and Spaces

Album is the whole venue to browse (D16). It opens on three **parts**, the way Google Business Profile groups a venue's photos (food and drink, amenities, the place itself), and each part narrows in steps, so no screen is a list of a hundred slots:

| Level   | What it is                           | Example    | Where it comes from                                                                        |
| ------- | ------------------------------------ | ---------- | ------------------------------------------------------------------------------------------ |
| Part    | Menu, Amenities or Spaces            | Menu       | The type of each slot (FA-6): Food and Drinks are Menu; Facilities and Other are Amenities |
| Type    | Within Menu only: Food or Drinks     | Drinks     | The coverage rule's category                                                               |
| Shelf   | A family of sections                 | Spirits    | Naba-Lens's fixed shelf set; each section suggested from its name, a manager can move it   |
| Section | The menu section or amenity category | Gin        | The active menu, or the amenity catalogue                                                  |
| Slot    | One dish, drink, amenity or area     | Hendrick's | As §4                                                                                      |

**Amenities** holds every venue feature a photo can show, grouped like Google's attributes (Accessibility, Arrival, Family, Pets, Outdoor, Games, Entertainment, Facilities, Connectivity, Service). Attributes a photo cannot show (payments, crowd, planning) are facts in venue knowledge, never slots. A new photographable feature is a row in the amenity catalogue, not code. **Spaces** holds the venue's areas (the bar, the kitchen pass, the garden), one slot each, with no shelves.

**The shelf set.** Fixed in `SHELVES` (`lib/album/shelves.ts`); a venue never adds one. Each type ends with a "More" shelf that takes any section no rule fits, so nothing is lost.

| Type       | Shelves, in order                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------ |
| Food       | Starters & small plates · Mains · Rice, breads & sides · Specials · Kids · Desserts · More food  |
| Drinks     | Beer & cider · Wine & fizz · Spirits · Cocktails & jugs · Soft & hot drinks · More drinks        |
| Spaces     | One shelf, The venue: the areas themselves                                                       |
| Facilities | One shelf per amenity catalogue category (Accessibility, Outdoor, Family, Pets, Games…), by name |
| Other      | One shelf, Other                                                                                 |

A section's suggested shelf comes from words in its name ("Gin", "Red Wine", "Naans"). The narrower shelves are checked first (Kids and Desserts before Mains, Cocktails before Spirits), so "Kids burgers" is Kids and "Gin cocktails" is Cocktails; a section whose name fits none goes on More. A manager's choice (`album_shelves`, set on `/manager/album`) always wins over the suggestion. Code never lists menu items or section names: the rules match words, and a venue whose words differ is fixed by its manager.

**Place is a lens.** "Where are you?" (All places, then each place with its empty count) filters every Album screen to the slots photographed there (§5a step 3, `album_places`). The chosen place is remembered on the phone (AL-2) and kept in the URL (`?place=`).

**Album landing** (`/staff/album`), top to bottom on a phone:

1. "The Bell album" (title) and "237 slots still empty" (V2-14).
2. Search (`AlbumSearch`, §6.1a MT-1): any slot by name, with its place and section; results only once something is typed.
3. "Where are you?": the place lens.
4. One card per part, in the order Menu, Amenities, Spaces (under a place, only parts with slots there; on All places an empty part says "Nothing to photograph here yet."): its name, "235 still empty of 243", its bar (§13 CoverageMeter), up to four accepted photos as a strip, and links into it with their empty counts (Menu: Food and Drinks; Amenities: its shelves; Spaces: none). A part with every slot filled reads "All in". The card opens the part.
5. Match later, when there are any (§5a step 5).

**A part** (`/staff/album/menu`, `/staff/album/amenities`, `/staff/album/spaces`), top to bottom:

1. "← Album", then the part's name with "124 still empty of 124" beside it.
2. Menu only: the Food | Drinks switch (`SegmentedControl`) with each one's empty count (`?kind=food|drinks`; default Food, or Drinks when Food has no slots).
3. One filter row: a **Filter** button with the number of filters changed from the default, the line "All · Bar" saying what is shown, and Clear when anything is changed. Filter opens a sheet (§5 Sheet) with Show (Needed, Waiting, In the album, Retake or needs checking, All; `ALBUM_SHOWS`, `?show=`) and Where are you? (the place lens, `?place=`); each choice applies at once and Done closes it. An open shelf shows All by default. A part with no slots has no filter row.
4. **Folders**: each shelf as a card, two across on a phone: a 2×2 cover of its accepted photos (with none yet, a dashed frame with the gallery icon and "30 to add"), its name with a tick when every slot is in, and "20 of 43 in · 16 empty". The card opens the shelf (`?shelf=`). A part with one shelf (Spaces) skips the folders and opens on it. The folders have no Show filter; the place lens still applies.
5. **An open shelf**: "← Menu · Food", the shelf's name and its count; the filter row (Show opens on All here, photos and gaps together); a sticky jump bar of its sections with their empty counts, the one in view marked (`aria-current`) and scrolled into view; then each section: its name (h2), "2 of 9" and, when every slot is filled, a Done mark (§2 principle 6), over three-up slot tiles (§5 slot tile). A shelf with one section leaves its heading to screen readers. A filter that empties a section leaves it out.
6. The main button: Add photos from your gallery, for Match (§6.1).

**Words.** Part, type, shelf and section names are shown as they are; the levels themselves are never named on screen ("part" and "shelf" are words for this spec and for managers). Counts are remaining ("still empty") for staff (V2-14).

**States.** No slots under the lens: "Nothing at the bar yet. Choose All places." Album can't be read: the problem notice with the message, and Add photos still works. Shelves can't be read (or the migration is not applied): suggestions only, with no notice to staff.

The model is `buildShelves` and `ALBUM_PARTS` in `lib/album/shelves.ts`; the screens are `AlbumLanding` and `AlbumPart` in `components/nabalens/album/`; a manager moves a section on `/manager/album` (`AlbumPlacesForm`, Shelf in Album).

## 5e. My photos (staff)

A tab (§15, D18): everything the person has sent and what happened to it, photo first (D19). Its tab counts open retakes. Three ideas: **one inbox** for whatever needs the person, **a grid by day** for everything else, and **details on tap**.

**My photos** (`/staff/photos`), top to bottom on a phone:

1. Add a video on the right (R15-1, departure A-D2; the older Add sheet for video and files Match does not take, gallery only). The bar above says My photos.
2. The summary line: "42 sent · 30 in the album · 9 waiting" (only the parts that are not zero).
3. **Needs you · 3**, when anything needs the person, one row each with its own button, newest first:
   - a retake: the slot's name, "Retake: " and the reviewer's reason, **Retake** (opens the slot, §5b slot page);
   - no slot yet (not "I'm not sure", which is the manager's job): "Which dish or space is this?", **Label photo** (opens Match later for that photo);
   - couldn't finish: "Didn't finish. Add it again from your gallery.", **Add again** (the gallery, then Match);
   - labels the server kept but could not add (`NeedsAttention`, without its own heading): Fix labels or Discard labels.
4. **Sending 2 photos…**, a thin row while uploads from this phone are on their way (the receipt words, §4). Never a filter.
5. The filter: All · Waiting · In the album (`SegmentedControl`, `?show=`). All by default. Waiting is anything a reviewer has not decided, sending included; In the album is accepted for public use or kept for reference.
6. **The grid**: three-up square photos grouped by the day they were sent ("Today", "Yesterday", "Tue 17 Nov", in the venue's calendar), newest first. Each photo carries one small mark in its corner: a tick (in the album), a clock (waiting), an exclamation (needs you) or none (not used, withdrawn). A video shows its film icon. Under the grid, "Show more" while there are older photos (§7, never infinite scroll).
7. Empty: "Photos you add appear here, newest first." with Add photos.

**One photo** (`/staff/photos/[assetId]`): "← My photos", the photo large (`/api/media/[id]/preview`), the slot names with each one's state chip (§4, FA-7), the reviewer's reason on a retake, the venue when it is not the current one, sent and taken dates, "Already sent before: it doesn't count twice" (FA-35), then every action the photo allows as full-width buttons: Retake, Label photo (when it has no slot), Change slot (the §5 Match picker), Ask for a correction, Ask to remove (FA-21) and Withdraw (last, destructive). After Withdraw the page says so and links back. A photo that is not the person's, or no longer exists, is not found.

In Needs you, **Label photos** opens Match later in selection mode when several photos can be labelled. Staff tick the photos that show the same thing and choose their slot once. The result links to that dish or space in Album, which shows those photos while they wait for review.

The words are Album's (§7). Nothing on My photos ranks the person or compares them with a colleague (§9).

The screen is `MyPhotos` (`components/nabalens/me/my-photos.tsx`); the rules (needs you, state, day groups, filter) are `lib/staff/my-photos.ts`; one photo reuses `MyUploads` in its detail layout, so every action and dialog has one implementation.

## 6. Patterns

### 6.1 Adding photos

1. The person taps Add photos (tab or main button) or a Needed slot.
2. The phone's photo picker opens. From the tab they may choose up to 20; from a slot, one.
3. From a slot, the photo goes straight to that slot. From the tab, Match opens.
4. Match shows one photo at a time. Suggestions are the empty slots of the current place, then of the place where the person last matched. Capture time orders the photos; location in the photo is never read.
5. Each tap fills a slot (Sending 40%, then Checking, then Waiting, each on the end's row with Retry when a photo did not send) and moves to the next photo. The next photo of the same dish is one tap under Recent, wherever it sits in the strip. Match later keeps the photo unmatched on the phone and on Home. Not for a slot sends it as a shared photo with no slot. I'm not sure sends it to the manager, who chooses the slot (FA-4). A run of one subject takes one answer: tap the last photo of the run under "Same slot for the next photos too?" (or All N left), then the slot; nothing is grouped until the person says so. A dark, blurred or small photo gets a one-line hint under the stage that never stops the send.
6. At the end: "5 slots filled", the venue and photo count, what happens next, and See the album.

### 6.1a Batch Match phone preview

Local trial of the two routes. Enable it in development with
`NEXT_PUBLIC_NABALENS_UPLOAD_TRAY=1`.

- **MT-1**. Search the active venue's slots on Album. Results show place,
  section, item, and state. Tapping a Needed result uses that slot's Add action.
- **MT-2**. Add photos opens the native picker. Match shows the whole
  selection in a two-column tray, with every photo initially unselected.
  Select one or more, choose a slot, and review the assigned groups before
  Send. Ask my manager and Not for a slot use their existing destinations.
  The chooser carries a missing search name to the manager as a note.
- **MT-3**. A known slot accepts multiple photos with one gallery pick.
  Both routes show a receipt with one row per file and Retry on recoverable
  failures. Count files already sent for review separately from those still
  sending. Match later continues to keep unassigned photos.
- **MT-4**. Preview sign-in lands on **Home** (`/staff/home`), which shows
  what to photograph next (§5c, D15).
  The bottom bar is Today, Album, Add, My photos and Me (§15). Each
  tab has a real URL and the current tab is labelled as the current page.
- **MT-5**. **Album** (`/staff/album`) opens on searchable, grouped slot
  rows. The known-slot receipt links to the slot's own page, which shows
  the brief and the staff member's submissions for that slot.
- **MT-6**. **Me** (`/staff/me`) starts with your month and your own
  submissions, followed by your profile and account. The three main
  screens show the venue and current section in the mobile header and,
  when set, the month's goal summary links to its details.

In the tray, assignments are drafts until Send. The existing upload queue
sends the files and their matches together. Each slot-first pick already has
its destination so it starts sending when the gallery returns.

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

Feedback is written on the page, in the place the person is looking: the slot changes, the count moves, Match ends with a summary. There are no toasts: v2's Toast is built (`components/nabalens/toast.tsx`) so its look is ready, but no screen shows one (departure V2-11). An error says what happened and what to do, beside what failed, and keeps whatever the person chose.

### 6.8 Offline

When the signal drops, matched photos show "Saved on this phone" on their slots and send when it returns. Nothing asks the person to wait.

## 6a. Manager screens

The manager workspace (Full App v1, spec §7) draws in the §3 tokens and §5 components on phone, tablet and desktop. It shows counts as "n of N" with the percentage as secondary text (FA-8; departure A-M2) and uses the spec's names for review actions, requests and publication (FA-7; §7).

- **Navigation.** Five tabs: Overview, Review (its badge counts photos waiting), Album, Requests, Venue. Add sits in the header on phones and as "Add photos" from md (departure A-M1). On phones the five tabs are v2's TabBar with 13px caption labels at every width; from 768px a row of section tabs under the header; from 1100px v2's SideNav (§15). Metrics, Team and Search have no tab and are linked from Overview.
- **Overview** (spec §7 M1). "Do next" first: "Review next · n photos waiting" is the one main button, then the spec's other actions as rows: Check venue details, Request missing photos and Resolve outdated public content (`lib/manager/overview.ts`). To confirm, Needs labels and publication issues are rows of their own with their counts. Then "Collecting and reviewing" (Still to collect and Waiting for your review, two separate counts that are never added), Coverage by category ("18 of 24" per Food, Drinks, Spaces, Facilities and Other, and confirmed facts), This venue (active menu with its monthly Still right, main and backup reviewers), then rows to Requests, Team and Metrics.
- **Review** (spec §7 M2, M3). The bare page is Review in a thumb (§6.5): Accept and Ask again. A filter or `?view=list` opens the full queue, oldest first, with Needs label photos in the main queue (FA-4), filters for category, contributor, section, age, possible duplicate, needed-by and media type, and a batch of at most 24. The photo detail (`/manager/review/photo/[assetId]`) shows the subject, the other photos sent with it, the album's public photos for each slot, provenance, flags (Needs label, Possible duplicate, Small) and history, and acts with the spec's names: Approve for public use, Keep as reference, Ask for another photo (reason chips, §5), Fix label, Mark duplicate, Not used, Withdraw (departure A-REV-1). Nobody decides on their own photo, except at a venue an admin marked single-reviewer (FA-9; departure A-REV-2).
- **Requests** (`/manager/requests`, spec §7 M4; FA-5). Open requests first, Blocked, Open and Submitted, by priority and date, each with its kind, slot or subject, person and state chip (`request_*`). New request starts from a slot or as a New brief. A request on a slot has "Needed by" and never reads Overdue; only a New brief or a shot list has a due date. Shot lists show "n of N completed". Cancel always asks for a reason. Staff see requests only as Asked for (§5a).
- **Metrics** (`/manager/metrics`, spec §18; AC39). Period and category filters, then coverage as "n of N" per category, review delay (median and 90th percentile), label corrections, the Needs label backlog, useful contributions, content use and reliability. "How this is counted" lists every slot with its report word (§4). No number about one named person (§9).
- **Venue** holds To confirm (facts and space photos due a check, with Still right), Reported changes, history, menus, specials, reviewers, team and exports. **Reported changes** (`/manager/venue/reports`) lists staff reports on a slot and photo correction requests, oldest first: what it is about (linked), kind and reason, the staff note, who and when, then Dealt with or Dismiss, each with an optional note.

## 6b. Admin screens

The admin app (Full App v1, spec §8) is desktop first and works at 320px. Every list puts what is blocked or failing first (§11 rule 3) and every number links to the records behind it.

- **Navigation.** Seven sections in the spec's order, kept in `ADMIN_NAV` (`components/nabalens/app-shell.tsx`): Overview, Venues, Menus & catalog, Library, Publishing, People, Settings & activity. From 1100px v2's SideNav lists all seven with the short labels Menus and Settings (§15); from lg to 1100px the top bar shows them; below lg the tab bar shows Overview, Venues, Library and More. **More** (`/admin/more`) lists all seven by their full names, each with a one-line description, as link rows (v2 ListRow; departure A-ADMIN-1). Coverage, Albums and Metrics light up Overview.
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

- WCAG 2.2 A and AA on every screen, both themes. Text 4.5:1; borders, icons, focus rings and large text 3:1 (§3.2).
- State is never colour alone (§4, §14). Every icon has a visible label or an `aria-label`; an icon never stands alone as a status.
- Targets: every staff action is 48px or more (`target-staff`). Compact controls (Button and PickChip `sm`) are 44px below 1100px and v2's 40px (`target-compact`) from 1100px, where managers and admins work with a pointer (departure V2-4). The platform's own picker is exempt.
- Focus is a 2px solid `focus` outline (ink) offset 2px, inset on rows and tiles whose parent clips, on every interactive element. It is never removed and never hidden by a sticky bar.
- A control that is off uses `aria-disabled`, stays in the focus order and has its reason beside it; prefer hiding an action the person may not take and explaining a blocked one with a Notice.
- Real elements: `<button>`, `<a href>`, `<input>` with `<label>`, `<table>`. Upload progress and results are announced in a polite live region without moving focus.
- Reflows at 320px and 200% zoom with no sideways scroll except inside a table's own box. Text containers never have a fixed height.
- Reduced motion removes every transition. Forced colours keep every frame, chip edge and focus outline visible.
- Tested on Safari for iPhone as well as Chromium, since most staff use iPhones.

## 9. Not in this system

- An in-app camera, a shutter, or a camera tab. The phone's own camera is used (§2).
- Labelling a photo after it has been sent.
- Toasts and snackbars shown to anyone (v2's Toast is built but unused; departure V2-11).
- A camera icon on an empty slot, or Take photo, Record video and Submit steps (v2's Upload sheet; departures V2-2, V2-9).
- Leaderboards, rankings or comparisons between staff.
- Due dates or overdue states for slots.
- Reading location from photos.

## 10. Names in code

`app/globals.css` has four tiers (its header says so): v2's values under v2's names (tier 1), the role names the code uses pointing at them (tier 2), `@theme` turning each role into utilities (tier 3), and recipes (tier 4). Application code uses only tier 3 and tier 4 names; of v2's own names only `brass`, `signal`, `on-signal` and `signal-soft` have utilities, because no role covers them. Utilities are the token after a Tailwind prefix: `bg-canvas`, `text-ink-muted`, `inset-ring-ring-retake`. The full v2-to-role table is in the [V2-A report](../plans/design-v2/reports/V2-A.md) ("Token mapping").

| §3 role                   | Custom property                                                               | v2 value                        | Note                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| canvas … raised           | `--canvas`, `--surface`, `--surface-2`, `--raised`                            | paper, surface, sunken, hover   | `media-placeholder` is `surface-2` too                                     |
| ink, ink-muted            | `--ink`, `--ink-muted`                                                        | ink, ink-muted                  | `--ink-subtle` is retired                                                  |
| line                      | `--line`                                                                      | line                            | Decoration only                                                            |
| edge                      | `--edge-strong`                                                               | line-strong                     | Name kept: the `edge` utility is the hairline recipe                       |
| accent …                  | `--accent`, `--accent-hover`, `--accent-text`, `--accent-soft`, `--on-accent` | bottle family                   | `accent-edge` retired: v2's dark bottle is light, its fill is the boundary |
| select                    | `--select`, `--on-select`                                                     | bottle, on-bottle               | A ticked box, a chosen radio, a picked tile's ring                         |
| focus                     | `--focus`                                                                     | focus (ink)                     | Drawn with the `focus-ring` recipes                                        |
| ok                        | `--ok-fg`, `--ok-bg`, `--ok-waiting`, `--ok-half`, `--on-ok`                  | bottle, bottle-soft, sky, (own) | Positive tone; `ok-waiting` is the pending bar segment                     |
| warn                      | `--warn-fg`, `--warn-bg`                                                      | brass-ink, brass-soft           | Attention tone                                                             |
| info                      | `--info-fg`, `--info-bg`                                                      | sky, sky-soft                   | Progress tone                                                              |
| signal                    | `--signal`, `--on-signal`, `--signal-soft`                                    | signal family                   | Problem tone; `edge-invalid`; shadcn `destructive`                         |
| ring-retake, ring-waiting | `--ring-retake`, `--ring-waiting`                                             | brass, sky                      | Drawn with the `slot-ring-*` recipes                                       |
| hatch                     | `--hatch`                                                                     | line                            | `bg-hatch` is the recipe that draws the hatching                           |
| stage, on-stage           | `--stage`, `--on-stage`, `--on-stage-muted`                                   | dark paper, ink, ink-muted      | The same in both themes                                                    |
| scrim                     | `--scrim`, `--plate`, `--on-photo`                                            | scrim, on-photo                 | `plate` sits under text on a photo                                         |
| elevation                 | `--elevation-card`, `--elevation-float`, `--elevation-bar`                    | line outline, shadow-raised     | `shadow-card`, `shadow-float`, `shadow-bar`                                |

Recipes: `slot-needed` (2px dashed `edge-strong`), `slot-not-here` (2px dotted, with `bg-hatch`), `slot-ring-waiting`, `slot-ring-retake` and `slot-ring-check` (4px inset rings), `edge`, `edge-strong`, `edge-selected`, `edge-invalid`, `ring-selected` (3px bottle, ThumbPick), `focus-ring`, `focus-ring-inset`, `focus-ring-within`. Type: `type-display`, `type-title`, `type-figure` and the Album aliases of §3.3. Fonts: `next/font` sets `--font-figtree` and `--font-fraunces` (with the `opsz` axis) on `<html>`; `font-mono` is Figtree with `tnum lnum`. Radius: `square` 6, `control` and `card` 12, `sheet` 20, `round`, `stamp` 2. Sizes: `tabbar`, `tile-min`, `rail`; breakpoint `desktop:` (1100px). The theme switch is next-themes' `.dark` class on `<html>`, which is v2's `data-theme="dark"` under another name.

Still to remove once no screen uses them: `stamp-fg`, `bg-stripe` and the `rail-*` recipes (v2 Notice has no rail). `tests/unit/token-integrity.test.ts` recomputes every contrast pair in §3.2 from the sheet; `tests/unit/token-discipline.test.ts` keeps raw colours and off-scale values out of source.

## 11. Rules every screen meets

1. It names the venue.
2. It has at most one main button, and it is a verb plus its object.
3. Its first content is what is missing or waiting, not a total.
4. Adding a photo is one tap away from it, and opens the gallery.
5. Every slot shown has its state frame, icon and word.
6. Every staff target is 48px or more (compact controls: §8), staff body text is 16px or more, and nothing is smaller than the 13px caption (§3.3).
7. It works at 320px, at 200% zoom, in dark, with reduced motion and in forced colours.
8. It uses only §3 tokens and §5 components, drawn as their v2 components (catalogue.md). A deliberate exception is recorded in [departures.md](departures.md).
9. It has one `display` style, for what the screen is about, and at most one bottle-filled control (§3.1).

## 12. Sources and history

### Delivery

| Batch | What                                                                                                                         | Status                    |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| A0    | This spec; Common Room frozen as `common-room.md`; citations repointed                                                       | 17 Nov 2026               |
| A1    | Tokens, fonts, slot tile, token tests                                                                                        | 17 Nov 2026               |
| A2    | Album (Home) and place screens over a slot read model                                                                        | 17 Nov 2026               |
| A3    | Adding from the gallery, Match, Match later                                                                                  | 17 Nov 2026               |
| A4    | Review and admin albums                                                                                                      | 17 Nov 2026               |
| A5    | Album is Home; gallery only; old Home layouts retired                                                                        | 17 Nov 2026               |
| V2    | Design system v2's look (D10): tokens, fonts, 21 components, SideNav, then every screen ([plan](../plans/design-v2/plan.md)) | 18 Nov 2026 (in progress) |

### Superseded

- **Album's look** (versions 1.0 to 1.7: warm paper, the Album greens and orange retake, Atkinson Hyperlegible, 64px main buttons, the 17px text floor, the filled Accepted square tag, 3px focus ring). Replaced by v2's (decision D10, version 2.0). Album's behaviour and words stay.

- **Common Room** (v0.4, 15 Nov 2026), frozen in [common-room.md](common-room.md). Replaced by decision D8. Its rules apply to the screens that still ship it and to nothing new.
- **Inn** (17 Nov 2026), the first proposal of the same day: a new look on Common Room's rules. Folded into Album, which kept its look and dropped the rest.

### Changelog

- **2.5** (19 Nov 2026, decision D19): §5e rewritten: My photos as one Needs you inbox, a three-up grid by day with All, Waiting and In the album, and a page per photo (`/staff/photos/[assetId]`) holding every action. No section was renumbered.
- **2.4** (19 Nov 2026, decision D18): five staff tabs, Today, Album, Add, My photos and Me (§15). New §5e, My photos at `/staff/photos` (moved from Me); its tab counts retakes. No section was renumbered.
- **2.3** (19 Nov 2026, decision D17): §5b, Me as a hub of rows with Your photos, Settings and Help on their own routes (`/staff/me/photos`, `/staff/me/settings`, `/staff/me/help`); the repeated photo lists and the Add photos buttons leave Me. No section was renumbered.
- **2.2** (18 Nov 2026, decision D16): new §5d, Album as three parts (Menu, Amenities, Spaces), then Food or Drinks in Menu, shelves and sections, with place as a lens. The fixed shelf set lives in `lib/album/shelves.ts`; a manager can move a section to another shelf (`album_shelves`). No section was renumbered.
- **2.1** (18 Nov 2026, decision D15): new §5c, staff Home as **a reminder to add photos**: a card whose words follow when the person last added photos, the main button, and their recent activity. Home never chooses a slot to photograph; retakes and requests (named by a person) keep their rows. The month card leaves Home. No section was renumbered.
- **2.0** (18 Nov 2026, batch V2, decision D10): the look becomes design system v2 ([v2/](v2/README.md)). §3 is v2's colours, contrast, type (Figtree and Fraunces), space, size, shape and motion; §4's frames take v2 colours, its marks become v2 chips under the name and the filled Accepted square tag is retired; §5 names the v2 component each Album component is drawn as and adds Notice, Empty state and lists; §6.7 and §9 note v2's Toast is built but unused; §6a and §6b move manager and admin navigation to v2's TabBar and SideNav (departure A-R5-1 retired); §8 is v2's accessibility (2px ink focus outline, 48px staff and 40px compact desktop targets, 16px body and 13px floor); §10 maps the roles onto v2's values; §11 rule 6 changes with the type floor and rule 9 is new. New §13 (v2 and D10), §14 (status tones), §15 (navigation) and §16 (interaction states). Every Album section number and the rule it names is kept; D10's kept rules are departures V2-1 to V2-14.

- **1.7** (18 Nov 2026, Full App v1 S5-PACKAGED): §4 gains **Optional** (FA-51): a packaged item without Photo wanted is listed and takes photos but leaves every count and is never empty. Its empty tile has a solid `edge-strong` line (the dashed frame stays Needed's alone) and the word Optional (`OPTIONAL_SLOT_WORD` in `lib/album/model.ts`); with a photo it shows that photo's state. Its slot page says "Optional: a photo is welcome, but none is needed."; Match finds it by search ("Optional · a photo is welcome") and never suggests it. Reports name it **No photo needed** (the rule's `inactive`).
- **1.6** (18 Nov 2026, Full App v1 S3-R14): a place's Needs updating filter (spec §6 S3) reads **Retake or needs checking**, the words of the tiles it shows (`SLOT_MARK_WORDS` in `lib/album/model.ts`, drawn by the slot tile). Withdrawn is one chip look everywhere (X icon).
- **1.5** (18 Nov 2026, Full App v1 S4-DOCS): §4 gains the report words (`coverage_*`) and Withdrawn; §5a lists the Full App rows (Unfinished photos, the blocked notice, Asked for) and where Start here sits; new §5b (Me: Your photos, Your month, Help and account, Notices, the slot page), §6a (manager screens: navigation, Overview, Review, Requests, Metrics, Venue and Reported changes) and §6b (admin screens: `ADMIN_NAV` and More, Overview, Venues, Library and Suspend from use, Publishing, People, Settings & activity); §7 gains the manager and admin words; §10 gains `slot-ring-check`. No section was renumbered.

- **1.4** (18 Nov 2026, Full App v1 S2-STAFF): §4 gains the receipt words (Checking, Sent, Couldn't finish) and the staff outcome words. A place screen filters by category and by Needed, Waiting, In the album, Needs updating and All (`?show=`, `?cat=`); filled dish and place tiles open a slot page (`/staff/album/slot/[kind]/[slotId]`) with Report a change. Me opens with My uploads and adds Help and account.
- **1.3** (17 Nov 2026): batches A3 to A5 built (docs/plans/album-a3-a5.md, tasks AL-1 to AL-8, release reviews and repair R-1 to R-4):
  - A3: Match on add (§6.1) with an outbox that feeds the upload queue, Match later (`/staff/album/match-later`), the three-tab shell, Your month on Me, the remembered place.
  - A4: one-line briefs per section and dish (`20261117130000_album_briefs.sql`), Review one photo at a time with reason chips (§6.5), admin Albums (`/admin/albums`, `20261117140000_album_admin.sql`, new `ok-half` token), slot photos staff can see (`20261117150000_album_slot_photos.sql`, `/api/album/[assetId]/thumb`).
  - A5: Album is the only staff Home (the goals, B01 and B02 layouts and `NABALENS_HOME_LAYOUT` are gone), no in-app camera anywhere for staff, §7 words on staff screens. §5a gains the Other jobs and Start here rows. Remaining Common Room screens and tokens (`info-*`, `stamp-fg`, rails) stay until a later batch.
- **1.0** (17 Nov 2026): Album adopted (D8, D9). Written from the prototype canvas and [proposals/album.md](proposals/album.md).
- **1.2** (17 Nov 2026): batch A2 built: places for menu sections and amenity categories (`supabase/migrations/20261117120000_album_places.sql`, set at `/manager/album`), the slot read model (`lib/album/model.ts`, `lib/server/album.ts`), Album Home and `/staff/album/[placeId]`. Album Home is opt-in per venue with `NABALENS_HOME_LAYOUT=album` or `NABALENS_HOME_LAYOUT_ALBUM_VENUES` until A5. Amenity and area slots show no thumbnail yet: staff cannot open a colleague's amenity or area photo today.
- **1.1** (17 Nov 2026): batch A1 built. §10 now maps every token to its name in code; `ink-subtle` darkened to #616559 to hold 4.5:1 on `surface-2`.

## 13. Design system v2 and D10

Design system v2 is the owner's package of 18 Nov 2026, kept unchanged in [v2/](v2/README.md). Decision D10 adopts its **visual system** in full and keeps **Album's behaviour and words**. Where they disagree:

| Subject                | v2 says                                                           | The product does (D10)                                                                                          | Departure |
| ---------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------- |
| Tokens, light and dark | `tokens.css`                                                      | v2 (§3, §10)                                                                                                    | none      |
| Type                   | Figtree body, Fraunces display                                    | v2 (§3.3)                                                                                                       | none      |
| Components             | 21 `nl-` components                                               | v2's look, built as Tailwind utilities on the tokens in the existing React components (catalogue.md)            | none      |
| Manager and admin nav  | SideNav from 1100px, TabBar on phones                             | v2 (§15)                                                                                                        | none      |
| Staff add flow         | Upload sheet: Take photo, Record video, Choose from phone; Submit | Gallery-first Add photos, Match on add, no in-app camera, no Submit (§2, §6.1, D9, FA-1, FA-2)                  | V2-9      |
| Staff words            | Upload, Take photo, Choose from phone, Submit                     | Album's words (§7)                                                                                              | V2-10     |
| Status words           | v2's status table                                                 | FA-7 words in `status-chip.tsx`, each drawn in one of v2's five tones (§14)                                     | V2-3      |
| Staff tabs             | Home / Upload / Album / My uploads                                | Album / Add photos / Me, drawn as v2's TabBar (§5)                                                              | V2-1      |
| Empty slot             | Dashed outline with the camera icon                               | Dashed outline with + Add (the gallery)                                                                         | V2-2      |
| Toast                  | "Sent for review" after sending                                   | Built, never shown; feedback is written on the page (§6.7)                                                      | V2-11     |
| Icons                  | Lucide stand-in, 1.75 stroke                                      | Phosphor, with v2's sizes and fixed meanings                                                                    | V2-8      |
| Numbers                | "30/40, 75% covered"                                              | Staff see the remaining count ("41 slots still empty"); managers and admins "n of N" with the percentage (FA-8) | V2-14     |

Everything else in v2 GUIDELINES (voice beyond the words above, colour, type, space, photography, layout, states, accessibility) applies as written. The package's own setup steps (copy `tokens.css` and `components.css`, keep `nl-` class names) do not: the values live in `app/globals.css` and the components are the app's own (AGENTS.md "UI changes").

## 14. Status tones

Every state is a chip with a tone, an icon and a word (v2 "Status language"). The words are Album's and Full App's (FA-7), kept in `CHIP_STATES` in `components/nabalens/status-chip.tsx`; the tone each is drawn in is `V2_TONE` in the same file. Do not restate either elsewhere.

| v2 tone   | Look                           | Means                                    | Examples of the words drawn in it                                                                                    |
| --------- | ------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Neutral   | `ink` on `surface-2`           | Nothing has happened yet, or out of play | Missing, Not here, No photo needed, Needs labels, Kept for reference, Label corrected, Not used, Withdrawn, Exported |
| Progress  | `info-fg` on `info-bg` (sky)   | Moving without the reader's help         | Waiting, Waiting for review, Awaiting review, Submitted, Queued, Update pending                                      |
| Positive  | `ok-fg` on `ok-bg` (bottle)    | Done and current                         | In the album, Covered, Approved for public use, Published, Completed                                                 |
| Attention | `warn-fg` on `warn-bg` (brass) | A person needs to do something           | Retake, Needs checking, Check due, Another photo requested, Needs attention, Withdrawal pending, Blocked             |
| Problem   | `on-signal` on solid `signal`  | Something is wrong now                   | Failed or unknown, Can't be downloaded, and the package photo words (Withdrawn since, Changed since …)               |

The chip's look follows its shape in `CHIP_SHAPES`, each of which is one of the five tones; where FA-7 puts a word in a different tone from v2's table (Needs labels and Label corrected are neutral, not attention), FA-7 stands (departure V2-3).

- The chip is v2's 28px pill with a 16px icon and a `caption` word at 600. Every chip has an icon; a state with no icon of its own takes its tone's icon. Problem is the only solid chip.
- An upload's state is words beside the file in its tone colour with no box (UploadRow), as v2 draws it: progress for a file on its way, `signal` for a failure. The slot tile draws Sending and Saved on this phone (§4 receipt words) in the progress tone.
- Kept for reference is neutral so it never looks like it closed a public-photo slot. Needs checking and a problem never share a tone.
- Fixed icon meanings (v2 "Iconography"): check = done, clock = waiting, dashed circle = missing, question mark = not sure or needs label, triangle = problem, camera = retake mark only (never an action that opens a camera), circular arrow = retry.

## 15. Navigation

- **Staff** (phone first, one column at every width, centred on larger screens): v2's TabBar with Album, Add photos and Me (§5 Tab bar). In the photo preview shell (§6.1a, D18) it is five tabs: **Today** (`/staff/home`, §5c), **Album** (§5d), **Add** in the middle (the gallery, then Match; `AlbumAddTrigger`, announced as Add photos), **My photos** (`/staff/photos`, §5e; its count is open retakes) and **Me** (§5b; its count is unread notices). Five is the most: Notices badges Me and People is on Me. From 768px the same places are links in the top bar, with Add photos as a button.
- **Managers**: on phones v2's TabBar with the five tabs of §6a; from 768px the section tabs (v2 Tabs) under the header; from 1100px v2's **SideNav**: a 240px rail on `surface` fixed to the left with "Naba-Lens" in `title` at the top, one level of items, the current item `accent-soft` with bottle text and `aria-current="page"`, and Review's count beside it. The content column is padded by the rail's width.
- **Admins**: below lg the tab bar with Overview, Venues, Library and More; from lg to 1100px the top bar with all seven sections; from 1100px the SideNav with all seven (§6b, departure A-ADMIN-1).
- **Tabs** inside a page (SectionTabs): `label` type, the current one in ink with a 3px bottle bar under it.
- **VenueBar**: v2 puts the active venue on every capture and review screen. The component is built (`components/nabalens/venue-bar.tsx`); screens adopt it in batch V2 (departure V2-12). Until then rule 1 of §11 is met by the page header.
- Sticky bars (TabBar, DecisionBar) respect the safe-area insets and carry `shadow-raised`.

## 16. Interaction states

Every interactive component has these states (v2 "States"); build all of them.

- **Hover and pressed:** outlined controls and rows take `raised`; the main button takes `accent-hover`.
- **Focus:** the 2px `focus` outline offset 2px (§8). Never removed.
- **Selected:** an `ink` fill with paper text and a tick (PickChip; departure V2-6), or a 3px bottle ring with a check on a round scrim plate (ThumbPick). Never colour alone.
- **Disabled:** `surface-2` ground, `line` border, `ink-muted` text, with `aria-disabled` (§8).
- **Busy:** the button keeps its label and sets `aria-busy="true"`; progress shows where the work is (UploadRow, the slot tile), never a full-screen spinner.
- **Loading:** `surface-2` blocks in the shape of the content.
- **Empty:** EmptyState (§5).
- **Error:** inline, beside the cause, saying what to do next: Field errors for input, a Notice for the page, the row for a file (§6.7).
