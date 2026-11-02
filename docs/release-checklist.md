# Release checklist and two-venue pilot

**Current decision: NOT READY for staging review, pilot or production.**
A documentation/build milestone is not a release. This branch has no hosted
deployment, real-phone certification, owner-confirmed venue list or restore
rehearsal. Historical fanout reports are evidence only for their recorded commit
and environment, not for today's head.

Keep a dated evidence record with commit, target environment, tester, command
output, device/OS/browser where relevant, failures and owner sign-off. Do not
include credentials, signed links or identifiable customer media.

## Gate 1: NOT READY

Stay here while any prerequisite below is missing. Current blockers:

- `supabase/seed/venues.json` is `[]`: no owner's ten confirmed venues loaded.
- Owner-authorised staging Supabase/Auth/SMTP/HTTPS/hosting/secrets and migration
  configuration are not evidenced. Public sign-ups, email templates, redirect
  allowlists, OTP expiry and purchased-plan upload caps need target verification.
- `next.config.ts` has no explicit HEIC-worker tracing/runtime configuration.
  Production-route worker packaging, Linux sharp/decoder startup, memory,
  timeouts and load behavior are not certified by a local build.
- Physical iPhone/Android media, actual camera selection, HEIC/HEIF orientation/
  colour/primary-image behavior, video-codec fallback and mobile interruptions
  need recorded real-device evidence. Desktop synthetic fixtures do not replace it.
- Cleanup scheduler, monitored failure handling and provider TUS expiry <=24 h
  are not deployed/verified here.
- Owner-approved retention, object/DB backups and an isolated restore rehearsal
  are missing. Restore remains **UNTESTED**.
- Current-head service-dependent integration/security/lifecycle/e2e evidence must
  be collected by the release owner; do not substitute another track's old run.
- Individual admin portfolios currently expose previews only; download/delete
  require **Content** filtered by **Staff member**. The spec requires those
  actions in individual portfolios too. The owning track must implement them
  or obtain an explicit scope decision before treating the MVP as complete;
  this documentation does not silently certify that missing UI.
- [v0.4](spec/NabaLens-Staff-Coverage-v0.4.md) monthly targets, venue coverage,
  review and venue-manager grants have no release evidence. Their migrations
  (from `20261102130000`) follow the pending local-only community migrations,
  and none is applied to a hosted database. The hourly monthly-preparation cron
  in `vercel.json` fails on any target without them. The required `lci` run on
  the final local commit has not happened.

This docs pass runs the contract's install/typecheck/lint/unit/build checks; see
[its handoff](fanout/handoffs/docs-expand.md) for exact results and not-run suites.

## Gate 2: READY FOR STAGING REVIEW

This gate permits a review of a **configured staging environment**, not a pilot
or production launch. Advance only when all are evidenced:

- [ ] Owner authorises and records each staging item in [setup §6](setup.md#6-hosted-staging-and-production-owner-authorisation-checklist).
      Confirmed venues only; no DEV FIXTURE seed in hosted data.
- [ ] Final-head `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`,
      `pnpm test`, `pnpm build` pass with real logs; report install warnings.
- [ ] On one owned, isolated local stack, `pnpm test:integration`,
      `pnpm test:security "$W"`, `pnpm test:lifecycle "$W"` and `pnpm test:e2e`
      pass. Record workdir/project/ports, no hidden retries and stop the owned
      stack afterward. Follow [test setup](setup.md#4-checks-and-isolated-test-stacks).
- [ ] With separate staging staff A, staff B and admin identities: invitation,
      magic-link login, upload, persistent portfolio, automatic ready asset in
      admin library, unchanged original download (compare file hashes) and denial
      of B's UI/API/DB/Storage access to A's asset all pass.
- [ ] Check missing/inactive profile, no/inactive venue, role/venue tampering,
      inactive sessions, removed/failed/unvalidated media, signed-link expiry,
      combined filters and pagination.
- [ ] Resolve the individual-portfolio download/delete gap above. Verify the
      agreed implementation; do not mistake the Content workaround for completed
      portfolio actions.
- [ ] Test own name/avatar edit, admin staff edit/resend, partial invitation email
      failure without duplicate accounts, deactivate/reactivate and retained
      portfolio. A venue transfer labels old uploads with the old venue and new
      uploads with the new venue.
- [ ] Full-size photo/video/avatar transfer and validation pass on the actual
      hosting plan; malformed/oversized/disguised input never becomes ready.
      Verify private/no-store responses and original download headers.
- [ ] HEIC production-route packaging, native dependencies, measured memory,
      concurrency and timeout are checked on the target Linux/Node host.
- [ ] Removal disappears from both views; Storage failure is reported and a later
      cleanup retries it. Validate authenticated POST scheduling, nonempty
      `failed`, `more`, lease skips, alerts and provider incomplete-TUS expiry.
- [ ] Keyboard/focus/dialog behavior and no horizontal overflow at 360, 390, 768,
      1280 and 1440 CSS pixels are reviewed, including **My tasks**, the
      manager screens and the staff navigation with **Manage**. Existing
      Playwright projects alone do not cover all these targets.
- [ ] v0.4 migrations: with owner authorisation, confirm the exact target, apply
      every earlier pending migration and then the coverage migrations and
      `20261102160000_community_asset_access` in order, verify the outcome,
      and only then deploy the code that needs them. Between that last
      migration and the deploy, colleagues' media shows as unavailable.
      Confirm a colleague's direct `media_assets` read returns no rows, while
      Explore and colleague portfolios still show previews.
      Set `CRON_SECRET` equal to `CLEANUP_SECRET` and confirm an hourly
      monthly-preparation run succeeds in **Coverage** (`/admin/coverage`).
- [ ] v0.4 journey with staging staff, manager and admin identities: grant a
      manager; set targets; staff land on **My tasks**, send photos to an
      assigned task and as monthly photos; the manager accepts one and asks for
      another with a reason; staff send a replacement. Counts follow the credit
      rules in the [staff guide](usage-staff.md#what-counts-toward-your-monthly-target),
      and oversight shows participation, coverage and the self-review
      separately.
- [ ] v0.4 denials: staff cannot review or set targets; a manager cannot reach
      another venue's ids through pages, actions or direct database calls;
      revoke, transfer and deactivation end an open manager session's reach;
      manager screens and responses contain no email or account details;
      evidence previews are `private, no-store` with 60-second links.
- [ ] Activating a new menu shows **Menu changed — review coverage** and moves
      nothing until reconciled; an amenity left as **Needs verification**
      cannot be confirmed; exclusions keep their reason.
- [ ] The coverage withdrawal is rehearsed on an isolated stack
      ([operations](operations.md#withdrawing-coverage-access-rollback)).
- [ ] Reviewer records remaining issues and owner accepts staging-review outcome.

## Gate 3: CONTROLLED PILOT

Requires Gate 2 plus explicit owner permission for real participants. No general
rollout yet.

### Two-venue plan

1. Owner chooses **two confirmed venues** and named individual contributors,
   covering both BOH and FOH, plus a different admin and a support contact.
   Do not invent names or use development fixture accounts.
   For [v0.4](spec/NabaLens-Staff-Coverage-v0.4.md), each venue also needs an
   owner-confirmed manager grant, confirmed menu-section and amenity coverage,
   and explicit manager-set monthly targets. Before staff start, the manager
   runs **Prepare this month**, confirms or excludes (with a reason) each
   suggested checklist item, records amenity facts (unknown stays **Needs
   verification**), confirms menu coverage from the venue's active menu,
   assigns people and sets each person's target. Do not invent targets or
   amenity facts.
2. Agree the pilot window, support channel, capture/permission rules, retention,
   approved download destination and stop conditions. Provide the
   [staff](usage-staff.md), [admin](usage-admin.md) and
   [capture/operations](operations.md) guides. Use only the manager-set v0.4
   targets; do not add other quotas or publishing workflows.
3. Invite participants through the real UI and verify their assigned venue.
   On participating physical **iPhone Safari and Android Chrome**, record
   device, OS/browser versions, network and source format. Test ordinary library
   selection and actual camera behavior where available.
4. For each venue, complete staff upload → reload portfolio → admin's foreground
   library refresh (approximately 15 seconds/focus) → preview → single original
   download → source/download hash comparison. The portfolio and library must
   reference the same asset with contributor, upload-time venue and date.
   On the same phones, open a task from **My tasks**, take or choose photos,
   send them and see the manager's decision; answer a **Needs another photo**
   request; check the month count and that videos never count.
5. Test real JPEG/PNG/WebP/HEIC/HEIF photos and MP4/MOV/WebM samples as available;
   record each tested/unavailable format honestly. Check orientation, colour,
   dimensions and video sound/playback without autoplay. Unsupported codecs
   show **Preview unavailable in this browser** and admin original download.
6. Interrupt a transfer/network, retry only the affected file without duplicate
   ready assets, and test a mixed successful/failed batch. Explain no promise of
   continuation after closing the browser. Verify missing/incomplete statuses.
7. Repeat isolation, removal, deactivation and a supervised venue transfer.
   Verify retained historical attribution and inactive contributors' admin view.
8. Review error logs, cleanup backlog and storage/egress costs during the pilot.
   Owner and participants record actual usability issues and corrective actions.

**Pilot exit:** Both venues demonstrate the complete real-device journey, negative
access/lifecycle checks pass, no unaccepted security/data-loss/runtime blocker
remains, and the owner signs the evidence. Upload counts are not the success
criterion.

**Stop the pilot** for cross-account access, publicly exposed media, original-byte
mismatch/data loss, broken validation or sustained processing/cleanup failure,
and for v0.4: a manager reaching another venue, inflated or lost monthly
credit, or email/account details in manager screens.
Contain access under the authorised incident plan, retain safe diagnostic
evidence and fix/retest before resuming. Do not weaken RLS or assertions.

## Gate 4: PRODUCTION

Requires Gates 2–3 and a **separate production authorisation**, not a passing CI run.

- [ ] Complete every production item in [setup](setup.md), including the real
      ten-venue list, approved admin bootstrap, SMTP, domains, secrets, migrations,
      private buckets/plan caps and measured runtime constraints.
- [ ] Owner approves retention, publishing-permission guidance, support and
      incident ownership; staff know a library entry is not publishing clearance.
- [ ] Monitored cleanup runs successfully; abandoned uploads, active-transfer
      protection and pending-deletion retries have target-environment evidence.
- [ ] Separate DB/Auth and private-object backups are configured. The isolated
      restore rehearsal has actual successful evidence; remove **UNTESTED** only
      after it passes. Agree recovery/cutover/rollback responsibilities.
- [ ] Pilot fixes are in the release commit and affected checks are rerun.
      Record production smoke-check/rollback procedure and responsible operator.
      For v0.4, rollback stops the monthly-preparation schedule and runs the
      [coverage withdrawal](operations.md#withdrawing-coverage-access-rollback);
      reverting the UI alone does not revoke database access. Colleague media
      access has a separate rollback
      ([community deployment](community.md#deployment-requirements)) that the
      coverage withdrawal does not cover.
- [ ] Owner explicitly accepts remaining limitations and authorises rollout
      beyond the two venues, in controlled groups up to all ten.

Preserve exactly two roles, **staff** and **admin**; a v0.4 venue-manager grant
is not a role. No editorial approval, public portfolio, consent workflow, social
tools beyond the authorised community, AI, publishing, analytics dashboard, bulk
ZIP export or extra role is added by these gates. v0.4 review decides task
completion only.
