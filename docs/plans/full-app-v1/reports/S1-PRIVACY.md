# S1-PRIVACY worker report

Final report from the T3 worker, kept verbatim as the hand-off record (branch `fa/s1-privacy`, merged into `feat/full-app-v1`).

S1-PRIVACY is done on `fa/s1-privacy`: 8 commits, clean tree, isolated stack stopped. All 10 checklist rows are built or partly built; none is left unbuilt. Typecheck, lint and unit tests pass, and the security suite passes except one asset-search check that I traced to existing behaviour (details under Checks).

The biggest behaviour changes:

- **Colleagues no longer see unreviewed photos (FA-20).** Staff see a colleague's media only once it has been accepted, and only at the venue it was taken for. This used to be org-wide and before review.
- **Admins must use an authenticator app (FA-23).** Existing admins will be asked to set one up at their next sign-in. The hosted project needs TOTP turned on in Auth settings; it is on by default.

## Checklist results

| ID                               | Result                                                                                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3.3-others-unreviewed           | **Built.** One visibility rule covers every colleague read (feed, people pages and counts, media routes, Album tiles).                                                                                                                                               |
| S3.3-staff-org-photo-feed        | **Built.** The Photos feed and people counts show only accepted media at the viewer's venue.                                                                                                                                                                         |
| S3-pending-privacy               | **Partly.** A colleague's waiting photo is no longer drawn; the slot still shows Waiting. A per-slot pending count belongs to S1-COV's coverage function.                                                                                                            |
| S3.3-view-album                  | **Partly.** Venue scope uses the profile venue or the managed venue. It switches to per-venue memberships in one function when S1-PEOPLE lands.                                                                                                                      |
| S16-retain-originals             | **Built.** Accepted originals can't be deleted by staff or by the plain delete. The retention policy itself is still the owner's to set.                                                                                                                             |
| S3.3-permanent-delete-admin-only | **Built** in the database and server: admin only, with a reason and an impact preview, refused while the photo is published. The admin screen is S2-LIBRARY's.                                                                                                       |
| S12.3-metadata-strip             | **Built.** Colleague video streams have their location and device data blanked in place, so length and seeking still work. The owner, managers and admins get the original.                                                                                          |
| S3.2-mfa, A6-admin-mfa           | **Built.** New `/auth/mfa` page for set-up and code entry; admins are refused admin access in the database until they pass it. Managers can turn it on from their Account page. **Not built:** a way for one admin to reset another's lost authenticator (S2-ADMIN). |
| S3.2-shared-device-mode          | **Built.** A "This is a shared device" choice under the sign-in card. On a shared device, any return to sign-in (sign-out or an expired session) wipes drafts, the capture journal, upload keys and tab data. Personal devices behave as before.                     |

## Migrations

All three applied in order on a fresh reset of my stack, and the seed ran.

- `20261118107000_privacy_colleague_media.sql`
- `20261118107100_media_removal.sql`
- `20261118107200_admin_mfa.sql`

## Checks

- **`pnpm typecheck`** and **`pnpm exec eslint . --ignore-pattern '.claude/**'`**: both exit 0.
- **Prettier:** clean on everything I changed. Five test/perf files were already unformatted at the base commit; I didn't reformat them.
- **`pnpm test`:** 365 files, 4591 tests passed.
- **Security suite, fresh stack:** 75 files, 1137 tests passed. The new `tests/security/privacy-access.test.ts` (18 tests) covers every new function as own venue, other venue, staff, manager, admin, admin without the second step, inactive and anon.
- **`asset-search.test.ts`:** 34 of 35 pass. "reads no evidence or group rows for another venue's check…" fails. It is not caused by this work:
  - `asset_search` touches those tables even for an unknown id.
  - The reads are identical with and without the `aal` claim, and with the old bodies of the two changed functions it calls.
  - The same test passed in my first full run, so it looks plan- or data-dependent.
  - The file also takes about 10 minutes on this shared machine.
- **Focused e2e:** `library.spec.ts` "filters combine…" passed on chromium. An admin went from sign-in through authenticator set-up and code to `/admin`.
- **Next.js advisory:** `next build` stopped once to recommend a security upgrade of Next.js. I retried and didn't upgrade, since dependency upgrades weren't asked for. The owner should decide on running `next upgrade --agent=security` in a separate worktree.

## Files outside my ownership (minimal edits)

- **Auth:** `lib/auth/index.ts`, `lib/auth/profile.ts`, `lib/auth/routes.ts` (owned by S1-PEOPLE); a new `lib/auth/mfa.ts`.
- **Media access:** `lib/server/media/context.ts`, `lib/server/amenities/media.ts`, `lib/server/lifecycle/remove-media.ts`; new `lib/server/lifecycle/removal.ts`.
- **App pages:** `app/page.tsx`, `app/login/*`, `app/auth/blocked`, `app/auth/sign-out-button.tsx`, `app/manager/account/page.tsx`, `app/_media/actions.ts`.
- **Copy:** five strings that promised colleagues see photos before review.
- **Config, seed, types:** `supabase/config.toml` (TOTP on locally), `supabase/seed.sql` (admin claim gets `aal2`), `lib/db/types.ts` (additions only).
- **Tests:** about 20 security tests rewritten to the new visibility rule; test admins now pass a real TOTP step. Shared e2e sign-in helpers complete the admin step via `tests/e2e/helpers/mfa.ts`, and `auth.spec.ts` now expects an admin to land on `/auth/mfa` first.
- **Docs:** `docs/community.md` and my rows in `docs/plans/full-app-v1/checklist.md`.

## For Sprint 2 workers

- **Visibility:** `private.media_visible_to_caller(asset)`, `private.asset_is_accepted(asset)` and `private.can_view_venue_album(venue)`. A reference-level decision counts as accepted.
- **Removing media:**
  - `delete_media_asset` now raises `media_asset_retained` for accepted media.
  - New functions: `request_media_removal`, `cancel_media_removal_request`, `decline_media_removal_request`, `media_removal_impact` (returns a token), `admin_delete_media_asset(asset, reason, token)` and `media_removal_requests(state, venue)`.
  - Refusal codes: `withdraw_instead`, `impact_changed`, `media_asset_published`, `reason_required`, `request_closed`.
  - Server functions are in `app/_media/removal-actions.ts`; types and parsers in `lib/media/removal.ts`. `removeMediaAsset` now returns 409 `retained`.
- **MFA:** auth state has a new `mfa_required` status (`requirement: "enrol" | "verify"`), and `authorize` can return reason `mfa_required`. `my_mfa_status()` returns the session level and verified-factor count; `ROUTES.mfa` is `/auth/mfa`.
- **Coordinator, at merge:**
  - If S1-PEOPLE also redefines `private.is_active_admin`, my migration (later timestamp) wins: keep its `aal2` condition.
  - If S1-COV changes the Album slot photo rows, my visibility filter still applies on top.
  - A few database checks that test `role = 'admin'` directly (admin label reads, one grant read) aren't covered by the `aal2` rule; the app-level gate still stops an admin who hasn't passed the second step.
  - The e2e specs that expect colleagues to see unreviewed photos (for example `colleague-originals.spec.ts`) still need updating; I didn't run them.
