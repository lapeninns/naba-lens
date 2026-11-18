# V2-C report: design-system docs for v2

Worker V2-C, 18 Nov 2026, branch `v2/v2-c` (based on `f87438e64`, V2-A merged). Decision [D10](../../../design-system/decisions.md); plan [plan.md](../plan.md). Docs only: no code, no push, no PR, no `lci`. The owner was away; each choice below follows D10 and is recorded here.

## What changed

| File                                                                                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DESIGN.md](../../../design-system/DESIGN.md)                                            | Version 2.0. Header names v2 as the look and Album as the behaviour, with a "where it lives" table pointing at `v2/`. §3 rewritten to v2's colours (role, v2 token, light, dark, use), recomputed contrast, Figtree/Fraunces type scale with the Album alias names, v2 space, size, radius, depth, motion and breakpoints. §4 frames in v2 colours, marks as v2 chips under the name, the Accepted square tag retired. §5 names the v2 component behind each Album component and adds Notice, Empty state and lists. §6.7, §6a, §6b, §8, §9, §10, §11 updated. New §13 (v2 and D10 table), §14 (status tones), §15 (navigation), §16 (interaction states). Changelog 2.0; Album's look listed as superseded; batch V2 in Delivery. |
| [departures.md](../../../design-system/departures.md)                                    | Intro now covers three specs. New first section "Design system v2 (D10)" with V2-1 to V2-14. Retired or updated rows v2 now satisfies (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [catalogue.md](../../../design-system/catalogue.md)                                      | v2 table checked against V2-A's component list: TabBar gains `shell/tab-item.ts`; Field gains `input.tsx`, `textarea.tsx`, `label.tsx`; JobCard and SideNav notes match V2-A; notes cite their departures. Path-check note added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [components.md](../../../design-system/components.md)                                    | New "Design system v2" note and table: each v2 component, its README, the Common Room table(s) here it replaces, and the shipping files. Says the old "Shipped" column is the 14 Nov snapshot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [usage-manager.md](../../../usage-manager.md), [usage-admin.md](../../../usage-admin.md) | Navigation placement only: the left-side menu on a wide screen (v2 SideNav, from 1100px). No behaviour text changed. `usage-staff.md` needed no change: staff navigation looks the same in words (three tabs, top bar from tablet), and it names no colour, font or bar colour.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Section numbers (R2)

Every number cited in `app`, `components` and `lib` (`grep -rn "DESIGN.md §"`: §2, §2.8, §3, §3.1, §4, §5, §6.1, §6.2, §6.3, §6.5, §6.6, §6.7, §7, §8, §9, §10, §11) still exists and names the same rule: §2 principles 1 to 9 unchanged (principle 4 and 8 cited), §3/§3.1 tokens and colour roles (canvas, ok tones), §4 slot states, §5 components, §6.x patterns, §7 words, §8 accessibility (now also states the `aria-disabled` rule `components/ui/button.tsx` cites it for), §9 not in the system, §10 names in code, §11 rules 1 to 8 in the same order (rule 9 added at the end). New material is §13 to §16. `tests/unit/design-citations.test.ts` passes.

## Departures recorded

From V2-A's list: V2-1 three staff tabs; V2-2 "+ Add" not a camera on the empty SubjectCard; V2-3 FA-7 words (with the tone exceptions Needs labels and Label corrected, neutral); V2-4 `sm` 44px below 1100px; V2-5 safe choice first in phone sheets; V2-6 PickChip tick; V2-7 manager tab label at 13px (closed, retires A-R5-1); V2-8 Phosphor not Lucide.

From D10, not in V2-A's list: V2-9 Upload sheet / Take photo / Record video / Submit replaced by gallery-first Add photos and Match on add; V2-10 v2's staff voice words (Upload, Take photo, Submit); V2-11 Toast built but not shown.

Found while writing 2.0: V2-12 VenueBar not yet on capture and review screens (**open**, owners V2-B1, V2-B2); V2-13 Album's slot frames kept on SubjectCard; V2-14 staff see the remaining count, not v2's "30/40, 75% covered".

Retired or updated: A-R5-1 closed (V2-7); A-CD1 closed (no reserved chip shapes in v2); Common Room N1 closed (SideNav), S5 closed (shapes are tones), S6 closed (every chip has an icon), C17 partly closed (SideNav, MetaList); A-M1 and A-ADMIN-1 reasons reworded for the 13px labels and the SideNav.

## Choices made without the owner

- **Status words versus tones.** DESIGN.md §14 describes the tones as the code draws them (`CHIP_SHAPES`), not v2's table, and V2-3 records the two words in a different tone. The words and tones are not restated beyond examples; `status-chip.tsx` stays the one source.
- **Text floor.** v2's floor (13px caption, 16px staff body) replaces Album's 17px in §3.3, §8 and §11 rule 6, because D10 adopts v2's type in full. No departure.
- **Compact targets.** §8 states 48px staff, 44px compact below 1100px, 40px from 1100px, as V2-A built it (V2-4).
- **VenueBar** is recorded as an open departure rather than a rule screens already meet, since V2-A left it unused.

## Findings for the coordinator

- Code comments still describe the old look in a few places (not changed: docs-only scope). `app/manifest.ts:13` says "Album's paper and green". V2-B or V2-R may want to reword it; the cited section §3.1 is still right.
- `staff-copy-guard.test.ts` does not keep "Upload", "Submit" or "take a photo" off staff screens; V2-10 says so. A guard is a possible follow-up for the next batch.
- DESIGN.md 1.x said "Version 1.6" in its header while its changelog had 1.7; 2.0 fixes the header.

## Checks

- `pnpm install --frozen-lockfile` (the worktree had no `node_modules`).
- `pnpm exec prettier --write` on the six changed docs and this report: formatted.
- `pnpm exec vitest run tests/unit/design-citations.test.ts tests/unit/docs-references.test.ts`: 2 files, 10 tests passed.
- `pnpm test`: 430 files, 5266 tests passed.
- Not run: typecheck, lint, e2e (no code changed); `tests/journeys/menus-observations.spec.ts` reads the usage guides for phrases that were not touched.
