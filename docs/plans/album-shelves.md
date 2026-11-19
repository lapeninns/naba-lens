# Album shelves: plan and task IDs

Status: in progress, 18 Nov 2026. Spec: [DESIGN.md §5d](../design-system/DESIGN.md) (Album shelves). Decision D16 in [decisions.md](../design-system/decisions.md). Delivery branch: `design/home-next`, one bundled PR with the Home rework (§5c, D15).

## Why

Album today has one level of grouping. The Bar place holds 124 drinks in 20 menu sections, listed one after another; food has 17 sections the same way. Place (where you stand) and type (Food, Drinks) are two rows of filter chips at the same level, and two-up tiles make a place dozens of screens long. Staff can't see the shape of the venue or how far each part is.

## Decisions (owner, 18 Nov 2026)

- The main way in is three **parts**: Menu (Food and Drinks as a switch), Amenities, Spaces. The **place** is a lens that filters any screen. A Profile part (logo, cover, frontage) is for later.
- Between a type and its menu sections sits a **shelf** (Spirits, Wine & fizz, Mains). Naba-Lens ships one fixed set of shelves; each section is put on one from its name, and a venue's manager can move it. Never a list of menu items in code.
- Spec, then build, against dev data.

## Tasks

| ID   | Task                                                                                                             | Done when                                                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AS-1 | Spec §5d, decision D16, catalogue entries                                                                        | §5d names every screen, level, word and state; `design-citations` test passes                                                                                                                        |
| AS-2 | Shelf set and suggestion (`lib/album/shelves.ts`)                                                                | Every section of the dev venue lands on the shelf in §5d's table; an unknown name lands on its type's "More" shelf; a manager's choice wins; unit tests cover each rule                              |
| AS-3 | Migration `20261118140000_album_shelves.sql`: `album_shelves`, `album_shelf_events`, reads and `album_shelf_set` | Same security shape as `album_places` (RLS on, no grants, definer functions, manager or admin writes, append-only events). Written, not applied: the owner applies it (no migrations without asking) |
| AS-4 | Read model: shelves on the album view, place lens, counts per type, shelf and section                            | `buildShelves` is pure and tested; a failed or missing shelves read falls back to the suggestions, never fails Album                                                                                 |
| AS-5 | Staff screens: Album landing (`/staff/album`) and the parts (`/staff/album/menu`, `/amenities`, `/spaces`)       | Matches §5d at 375px in dark and light; the filter row, jump bar, compact tiles, Done mark and place lens work on dev data; existing slot, place and Match routes keep working                       |
| AS-6 | Manager: move a section to another shelf on `/manager/album`                                                     | One select per section, limited to its type's shelves, through `album_shelf_set`; while the migration is not applied it says so and offers no control                                                |
| AS-7 | Checks                                                                                                           | Typecheck, lint, Prettier on changed files, focused unit tests; browser check of AS-5 and AS-6. Full suite and `lci` once on the final head                                                          |
