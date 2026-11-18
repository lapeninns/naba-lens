# S2-MGR worker report

Final report from the T3 worker (branch `fa/s2-mgr`, merged into `feat/full-app-v1`).

S2-MGR is done on branch `fa/s2-mgr`: 9 commits, nothing pushed, working tree clean, and my stack (596xx) is stopped. 12 of the 13 checklist rows are built and 1 is partly built. Typecheck, ESLint and Prettier are clean, and every security file I added or touched passes. The full `pnpm test` run had timeout failures because the shared machine was overloaded (load average about 100); every failing file passed when re-run on its own, except `tests/media/heic-memory.test.ts`, which I didn't re-run.

## Checklist (Result column updated in `checklist.md`)

| ID                                              | Result                                                                                                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S20-reviewers-usages                            | **Partly built.** Main and backup reviewers per venue, with handover, are built. I treated "known external usages" as S1-EXPORT's publication records (Exports screens) and did not build a separate register. |
| S9.3-menu-monthly-confirmation                  | Built: a monthly "Still right" for the active menu, on Overview and Venue.                                                                                                                                     |
| M4-manager-nav                                  | Built: Overview / Review / Album / Requests / Venue. Requests points at `/manager/requests`, which S2-REQ builds; it returns 404 until that merges.                                                            |
| M1-unlabelled-count                             | Built. It uses the same rule as Review's Needs labels filter, so the number matches the list it links to.                                                                                                      |
| M1-missing-required, M1-needs-update            | Built from `coverage_slots`. "Needs update" only becomes accurate once S2-INT replaces the check-due stub.                                                                                                     |
| M1-publication-issues                           | Built from `publication_overview().outstanding`; the row links Exports.                                                                                                                                        |
| M1-coverage-categories                          | Built: Food, Drinks, Spaces, Facilities (Other when present) and facts, shown as "n of N" with the percentage second (FA-8).                                                                                   |
| M1-priority-actions                             | Built: "Review next" is the one main button, then the spec's four actions. Collection (empty slots) and review backlog (photos waiting) are shown separately.                                                  |
| M1-active-menu-reviewers, M5-review-assignments | Built. Only people who already hold manager permission at the venue can be nominated.                                                                                                                          |
| M5-venue-hub, M5-history                        | Built: `/manager/venue`, `/manager/venue/history`.                                                                                                                                                             |

**Hand-off items, all built:**

- Overview links `/manager/exports` and shows publication issues.
- The Review badge is unchanged; the amenity findings badge moved to the Album tab.
- Amenity archive and restore now always ask for a reason, on the check page and on the Archived list. The reasonless database commands are no longer callable by signed-in users.
- Menus, specials, availability and local-name screens are linked from Venue.
- A new **Venue › To confirm** page (`/manager/venue/facts`) gives "Still right" for facts and for space photos due a check.
- Team links `/manager/team`, which has the `VenueSwitcher`.
- When a reviewer stops being a manager at the venue, their role ends and the backup becomes main. This is done by database triggers, so it covers `remove_venue_member`, admin commands and deactivation.

## Assumptions to review

- **Add on phones:** five tabs fill the 320px bar, so the manager's Add moved to the header. Below 352px the header shows the venue name to screen readers only (each page header still names it). Recorded as departure A-3; please check at 320px.
- **Core amenity questions:** these four can now be archived or restored only by an admin (the rule in S1-MENUS' applicability function): toilets, Wi-Fi, parking, step-free entrance. Before, managers could archive them.
- **Restore is locked down too:** I also revoked the reasonless restore, not just archive, because restoring is also an applicability change (AC29).
- **Album tab** opens `/manager/menu`; Venue covers team, exports, menu versions and specials.
- **"Still right" for facts** sends the `revision` from the fact states read as the slot revision. If that is wrong, the row shows the conflict message.

## Migrations (`20261118113000`–`113300`, additive, apply on a fresh reset)

- `113000_venue_reviewers.sql`: reviewer table, `venue_review_assignments`, `set_venue_reviewer`, handover triggers.
- `113100_menu_month_checks.sql`: `confirm_menu_month`, `manager_venue_summary`, and `private.venue_unlabelled_photos`. If S2-REVIEW's wider Needs label queue (FA-4) changes what counts as unlabelled, it should redefine that function rather than count another way.
- `113200_venue_history.sql`: `venue_history`, which reuses S1-OPS's history rows plus applicability, fact, special and change-request history.
- `113300_amenity_applicability_only.sql`: the archive/restore revoke.
- `lib/db/types.ts`: my additions only.

## Files

- **Mine:**
  - Pages and actions: `app/manager/venue/**`, `app/manager/page.tsx`.
  - Components: `components/nabalens/manager/{overview/overview-panels,venue/*}`.
  - Libraries: `lib/manager/{venue,overview,to-confirm}.ts`, `lib/server/manager/venue.ts`.
  - The gallery fixtures section `manager-venue`.
  - Tests: `tests/security/manager-venue.test.ts`, `tests/unit/manager-venue-{model,server}.test.ts`, `tests/ui/manager-venue.test.tsx`.
- **Outside my ownership, kept small:**
  - Nav and shell: `manager-nav.tsx`, `manager-shell.tsx`, `hrefs.ts`, `copy.ts`, `overview-body.tsx` (new `actions`/`panels` props), and `home-rows.tsx` (exported `HomeRow`).
  - Amenities: `amenities/manage/{check-detail,amenities-overview}.tsx` and `lib/server/amenities/{writes,errors}.ts`.
  - Gallery: `page.tsx` and `fixtures.ts`.
  - Docs: `departures.md` (A-3, A-4), `catalogue.md`, `checklist.md`.
  - Tests updated because of the revoke or the nav change: 6 security files (plus a helper, `tests/security/amenity-applicability.ts`), `tests/e2e/knowledge-b03-cd.spec.ts`, and 8 UI/unit files, including the scope-guard allow-list.

## Checks (final head)

- `pnpm typecheck`: exit 0. ESLint: exit 0. Prettier on the 58 changed files: "All matched files use Prettier code style!"
- My unit and UI tests plus the affected suites: 13 files, 164/164 passed.
- `pnpm test`: the last full run had 10 failing files and the run before it 27 failing tests, nearly all 5-second timeouts. Re-running those files on their own: all passed after one real fix in `amenities-manage.test.tsx`, except `heic-memory.test.ts`, which I didn't re-run. I didn't get a clean full run.
- Security on my stack: `manager-venue` 21/21. Then 18 files together, 359/359 passed: the 6 suites changed for the revoke, plus memberships, manager accounts and denials, ops, facts freshness, exports, coverage access, evidence documents, upload pipeline, manager uploads, local menu offerings and hardening.
- **Not done:** no browser render at 320px or desktop. That would need env files I'm not allowed to read, so it's left for Sprint 3.

## For Sprint 3 reviewers and e2e writers

- **Routes:** `/manager` (Overview), `/manager/venue`, `/manager/venue/facts`, `/manager/venue/history?source=…`, `/manager/venue#reviewers`.
- **Test hooks:**
  - Overview: `data-slot="overview-actions|review-next|overview-backlog|overview-coverage|overview-venue|active-menu|menu-check|exports-row"`, `data-action="review|venue|request|outdated"`, `data-backlog="collect|review"`, `data-category=…`, `data-reviewer="main|backup"`.
  - Venue: `data-slot="reviewers-form|venue-history|venue-menus"`, plus `manager-add-compact` for the phone Add button.
- **Journeys:**
  - Nominate a backup, then remove the main reviewer as admin: the backup becomes main.
  - Confirm this month's menu: it reads "Confirmed for November by …".
  - Archive an amenity with a reason: it appears in History as "Marked not here" (AC29).
  - Fifty photos waiting with no empty slots: the two backlog numbers stay separate.
- **Seeded data:** none added. Fixtures are made through the security helpers (`makeManager`, `publishMenu`).
