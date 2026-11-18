# S1-PEOPLE worker report

Final report from the T3 worker, kept verbatim as the hand-off record (branch `fa/s1-people`, merged into `feat/full-app-v1`).

S1-PEOPLE is done on branch `fa/s1-people` in 7 commits; nothing was pushed. 15 of the 19 checklist items are built, 3 are partly built and 1 is not built. Typecheck, ESLint and Prettier are clean, and my new tests pass. In the full security suite, one existing test (`asset-search.test.ts`) failed once, and I traced that to accumulated test data rather than my code. My stack (582xx) is stopped.

## How it works

- **New table `venue_memberships`:** one row per person, venue and role (staff or manager), with who granted it, when, why, and how it ended. Rows are never edited except to end them. Existing staff and managers were copied in.
- **Main assumption: "active venue".** About 140 existing database checks read the profile's role and venue. Instead of rewriting them, the profile now holds the venue the person is working at right now, and their role there. `switch_active_venue` moves them only to a venue where they already have a membership, so switching never grants access. Someone who manages A and is staff at B gets manager rights only at A, and only while working at A. A switch is per person, not per browser tab.
- **Old paths still work.** Triggers keep memberships in step with invites, transfers, conversions, (re)activation and manager grants. The three old side-effect triggers (revoke grants, end assignments, clear amenity assignees) skip a switch.
- **Changes to existing database functions:**
  - A person can now hold one open manager grant per venue, instead of one in total.
  - `grant_venue_manager` no longer revokes a grant at another venue.
  - `manager_workspace_scope` reads the grant for the active venue.
  - `deny_manager_coverage_writes` lets the departure side effects through when a manager removes staff.

## Checklist

| ID                                                                                      | Result                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| AC14, S3.1-per-venue-memberships, M5-multi-venue-membership, A6-multi-venue-memberships | built                                                                                                                                    |
| AC40, S3.1-manager-invites-staff, M5-invite-staff, A6-invite, S3.3-invite-matrix        | built: always staff, only at the manager's own venue; the database refuses before any login account is created                           |
| S3.1-manager-cannot-touch-other-venues                                                  | built, with negative tests                                                                                                               |
| M5-deactivate-staff                                                                     | built: removing someone from their last venue deactivates and signs them out; assets and history stay                                    |
| S3.1-last-admin, A6-manage-admins                                                       | built: a trigger blocks any route (app, provider or SQL) that would leave no active admin; grant and revoke the admin role with a reason |
| A6-effective-privileges                                                                 | built: `person_venue_privileges` table on the admin person page                                                                          |
| S11-membership                                                                          | built; invitation status still comes from Supabase Auth                                                                                  |
| S3.1-active-venue-visible                                                               | partly: `VenueSwitcher` is only on the manager Team screen. A person who is currently staff can't switch until S2-STAFF adds it to Me    |
| S3.2-first-sign-in                                                                      | partly: notice version, acceptance record and onboarding read are built; the welcome screen is S2-STAFF's                                |
| A6-reassign-work                                                                        | partly: open coverage assignments and amenity checks move to a colleague. Review responsibilities wait for the reviewer model (A2)       |
| S3.2-session-expiry                                                                     | not built: it is a hosted Supabase Auth setting the owner must apply (a paid-plan feature)                                               |

## Migrations

- `20261118101000_venue_memberships.sql`
- `20261118101100_venue_membership_commands.sql`
- `20261118101200_admin_roles_and_onboarding.sql`

They apply in order on a fresh reset. They don't depend on other workers' migrations, and they don't change the shared `coverage_audit_events` entity list.

## Files

- **Mine:**
  - the 3 migrations and the new types in `lib/db/types.ts` (only my additions)
  - `lib/server/accounts/{memberships,validation,context,index,auth-users}.ts`
  - `lib/auth/{venues,venue-actions}.ts`
  - `app/manager/team/{page,actions,venue-people}.tsx`
  - `app/admin/staff/{page,actions,admin-roles}.tsx` and `[id]/{page,venue-access-panel}.tsx`
  - tests and my checklist rows
- **Outside my ownership:**
  - `components/nabalens/invite-staff-dialog.tsx`: added a locked-venue mode and an "added" result, rather than building a second invite dialog.
  - `components/nabalens/venue-switcher.tsx`: new file.
- The Team page section reuses its existing Common Room card and heading; no Common Room code was changed.

## Checks

- **Typecheck, lint, format:** `pnpm typecheck` exit 0; `pnpm exec eslint . --ignore-pattern '.claude/**'` exit 0; `prettier --check` on changed files: "All matched files use Prettier code style!"
- **My tests:** `tests/security/venue-memberships.test.ts` 26/26 (own venue, other venue, staff/manager/admin, inactive, anon); `tests/unit/venue-memberships-server.test.ts` 14/14; `tests/ui/venue-memberships.test.tsx` 11/11.
- **Wider security suite on my stack:** manager, coverage, access, hardening and staff-work-profile files 347/347. Remaining files: 3 groups of 16 passed (183, 231, 193), and 15 of the other 16 passed one by one.
  - `asset-search.test.ts` takes about 11.5 minutes and failed one scan-counting test once, after earlier long runs had filled the stack with test data.
  - It passes on a fresh base stack, still passes after adding my three migrations to it, and passes on a fresh reset of my branch. So it depends on accumulated data and query plans, not on this change.
- **`pnpm test`:** 4582 passed, 5 failed, all 5-second timeouts in HEIC decode, menu matching and the community People list. That run overlapped the security suite; rerun alone, those 4 files pass 124/124. I did not rerun the whole `pnpm test` alone.

## What Sprint 2 workers need to know

- **Database reads:**
  - `my_venue_memberships()`
  - `venue_team(venue)`: manager of that venue or admin
  - `person_venue_privileges(person)`: flags `can_upload`, `can_review`, `can_invite_staff`, `can_export`, `can_grant_roles`
  - `my_onboarding_state(version)`
- **Database commands:**
  - `switch_active_venue`
  - `manager_invite_staff`
  - `remove_venue_member(person, venue, reason, replacement?)`, which returns `removed` or `deactivated`
  - `admin_set_venue_membership`
  - `reassign_open_work`
  - `admin_grant_admin` / `admin_revoke_admin`
  - `acknowledge_contribution_notice`
- **Rule:** `private.venue_role_of(user, venue)` is the per-venue role rule; build new checks on it.
- **Server layer** (`@/lib/server/accounts`): `inviteStaffToVenue`, `removeVenueMember`, `setVenueMembership`, `reassignOpenWork`, `grantAdminRole`, `revokeAdminRole`, `listVenueTeam`, `getPersonVenuePrivileges`, `listActiveAdmins`, `membershipError`. There is a new error code `last_admin`.
- **App helpers:** `@/lib/auth/venues` has `listMyVenues`, `switchMyVenue`, `getOnboardingState`, `acknowledgeContributionNotice`, `CONTRIBUTION_NOTICE` and `CONTRIBUTION_NOTICE_VERSION` ("v1"), `venueRoleLabel`. `@/lib/auth/venue-actions` has `switchVenueAction` (it returns the new role's home page) and `acknowledgeNoticeAction`.
- **S2-STAFF:** put `VenueSwitcher` with `switchVenueAction` on Me, and use `CONTRIBUTION_NOTICE` plus the acknowledgement on the first sign-in screen.
- **S2-MGR / S2-ADMIN:** reviewer handover isn't covered. Add it to `remove_venue_member` once the reviewer model (A2) exists.
- **Old conversion path:** `convert_account_to_manager` / `convert_manager_to_staff` still act on the whole account and revoke manager rights at other venues. Admin screens should use `admin_set_venue_membership` for anyone with more than one venue.
