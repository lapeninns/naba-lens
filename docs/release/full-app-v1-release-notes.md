# Naba-Lens Full App v1: release notes

Release candidate: branch `feat/full-app-v1`, final verified head `428b8c90e` plus these docs. Spec: [NabaLens-Full-App-Specification-v1.0.md](../spec/NabaLens-Full-App-Specification-v1.0.md). Decisions: [FA-1 to FA-54](../plans/full-app-v1/decisions.md). Requirement results: [checklist.md](../plans/full-app-v1/checklist.md). How to use each screen: [staff](../usage-staff.md), [manager](../usage-manager.md), [admin](../usage-admin.md).

Four things stay separate throughout the app and these notes:

| Word            | Means                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------- |
| Sent (uploaded) | The file reached the server. Nobody has looked at it yet.                                    |
| Approved        | A manager decided on it: for public use, or kept as reference (never closes a public slot).  |
| Covered         | A slot counts as filled: a current, public-level, non-duplicate photo with nothing due.      |
| Published       | Someone recorded that the photo is live on a destination. Exported (downloaded) is not this. |

## What changed for staff

- **Same three tabs.** Album, Add photos and Me stay (FA-1). The spec's Home, Upload and My uploads are inside them.
- **Asked for.** A manager's request shows on Album as the slot itself, with the manager's brief and, when dated, "Needed by". Tapping it opens the gallery for that slot (FA-50). Staff never see "task", "due" or "Overdue".
- **Filters.** Album filters by Food, Drinks, Spaces, Facilities and Other (FA-6), and by Needed, Waiting, In the album, Needs updating and All.
- **Slot page.** Tapping a filled slot shows its photo, its brief, its state, how many photos wait, Add photos and **Report a change**.
- **Adding photos.** Match stays (D9). New: **I'm not sure** sends a photo to the manager to label instead of guessing; **Use for the next N photos** labels a run in one go; an optional short note; a summary before sending (venue, counts, labelled, waiting for the manager to label). Quality hints (dark, blurry, small) never stop a send (FA-3).
- **Honest receipts.** A photo reads Saved on this phone, Sending, Checking, then Waiting. Sent, Couldn't finish and Not sent say what went wrong. Only the files that failed are retried; a lost reply never makes a second copy.
- **Limits.** Photos up to 25 MB (JPEG, PNG, WebP, HEIC), videos up to 60 seconds and 250 MB, 20 files a batch. An oversized file fails alone with a reason.
- **Your photos** is the first section of Me (FA-48), filtered by Needs attention, Sending, Waiting and Reviewed. After review a photo reads In the album, Kept for reference, Retake (with the reason), Label corrected or Not used (FA-7). From a row: Retake, Change slot and Withdraw while undecided, Fix date taken, and **Ask to remove** once accepted (an accepted original cannot be deleted by its sender, FA-21).
- **Notices.** An inbox on Me (retakes, label corrections, requests naming you), with a count badge. No pop-ups and no push (FA-10). Quiet hours 21:00 to 08:00 venue time.
- **Colleagues' photos** are shown only once a manager has accepted them; an unreviewed one shows as "1 waiting" (FA-20). Your own photos are always visible to you.
- **Several venues.** A person can be staff at one pub and manager at another; Me shows your venues and switches between them (FA-22).
- **Exact copies** of a photo already sent never count twice ("Already sent before: it doesn't count twice", FA-35, FA-45).
- **Welcome.** First sign-in shows the venue, role and a note on how contributed photos are used, until you tap I understand.

## What changed for managers

- **Five tabs:** Overview, Review, Album, Requests, Venue.
- **Overview** starts with what to do next: review the oldest waiting photo, photos needing a label, slots still to collect, checks due, facts to confirm and publication problems. Collecting and reviewing are two separate counts. Coverage shows "18 of 24" per category with the percentage as secondary text (FA-8).
- **Review.** One queue with photos that need a label (I'm not sure, food or drink with no dish, or unmatched for 7 days) next to those awaiting review, oldest first (FA-4). Filters for category, person, section, age, possible duplicate, needed-by and media type. On a photo: **Approve for public use**, **Keep as reference**, **Ask for another photo** (with a reason), **Fix label** (no new upload; the person sees Label corrected), **Mark duplicate**, **Not used**. Batches ask for confirmation. If someone else decided first, you are told and nothing is overwritten.
- **Your own photos.** Nobody decides on their own photo, unless an admin marks the venue single-reviewer; those decisions are listed for admin spot checks (FA-9).
- **Requests.** Ask for a slot with a brief, priority and needed-by date (never Overdue), optionally for one person and for video; shot lists for a launch; campaign briefs with real due dates. States: Open, Submitted, Completed, Blocked, Cancelled (FA-5). A fact-confirmation request completes only when the fact is confirmed.
- **Metrics.** Coverage by category, confirmed facts, review delay, label corrections, the Needs label backlog, useful contributions, content use and reliability. "How this is counted" lists every slot behind the number. No ranking of people.
- **Venue.** To confirm (facts and place photos due a check, with **Still right**, which restores them without a new photo), **Reported changes** from staff (Dealt with or Dismiss), menus current and scheduled, local specials, **Mark not available** for a sold-out dish (it stays in the total), local display names, catalogue change requests, team (invite and remove ordinary staff at your own venue only), backup reviewer, history and exports.
- **Exports.** Make a package of public photos for your venue and download a ZIP. Exported is not Published.

## What changed for admins

- **Seven sections** in the spec's order: Overview, Venues, Menus & catalog, Library, Publishing, People, Settings & activity. On phones: Overview, Venues, Library and **More** (FA-49). Admins land on Overview.
- **Two-step sign-in.** Admin accounts must use an authenticator app (FA-23). Admins can reset another admin's lost authenticator.
- **Overview.** Monitoring exceptions and venues needing attention first, then each venue's coverage, facts, label backlog, oldest waiting review, checks due and publication errors. Every number links to its records.
- **Venues.** Create and edit (name, locality, timezone), operating status with a reason, archive and restore, setup checklist, main reviewer, single-reviewer setting, templates copied from the group or another venue, and scope changes (such as accommodation) with an impact preview and a reason.
- **Menus & catalog.** CSV import with a downloadable template, row errors, a preview grouped as unchanged, added, suspected match, changed presentation and proposed retirements; re-importing the same file changes nothing; retirements must be ticked. Activate now or schedule a date.
- **Library.** Filters (venue, item, category, state, dates, person, orientation, type, request, collection, destination), asset detail with provenance and history, select primary, tags, collections, duplicate compare, withdraw and restore, **Suspend from use** (the slot counts as empty again; restore never brings approvals back), and permanent removal with an impact preview and a reason.
- **Publishing.** Export packages (Original, Website, Social, Custom sizes; ZIP with CSV and JSON manifest) and manual **Published** records with destination, link and date. Withdrawing a photo invalidates packages that hold it ("Needs rebuilding") and marks destinations Withdrawal pending. Reference photos appear only in internal packages, marked internal (FA-46).
- **People.** Per-venue roles, invites, admins (the last active admin cannot be removed), effective privileges per venue, and open work handed over when someone leaves.
- **Settings & activity.** Quiet hours, reminders, backlog threshold, orphan-upload window (7 days), export profiles, storage quota; an activity log of who changed what, where, when and why; monitoring of stuck processing, failed jobs and storage.

## Data and migrations

83 Full App migrations, `20261118100000` to `20261118138100`: Sprint 1 (23), the Sprint 2 fix pass `108000`-`108600` (7), Sprint 2 (20), the Sprint 3 repair rounds `120000`-`132100` (26) and the Release 1 completion batch `133000`-`138100` (7). With the four Album migrations not yet on `main`, the PR adds 87. Every one applies in order on a fresh stack. All are additive: new tables, columns, functions and policies, with RLS on and no direct table grants. Run them on staging first.

### Migrations that change existing data

| Migration                              | What happens to existing rows                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `100000_coverage_review_level`         | Every existing dish and place acceptance becomes **public** level (what acceptance meant until now). Each confirmed amenity Yes gets one carried-over accepted (public) photo decision on the photo Album shows today, so a slot filled today stays filled. Venues gain timezone (Europe/London), locality and operating status (open). |
| `101000_venue_memberships`             | Backfill: one open membership per active staff profile, and per manager with an open grant at their venue. A manager account without an open grant gets no membership (an admin re-grants).                                                                                                                                             |
| `102000_upload_pipeline`               | Raises the media bucket limit to 250 MiB. Existing previews and thumbnails are recorded as renditions with pipeline `legacy` and unknown size. Existing assets have no hash or capture time (unknown).                                                                                                                                  |
| `104000_facts_freshness`               | Seeds the 90-day check rule (14-day lead). **Answers last checked over 90 days ago now read Check due** and leave coverage until a manager says Still right. Guest Wi-Fi rule version 2: **a staff Wi-Fi Yes without manager confirmation now reads Unconfirmed.** Outdoor seating moves to the facility form (lossless).               |
| `109300_int_policy_evidence`           | Amenity catalogue version 2: six policy questions (Wi-Fi, dogs inside, dogs outside, live music, pub quiz, curbside pickup) need no photo. Existing answers keep the rule they were recorded under; every working slot records a catalogue change.                                                                                      |
| `117000_metrics_instrumentation`       | No ready time exists for older uploads: review delay falls back to the reserve time, and processing time is measured from now on.                                                                                                                                                                                                       |
| `121200_knowledge_rules_all_questions` | Every catalogue question without a knowledge rule gets rule version 1 (accessibility questions need a manager to confirm; others complete automatically) and a registry version. Questions such as pool table and darts can now join a venue's list and ask for a photo.                                                                |
| `125000_venue_status_backfill`         | A switched-off venue still marked open becomes **permanently closed** and archived. Not reversed on rollback (the earlier state was wrong).                                                                                                                                                                                             |
| `107200_admin_mfa`                     | No row changes, but **every admin session without a second factor loses admin rights** until the admin enrols an authenticator app at next sign-in.                                                                                                                                                                                     |
| `107000_privacy_colleague_media`       | No row changes; staff stop seeing colleagues' unreviewed photos (FA-20).                                                                                                                                                                                                                                                                |
| `103300_venue_scope`                   | Accommodation does not apply anywhere until an admin turns it on; no existing slot is removed.                                                                                                                                                                                                                                          |

Other migrations add tables or seed configuration only (export profiles, the settings row, freshness policies). Rollback notes are in each migration's header; most roll back by a forward migration re-applying an earlier function body.

### New scheduled routes (`vercel.json`)

`/api/internal/menus/activate-due` every 15 minutes (scheduled menus), `/api/internal/knowledge-rechecks` and `/api/internal/notifications` hourly. They use the existing internal cron protection.

## Owner actions before and after release

Ordered steps; none has been done by the build agents.

1. **Preview the facts change** on the hosted project with `knowledge_freshness_preview` before migrating, so you know how many answers will read Check due or Unconfirmed (S1-FACTS).
2. **Raise the hosted project's global upload limit** to at least 250 MiB; no migration changes it (S1-UPLOAD).
3. **Check TOTP MFA is enabled** in hosted Auth (on by default) and tell admins they will be asked to set up an authenticator app at next sign-in (S1-PRIVACY).
4. **Set the session expiry** for remembered devices in hosted Auth; it is a hosted setting, not code (S1-PEOPLE).
5. **Run the migrations on staging, then production, then merge**: the exact order and commands are in [full-app-v1-owner-steps.md](full-app-v1-owner-steps.md).
6. **Check manager grants.** A manager account with no open grant at its venue (already "access ended" today) gets no membership from the backfill; re-grant any that should still manage.
7. **Set each venue's main reviewer** (admin only) and choose any **single-reviewer** venues (FA-9). Until a venue is single-reviewer, nobody there can decide on their own photo.
8. **Turn on accommodation** for venues with rooms (Venues › scope), with a reason.
9. **Restore rehearsal** (AC38) against a hosted project needs your approval (S1-OPS; `docs/backup-restore.md`).
10. **Next.js security notice.** `next build` sometimes stopped with "known security vulnerability … upgrade Next.js" and passed on retry (S1-PRIVACY, S3-R3, S3-R5, S3-R6, S3-R8, S3-R11). No dependency was upgraded; decide on the upgrade.
11. **Performance and pilot.** No real-device or 4G measurements were taken (spec §15.2, §15.3, §21). Run the pilot measurements on real phones.
12. **Review the decisions marked review** in `decisions.md` (FA-20: staff see colleagues' photos only once accepted).
13. **Review the five default shot templates** (Settings › Shot templates) and adjust the wording to your venues (FA-52).
14. **Mark packaged drinks** (bottled and canned) on each venue's menu, and Photo wanted where you want one; coverage totals change only for the items you mark (FA-51).
15. **Import existing photos** with `pnpm import:legacy`, on staging first, dry run first ([legacy-import.md](../legacy-import.md), FA-54).

## Release 1 completion (FA-51 to FA-54)

- **Packaged drinks (FA-51).** Managers and admins can mark a menu item or local offering **Packaged**. A packaged item is optional (listed, takes photos, never counted as empty or in a total) unless it is also marked **Photo wanted**. Nothing changes until someone marks an item.
- **Shot templates (FA-52).** Admin **Settings › Shot templates**: a short default instruction per category, with an optional example photo. Staff and reviewers see the request brief first, then the manager's section brief, then the template. Seeded with plain defaults; review them before release.
- **Installable app (FA-53).** A web app manifest and icons. Me › Help offers **Add to home screen** where the phone's browser supports it, and iPhone steps on iOS. No service worker; browser use is unchanged.
- **Legacy import (FA-54).** `pnpm import:legacy` brings existing originals in as **awaiting review**, with exact-duplicate skipping and capture dates kept or left unknown. Dry run by default. See [legacy-import.md](../legacy-import.md).

These add no change to existing rows; `20261118134000_shot_templates` seeds the five default templates and `20261118132000` lets the venue template offer active checks never on the working list.

## Known limits

- **Partly built** (36 rows in the checklist), among them: there is no admin upload screen (admins upload only through the database rule); an admin's original download is not recorded as an export; imported price context records no authority.
- **Navigation:** Albums, all-venue Coverage and admin Metrics are reached from Overview links and have no nav item. The other wording seams the docs check found were fixed in repair round 3 (S3-R12 to S3-R14).
- **Next batches:** design system v2 (owner decision, 18 Nov 2026); I'm not sure in Me's Change slot, a sending percentage on Album tiles, and Not here dishes on the Match board (S3-R12 deferred items).

## Deferred to Release 2

| Decision | Deferred                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------- |
| FA-40    | Live destination adapters (website, Google Business Profile); publishing is manual export and record |
| FA-41    | Same dish on several menus (one active menu per venue), cross-venue reuse, a group catalogue         |
| FA-42    | Edited versions and crops, video posters and previews (needs a media worker); originals are kept     |
| FA-43    | Push notifications and email digests                                                                 |
| FA-44    | AI label suggestions and PDF or image menu extraction                                                |
| FA-33    | An organisation table (one implicit organisation until a second customer)                            |

Acceptance checks AC20, AC22 and AC33 are deferred by these decisions; each has an e2e spec that pins today's behaviour. AC04 holds because there is no AI to be unavailable.

## Verification

On the final head `428b8c90e` (fresh isolated stacks): typecheck clean; ESLint exit 0; `pnpm test` 430 files, 5266 tests passed; the full security suite 115 files, 1640 tests passed; the e2e suite on Chromium ran all 76 spec files: 305 passed, 0 failed, 28 skipped by design (opt-in visual and phone-only specs). AC01 to AC40 and their specs are in the [checklist summary](../plans/full-app-v1/checklist.md#acceptance-criteria-ac01-to-ac40). Formal CI (`pnpm verify:release`) runs once on the pushed PR head; its result is recorded in the PR. Release steps for the owner: [full-app-v1-owner-steps.md](full-app-v1-owner-steps.md).
