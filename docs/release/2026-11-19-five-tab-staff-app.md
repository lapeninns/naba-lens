# Release: five-tab staff app (design/home-next)

Status, 19 Nov 2026 (night): the branch is committed and merged with the
latest `feat/full-app-v1` (PR 34). Typecheck, repo-wide lint and the unit
suite (433 files, 5,310 tests) pass on `9177095cc`. Nothing is pushed,
deployed or migrated. The owner runs every production step below.

What ships: Today, Album (Menu, Amenities, Spaces; shelves as folders),
Add, My photos and the Me hub for every staff member; the old `/staff`,
`/staff/tasks`, `/staff/menu`, `/staff/album/[placeId]` and `/staff/manage/*`
redirect (DESIGN.md §5b to §5e, §15; D15 to D19; D3). Match keeps
MatchScreen; the tray stays a trial (D13).

## Blocking before release

1. **PR 34 lands first.** Another thread is qualifying `feat/full-app-v1`.
   Do not start a second `lci` run while it holds the shared runner.
2. **E2E migration batch (not done).** About 40 specs in `tests/e2e/`
   drive retired URLs (mostly `/staff/manage/*`, `/staff`, `/staff/tasks`):
   `coverage-manager`, `coverage-acceptance`, `upload-label-flow`, `visual`,
   `reflow`, `manager-workspace`, `coverage-routes`, `helpers/managed-world.ts`
   and others (`grep -lE '/staff/manage|"/staff"|"/staff/tasks"' tests/e2e`).
   Manager journeys move to `/manager`; staff journeys to the five tabs.
   `lci` fails until this is done.
3. **Integration tests not run.** `tests/integration/auth-access.test.ts`
   and `auth-links.test.ts` were retargeted to `/staff/me` and
   `/staff/photos` and typecheck, but need the local stack
   (`pnpm test:integration`).
4. **Legacy manager grants.** A staff account that still holds a manager
   grant is now sent to `/manager` (D3). Check production has none before
   release, or move them to manager accounts.
5. **Phone check.** The five tabs, Album folders and My photos were checked
   in a 375px browser only, not on the phones (docs/dev-phone-loop.md).

## Release steps (owner)

1. After PR 34 merges: `git fetch origin && git rebase origin/main` on
   `design/home-next` (or merge `origin/main`); re-run
   `pnpm typecheck && pnpm exec eslint . --ignore-pattern '.claude/**' && pnpm test`.
2. `gh auth switch --user lapeninns`, push `design/home-next`, open one PR:
   "feat(staff): five-tab staff app with Today, Album shelves, My photos
   and Me hub".
3. Migration `supabase/migrations/20261118140000_album_shelves.sql`:
   staging first, then production, with the repo's `pnpm db:*` scripts.
   The app works without it (Album uses the suggested shelves; managers see
   the shelf but cannot move it), so it can follow the deploy if needed.
4. On the final head, once: `pnpm verify:release` (it runs `lci`). Then
   `lci merge` (the only merge path; no `--force`, `--only`, `--no-codex`).
5. Deploy and smoke as for PR 32 and PR 34. Smoke: staff sign-in lands on
   Today with five tabs; `/staff/tasks` and `/staff` redirect; a manager's
   `/staff/manage` goes to `/manager`; Album › Menu shows folders; My photos
   opens a photo page; Add opens the gallery, then Match.

## Not in this batch (next)

- Move the task-era screens to clearer URLs with redirects (`tasks/month` →
  `me/month`, `tasks/other` → `me/jobs`, `tasks/welcome` → `welcome`,
  `tasks/guide` → `me/help/guide`, `tasks/amenities/[id]` →
  `album/amenities/[id]`, `profile` → `me/work`).
- Delete code only the retired screens used (`app/staff/staff-portfolio.tsx`,
  `AlbumHome`, `album-place.tsx`, `/staff/manage/_shared`, old copy keys).
- Redesign the rest of `/staff/*`: slot page, notices, Your month, welcome
  and guide, colleagues' photos and People, Match later and Other jobs.
- `lib/album/mock-photos.ts` is a dev-only preview (`next dev` with
  `NABALENS_ALBUM_MOCK_PHOTOS=1`); it never runs in production.
