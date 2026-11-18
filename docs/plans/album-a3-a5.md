# Album batches A3 to A5: plan and task IDs

Status: in progress, 17 Nov 2026. Spec: [../design-system/DESIGN.md](../design-system/DESIGN.md) (Album v1.2). Decisions D8 (adopt Album) and D9 (match on add) in [../design-system/decisions.md](../design-system/decisions.md). Delivery branch: `design/inn-identity`, one bundled PR with A0 to A5.

A0 to A2 are built and committed on the delivery branch (spec, tokens and fonts, slot tile, places migration `20261117120000_album_places.sql`, slot read model, Album Home behind `NABALENS_HOME_LAYOUT=album`, place screen, manager Album places).

## How this batch runs

- Wave 1: eight worker threads (T3 Code, accounts `claude-team-01` to `08`), one task each, each in its own worktree branched from `design/inn-identity`. Workers implement and run focused checks only, commit on their own branch, and never push, deploy, run hosted migrations or start `lci`.
- Integration: the coordinator merges the eight branches into `design/inn-identity` in the order below, resolves conflicts and runs the full local checks.
- Wave 2: release reviews (database and security, staff, manager and admin), one repair pass, then `pnpm verify:release` once on the final head.

Rules for every task:

1. Read `AGENTS.md` and `docs/design-system/DESIGN.md` first. Gallery first: no in-app camera anywhere (§2, §9). Match on add (D9).
2. Stay inside the files your task owns. If you must touch another task's file, keep the change minimal and say so in your report.
3. New migrations use only your task's timestamp. Every new table: RLS on, no direct grants, security definer functions with `set search_path = ''`, revoke from public/anon/service_role and grant execute to authenticated, as `20261117120000_album_places.sql` does. Prove it on an isolated stack (`node scripts/db/prepare-stack.mjs --project nabalens-migrations --ports 611`), never the default 554xx stack and never a hosted project.
4. Checks before you finish: `pnpm typecheck`, `pnpm exec eslint . --ignore-pattern '.claude/**'`, Prettier on changed files, the tests you touched and `pnpm test`. Report real output.
5. Report: what you built, files changed, checks run with results, what you did not do, and anything another task must know.

## Wave 1 tasks

| ID   | Account        | Batch | Task                                          | Owns                                                                                                                                                                                       | Migration timestamp |
| ---- | -------------- | ----- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| AL-1 | claude-team-01 | A3    | Match on add                                  | `components/nabalens/album/match/**`, `components/nabalens/shell/add-context.tsx`, `app/staff/_shell/add-host.tsx` and the upload/label path it uses                                       | none expected       |
| AL-2 | claude-team-02 | A3    | Album shell: tabs, Me, remembered place       | `components/nabalens/app-shell.tsx` and tab bar, `components/nabalens/album/album-home.tsx`, `app/staff/page.tsx` (Me)                                                                     | none                |
| AL-3 | claude-team-03 | A4    | Review in a thumb                             | `app/manager/review/**`, `components/nabalens/album/review/**`                                                                                                                             | none expected       |
| AL-4 | claude-team-04 | A4    | Slot briefs                                   | `lib/album/model.ts` (brief fields), briefs in `lib/server/album.ts`, `app/manager/album/**`, `components/nabalens/album/album-places-form.tsx`                                            | `20261117130000`    |
| AL-5 | claude-team-05 | A4    | Admin albums                                  | `app/admin/albums/**`, `lib/server/album-admin.ts`, admin nav entry                                                                                                                        | `20261117140000`    |
| AL-6 | claude-team-06 | A5    | Gallery only and Album words on staff screens | camera buttons and copy in `components/nabalens/menu-photos/**`, `components/nabalens/tasks/**`, `components/nabalens/home/**`, `app/staff/tasks/**` except `page.tsx`                     | none                |
| AL-7 | claude-team-07 | A5    | Slot photos staff can see                     | amenity and area thumbnails in `lib/server/album.ts` (`allAmenities`, `allAreas`), a scoped thumbnail route under `app/api/album/**`                                                       | `20261117150000`    |
| AL-8 | claude-team-08 | A5    | Album is Home                                 | `app/staff/tasks/page.tsx`, `lib/config/home-layout.ts`, removal of the goals, B01 and B02 Home layouts and their components and tests, `docs/release-checklist.md`, `docs/usage-staff.md` | none                |

### AL-1 Match on add (A3, DESIGN.md §6.1)

- Add photos (tab and Album's main button) opens the phone's photo picker for up to 20 images; a Needed slot's tile opens it for one image that goes straight to that slot.
- After picking several, the Match screen shows one photo at a time on the stage: the strip of chosen photos (current ringed), "Which empty slot is this?", suggested empty slots (current place first, then the place last matched), search over all empty slots, Match later and Not for a slot.
- Matching a dish slot sends the photo with that dish as its menu label (the path `AddLabelPreset` already uses). Matching an area slot sets its G-9 area label (`setAreaLabel`). Amenity slots are not offered in Match (their question decides the evidence); say so in the empty-search text if one is searched for.
- Each match fills the slot at once (Sending, then Waiting). Match later uploads the photo unmatched; it appears in the existing label work and must be reachable from Album as "Match later" (export a `MatchLaterRow` component and the screen; AL-8 or the coordinator wires it into Home). Not for a slot uploads it as a shared photo with no slot.
- End: "5 slots filled", what happens next, See the album.
- Remove the camera source from Add itself (`source: "camera"`, capture inputs) per §9; other screens' camera buttons are AL-6's.
- Acceptance: UI tests for picking, matching a dish, an area, Match later, Not for a slot, the summary; no `capture` attribute or camera wording anywhere in Add; keyboard and screen-reader names on every control.

### AL-2 Album shell (A3, DESIGN.md §5, §5a)

- With the album Home layout, the staff tab bar is three tabs: Album, Add photos (opens the gallery directly), Me. Other layouts keep today's tabs until AL-8 removes them.
- Me shows the person's own month (moved off Home, proposal §7.6) under the album layout.
- Album remembers the place the person last opened (a cookie, no personal data) and opens on it (§5a step 3).
- Acceptance: tests for the three tabs and their names, Add photos opening the picker, Me showing the month, the remembered place; 48px targets; no ranking or comparison anywhere.

### AL-3 Review in a thumb (A4, DESIGN.md §6.5)

- The manager review screen for menu photos and area photos: the queue count as the page title, one photo on the stage with its slot name, brief (from `AlbumSlot.brief` or the item's description until AL-4 lands), author, time and place; Ask again (secondary) and Accept (main) at the bottom; Ask again shows reason chips (Too dark, Out of focus, Wrong item, Show more of it, Messy background, Other with text) and choosing one sends the decision with that reason; then the next photo. Nobody reviews their own photo (the database already refuses).
- Reuse the existing decision actions; no new rules.
- Acceptance: tests for accept, ask again with a chip, Other with text, own photo refused, empty queue; words per §7 (Accept, Ask again, never approve/reject).

### AL-4 Slot briefs (A4, DESIGN.md §5 Brief, proposal §7.4)

- Migration `20261117130000_album_briefs.sql`: a one-line brief (1 to 140 characters) per venue for a menu section (by slug) and per menu item, with append-only history, a staff read and a manager/admin write, in the style of `album_places`.
- `AlbumSlot` gains `brief: string | null`: the dish's own brief, else its section's, else null; amenity slots use the catalogue's capture brief; areas null.
- `/manager/album` gains a brief field per section; the manager menu item page gains one per dish.
- Acceptance: migration proven on the isolated stack (manager set and clear, staff read, staff refused, other venue refused, history append-only), model tests for the brief order, UI tests for editing.

### AL-5 Admin albums (A4, DESIGN.md §6.6)

- `/admin/albums`: venues down, Food, Drinks, Amenities, Areas across, each cell "filled of total" with a tint that darkens as it fills (colour never alone), and the biggest gaps under it. Tables scroll inside their box on a narrow screen.
- Read through existing admin-scoped functions where they exist; add `20261117140000_album_admin.sql` only if needed, admin only.
- Acceptance: tests for the matrix, tints and words, gaps order, a venue with no menu, admin-only access.

### AL-6 Gallery only and Album words (A5, DESIGN.md §2, §7, §9)

- Remove every staff-facing in-app camera control outside Add (Take a photo buttons, camera icons as actions, "take a photo" copy) in favour of the gallery.
- Apply the §7 word table to staff screens (Add photos, not upload; Retake; In the album where it means accepted; no task/due/overdue for slots). Keep existing copy guard tests green; update them where the rule changed and say why.
- Acceptance: a guard test that fails on camera actions in staff components; copy tests updated; no change to data rules.

### AL-7 Slot photos staff can see (A5)

- Staff at a venue can see the current photo of an accepted or waiting area slot and an accepted amenity slot at their own venue on Album (review never gates visibility, product rule). Add a scoped database check and a thumbnail route (`/api/album/[assetId]/thumb`) that signs for 60 s like `/api/area-photos`; 404 for unknown and forbidden alike.
- Fill `thumbnailUrl` for those slots in `lib/server/album.ts`.
- Acceptance: migration proven on the isolated stack (own venue yes, other venue no, deleted asset no, anon no), route tests, read model tests.

### AL-8 Album is Home (A5)

- Make `album` the default Home layout and remove the goals, B01 and B02 layouts, their switch values, components only they use and their tests. `NABALENS_HOME_LAYOUT` and the per-venue lists go.
- Wire AL-1's `MatchLaterRow` into Album Home if AL-1's branch is merged first; otherwise leave a clearly named slot for the coordinator.
- Update `docs/release-checklist.md` and `docs/usage-staff.md` for the new Home.
- Acceptance: no reference to the removed layouts remains; Home tests rewritten for Album; `pnpm test` green.

## Merge order

AL-4, AL-7 (data), AL-1, AL-2, AL-3, AL-5, AL-6, AL-8 (the last, since it deletes the old Home).

## Out of scope

Rebuilding every remaining Common Room screen (People, Photos feed, admin pages beyond Albums): they keep their layout in Album colours and type, and stay cited to `common-room.md` until a later batch. Hosted migrations and deploys: the user runs them, staging first.
