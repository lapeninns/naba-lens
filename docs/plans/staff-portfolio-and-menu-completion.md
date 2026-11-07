# Staff portfolios and menu photo completion

**Status** · Implementation proposal. Product rules below are proposed defaults for the first release.

## Product goal

Staff build a record of what they make and capture at work. Their venue builds a library with a usable photo for every item on its active menu. The daily flow starts with what staff already made or photographed during a shift. A shared menu view gives anyone who wants to contribute a way to see which items still need photos.

A chef should be able to sign in, choose a photo, label it with the dish they made, and find it in their portfolio in one visit. A reviewer should be able to see the same photo, confirm what it depicts, and make it count toward the venue goal without assigning a task first.

## Staff experience

| Surface | First release behaviour |
| --- | --- |
| Sign in | Enter email once. The email contains a sign-in link and a one-time code. The waiting screen lets staff enter the code, resend, or change email. |
| Home | Show a broad contribution prompt based on the work profile, a primary **Choose from your photos** action, and a secondary **Take a photo** action. Show **Our menu** progress for the current venue and a link to browse it. |
| Start here | Explain what the portfolio is for, offer work profile setup, then open the photo picker. Provide **Skip for now** and a way back from **Me**. Existing staff can open the guide on demand. |
| Add | Open the same library-first picker and upload queue from Home, welcome and the global Add control. Honour unfinished uploads and use the same priority on existing task submission screens. |
| Me | Show the staff member's role, venue, optional profile photo, and their own recent work. Provide direct actions to edit work details and add or correct photo labels. |
| Our menu | Show the active venue menu grouped by section. Let staff search and filter to **Still needs a photo**. A tap on a dish may preselect it for upload when staff explicitly choose to contribute there. |
| Review | Let an authorised reviewer accept a ready photo for a particular item, ask for a better photo, or undo acceptance with a reason. Show the item, variant, upload venue and contributor. |

### A first contribution

1. A chef signs in and sees **What did you cook today?**
2. They choose three photos from their phone. Two show the same curry and one shows a special.
3. The existing queue processes the files. The chef can label ready files together and adjust the special individually. A failed file can be retried without uploading its successful siblings again.
4. The chef finds the photos in **Me**. They can save the special through the existing item suggestion route and return later to finish labels.
5. A reviewer accepts one of the curry photos for that item. The venue gains one covered item. Both photos remain in the chef's portfolio.

Use **Saved to your portfolio**, **Ready to label**, and **Accepted for menu use** for the separate milestones. Existing ready media can also appear in the internal Photos feed under its current visibility rules. Menu acceptance is an internal review decision. Any public publishing workflow would require its own decision and release.

## Work profile and personalised prompts

Ask **What do you do at [venue]?** Show the current name and venue. Ask for one main job role and allow optional additional work areas. Saving the main role completes the work profile. A profile photo stays optional, and staff can edit or skip the form. Where staff already have a department or title, prefill values that can be matched reliably and let them confirm. Preserve unfamiliar titles and offer **Other** with a short title.

| Example job role | Home prompt | Helpful picker order |
| --- | --- | --- |
| Head chef, sous chef, line chef, kitchen team | What did you cook today? | Food sections, then the full menu |
| Curry chef | What did you cook today? | Curries and associated sides first |
| Tandoor chef | What did you cook today? | Tandoori dishes and breads first |
| Middle man / plating | What did you plate today? | Finished dishes and plating labels first |
| Bartender, bar team | What did you make at the bar today? | Drinks first, with venue and event labels available |
| Waiter / server, host | What did service look like today? | Table setups, dining areas, food as served and events |
| Manager, venue team | What did you capture around the venue today? | Amenities, dining areas, events and venue details |
| Other or profile skipped | What did you make or capture today? | Full menu and general labels |

Use stable keys for the initial role options and editable display titles where useful. Confirm the kitchen's preferred wording for **Middle man / plating** with pilot staff. Where menu section names vary, use known section kinds or an explicit mapping and fall back to the normal menu order. Search always covers the full eligible catalogue. Choosing a role only influences prompts and picker order. Staff can contribute across areas, and their role never supplies a photo's dish label automatically.

Treat self-described job details as separate from app access, manager grants, venue membership, and any manager-maintained department used for reporting or assignments. Audit the existing consumers before reusing the current department field for self-service. Validate allowed profile fields server-side and prevent the profile form from changing administrative fields. Keep profile visibility within the existing staff directory boundary.

## Menu photo rules

### What counts

- Use the active venue catalogue and count distinct eligible stable menu item IDs. Display covered items over the eligible total with section breakdowns. Include food and listed drinks. Amenities and service photos can appear in portfolios and existing coverage views.
- Count one item once when it has at least one ready, accessible still image explicitly accepted for that item by an authorised reviewer. An upload, a label, a menu suggestion or an existing section acceptance alone adds zero to this measure.
- Start with one photo per menu item for the headline goal. Capture variants where the catalogue supports them and show variant details in review. For example, one accepted chicken Korma photo covers the Korma item under this rule. It gives no implied approval to the lamb variant.
- Permit multiple labels for accurate discovery. Review decisions target individual items, and a reviewer may count a photo for several items only if each is clearly shown and individually accepted.
- A newer image can become the preferred image for an item while the previous one remains in the portfolio. Start with one designated primary per item and allow other accepted options. If a primary is removed, select another eligible accepted image or reopen the gap.
- Removing an asset, removing or changing the relevant label, withdrawing acceptance, or losing asset eligibility invalidates its contribution. Recalculate progress when any of these changes. A deleted photo stays absent from both the count and previews.
- On menu activation, carry acceptance only where the stable item identity persists, the label and asset still qualify, and the item remains materially the same. If reconciliation flags an ambiguous match or a material change, send it for review. Removed dishes leave the active denominator and keep their historical portfolio labels. New items start with a gap.
- Missing menu, empty menu and temporary load failures have distinct states. Use **Menu photos will appear once your venue’s menu is set up** for an unconfigured venue. Staff with upload access can still contribute to their portfolio.

### How review fits the current model

The existing menu coverage plan is section-based, and accepted section photos can be unlabelled. The current label model already supports stable item IDs, variants, snapshots, batch labels, and off-menu suggestions. Build item completion from the catalogue and existing labels, with an explicit item-photo acceptance record. Keep the existing monthly and section measures distinct and label them clearly wherever both appear. Review a portfolio contribution without requiring an assignment or rewriting historical credit.

Prefer an additive relation keyed by venue, item and asset, with optional variant context, reviewer, decision timestamps and revision or equivalent audit metadata. Use a transaction for eligibility checks and review mutations. Validate access against the existing database-backed review scope and apply the current rules for self-review. Make repeated actions safe and report a stale decision if two reviewers act on the same item at once. Use the original upload venue when labelling or reviewing transferred staff members' historical photos.

For existing media, surface valid labelled images as review candidates. Managers can confirm the best image from those candidates. Unlabelled photos can be labelled first, with no image or label inferred from filenames, job titles or old section assignments. Scope summaries and previews to the caller's authorised venue, with paginated candidates and indexes supporting the item and asset lookups.

## Sign-in and recovery

- Add the one-time token to the existing Supabase sign-in email and retain the current confirmation page and user-initiated verification step. Verify codes using the requested email and the provider's email OTP flow. Both paths converge on the same session and database-backed staff access checks.
- Preserve invite-only account creation behaviour, existing CAPTCHA checks on email requests, generic email-request responses, and provider throttles. Keep codes out of URLs, logs and analytics. Use one accessible code input that supports paste and mobile autofill. Check the configured token length and expiry in each environment before shipping copy.
- Cover stale and used codes, wrong codes, cooldown, changed email, delayed delivery and opening the link in a different browser. Verify single use across both redemption methods. Show a retry path and make it clear which email request is current.
- Keep invitations and return sign-in as separate templates and journeys. Verify that a newly invited staff member can activate their account and then use either sign-in method. Confirm the template deployment order so staff see the code field and receive the matching email at rollout.
- Include code entry in the upload session-recovery design. A staff member should be able to restore their session in the same tab and resume the existing queue under the same identity. Continue to handle a changed identity, expired reservation and revoked venue access through the upload guards.

## Delivery sequence

Work through these slices locally and bundle them into one repository PR under the shared runner policy.

| Slice | Work and exit condition |
| --- | --- |
| 1. Reproduce and simplify entry | Trace the reported Start here behaviour on the current build with new and returning staff. Check route access, welcome dismissal, direct profile links and Add context. Make welcome re-openable and prove its primary actions reach the intended screens. |
| 2. Photo library first | Align global Add, welcome, portfolio and existing task submissions. Reuse the existing picker, processing, progress and retry path. Verify picker cancellation, mobile file selection, camera, mixed outcomes and preservation of queued uploads. |
| 3. Email sign-in | Add the combined template and code-entry UI, then run real local email journeys for both methods and interrupted-upload recovery. |
| 4. Work profile and Home | Add self-service work details and role-aware prompts, with generic defaults and a direct profile setup route. Reuse the label picker for batch and per-photo labels. |
| 5. Our menu and item review | Add the venue-scoped item read model, explicit acceptance, gap list and reviewer candidate view. Verify the rules with existing media, version changes and concurrent review. |
| 6. Pilot and rollout | Use one venue with an active catalogue, chef, front-of-house contributor and authorised reviewer. Walk through sign-in, first contribution, a review and a changed menu item. Expand once the end-to-end workflow and coverage count are verified. |

## Verification and release evidence

- Read the relevant local Next.js guides before implementation and the **qa-with-e2e** skill before QA. Use the e2e runner for applicable journeys alongside the repository checks. Keep actual journey results, viewport, fixture and evidence links. Record device or provider gaps separately.
- Use an isolated local Supabase stack with Mailpit, two venues, staff in several roles, a scoped reviewer and an admin. Seed an active menu with variants, a revised menu, a venue without a menu, and labelled and unlabelled legacy photos. Include an inactive or unassigned staff state and a transfer case.
- Verify real email delivery and both redemption paths in the local stack. Verify invite activation, CAPTCHA handling, resend, invalid and used tokens, upload recovery, direct welcome entry, resume after skipping, and profile edit permissions.
- Run an end-to-end sequence on narrow mobile and desktop from sign-in to portfolio to item acceptance. Include multi-select, per-file adjustments, off-menu suggestions, partial upload failure, reload and old menu data. Check focus, keyboard use, screen reader status announcements and narrow layout. Check native photo library and camera on iPhone and Android during the pilot and record which devices were used.
- Verify server and database boundaries. Staff cannot edit another person's profile, change access, review another venue's photos or write cross-venue labels. Test acceptance, withdrawal, duplicates, concurrent review, primary photo replacement, menu activation, removed media, and unchanged monthly and section totals.
- Run lint, typecheck, unit, integration, migration and relevant repository browser and security checks. Rebase onto the latest default branch and run the configured `~/.local/bin/lci run <profile> --pr N --post --comment` once on the final head. Record the resulting head and evidence.
- For an authorised production release, verify the hosted database target and migrations in the merge/release sequence, confirm hosted template configuration and test with controlled pilot accounts. Keep migrations compatible with the previous app revision so a UI rollback can preserve profile and review data. Pair any template rollback with a compatible sign-in screen.

## Pilot measures and decisions

Track the path from successful sign-in to first ready photo, first menu label and first item acceptance. Compare covered items with the active menu total and track pending review age so upload volume does not hide a review backlog. Ask pilot staff whether their role fits, whether the right dishes are easy to find, and whether they can explain the difference between saving a photo and getting it accepted for the menu. Keep email addresses, OTPs and photo contents out of measurement events.

Before finalising the schema and pilot copy, confirm the job vocabulary with staff and whether any menu groups need variant-level coverage or exclusion from the headline total. The proposed starting rule is one accepted still image per active listed food or drink item. Managers can continue to run existing assigned checklists alongside the portfolio flow.

## Repository references

- `app/staff/tasks/page.tsx` and `app/staff/tasks/welcome/page.tsx`
- `app/staff/_shell/add-host.tsx` and `app/staff/staff-portfolio.tsx`
- `components/nabalens/edit-profile-dialog.tsx` and `lib/auth/profile.ts`
- `supabase/templates/magic_link.html` and `app/auth/confirm/verify/route.ts`
- `lib/server/coverage/menu.ts`, `lib/server/coverage/staff.ts` and `lib/server/coverage/review.ts`
- `supabase/migrations/20261030120000_menu_catalogue.sql` and `supabase/migrations/20261030120100_media_labels.sql`
- `docs/usage-staff.md`
