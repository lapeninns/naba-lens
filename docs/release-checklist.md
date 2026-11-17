# Release checklist and controlled pilot

**Current decision (owner, 2 November 2026): production is deployed at
`ab9452f`, and a controlled three-venue pilot is in progress.** The owner took
this decision before the Gate 2 and Gate 3 evidence below was complete, so the
deployment certifies no unticked item. There is still no real-phone
certification, staging review or restore rehearsal. The dated record is
[production at `ab9452f`](release/2026-11-02-ab9452f-production.md).
Historical fanout reports are evidence only for their recorded commit and
environment, not for today's head.

Open after the 2 November release:

- Physical iPhone Safari and Android Chrome checks (F-01, F-02) have not run.
- The scheduled hourly monthly preparation is not proved on production; only a
  manual run succeeded (2 November, 12:15 Europe/London).
- In each pilot venue, 12 suggested checklist items await the manager's
  confirmation, and menu coverage and amenity facts are unconfirmed.
- Each pilot venue uses one shared account that is both its FOH staff member and
  its manager, so every acceptance is a self-review and individual FOH and BOH
  participation is not measured.

Keep a dated evidence record with commit, target environment, tester, command
output, device/OS/browser where relevant, failures and owner sign-off. Do not
include credentials, signed links or identifiable customer media.

## Gate 1: open prerequisites

The production release went ahead with these still open; each still needs
evidence:

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
- The cleanup schedule ships in `vercel.json`, but successful scheduled runs,
  monitored failure handling and provider TUS expiry <=24 h are not verified
  here.
- Owner-approved retention, object/DB backups and an isolated restore rehearsal
  are missing. Restore remains **UNTESTED**.
- Current-head service-dependent integration/security/lifecycle/e2e evidence must
  be collected by the release owner; do not substitute another track's old run.
  For `ab9452f`, `lci` ran them on fixture stacks in all three browser lanes
  (see the [record](release/2026-11-02-ab9452f-production.md)); hosted
  services are covered only by the live checks listed there.
- Individual admin portfolios currently expose previews only; download/delete
  require **Content** filtered by **Staff member**. The spec requires those
  actions in individual portfolios too. The owning track must implement them
  or obtain an explicit scope decision before treating the MVP as complete;
  this documentation does not silently certify that missing UI.
- [v0.4](spec/NabaLens-Staff-Coverage-v0.4.md) monthly targets, venue coverage,
  review and venue-manager grants are in production: the six migrations
  `20261102110000` to `20261102160000` were applied on 2 November 2026, and the
  required `lci` run passed on `ab9452f`. The hourly monthly-preparation run
  and each pilot venue's checklist, menu coverage and amenity facts are still
  open (see above). The cron in `vercel.json` fails on any target without these
  migrations.

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
- [x] v0.4 migrations: with owner authorisation, confirm the exact target, apply
      every earlier pending migration and then the coverage migrations and
      `20261102160000_community_asset_access` in order, verify the outcome,
      and only then deploy the code that needs them. Between that last
      migration and the deploy, colleagues' media shows as unavailable.
      Confirm a colleague's direct `media_assets` read returns no rows, while
      Explore and colleague portfolios still show previews.
      **Done on production, not a staging target, 2 November 2026:** readback
      showed nothing pending, 13 new tables with row-level security, the
      community RPC denied to anonymous users and the broad colleague row
      policy gone; `ab9452f` was deployed afterwards.
- [ ] Set `CRON_SECRET` equal to `CLEANUP_SECRET` and confirm an hourly
      monthly-preparation run succeeds in **Coverage** (`/admin/coverage`).
      **Open:** only a manual run is evidenced (2 November, 12:15 Europe/London).
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

**Current pilot (from 2 November 2026):** the owner started it on production
before Gate 2 was evidenced. Three venues take part: Old Crown (Girton), Corner
House and White Horse (Waterbeach). Each has one shared venue account that is
FOH staff and the manager of its own venue only, with a target of 5 accepted
photos due 30 November 2026. This departs from step 1: there are no named
individual contributors, no BOH contributor and no separate reviewer. A manual
monthly preparation ran on 2 November; each venue's suggested checklist items,
menu coverage and amenity facts still await the manager's confirmation.

### Pilot plan

1. Owner chooses the **confirmed pilot venues** and named individual contributors,
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

**Pilot exit:** Every pilot venue demonstrates the complete real-device journey, negative
access/lifecycle checks pass, no unaccepted security/data-loss/runtime blocker
remains, and the owner signs the evidence. Upload counts are not the success
criterion.

**Stop the pilot** for cross-account access, publicly exposed media, original-byte
mismatch/data loss, broken validation or sustained processing/cleanup failure,
and for v0.4: a manager reaching another venue, inflated or lost monthly
credit, or email/account details in manager screens.
Contain access under the authorised incident plan, retain safe diagnostic
evidence and fix/retest before resuming. Do not weaken RLS or assertions.

## Release: goals, not tasks (v0.5, phase 1)

[v0.5](spec/NabaLens-Goals-v0.5.md) §6 and
[decision 18](plans/goals-not-tasks.md): staff Home switches from tasks to
goals at every venue in one release, with no per-venue stage. This entry does
not authorise a deploy, a migration or an environment change; those stay with
the user under Gate 4.

Album (below) replaces this Home. If both ship in the same release, send
Album's venue note instead of the one here, and follow Album's steps for the
environment and rollback: the layout switch this section relies on is gone.

**Who tells the venues and when.** Aman Kumar Shrestha tells every venue on
release day (decision 18, amended by the user on 15 Nov 2026).

| Item                               | Value                                      |
| ---------------------------------- | ------------------------------------------ |
| Who tells each venue               | Aman Kumar Shrestha                        |
| Release date                       | not set yet                                |
| Date venues are told (release day) | not set yet; record the actual date here   |
| Venues told                        | every venue (record each one and the date) |

**Note for every venue** (send as written, or in the same words):

> From [release date], Naba-Lens Home changes for food and drink photos.
> There are no more task lists, due dates or Overdue for menu photos. Home
> shows **Our menu**: the dishes and drinks at your venue that still need a
> photo. Anyone can photograph any of them, and a dish leaves the list once a
> photo of it is accepted. **Your month** still shows your own target; it
> ends with the calendar month and has no due date. Accepted photos you
> labelled — dishes, drinks and venue areas — and photos you sent to the
> month, count. A photo that isn't a dish or a drink (the bar set-up, the
> garden) counts once you label it with a **Venue area** and a manager
> accepts it. If a manager asks for another photo of a dish, Home shows it as
> **Needs another photo** with **Reshoot** and **Later**. Photos you have
> already sent keep counting. Amenity checks and other venue jobs keep their
> dates; find them under **Other jobs** on Home.

**Note for venue managers** (send with the note above):

> - **Team targets** (Overview → Team targets): set the venue's default photo target
>   once; new starters get it without you doing anything. You can give
>   someone their own number (a reason is needed to change one) and move
>   them back to the default later.
> - **Needed by** (Menu → a dish): put a date on a dish to show it first
>   in Still needed for everyone. It clears when a photo is accepted, and it
>   never shows as Overdue.
> - **Venue area photos** (Review): photos staff labelled with a part of the
>   venue wait here. Accept, ask for another photo (with a reason) or
>   withdraw. You can't decide on your own photos.
> - Menu sections no longer have assignees or due dates; section shots count
>   toward each person's month.
> - Known limit: when you ask for another photo of a venue area, the person
>   sees it on Your month but gets no retake note yet.

**Steps for the user, in order.** Environment changes need the user; agents
never make them.

1. Set the release date and record it in the table above.
2. On release day, Aman Kumar Shrestha sends the note to every venue. Record
   each venue and the date sent.
3. (No waiting period: venues are told on release day.)
4. Apply the phase 1 migrations and deploy through the normal release path
   (Gates 2 to 4, v0.4 §5 release and rollback rules). Nothing here applies
   them.
5. On a phone at one venue, check Your month on **Me** with no due date, no
   Overdue on any dish, and an amenity check reachable from **Other jobs**.

## Release: Album is Home (A5)

[DESIGN.md](design-system/DESIGN.md) §5a, decisions D8 and D9: staff Home is
Album at every venue. The goal-led, B01 and B02 Home layouts and their switch
are removed from the code, so there is no per-venue stage and no layout
rollback. This entry does not authorise a deploy, a migration or an
environment change; those stay with the user under Gate 4.

| Item                               | Value                                      |
| ---------------------------------- | ------------------------------------------ |
| Who tells each venue               | Aman Kumar Shrestha                        |
| Release date                       | not set yet                                |
| Date venues are told (release day) | not set yet; record the actual date here   |
| Venues told                        | every venue (record each one and the date) |

**Note for every venue** (send as written, or in the same words):

> From [release date], Naba-Lens opens on your venue's **album**. Every dish
> and drink on the menu, every amenity and every part of the venue that needs
> a photo has a slot, and the empty ones are drawn as gaps you can tap. Take
> photos with your phone's own camera whenever service allows, then add them
> from your gallery and tap the slot each one fills. A photo waits for review,
> then it is **In the album**; if a reviewer asks for another, Album shows a
> **Retake** with the reason. There are no due dates and nobody is ranked.
> Your own month is on **Me**.

**Note for venue managers** (send with the note above): set which part of the
menu and which amenities belong to which place on **Album places**
(`/manager/album`);
until then every slot is under **Not placed yet**.

**Steps for the user, in order.** Environment changes need the user; agents
never make them.

1. Set the release date and record it in the table above. On release day,
   Aman Kumar Shrestha sends the notes to every venue; record each venue and
   the date sent.
2. Apply the Album migrations (A2 to A5) on staging, then production, through
   the normal release path (Gates 2 to 4). Nothing here applies them.
3. The code no longer reads `NABALENS_HOME_LAYOUT`,
   `NABALENS_HOME_LAYOUT_B01_VENUES` or `NABALENS_HOME_LAYOUT_ALBUM_VENUES`.
   Delete them from every environment after the deploy; leaving them set has
   no effect.
4. On a phone at one venue (Safari on iPhone and Chromium), check Album: the
   venue's name and empty count first, the places, the empty slots of the
   current place, a retake when one is open, and **Add photos from your
   gallery** opening the phone's photos. Check there is no in-app camera, no
   due date, no Overdue and no ranking anywhere on it.
5. Rollback, if needed: redeploy the previous release. There is no layout
   switch to flip; no data changes. Tell the venues if you do.

## Gate 4: PRODUCTION

Requires Gates 2–3 and a **separate production authorisation**, not a passing CI run.
The 2 November 2026 production deploy is for the controlled pilot, by the
owner's decision above; this gate still governs any wider rollout.

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
      beyond the pilot venues, in controlled groups up to all ten.

Preserve exactly two roles, **staff** and **admin**; a v0.4 venue-manager grant
is not a role. No editorial approval, public portfolio, consent workflow, social
tools beyond the authorised community, AI, publishing, analytics dashboard, bulk
ZIP export or extra role is added by these gates. v0.4 review decides task
completion only.
