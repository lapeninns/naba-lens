# Release record: production at `ab9452f`, 2 November 2026

The dated evidence record the [release checklist](../release-checklist.md) asks
for. It covers this commit and environment only; a later commit needs its own
record.

| Item        | Value                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| Commit      | `ab9452f24e090de41726a373d37c439989a0b435` on `main`, "Add the organisation community, monthly targets and venue coverage" |
| Environment | Production: the hosted Supabase project and the Vercel production deployment                                               |
| Date        | 2 November 2026                                                                                                            |
| Operator    | The owner pushed, migrated, deployed and ran the live checks. Agents prepared the commit and ran local CI only             |
| Decision    | Owner: deploy to production and run a controlled three-venue pilot before the Gate 2 and Gate 3 evidence is complete       |
| Sign-off    | Release decided by the owner. Pilot evidence is not signed off: the open items below remain                                |

## Before release: local CI on the exact commit

`lci run naba-lens --ref ab9452f…` passed all four required jobs:

- **Chromium lane:** typecheck, lint, unit (826), build, bundle scan,
  integration (234 passed, 12 skipped), lifecycle (26), security (367),
  Playwright desktop and phone (138 passed, 21 skipped by their own gates:
  visual snapshots, two `CLEANUP_SECRET` cron-route checks and one desktop-only
  check) and privacy runtime (12).
- **Firefox and WebKit lanes:** the same gate with the `@core` journey as the
  browser suite.
- **Production smoke contract:** loopback fixture tests only.

## Migrations

Applied to production in order with `supabase db push`:

1. `20261102110000_staff_departments`
2. `20261102120000_organization_community`
3. `20261102130000_venue_manager_grants`
4. `20261102140000_coverage_domain`
5. `20261102150000_coverage_procedures`
6. `20261102160000_community_asset_access`

Readback: nothing pending; 13 new tables, all with row-level security; the
community RPC is denied to anonymous users; the broad colleague read policy on
media rows is gone.

## Deploy

The Vercel production deployment of `ab9452f` is ready. The local CI result
above was reused for this commit, not re-run.

## Live checks on production

- Production smoke: 13 of 13 signed-out checks pass, plus archive freshness.
- Route charters for signed-out protection pass. The first run stopped at a
  manual "Verify you are human" checkbox, not treated as a defect; the second
  run was clean.
- A colleague's photo viewer has no original, download or delete controls.
- A venue manager sees only their own venue, and `/admin/coverage` redirects a
  manager to their tasks.
- A manual monthly preparation succeeded at 12:15 Europe/London.

## Pilot

Three venues: Old Crown (Girton), Corner House and White Horse (Waterbeach).
Each has one shared venue account that is FOH staff and the manager of its own
venue only, with a target of 5 accepted photos due 30 November 2026.

## Open

- **F-01, F-02:** physical iPhone Safari and Android Chrome checks have not run:
  camera and library uploads, HEIC/HEIF, video playback and sound, interrupted
  transfers, sending, review and a replacement photo, and an original-download
  hash comparison. No device, OS or browser details are recorded yet.
- **Scheduled preparation:** the hourly monthly preparation (minute 7) is not
  proved on production; only the manual run is. Confirm a scheduled run in
  **Coverage** (`/admin/coverage`).
- **Venue setup:** in each venue, 12 suggested checklist items await the
  manager's confirmation, and menu coverage and amenity facts are unconfirmed.
- **Shared accounts:** each account reviews its own photos, so every acceptance
  in this pilot is a self-review, and individual FOH and BOH participation is
  not measured.
- Every unticked item in Gates 2 to 4 of the release checklist.

Raw command output stays in the owner's release evidence outside this
repository. This record holds no email addresses, project identifiers, signed
links or credentials.
