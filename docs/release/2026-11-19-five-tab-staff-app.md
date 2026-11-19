# Release: five-tab staff app and Full App v1 (shipped 19 Nov 2026)

**Shipped.** `main` is the source of truth; start new work from it.

| PR  | What                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #35 | Five-tab staff app (Today, Album with shelves, Add, My photos, Me hub) and all of Full App v1 (PR 34's branch at `db0da20e6`); e2e specs moved to the five tabs and `/manager` |
| #36 | PR 34's last review repairs, restated as `20261119120000_pr34_review_followups`; two test-stabilisation commits                                                                |
| #37 | PR 34's last five commits and one test, restated as `20261119130000_full_app_v1_tail_fixes`                                                                                    |

PR 34 was closed: everything in it is in `main`.

What ships: Today, Album (Menu, Amenities, Spaces; shelves as folders), Add,
My photos and the Me hub for every staff member. The old `/staff`,
`/staff/tasks`, `/staff/menu`, `/staff/album/[placeId]` and `/staff/manage/*`
redirect; `/staff/manage/<x>` goes to its `/manager/<x>` twin in
`next.config.ts` (DESIGN.md §5b to §5e, §15; D15 to D19; D3). Match keeps
MatchScreen; the tray stays a trial (D13).

## How it went out (read before the next release)

The owner asked to ship without CI or `lci`. #35 merged before production had
PR 34's migrations, so production ran new code on the old schema for about 20
minutes, until `supabase db push --linked` applied all 90. #36 and #37 were
released in the right order: migration first, then merge.

- A merge to `main` deploys production on Vercel. Compare
  `supabase migration list --linked` with `main`'s migrations **before**
  merging.
- Never edit a migration production has applied: Supabase will not re-run it.
  Restate the change as a new migration (`create or replace function` with the
  latest body). #36 and #37 did this and checked that a fresh database matches
  the edited files (`pg_get_functiondef`).
- There is no separate staging Supabase project in this account.

## State on 19 Nov 2026

- Production app: `nabalens.vercel.app` on `85c046534` (#37), Ready.
- Production database: every migration applied, none pending.
- Hosted Auth and Storage settings match `supabase/config.toml`
  (`supabase config diff` empty), including TOTP MFA for admins.
- Checked on the merged head: typecheck, repo-wide lint, unit suite
  (435 files, 5,326 tests). E2E on an isolated stack before #36: chromium 302
  passed, 1 failed; mobile-chromium 47 passed; journeys 17 passed.

## Still open

1. **Signed-in production check.** Only signed-out pages were checked. Check
   that an admin is asked for an authenticator code, that a staff phone adds a
   photo from the gallery and sees it under My photos as Waiting, and that the
   manager sees it in Review.
2. **App findings the specs keep strict:** the Today goal chip's accessible
   name does not include its visible text; on `/manager`, "This venue",
   "Specials" and "Current and future menus" are under 44px; two chips in the
   menus "Saving" sheet fail target size at 360px.
3. **`scripts/ci/fixtures.ts`** signs the admin in without the second factor,
   so its menu step fails with `not_active_admin`.
4. **Not run since #36:** the security and e2e suites (Docker on the dev Mac
   could not start Supabase's auth and storage services).
5. **Phone check.** The five tabs, Album folders and My photos were checked in
   a 375px browser only, not on the phones (`docs/dev-phone-loop.md`).
6. **After-release admin steps** from `docs/release/full-app-v1-owner-steps.md`
   section 3: check manager grants, set each venue's main reviewer, review the
   shot templates, mark packaged drinks.

## Repository cleanup (19 Nov 2026)

The repo was reduced to `main` plus open PR branches; 144 worktrees and 397
local branches were removed. Nothing was lost: every commit and uncommitted
change that was not on GitHub is kept as a tag under `archive/2026-11-19/`
(`branch/`, `wip/`, `detached/`, `remote/`, `stash/`). Restore one with
`git switch -c <name> archive/2026-11-19/<path>`. Older archives are the
`archive/nabalens-2026-11-18/*` branches.

## Next (not in this release)

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
