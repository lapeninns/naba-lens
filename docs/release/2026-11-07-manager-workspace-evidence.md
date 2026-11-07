# Evidence: venue manager workspace, Phase 2, 7 November 2026

Local browser evidence for the venue manager workspace (Phase 1 manager
accounts plus Phase 2 item photo review) on branch
`claude/nabalens-manager-workspace-455c31`, before commit. It covers an
isolated local stack only. Hosted checks come after an authorised release and
are listed at the end as open.

| Item        | Value                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code        | Working tree on the branch above (Phase 1 committed; Phase 2 uncommitted), rebased on the staff portfolio branch                                                                |
| Environment | Isolated local Supabase stack made by `tests/e2e/prepare-stack.mjs` (own project id and port block, not 554xx), all 28 migrations applied from scratch, latest `20261107100500` |
| App         | Production build (`next build`, then `next start`) against that stack                                                                                                           |
| Runner      | Playwright (`playwright.config.ts`). The plan's qa-with-e2e skill is not available here, so the repo's own Playwright runner was used                                           |
| Operator    | An agent. Nothing pushed, deployed or migrated on a hosted project                                                                                                              |

## Roles and viewports

- **Accounts:** an admin, a venue manager account at venue A and one at venue
  B (each converted from staff by the admin's own session through
  `convert_account_to_manager`, with a reason), two staff at venue A, and a
  revoked manager (venue A's, after the admin revoked the grant). All are DEV
  FIXTURE accounts made for the run.
- **Menu:** each venue has an active four-item menu (Soup and Salad in
  Starters, Pie in Mains, Lager in Drinks).
- **Viewports:** `chromium` at 1280 × 800 and `mobile-chromium` at 390 × 844
  with touch. Every test in `tests/e2e/manager-workspace.spec.ts` ran in both.

## Results: `tests/e2e/manager-workspace.spec.ts`

12 passed, 0 failed, 0 skipped (6 tests × 2 viewports, 50 s).

| Test                                | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in and wrong-role navigation   | A manager lands on `/manager` with the emailed link and, separately, with the emailed code on the login page. The manager opening `/`, `/staff`, `/staff/tasks`, `/staff/menu`, `/staff/manage`, `/staff/manage/review`, `/admin`, `/admin/staff` or the admin Review page is sent to `/manager`. Staff opening `/manager`, `/manager/review` or `/manager/menu` land on Home. An admin opening `/manager` lands on `/admin`                                                                                                                                                                                               |
| Overview counts and no add controls | Overview's total matches the active menu's food and drink items counted in the database (4). It shows "2 photos waiting for a decision", the Review badge "2 photos waiting" and each section's count. Menu lists all four items. Overview, Review (Waiting, All, Unlabelled), Menu, an item page, a contributor page and Account have no upload, add-photo or file-input control                                                                                                                                                                                                                                          |
| Journey                             | Staff upload a JPEG through the real upload dialog and label it Soup in the label editor; staff Our menu shows 0 of 4. The manager opens the large preview (served by the private preview route, image loaded), chooses **Accept for this item** ("Accepted for Soup. Soup now has a photo."), then **Accept and set as menu photo** on a second Soup photo. On the item page the second photo is the menu photo and the first is an accepted alternative; **Set as menu photo** swaps them. Menu shows Soup **Has a photo**. Staff Our menu shows 1 of 4, Soup **Has an accepted photo**, with the menu photo's thumbnail |
| Relink, ask, withdraw               | **Choose a different menu item** refuses without a reason, then moves a Salad-labelled photo to Lager with one (stored as a reviewer match correcting Salad); the Accepted card shows "Moved from Salad". **Ask for another photo** refuses without a reason, then records the request; the contributor sees **Better photo requested**. **Withdraw acceptance** with a reason leaves Lager needing a photo again                                                                                                                                                                                                          |
| Unlabelled photos                   | Only the ready photo tagged as a dish with no item appears; a photo tagged only as team does not. **Choose a menu item** assigns it to Pie ("Moved to Pie and accepted.") and the list is then empty                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Isolation and revoke                | Venue B's manager gets "This item isn't on your current menu" for venue A's item, the not-found page for venue A's contributor, 404 for venue A's photo thumbnail, and no venue A cards. Venue A's manager gets the not-found copy for venue B's item. Before the revoke, `/manager/review` is sent `no-store` and venue A's thumbnail is a private 302. After the admin revokes the grant, `/manager`, `/manager/review` and `/manager/menu` show **Venue access unavailable** ("Your venue access has ended.") with no workspace nav and only **Sign out**, and the thumbnail is 404                                     |

### Totals before and after (both viewports)

| Screen           | Before the decisions                                                                | After the decisions                                                                             |
| ---------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Manager Overview | Menu photos · 0 of 4 items covered; 2 photos waiting for a decision; Review badge 2 | Menu photos · 1 of 4 items covered; 0 photos waiting for a decision; Nothing waiting for review |
| Staff Our menu   | 0 of 4 menu items have an accepted photo                                            | 1 of 4 menu items have an accepted photo; Soup has an accepted photo                            |

Screenshots (full page, per viewport) were saved in the run's output folder
(`.artifacts/test-results/`, not committed): `overview-before`,
`overview-after`, `staff-our-menu-after`, `overview-counts`,
`review-after-withdraw` and `venue-access-unavailable`.

## Results: legacy specs updated for manager accounts

Phase 1 made `grant_venue_manager` refuse staff accounts, so every spec that
granted a staff "manager" failed in setup (`staff_not_eligible`; shown by
running the unmodified `menu-completion.spec.ts`, which failed at once). Those
specs test the legacy `/staff/manage` tools, so they now use a legacy
staff-held grant written by the fixture (`legacyStaffGrant` in
`tests/e2e/helpers/coverage-world.ts`), which the transitional rule keeps in
effect. `coverage-manager.spec.ts` no longer makes the grant in the admin form
(which now lists manager accounts only); it checks that the admin sees the
grant in effect, labelled **Legacy staff grant**.

Chromium (`mobile-chromium` selects none of these files):

| Specs                                                                                                                            | Result                                                            |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `coverage-manager`, `coverage-checklist`, `menu-completion`, `me-manage`, `coverage-staff`                                       | 13 passed                                                         |
| `coverage-routes`, `coverage-acceptance`, `review-fixes`                                                                         | 27 passed, 2 skipped (the existing `CLEANUP_SECRET` route checks) |
| `coverage-rpc`, `contrast-dark`, `reflow`                                                                                        | 34 passed                                                         |
| Regression sample: `auth-guards`, `auth`, `staff-accounts`, `security-headers`, `negative`, `colleague-originals`, `menus-admin` | 28 passed                                                         |

Not run in this pass: the remaining Playwright files, the Firefox and WebKit
`@core` lanes, and `visual.spec.ts` (skipped without `NABALENS_VISUAL`).

## Not covered here

From design spec §6.6, these were not automated in this pass: the admin
deciding a manager's own photo, concurrent decisions from two sessions, menu
replacement and rechecks, photos labelled for an old menu, a 60-photo queue,
keyboard-only review, the stubbed failure state and the recorded journeys
harness file. The database rules behind them are covered by the security and
integration suites.

## Hosted checks (after an authorised release)

Open. Before `supabase db push`, confirm the staff portfolio branch's
`20261106130000_menu_item_photos` is already on the target: it must be applied
before `20261107100300`–`20261107100500`, and `db push` refuses out-of-order
files. Then repeat sign-in (link and code), one accept and the Overview and Our
menu totals with the pilot accounts, and record the results here.
