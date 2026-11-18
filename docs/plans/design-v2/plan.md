# Design system v2: batch plan

Decision: [D10](../../design-system/decisions.md). Source package: [docs/design-system/v2/](../../design-system/v2/README.md). Branch `design/v2`, based on `feat/full-app-v1` (PR #34). One PR at the end, based on `feat/full-app-v1` until #34 merges, then on `main`.

## What changes and what stays

| Area | v2 | This batch |
| --- | --- | --- |
| Tokens, colours, light and dark | `tokens.css` | Adopt; `app/globals.css` holds them (one source) |
| Type | Figtree 400-700 body, Fraunces 600 display | Adopt via `next/font/google`; Atkinson goes |
| Components | 21 `nl-` components (`components.css`, `components/<Name>/`) | Adopt; each becomes, or restyles, one React component listed in `catalogue.md` |
| Manager and admin navigation | SideNav from 1100px, TabBar on phone | Adopt |
| Staff add flow | Upload sheet: Take photo, Record video, Choose from phone, Submit | **Keep Album**: gallery-first Add photos, Match on add, no camera, no Submit (D9, FA-1, FA-2) |
| Status words | v2 status table | **Keep Album** FA-7 words in `status-chip.tsx`; adopt v2's five tones, icons and chip shape |
| Staff tabs | Home / Upload / Album / My uploads | **Keep** Album / Add photos / Me, drawn with v2's TabBar |
| Behaviour | (not in v2) | Unchanged everywhere: this batch is visual |

## Tasks

| ID | Stage | Scope |
| --- | --- | --- |
| V2-A | 1, alone | Foundation: tokens into `app/globals.css` (light/dark), fonts, Tailwind theme mapping, and every shared component restyled or built to v2 (Button, StatusChip, TabBar, SideNav, Sheet, Field, PickChip, Tabs, ListRow, Notice, EmptyState, Toast, MetaList, DataTable, ThumbPick, SubjectCard, JobCard, UploadRow, DecisionBar, CoverageMeter, VenueBar) with their existing APIs kept, so screens change with no screen edits where possible. `/ui-preview` shows every component. AGENTS.md "UI changes" points at v2. |
| V2-B1 | 2 | Staff screens (Album, place, slot, Match, Me, notices, help) on the v2 components, per `v2/SCREENS.md` within D10 |
| V2-B2 | 2 | Manager screens, phone TabBar and desktop SideNav |
| V2-B3 | 2 | Admin screens and SideNav |
| V2-C | 2 | DESIGN.md 2.0, departures for D10's kept rules, catalogue rows, usage guide wording that names visuals |
| V2-R | 3 | Adversarial review (visual fidelity to v2, accessibility, 320/390/1280, dark mode, no behaviour change), one repair pass |
| V2-Q | 4 | Full checks, all e2e, visual specs (`pnpm test:visual`) with refreshed baselines, rendered checks; one PR |
