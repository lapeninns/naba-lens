# Proposal: Album, a new design system for Naba-Lens

Status: **adopted** on 17 Nov 2026 (D8 in [../decisions.md](../decisions.md)). Next: rewrite `DESIGN.md` as Album v1.0, then batches A1 to A5 (section 8). Until then the app still ships Common Room.

Prototype canvas: <https://claude.ai/artifact/GZUbKcemggcPgV5Rh1Qwyg> (private). It holds the principles and slot states, five staff screens, manager review and the admin view. Match, Amenity and Review work in Play.

Album replaces Common Room completely: its idea, layout, components, state vocabulary and look. Nothing is carried over by default. Where a rule comes back (large targets, a text floor), it is there because the goal needs it, and it is restated here.

## 1. The goal it is built for

Get an accepted photo into every slot at every venue: each dish and drink on the active menu, each amenity, each area. The system is judged by one thing: how quickly the number of empty slots falls.

## 2. Idea

Every venue is an **album**. Every thing that needs a photo has a **slot** in it. Empty slots are drawn as gaps you can tap. Staff take photos with their phone's own camera whenever service allows, and add them from their gallery later.

## 3. Principles

1. **The gap is the screen.** Home opens on what is missing, drawn as empty slots, grouped by place.
2. **Gallery first.** The main action always opens the phone's photos, not an in-app camera. The phone camera is better, faster and already in staff's hands, and photos are often taken mid-shift and sent later. An in-app camera is not part of this system.
3. **Match, one tap each.** Choose many photos at once, then tap the empty slot each one fills. Suggestions are the empty slots in the place where most of the photos were taken, then search over all empty slots. "Match later" and "Not for a slot" keep every photo; nothing is lost or forced into a wrong slot.
4. **Show what good looks like.** Every slot has a one-line brief ("Side on, sauce pouring, on the slate plate"). Staff read it before they take the photo, and the reviewer judges against the same words.
5. **Every photo moves the album.** A matched photo fills its slot at once as Waiting for review. The count moves then; review confirms or reopens it.
6. **Finish lines you can reach.** Sections (Desserts, Games, The garden) are small finish lines. Finishing one is marked on the page, and the next nearest gap is offered.
7. **Review in a thumb.** Photo beside its brief, Accept or Ask again, a reason chip, next. The queue count is the heading.
8. **Never lose a photo.** Uploads queue and resume. Unmatched photos wait under Match later on Home.

## 4. Information architecture

| Place                                                    | What it is                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Album** (Home)                                         | Empty-slot count for the venue, a retake row if any, places with their empty counts, the empty slots in the current place, one main button: Add photos from your gallery |
| **Place** (the bar, the kitchen pass, the garden, rooms) | Every slot there, by section (Drinks on the menu, Games and amenities, The space), each tile in its state                                                                |
| **Match**                                                | The photos just chosen, one at a time, with the empty slots to match them to                                                                                             |
| **Slot**                                                 | The brief, the current photo and its history. Amenity slots ask the guest question first (Yes needs a photo; No marks it Not here)                                       |
| **Me**                                                   | The person's own photos and their month. The month moves off Home so the venue's album is the only goal there                                                            |
| **Review** (managers)                                    | The waiting queue, one photo at a time                                                                                                                                   |
| **Albums** (admin)                                       | Every venue by section, filled of total, and the biggest gaps                                                                                                            |

Phone tabs: Album, Add photos, Me. Add photos opens the gallery directly.

## 5. Slot states

A state is shown by a frame, an icon and a word. Colour is never the only signal.

| State               | Frame                       | Word and icon                        | Counts as filled?        |
| ------------------- | --------------------------- | ------------------------------------ | ------------------------ |
| Needed              | Dashed edge, paper fill     | + Add                                | No                       |
| Sending             | The photo, progress in mono | Sending 40% · Saved on this phone    | Shown as waiting         |
| Waiting for review  | The photo, light oat ring   | ↑ Waiting                            | Shown, not yet confirmed |
| Needs another photo | The photo, rust ring        | ↩ Retake, with the reviewer's reason | No                       |
| Accepted            | The photo, no ring          | ✓ In the album (green square tag)    | Yes                      |
| Not here            | Dotted edge, hatched        | Not here, with a reason              | Leaves the total         |

## 6. Look

Warm paper, bottle-green ink and Fraunces headings, so the photos are the colour on the page. Body and meta text use Atkinson Hyperlegible Next and Mono. Light and dark themes; photo screens (Match, Review) use a dark surround for the photo itself.

| Token       | Light                  | Dark                   | Checked pair                           | Light | Dark |
| ----------- | ---------------------- | ---------------------- | -------------------------------------- | ----- | ---- |
| canvas      | `#f6f1e7`              | `#151714`              | ink on canvas                          | 13.2  | 15.0 |
| surface     | `#fffdf8`              | `#1f221e`              | ink on surface                         | 14.6  | 13.4 |
| surface-2   | `#ece5d6`              | `#2c302a`              | muted on surface-2                     | 5.5   | 6.4  |
| ink         | `#1f2a22`              | `#efeadf`              |                                        |       |      |
| muted       | `#575c52`              | `#b8b3a6`              | muted on surface                       | 6.8   | 7.7  |
| edge        | `#7a7466`              | `#878274`              | dashed slot edge on surface (non-text) | 4.6   | 4.2  |
| accent      | `#1d4d36`              | `#2b6e4c`              | white on accent                        | 9.7   | 6.1  |
| accent-text | `#1d4d36`              | `#8fd1aa`              | on surface                             | 9.5   | 9.1  |
| ok          | `#1b5e3a` on `#d9eedd` | `#8fd1aa` on `#173323` | text on tint                           | 6.4   | 7.7  |
| warn        | `#9a3412` on `#fbe3d6` | `#ffb49d` on `#4d231a` | text on tint                           | 5.9   | 7.8  |

The dark accent fill is 2.6:1 against a dark card, so in dark the main button carries a 1px `accent-text` edge.

Green is both the main action and Accepted. They stay apart by form: the main button is a full-width control with a verb, and Accepted is a small square tag on a photo. Selected choices (an amenity Yes) use the soft green with a green edge, never the solid fill, so there is one solid green button per screen.

Sizes: main buttons 64px, all other targets 48px or more, product text 17px or more (15px only for names over a photo tile), gaps of 8px between targets.

## 7. What this changes outside the design system

These are product changes, not styling. Each needs its own decision before it is built.

1. **Match on add.** Decided as D9 on 17 Nov 2026. Today staff upload and then label ("What did you cook today?"). Album matches each photo to a slot as part of adding it. Unmatched photos still upload, as Match later.
2. **One slot model.** Menu items, amenity checks and venue areas are shown as one kind of thing. The data stays in its own tables (`coverage_*`, `venue_amenity_checks`, areas); the slot is a read model over them.
3. **Places.** Slots need a place (bar, pass, garden, rooms). Areas exist (G-9); menu items and amenity questions need a default place per venue.
4. **Briefs for every slot.** Amenities have capture briefs already (`amenity_catalogue`). Menu items do not; they need a default per section and an optional brief per dish.
5. **Match suggestions from capture time.** Reading the photo's capture time on the phone before upload is enough to order suggestions. Location from EXIF is personal data and is not proposed; the place comes from the slot the person last opened. Check this with `docs/privacy-audit.md`.
6. **Your month moves to Me.** This amends NabaLens v0.5 rule 21.
7. **No in-app camera.** The existing Take a photo path is removed from staff screens; Choose from your photos becomes the only path.

## 8. How it would ship

If D8 is decided: `DESIGN.md` is rewritten as Album v1.0 (new section numbers; the citation test and the comments that cite Common Room sections are updated in the same change), then batches:

- **A1 Foundations:** tokens in `app/globals.css`, fonts, the slot tile, the token tests.
- **A2 Album and Place:** Home and place screens over a slot read model.
- **A3 Match:** multi-select from the gallery, matching, Match later.
- **A4 Review and admin:** review queue and the admin albums view.
- **A5 Retire Common Room:** remove unused components and the old state chips.

Each batch is one bundled PR with `pnpm verify:change`, the accessibility gates and one `lci` run on its final head.
