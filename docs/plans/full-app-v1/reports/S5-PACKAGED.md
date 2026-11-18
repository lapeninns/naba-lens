# S5-PACKAGED: packaged drinks (FA-51)

Branch `fa/s5-packaged`, based on `068f67d9e`. Builds FA-51 (spec §4.2, checklist row S4.2-packaged-drink-designation, AC39). Nothing pushed; no PR, deploy, hosted migration, `lci` or `verify:release`. The owner was asleep, so every open choice took the recommended option; they are listed under Decisions.

## What was built

A manager of the venue or an admin marks a menu item or local offering **Packaged (bottled or canned)** and optionally **Photo wanted**. A packaged item without Photo wanted is optional: it stays listed, takes photos and can be accepted, but it leaves the total and the numerator of every count and is never empty. Photo wanted counts it again. Defaults (no row) keep today's behaviour.

- **Database** (`20261118133000_packaged_items.sql`): table `public.menu_item_packaging` (one row per packaged item; RLS on, no direct grants); `public.menu_item_packaging_set(item, packaged, photo_wanted)` (manager of the item's venue or admin with MFA, via `private.menu_manage_item`; active menu item or running special; Photo wanted needs Packaged, `invalid_packaging`; audited as `menu_events.action = 'packaging_set'`, no reason); `public.menu_item_packaging(venue)` (managers of the venue and admins; active menu items plus running specials not on the menu, with their designation).
- **The rule**: `private.coverage_slot_rows`, re-created from its latest body (`20261118109000`). An optional packaged dish has `required = false` and state `inactive` (report word **No photo needed**), keeping its `primary_asset_id`, `pending_count` and `covered_since`. Every reader that counts by state (coverage_slots, metrics, manager Overview, admin overview and venue checks, How this is counted) therefore leaves it out of total and numerator with no further change. Two readers count dish rows by section rather than by state and were re-created from their latest bodies (`20261118100200`): `public.album_admin_counts` (sections) and `public.menu_item_photo_summary` (Our menu, eligible items).
- **Manager**: a **Packaged** card on `/manager/menu/[itemId]` with two switches, each confirmed in an alert dialog without a reason.
- **Admin**: **Packaged items** on `/admin/menus/[venueId]`: drinks on the active menu (and any packaged item or running special), one row each with the same switches.
- **Album**: an optional dish keeps its own photo state (from the dish read, since the rule says `inactive`) and is flagged `optional`; it leaves Album, place and group counts and the Needed filter. Its empty tile reads **Optional** in a solid `edge-strong` line (Needed's dashed frame stays reserved) and opens its slot page, which says "Optional: a photo is welcome, but none is needed." and keeps Add. Match finds it by search ("Optional · a photo is welcome") and never suggests it as empty.
- **Menu import** is untouched: the designation lives on the stable item, so a re-import keeps it and a new item starts with the defaults.

## Files

- `supabase/migrations/20261118133000_packaged_items.sql` (only migration; range `133000` to `133900`)
- `lib/server/menus/local.ts` (`getPackaging`, `setItemPackaging`, `PackagingItem`), `lib/server/menus/errors.ts` (`invalid_packaging`)
- `app/manager/menu/local-actions.ts` (`setPackagingAction`), `app/manager/menu/[itemId]/page.tsx`
- `app/admin/menus/actions.ts` (`setPackagingAction`), `app/admin/menus/[venueId]/page.tsx`
- `components/nabalens/manager/menu/packaging-control.tsx` (new, catalogue row `S5-PACKAGED PackagingControl`)
- `lib/album/model.ts` (`AlbumSlot.optional`, `OPTIONAL_SLOT_WORD`, counts and Needed filter)
- `components/nabalens/album/slot-tile.tsx` (`optional`), `album-home.tsx`, `slot-screen.tsx`, `match/model.ts`, `match/match-picker.tsx`, `match/copy.ts`
- Docs: `docs/design-system/DESIGN.md` (§4 Optional row, changelog 1.7), `catalogue.md`, `docs/usage-manager.md`, `usage-admin.md`, `usage-staff.md`
- Tests: `tests/security/packaged-items.test.ts`, `tests/unit/packaged-items.test.ts`, `tests/ui/packaging-control.test.tsx`, `tests/e2e/full-app/fa51-packaged.spec.ts`; `tests/ui/manager-access-ended.test.tsx` gained `getPackaging` in its module mock (the item page now imports it).
- `lib/db/types.ts` regenerated locally for typecheck, **not committed** (coordinator regenerates).

## Decisions (recommended options taken)

1. **One rule, existing state.** Optional slots use the rule's existing `inactive` state rather than a new state: every count already excludes it, report screens already name it No photo needed, and no parser or enum changes. Album tells it apart (`kind = 'dish'` and `inactive`) and draws the photo state from the dish read.
2. **Separate table, not columns on `menu_items`**, following S1-MENUS' local-state tables (display names, availability). Absent row = not packaged; clearing Packaged deletes the row.
3. **Staff word "Optional"** for an empty optional tile, with a solid `edge-strong` line. No existing staff word fitted ("No photo needed" is report-only, never shown to staff); recorded in DESIGN.md §4 and its changelog. Tapping it opens the slot page (which says it is optional and keeps Add) rather than the gallery, so the person sees why it is not counted.
4. **Media requests**: a manager cannot raise a Missing photo request on an optional slot (`slot_not_needed`, existing behaviour for `inactive`). Photo wanted is the way to ask for it.
5. **Admin list scope**: drinks on the active menu, plus any item already packaged and running specials. Food items can be marked from the manager item page.
6. **Specials**: the designation can be set on a running special's item (the write accepts it, and the admin list shows running specials). Specials are not coverage slots today, so it has no count effect for them yet. The manager specials page has no switch; follow-up if wanted.
7. **Read access** uses `private.assert_can_manage_venue` (`not_venue_manager`, 42501), like the other manager menu reads.

## For the coordinator

- `menu_events_action_check` is re-created to add `packaging_set`. If another S5 worker also adds a menu action, merge the two lists.
- `private.coverage_slot_rows`, `public.album_admin_counts` and `public.menu_item_photo_summary` are redefined. A later migration that changes any of them must start from this body.
- Next.js `SecurityFatalError` on `next build` appeared on alternate runs (retried once each time, as instructed; no upgrade). The build recommends a Next.js security upgrade: owner decision, already recorded in the Sprint 1 owner actions.

## Checks (real output)

- `pnpm typecheck`: `tsc --noEmit`, no errors.
- `pnpm exec eslint . --ignore-pattern '.claude/**'`: exit 0 (one `react-hooks/set-state-in-effect` error in the new control was fixed first).
- Prettier `--check` on every changed file: clean.
- `pnpm test`: `Test Files 424 passed (424)`, `Tests 5190 passed (5190)`.
- Security, on the isolated stack `nabalens-s5-packaged` (ports 631xx) after a fresh `db reset` with the final migration: `packaged-items`, `coverage-slots`, `album-admin`, `menu-item-photos`, `metrics`, `admin-overview-repairs`, `menus-local-offerings`, `menus-db`, `full-app-integration`, `media-requests`, `admin-venues`: `Test Files 11 passed (11)`, `Tests 191 passed (191)`. The packaged file covers staff, a manager of another venue, an admin without MFA and anon refused (write and read), no direct table read, Photo wanted without Packaged refused, the rule (optional slot out of total, takes a photo, accepted photo kept as primary and out of the numerator, Our menu and admin album totals), Photo wanted counting again, admin set and clear, the audit rows, another venue untouched, and AC39 reproduction from the rows at every step.
- E2E, isolated stack `nabalens-s5-packaged-e2e` (block 632, app on 3632): `fa51-packaged.spec.ts`: `2 passed`. Manager at 390 marks Lager packaged (one confirm, no textbox); staff at 390 sees the tile change from `needed` to `optional` and the place's "n empty of N" drop by one on both sides, then the slot page's optional line and Add; at 1280 the counts from `private.coverage_slot_rows` match metrics, How this is counted (Lager under No photo needed), the manager Overview and the admin Overview; the admin turns on Photo wanted at 1280 and the counts and tile return to before. Also no sideways scroll at 390 and 1280. Regression on the same stack: `ac39-coverage-audit.spec.ts` and `s3-r12-match.spec.ts`: `5 passed`.
- Skipped: the full security suite (~450 s; broad regression is the coordinator's) and other e2e specs.

Both stacks were stopped with `supabase stop --no-backup`.
