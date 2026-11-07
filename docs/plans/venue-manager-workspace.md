# NabaLens venue manager workspace

**Status** · Phase 1 (manager accounts, admin conversion, the `/manager` shell) and Phase 2 (item photo review: Overview, Review, Menu, contributor view and the admin Review page) are built on branch `claude/nabalens-manager-workspace-455c31` and verified on local isolated stacks ([evidence](../release/2026-11-07-manager-workspace-evidence.md)). Not merged or released; hosted checks follow an authorised release. The cut-over migration that retires legacy staff-held grants is not part of Phase 2. The product rules below distinguish agreed scope from proposed first-release defaults.

## Outcome and scope

A venue manager signs in, sees where their venue stands, reviews staff contributions, and gets every item on the active menu to an accepted photo. The manager has one workspace, one assigned venue, and no staff mode or photo upload capability. Staff continue to build their own portfolios from what they cook, make, or capture during a shift. The menu gap list is shared context for staff and managers.

The first release concentrates on **Overview**, **Review**, and **Menu**. Account settings provide sign-out and basic personal details. A contributor name on a review can open a venue-scoped list of that person's contributions. A standalone team directory, targets, checklists, amenities management and public publishing are outside the first release. Existing records for those workflows remain available to admins according to existing policy.

## Current repository and dependencies

- Today the app routes signed-in users by a staff/admin role. An effective manager is an active staff member with a grant for their current active venue. The existing manager screens are nested at `/staff/manage` and use the staff shell. Both the scope helper and database grant predicates assume this relationship.
- The current review queue works with submitted coverage photos. Section coverage can accept unlabelled images and measures distinct accepted photos against a section target. Existing manager controls also include attachment of ready media, checklist setup and monthly targets.
- The catalogue has stable venue-specific item and variant IDs, version-specific entries, and active menu versions. Media labels already record catalogue associations and preserve the label context from upload. Use these as the source for the item workflow.
- Coordinate the item acceptance schema and rules with [Staff portfolios and menu photo completion](./staff-portfolio-and-menu-completion.md). Both workspaces must read the same item status and totals. Build one implementation of eligibility and item completion. Verify the staff work against the integration branch before depending on it.

## Manager journey and screens

### Sign-in and shell

Use the shared email link and code flow when available. A valid manager session with an effective venue grant lands at `/manager`. Put the venue name in the shell and use **Overview**, **Review**, and **Menu** navigation at every width. A manager has a single venue context throughout. If the grant ends, show **Venue access unavailable** with a way to sign out and guidance to contact an admin.

The manager shell contains previews, review actions and account settings. It has no staff Add provider, photo picker, contribution prompts, portfolio, or organisation-wide Photos or People navigation. Legacy manager links can redirect to their equivalent screen after a fresh scope check. A stale or inapplicable link leads to a safe workspace page or a scoped unavailable state.

### Overview

Lead with **Menu photos · 24 of 38 items covered**, then show the number of items awaiting a decision, items with no ready candidate, and the oldest pending review. Link each count to the matching filtered view. Give the manager one primary action, **Review photos**, when there is work waiting. If all items are covered, show **Every menu item has a photo** and allow reviewing newer alternatives.

Distinguish menu setup pending, an empty eligible menu, a quiet queue, and a failed data request. A manager can review accessible historical contributions after a menu change, while any acceptance must resolve against the current menu.

### Review

Offer a default queue for ready, venue-scoped photos with a current item association, oldest pending first. Group photos for the same item when helpful, with filters for section, contributor and status. Offer an **Unlabelled photos** filter so managers can find usable images already contributed at their venue. Include labelled older uploads as candidates. Processing, failed, deleted and inaccessible media are ineligible.

A review shows the preview, contributor, upload date, staff label, active menu item and variant where relevant. It supports these actions:

| Action | Result |
| --- | --- |
| **Accept for this item** | Record an item-photo decision. The first qualifying photo makes the item covered. |
| **Set as menu photo** | Choose the preferred image among eligible accepted options. The previous image remains available as an accepted alternative. |
| **Choose a different menu item** | Record a reviewer-confirmed association for this decision, with a reason when correcting a staff label. Preserve the original staff label and attribution. |
| **Ask for another photo** | Require a short reason tied to the contribution and item. Show it in the contributor's existing follow-up area if they can still act at this venue. Keep the item open unless another accepted image covers it. |
| **Withdraw acceptance** | Require a reason. Use another eligible accepted image if there is one, or reopen the gap. |

A historical contribution from a converted manager remains attributed to them. Require another authorised reviewer for their photo. If a contributor has left or moved, allow eligible historical photos to be reviewed for the upload venue, subject to media retention and visibility policy. Show an unavailable follow-up state and let other staff discover the gap through **Our menu**.

Keep the current preview pipeline and its access controls. Support large preview, keyboard navigation and visible focus. Keep the filter and scroll position after a decision and announce the result. If another reviewer changes the item first, show the updated decision and let the manager act again from the current state.

### Menu

Group the active catalogue by section and support item-name search. Each item has one headline state:

- **Has a photo** when an eligible accepted photo exists.
- **Awaiting review** when an eligible ready candidate exists and no accepted photo exists.
- **Still needs a photo** when neither condition holds.

Use pending replacements as a secondary indicator on an already covered item. An item detail shows the preferred photo, accepted alternatives, review candidates and relevant decision history. Show the menu title or activation date so the manager can tell which version they are working on. On activation, show what was carried forward and which items need a new decision.

## Item acceptance and progress

- Use distinct eligible stable item IDs from the active venue menu as the denominator. Start with one accepted still image per listed food or drink item. Track variant identity when known and show it during review. Variant-specific coverage can be introduced if the pilot identifies menu groups that need it.
- Accept a photo per item. Multiple photos of one item count once. A photo can cover multiple items only through individual review decisions where each item is clearly visible.
- An association can come from an eligible staff label or a reviewer-confirmed item. Keep the source and evidence separately. If the basis was a staff label and that label changes, send the acceptance for recheck or invalidate it. A correction with an explicit reviewer association has its own provenance.
- Progress depends on current eligibility. A lost asset, withdrawn approval, or inactive menu item drops out of the relevant count. Use an accepted alternative if the preferred image loses eligibility. Keep decision history and contributor attribution.
- Carry acceptance across menu versions only if the stable identity matches, the photo remains eligible, and the item did not materially change. Ambiguous matches and relevant variant changes go to recheck. Removed items leave the denominator. New items begin uncovered.
- Existing section acceptances and monthly credit retain their own meaning. Older media can enter the queue as candidates. A legacy section approval does not constitute item approval.
- Derive status on the server using the same read model for Overview, Review, Menu and the staff-facing progress card. Prefer bounded, indexed queries with cursor pagination over downloading the venue's full library. Invalidate the affected summaries and details after decisions, label changes, deletions and menu activation.

### Data and transaction design

Extend the shared item-photo review model with venue ID, stable item ID, asset ID, optional variant ID, decision state, decision source, relevant menu version or revision, reviewer and timestamps. Record reasoned changes in the audit trail and retain the contributor identity independently. Enforce one preferred eligible image per item and keep review decisions unique at their intended venue/item/asset grain.

Perform the authorisation check, active menu check, asset check, stale revision check, decision write and preferred-image update in one transaction. A request retried after a network failure must return the committed decision or detect a conflict without creating duplicate decisions or follow-ups. An admin action and a manager action share the same concurrency rules. Notification delivery, if added, should use a deduplicated event tied to the committed decision.

## Access and lifecycle

| Capability | Staff | Venue manager | Admin |
| --- | --- | --- | --- |
| Upload portfolio media and label own work | Own eligible media | No | Existing admin policy |
| Browse staff Photos and People | Existing staff scope | No | Existing admin scope |
| See item-level menu progress | Own venue | Assigned venue | Authorised venues |
| See review previews and contributor context | Own contributions and existing staff visibility | Assigned venue contributions | Authorised venues |
| Accept, correct associations, request replacements, choose preferred image | No | Assigned venue, subject to review rules | Authorised venues, subject to review rules |
| Assign roles or venues, activate a menu, access original downloads | No | No | Existing admin policy |
| Edit personal display details | Own | Own through account settings | Existing admin policy |

Use a distinct database-backed manager account classification and the existing auditable venue-grant concept. Adapt the effective grant rule to require an active manager account and one live grant matching its current active venue. Staff job titles and work profiles have no bearing on access. Only an admin assigns or removes manager access. Revocation blocks the manager workspace and never grants staff access by implication. Venue changes end the existing grant and require explicit authorisation for the new venue.

Enforce the boundary in the login destination, route guards, server actions, database functions and RLS. Audit every use of staff predicates, actor helpers, signing paths and profile role switches. Verify manager denial for direct upload reservation, signed PUT issuance, finalisation, label edits, staff work profile mutations, shared staff feeds and guessed IDs. Scope previews to the upload venue and use the existing private media delivery pattern. For uploads already authorised before a conversion, account for the expiry of signed PUTs, deny finalisation under the new role, and clean up stranded reservations through the existing lifecycle path.

## Migration and rollout

1. **Inventory dependencies.** Identify existing active, revoked and stale grants, their venue mappings, current use of the legacy manager screens, and in-progress work. Map manager-specific checks in database and application code, including triggers that revoke grants on a role change. Verify whether the existing manager-grant schema can support an atomic conversion or needs a compatible extension.
2. **Prepare additive changes.** Add the role, grants support, routes and policies with the new role unused until the compatible application is deployed. If PostgreSQL needs a separate committed migration before using the enum value, split the schema work accordingly. Regenerate database types and check compatibility with the staff portfolio branch.
3. **Build and verify a pilot venue.** Use an active menu, representative staff uploads, at least one eligible reviewer and an admin. Route both sign-in methods to the manager shell. Confirm no staff upload capability through routes, actions or database APIs.
4. **Convert approved accounts.** Admins review the exact account and venue list. Convert role and preserve or replace each effective grant atomically with audit history. Preserve the user's ID, historical photos, credit and review decisions. Leave invalid or ambiguous grants for explicit admin resolution. Do not elevate other staff with a manager job title.
5. **Cut over links and watch the pilot.** Check existing sessions, bookmarks, the retired staff Manage entry and old review URLs. Verify queue decisions and the displayed count against the active menu. Review the exact converted accounts and audit records before expanding.
6. **Prepare rollback before conversion.** Retain a compatible app revision that enforces manager denial on staff endpoints. Pause additional conversions if the workspace fails. Restore a working manager experience without silently restoring staff privileges. Any deliberate reversal of account classifications requires admin authorisation. Preserve all new review records.

## Verification and release evidence

- Load the **qa-with-e2e** skill for QA. Use the e2e runner for browser journeys alongside repo checks, and record actual roles, viewport, results and evidence. Use an isolated local stack for migration, access and media tests.
- Test a chef, a manager at venue A, a manager at venue B, an admin, a revoked manager and a converted staff account with existing media. Exercise link and OTP sign-in, wrong-role navigation, old bookmarks, stale sessions, direct server actions and database access with ordinary user credentials.
- Run a complete journey from staff upload and label to manager review, preferred-image selection and the updated staff progress card. Test unlabelled candidate review, corrected item association, contributor follow-up, withdrawn approval, multiple photos for one dish, concurrent decisions, and menu replacement.
- Confirm venue A cannot enumerate or preview venue B data by changing asset, contributor, review or item IDs. Check cache isolation and signed preview behaviour. Verify that a revoked grant and inactive venue block future reads and writes.
- Test mobile and desktop navigation, queue filters, long dish names, keyboard and touch review, empty/error states and large queues. Capture before/after evidence for progress totals, and separately record the checks performed on hosted accounts after authorised release.
- Run repository lint, typecheck, unit, integration, migration, security and applicable browser checks. Keep one bundled PR for the work. Rebase on the latest default branch and run `~/.local/bin/lci run <profile> --pr N --post --comment` once on the final head. Apply hosted migrations within the authorised merge/release sequence after verifying the target and compatibility.

## Pilot outcomes

For the pilot venue, record the active menu item count, covered count, pending review age, and how often photos need a label correction or replacement. Observe a manager finding the next gap and approving a suitable photo from the existing staff library. Verify that the manager can complete that workflow without ever entering a staff screen and that the staff portfolio remains independent.

The initial product choices to validate are one photo per listed item, a venue-scoped contributor view inside Review, and using the existing follow-up area for replacement requests. The manager-only access decision is fixed.

## Phase 2 decisions

- **Unlabelled photos** ships, limited to ready images at the upload venue with no item label that staff tagged as food or drink, for manager accounts and admins only.
- **Admin self-review** stays allowed. Manager accounts never decide their own photos.
- **Leavers' photos** stay admin-only, consistently for review, withdraw and choosing the menu photo.
- **Hosted migration order:** the staff portfolio branch's `20261106130000_menu_item_photos` must be on the target before `20261107100300`–`20261107100500`.
