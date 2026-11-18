# Naba-Lens — Full App Specification

**Staff, manager and admin experiences**  
**Version:** 1.0 — 17 November 2026  
**Status:** Proposed product and implementation specification  
**Initial operator:** Lapen Inns

This document specifies the intended application. It does not claim that any feature has already been implemented or tested. Existing repository, integrations and production data must be inspected before implementation; retain working components that meet these requirements. Numeric limits and timing targets below are proposed starting defaults, not measured results.

## Contents

- [Product goal and approach](#1-product-decision)
- [Terminology and completion](#2-terminology-and-completion-rules)
- [Roles and permissions](#3-roles-accounts-and-permissions)
- [Inventory and requirements](#4-venue-inventory-and-requirements)
- [Upload and labelling flows](#5-universal-upload-and-labelling-specification)
- [Staff screens](#6-staff-facing-screens)
- [Manager screens](#7-manager-facing-screens)
- [Admin screens](#8-admin-facing-screens)
- [Quality, facts and freshness](#9-quality-facts-and-freshness)
- [States and invariants](#10-state-model-and-invariants)
- [Data model](#11-data-model)
- [Uploads and media processing](#12-upload-service-and-media-processing)
- [Service contracts](#13-serviceapi-capabilities)
- [Exports and publishing](#14-export-and-downstream-publishing)
- [UX and performance](#15-ux-accessibility-and-performance)
- [Access, retention and operations](#16-security-retention-and-operational-controls)
- [Notifications](#17-notifications-and-operating-routine)
- [Metrics](#18-metrics-and-reporting)
- [Technical shape](#19-recommended-technical-shape)
- [Migration](#20-migration-and-initial-setup)
- [Delivery plan](#21-delivery-plan)
- [Acceptance checklist](#22-acceptance-checklist)
- [Implementation defaults](#23-decisions-fixed-by-this-specification)
- [Sources](#24-source-notes)

## 1. Product decision

Build one responsive application with three role-specific experiences. Staff use a simple phone interface; managers can work on phone or desktop; group admins have a desktop-oriented workspace that remains usable on smaller screens.

The product goal is:

> Every pub has a current, organised collection of approved photographs and short videos of what it serves and offers, accompanied by confirmed venue information, ready for the business to use.

The organising principle is a venue's actual offering: its current food, drinks, spaces and facilities. The staff interface helps people capture material quickly; the manager interface turns submissions into accurate, usable assets; the admin interface maintains the catalog and makes the approved collection useful across the business.

### 1.1 The improved approach

1. **Task-based capture:** a named item already supplies its venue, category and label. Staff take or choose media and submit.
2. **Quick capture:** staff upload first, then select a suggested existing label. They can submit as “I'm not sure” if necessary.
3. **Catalog-based organisation:** administrators and managers maintain records; staff do not invent a filing system.
4. **Human review:** managers correct labels, assess image suitability and confirm facts.
5. **Current coverage:** completion reflects usable approved material for the current offering, rather than raw upload totals.
6. **Business reuse:** authorised people can find originals, approved renditions and confirmed facts; downstream publication has its own status.

### 1.2 Product boundaries

The core includes collection, labelling, review, venue information, coverage, archive, export and the account controls needed for these workflows. Photos are the default requirement. Video is supported but is mandatory only where a requirement explicitly asks for it.

There is no guest-facing login in these three experiences. Venue websites and other publishing channels consume selected approved outputs. POS, reservations, payroll, rota management and review-response generation remain separate systems.

Automated labelling is optional assistance. Every essential workflow must work without an AI service. Public facts, food identity, dietary claims and accessibility claims must never be treated as verified merely because an image model proposed them.

## 2. Terminology and completion rules

| Term | Definition |
|---|---|
| Venue | One pub, with its own menu availability, spaces, facilities and memberships |
| Catalog item | An optional group-wide definition of a dish or drink |
| Venue offering | The specific dish or drink as served at a particular pub |
| Subject | A photographable venue offering, space, facility or other content item |
| Requirement | A specific piece of material needed for a subject, such as one website-ready dish photograph |
| Task | A request to help satisfy a requirement; a task is not a second copy of the requirement |
| Submission | A person's delivery of one or more media items with proposed labels |
| Asset | The original stored photo or video and its provenance |
| Rendition | A thumbnail, crop, edited version or delivery format linked to an original asset |
| Usage | An asset or rendition approved for a particular subject, revision and purpose |
| Fact | A structured answer about the venue, with conditions, verification and dates |
| Publication | A specific approved version delivered to a destination |

An item is covered only when every active required media requirement has a qualifying current usage. Optional additional angles do not hold completion below 100%.

An asset qualifies only if it is uploaded successfully, processed successfully, attached to the correct subject and current revision, approved for the requirement's purpose, within its applicable validity period and not withdrawn. A reference-approved image cannot satisfy a requirement for a public photograph.

Photo coverage and fact verification are separate. A confirmed “no” can resolve a guest question even when there is no relevant photograph. An unverified answer, an absent answer and a confirmed negative answer are distinct.

“Needs checking” means a confirmation is due. “Needs replacing” means known changes make the material unsuitable. Reconfirming an unchanged space can restore its current status without requiring another photograph.

## 3. Roles, accounts and permissions

### 3.1 Account model

- Users have individual accounts. Staff attribution must never depend on a shared login.
- Group admins manage the organisation and all its venues.
- Staff and manager permissions are assigned per venue. A person can manage one pub and be a staff contributor at another.
- The active venue is visible throughout capture and review. Changing venue filters existing permissions; it does not grant access.
- Only admins grant or remove manager/admin privileges. Managers can invite or remove ordinary staff within their assigned venues.
- Managers cannot remove a person's memberships at other pubs.
- Deactivating employment or access does not delete approved business assets.
- Require another active admin before removing the last active admin.

### 3.2 Sign-in and onboarding

Default onboarding uses an invited email address and a one-time code. The invitation binds an individual to approved venue memberships; a QR code or link can open that invitation but does not confer access by itself.

First sign-in shows the assigned pub, the person's role, a short demonstration of the upload flow and the contribution-use notice. Personal devices may remember the session subject to an organisation-controlled expiry. Provide an explicit shared-device mode that clears private cache on sign-out and does not retain offline drafts between people. Require MFA for group admins; support it for managers.

Do not demand camera access until the user chooses to take a photo or video. Photo-library selection must still work if camera permission is refused.

### 3.3 Permission matrix

| Action | Staff | Manager | Admin |
|---|---|---|---|
| View assigned venue's current public-approved album | Yes | Yes | All venues |
| View own submissions and feedback | Yes | Yes | Yes |
| View another person's unreviewed media | No | Assigned venues | All venues |
| Upload into a venue | Assigned venues | Assigned venues | All venues |
| Edit own proposed labels before a review decision | Yes | Yes | Yes |
| Change a label after review | Request correction | Assigned venues, audited | All venues, audited |
| Correct other contributors' labels | No | Assigned venues | All venues |
| Approve media or request another photo | No | Assigned venues | All venues |
| Confirm venue facts | Suggest a correction | Assigned venues | All venues |
| Create photo tasks | No | Assigned venues | All venues |
| Add a local special or change temporary availability | Suggest | Assigned venues | All venues |
| Edit group catalog or activate a replacement permanent menu | No | Propose changes | Yes |
| Invite ordinary staff | No | Assigned venues | All venues |
| Grant manager/admin roles | No | No | Yes |
| Select a primary image | No | Assigned venues | All venues |
| Download originals and create export packages | No by default | Assigned venues | All venues |
| Configure publication integrations or publish externally | No | No by default | Yes |
| Archive local media, tasks, ended specials or space/facility records | No | Assigned venues, with reason | All venues |
| Retire a permanent menu offering or its required photo | No | Request admin change | Yes, with impact preview |
| Permanently delete retained business files | No | No | Controlled admin action |

All permissions must be enforced on the server and on database/storage access. Hiding a menu option is not an access-control mechanism. A manager can use the staff capture screens without becoming a different user.

## 4. Venue inventory and requirements

### 4.1 Staff-facing categories

Use five familiar labels: **Food, Drinks, Spaces, Facilities, Other**. Events, seasonal decoration and team activity can be classified under Other and given more specific labels by managers.

Staff see relevant current records, not the organisation's entire catalog. Archive records remain available to managers and admins through an explicit archive filter. An assigned preparation task can expose a future-menu subject to staff as Upcoming; its preparation media stays outside the current menu album, current coverage and public selection until that menu becomes effective.

### 4.2 Default requirements

| Subject | Default required material | Optional material |
|---|---|---|
| Distinct food dish | One public-ready photograph of the actual current serving | Another angle, detail, short clip |
| Distinct prepared drink | One public-ready photograph of the actual serving | Pouring or preparation clip |
| Packaged drink | One relevant approved image when designated in the collection plan | Further angles |
| Bar, dining area, garden or room | One current public-ready overview | Alternative view, setup, atmosphere, walkthrough |
| Physical facility such as pool table | One clear current image where it helps guests | Detail or usage view |
| Entrance or access route | Evidence views specified by the manager for the precise route | Route video |
| Policy such as pet-dog areas or guest Wi-Fi | Confirmed fact; photograph only when useful | Illustrative space image |
| Event or seasonal setup | Requirements from its dated brief | Other campaign material |

Defaulting every food item to one mandatory public-ready photograph keeps the goal understandable. A second photograph, clip or format becomes mandatory only through an explicit requirement. One appropriate source can produce several crops.

### 4.3 Menu identity and changes

Permanent menus have versioned drafts and activation dates. Admins import or enter them, review additions/changes/removals and activate the intended version. OCR or extraction creates a draft only.

The same unchanged venue offering can appear on several menus without duplicating its asset requirement. Stable IDs survive renamed dishes and spelling corrections. Shared names alone are not proof that two items are identical.

For variants, require a separate photo when the normal visual serving changes materially. Different prices, service times or spirit measures do not automatically demand distinct photographs. Different plating, portions, ingredients or sides can.

A price-only change does not invalidate a photograph. A material presentation change marks the affected usage for replacement. Activating a new menu updates coverage and public eligibility transactionally.

Managers can create dated local specials and mark a dish temporarily unavailable. Specials expire or prompt review at their end date; temporary absence must not delete historical media. A permanent menu removal archives its requirement from current coverage.

### 4.4 Spaces and facilities

Managers confirm which standard checklist entries exist at their pub and can add a local space or facility. Record available, temporarily unavailable, not offered or not applicable with a reason where relevant.

Do not require bedroom photographs at pubs without accommodation. Do not let someone improve completion merely by excluding a real required item; scope changes require permission, reason and an audit record.

### 4.5 Same images across records or venues

One asset can support several requirements only when a reviewer explicitly confirms each match. An overview photograph must not automatically satisfy every facility visible within it.

Preserve the actual capture venue permanently. Group admins may propose reuse of a genuinely matching dish image at another venue; that venue's manager must confirm that the current serving matches, and the usage records the source venue. Never relabel provenance. Images of a different pub's entrance, garden or rooms cannot satisfy local space evidence.

## 5. Universal upload and labelling specification

### 5.1 Fields staff actually handle

The normal upload requires only an image/video and a selected existing subject. When launched from a task, the subject is already supplied. A category is a selection aid, not a mandatory second question if the subject is known.

| Information | How it is populated |
|---|---|
| Venue | Active authorised venue, prominently visible |
| Contributor | Signed-in account |
| Subject and category | Task context or selected catalog label |
| Requirement | Task context or resolved during review |
| Upload date | Server time |
| Captured date | Available metadata or optional correction; unknown is valid |
| File name and storage key | Generated by the system |
| Dimensions, duration, format | Extracted automatically |
| Caption, tags and alt text | Reviewer/export tooling; not required from staff |
| Optional note | Staff may add a short note |

Uploading today must not be represented as proof that an image was photographed today. Uncertain capture dates remain unknown until confirmed.

### 5.2 Route A: from a named task

1. Staff open a task such as “Chicken momo — photo needed.”
2. Show one short shot instruction, the intended subject and an optional approved example.
3. Choose Take photo, Record video where permitted, or Choose from phone.
4. Show thumbnails with the existing label, allowing removal or correction.
5. Submit; show per-file transfer progress and then a server-confirmed receipt.

No typing is required. Task ID and item ID travel with the submission. If that task has been satisfied meanwhile, accept a useful alternative without creating duplicate coverage or suggesting the staff member failed.

### 5.3 Route B: quick upload

1. Tap the persistent Upload action.
2. Take or choose media.
3. Choose a label from recent subjects, outstanding tasks and category-filtered search.
4. Confirm the thumbnail group and submit.

Show at most a few useful suggestions initially. Search should tolerate spelling variants and common approved aliases such as “momos” while showing canonical item names and distinguishing similar dishes. Recent labels must not be silently applied to unrelated pictures.

Provide “I'm not sure” as an explicit selectable label state. It sends the submission into Needs label for a manager. A short optional note helps, but is not required. This route neither creates a permanent catalog item nor completes a requirement.

### 5.4 Batch behaviour

Default maximum: 20 files per selection, subject to configured limits. A task-based batch inherits its task label and shows “These X files are labelled [item]” with Change labels / Several items for exceptions. Do not ask the person to choose the same label again.

For quick-upload batches, the app asks whether the selection is of the same item or different items.

For one item, staff select a label once and explicitly apply it to the visible group. For different items, they select thumbnails into groups and apply a label to each group. Groups have counts, thumbnails and a change-label action.

Show the number of unlabelled files. Staff can resolve these or submit them as Needs label. Never apply the first selected label to an entire mixed batch without an explicit action.

Each file has its own progress and retry state. A failure on one photo must not undo other successful files. Retrying a transfer must not duplicate the asset or the submission.

An illustrative batch might contain four photos of one dish, three of another and two of the garden. Staff label three groups, rather than enter nine descriptions.

### 5.5 Suggestions and automation

Deterministic suggestions from the chosen task, venue, category and recent activity ship first. Optional visual suggestions may propose only existing authorised subjects and must be confirmed by the user or reviewer.

Low-confidence suggestions appear as suggestions or remain unlabelled. AI must not invent a menu item, infer the venue from appearance, approve publication or confirm policy/accessibility/dietary facts.

Blur, darkness, resolution and possible-duplicate checks should offer useful feedback. Except for invalid or prohibited file types and hard size limits, these checks should normally allow “Send for review” so useful evidence is not discarded.

### 5.6 Drafts, retries and honest receipts

Distinguish “Saved on this device,” “Uploading,” “Uploaded — processing,” and “Sent for review.” Uploaded — processing means the server has validated and durably accepted the original and submission, but processing is incomplete. Sent for review requires successful required processing and an actionable review entry. A Processing failed state retains the accepted original and offers recovery; do not request another transfer of the same file by default.

Store local drafts and retry metadata where browser storage allows. Warn clearly if a selected file cannot be retained locally. When reopened, reconcile local state against server receipts before retrying.

Use foreground retry and resume as the reliable baseline. Background synchronisation is an enhancement where supported, not a promise that uploads will finish after the user closes the browser. Browser support and storage persistence vary [S3, S4].

On sign-out or venue-access removal, stop new transfers, prevent finalisation without fresh authorisation and clear private cached content according to device mode. Explain any unsent work before an ordinary voluntary sign-out. Never disclose the previous person's pending media to the next person.

## 6. Staff-facing screens

Mobile navigation: **Home / Upload / Album / My uploads**. Account, help and notification settings live behind the profile control. Use plain wording rather than exposing the domain model.

### S1. Home

Show the current pub and a prominent Add photos or video action. Under this, show any interrupted upload needing attention, then up to three relevant jobs with View all. Order jobs by explicit manager priority, overdue update requests and the user's preferred work area.

Job cards show the subject, brief instruction, state and action. An existing pending submission is visible as “Awaiting review”; another contribution is permitted but is not presented as an urgently empty slot.

Optional work-area preference: Kitchen, Bar, Front of house, All. This affects recommendations, not access. Lower on the screen, show venue coverage and a link to the album. Contribution feedback must not displace the upload action.

### S2. Upload

Use the shared flow in section 5. The camera/library chooser respects the selected task and returns to the same selection if the user cancels.

A batch belongs to one venue. Changing the venue before submission clears or revalidates every group label and shows the final destination. Once accepted by the server, a venue correction requires a manager/admin workflow; do not silently move a business record.

The confirmation screen shows venue, file count, thumbnails, visible label chips and the number awaiting manager labelling. Optional notes are collapsed. Submit remains available for explicitly unlabelled files.

### S3. Album

Show a visual grid of subjects with category filters and **Needed / Awaiting review / Approved / Needs updating / All**. Open on Needed from a collection prompt; preserve an intentional browsing choice.

A card shows the approved primary thumbnail when present, subject name, requirement status and pending count. A subject page shows the current public-approved material, brief and Add photo action. Staff can see another contributor's pending count without seeing their private unreviewed media.

Report a change opens a short choice: item no longer served, appearance changed, space unavailable, wrong label, other. The report goes to manager review and does not immediately change public information.

### S4. My uploads

Tabs or sections: Needs attention, Uploading/processing, Awaiting review, Reviewed. Each contribution shows its actual venue, thumbnail group, labels, dates and feedback.

Actions depend on state: resume, retry failed files, change an unreviewed label, withdraw an unreviewed submission, retake, or request correction. Use version checks for edits that could race with a manager's decision.

Review outcomes use human wording: Approved for public use, Kept as reference, Another photo requested, Label corrected, Archived or Not used. A retake opens the original subject and brief with the reviewer's exact reason. The new upload links to the earlier attempt rather than replacing its history.

“Your month” can be a compact summary here: required items covered and outdated photographs replaced. It is not a separate core navigation destination and does not rank staff.

### S5. Help and account

Show assigned venues, work-area preference, notification preferences, sign-out, short capture tips and a contact-manager route. Provide clear permission-denied and file-format help.

## 7. Manager-facing screens

Navigation: **Overview / Review / Album / Tasks / Venue**. The current pub is always visible. The manager can also open the staff upload interface with their own identity.

### M1. Overview

Show review backlog with oldest age, unlabelled submissions, missing required photos, material needing updates, facts awaiting confirmation and publication issues affecting the pub. Coverage shows counts and percentages separately for food, drinks, spaces and facilities.

Prioritise actions over charts: Review next, Check venue details, Request missing photos, Resolve outdated public content. Expose the active menu and assigned main/backup reviewers.

The dashboard must distinguish a collection problem from a review backlog. Fifty files awaiting approval must not look like staff have supplied nothing.

### M2. Review inbox

The main queue includes Needs label and Awaiting review; uncertain submissions must not disappear into a separate forgotten backlog. Default sort is oldest ready submission, with urgent-task filters. Filter by category, task, contributor, age, video/photo and possible duplicate.

Review detail shows:

- Large preview of the exact rendition being reviewed.
- Proposed subject, source task and current menu/presentation revision.
- Other images in the group and existing approved material for comparison.
- Contributor, upload time and capture date or Unknown.
- Technical flags, existing review history and optional note.

Actions:

| Action | Required result |
|---|---|
| Fix label | Correct the association immediately, retain the earlier proposal and notify the contributor without requiring another upload |
| Approve for public use | Confirm subject accuracy and suitability, resolve restrictions, create an auditable approval |
| Keep as reference | Retain useful evidence; leave a public-photo requirement open |
| Ask for another photo | Record a specific reason and reopen/create the linked retake request |
| Mark duplicate | Associate the existing authorised asset; preserve attribution without duplicate coverage credit |
| Archive/not used | Record why; preserve according to retention rules |
| Select primary | Choose one eligible public image for this subject and use |

Reviewers may fix a label and approve in one action. A label error is not a photo-quality rejection.

Reusable retake reasons include whole item not visible, insufficient light, out of focus, wrong current presentation, route not shown and public-use background issue. A short note can clarify.

Batch decisions show exactly the selected thumbnails and require explicit confirmation. Each item still passes its own permission, current-revision and public-use checks.

One manager approval is sufficient for ordinary public-use eligibility. A manager may review their own capture when operating a small venue; record the same contributor/reviewer identity accurately and allow admin spot checks. Staff-only accounts cannot approve themselves.

If a second reviewer has already changed the record, show the latest decision and require the manager to review it before replacing that decision.

### M3. Album and subject detail

Managers see current, reference, pending and archived material within their venue. Subject detail includes requirements, source files, approved versions, primary selection, linked facts, tasks and known usage destinations.

Actions include upload, create a request, select primary, correct a label, flag inaccurate material, archive, download/export and view where used.

Manager archiving is limited to local submissions/usages/tasks, ended local specials and local spaces/facilities with a recorded reason. Retiring a permanent menu offering or removing its generated requirement requires an admin-approved change. Managers can immediately suspend inaccurate media from public use while that request is pending.

“This no longer represents the venue” immediately excludes that usage from new public selection and creates update/withdrawal work for known destinations. Show separately whether the external copy has actually been changed.

Managers may download original files and create exports only within their venue. Public export defaults exclude private evidence and unreviewed material.

### M4. Tasks and shot lists

Create a media task from an existing requirement or a New brief. Required fields: subject, short instruction and intended use. Defaults: current venue, appropriate team, one photograph, normal priority. Optional fields: person, due date, reference image, orientation, requested video and suitable capture window.

A fact-confirmation task instead links to a fact record and is assigned to a manager/admin with verification permission. It completes through a confirmed fact revision. Staff can supply evidence or a change report, but those contributions do not complete verification and do not require public-use media.

Task types: missing photograph, replacement, optional angle, fact confirmation and campaign collection. A shot list groups a few tasks for a menu launch or a quieter service period.

States: Open, Submitted, Completed, Blocked, Cancelled. Claiming may be added as an optional time-limited signal; it must never prevent another contribution indefinitely.

Only approved suitable content completes a reviewed media task. A submission changes it to Submitted; a retake reopens it with the reason. Required items and optional creative requests remain separate in coverage.

Blocking capture because a dish is sold out does not remove its active requirement from the denominator.

### M5. Venue

Sections: Current menus, Local specials, Spaces, Facilities and policies, Team, Review assignments, History.

Managers can view active/future menus, request permanent catalog changes, create local specials with start/end dates, update temporary availability and apply audited local display-name overrides. Material appearance changes trigger image reassessment.

For spaces/facilities, managers confirm applicability and maintain precise descriptions. They can confirm facts with answer, conditions, source, date and next check.

Managers can invite/deactivate ordinary staff in their venue and nominate a backup reviewer from users who already hold manager permission there. They cannot grant manager rights or change another pub's memberships.

## 8. Admin-facing screens

Desktop navigation: **Overview / Venues / Menus & catalog / Library / Publishing / People / Settings & activity**. All urgent decisions remain usable on mobile.

### A1. Group overview

A table lists each venue's food/drink/space/facility coverage, confirmed fact coverage, unlabelled backlog, oldest review age, overdue checks and publication errors. Every number links to its underlying records.

Show blocked setup and operational exceptions first. Filters include venue, category, menu version and reporting period. Group progress is useful; staff league tables are not part of the product.

### A2. Venues

Create/edit a venue's name, location, timezone, operating status, menu assignments, reviewer responsibility and relevant checklist. All initial Lapen Inns pubs use Europe/London unless a future venue requires another timezone.

A setup checklist covers current inventory confirmed, main and backup reviewer selected, staff invited, spaces/facilities checked and first approved collection available.

Copying a template creates draft requirements. It must not copy confirmed facts, approval history or another venue's physical evidence.

Changing collection scope requires an impact preview and reason. Archive a closed venue while retaining its permitted history.

### A3. Menus and catalog

Support manual entry and CSV import in the first operational release. CSV columns include venue identifier, menu name, section, canonical/local item name, stable existing ID where available, variant and active dates. A downloadable template and row-level validation are required.

Import preview groups unchanged items, additions, suspected matches, changed presentations and proposed retirements. Resolve ambiguous matches before activation. Re-importing the same source/version must not duplicate records.

Activation can be immediate or scheduled. Future menus can have photos collected ahead of time without replacing current public availability.

The manager change-request queue allows approve locally, promote to group catalog, merge a genuine duplicate, ask for clarification or decline with reason. Show affected venues before editing a shared definition.

PDF/image menu extraction is a later convenience: extracted records remain a reviewable draft.

### A4. Library

Search across all authorised group material. Filters include venue, item/alias, category, active/archived, review eligibility, capture/upload date, contributor, orientation, media type, task, collection and usage destination.

Asset detail shows original provenance, exact renditions, labels and revisions, approvals, eligibility, required-item links, evidence links and exports/publication history.

Actions include select primary, add controlled tags, compare suspected duplicates, collect for a campaign, correct associations, download, export, withdraw, restore an archived record and request permanent removal.

Collections reference assets rather than duplicating files. Removing an image from a Christmas collection must not delete the venue's original.

### A5. Publishing

This screen is useful before integrations exist: it supports export packages, records manual handoffs and tracks destination status.

Admins configure venue-scoped destinations. Show exact content version, intended action, last successful result, destination URL/ID, retry state and outstanding work.

Public approval makes an asset eligible; publishing is a separate explicit operation. A ZIP download is recorded as Exported. Published by manual confirmation requires destination, URL/reference, date and confirming person. Integrated publication requires an acknowledged result.

Withdrawn internal content stops entering new exports/feeds immediately. Existing destinations stay Withdrawal pending until confirmed. Do not claim a downloaded copy has been recalled.

### A6. People

Invite, deactivate, restore access, assign venue roles, manage admins and reassign tasks/review responsibilities. Show effective privileges per venue to avoid a manager role becoming organisation-wide accidentally.

On departure, revoke access and reassign open work. Accepted assets, provenance and review history remain. Only personal local drafts that were never submitted may be unavailable to the business.

### A7. Settings and activity

Settings include categories/aliases, shot templates, media limits, review reminders, retention, allowed export formats, quiet hours, integrations and account controls. Protect secrets outside ordinary editable text fields and logs.

Activity records actor, venue, action, object, old/new revision, reason and timestamp for important changes. Operational monitoring covers stuck processing, failed exports, failed destination updates and storage consumption.

The server must not imply it can inspect files that exist only as unsent drafts on a staff phone.

## 9. Quality, facts and freshness

### 9.1 Review criteria

Public-use approval checks that the subject is correctly identified, the content reflects the normal current offering, the requested view is useful, focus/light/framing meet the intended purpose, and any visible people or personal information have been addressed under the group's publication policy.

A technical processing error is not a rejection of the staff member's photography. File validation and editorial decisions have different messages and metrics.

Keep the exact uploaded original private and immutable. Corrections to light, crop or presentation produce a linked version. Changes that materially affect what appears in the picture require review of that new version. Mechanical resize, encoding and format conversion may inherit eligibility through a versioned approved transformation policy, provided they do not alter visible content.

The default public-photo brief is a clear, truthful photograph of the normal serving or space. Do not require professional studio photography before accepting a useful contribution. Google similarly advises business images to represent reality and avoid significant alterations [S6].

### 9.2 Fact examples

| Question | Useful structured information | Verification boundary |
|---|---|---|
| Where are pet dogs welcome? | Answer, permitted areas, conditions, effective date | Confirm policy; an animal in a photo does not establish it |
| Is guest Wi-Fi available? | Availability, areas, access conditions, check date | Confirm actual guest provision; do not infer from a router |
| Is an entrance step-free? | Specific entrance, route, destinations reached, limitations and relevant measurements | Do not expand an entrance answer into an entire-building accessibility claim |
| Is the garden open? | Operational state, effective dates, restrictions | An old summer photo does not establish current opening |
| Is there a pool table? | Availability, area, charges/conditions where relevant | Photograph and operational confirmation can support the answer |

Facts have explicit source types such as manager inspection, approved operating policy or another authoritative business record. A photograph may support a fact without being its complete source. Detailed factual access descriptions are consistent with VisitEngland's approach to accessibility information [S7].

Food allergens, dietary suitability, live stock levels and prices are not generated from photography. If imported for context from another system, record that source and its authority separately.

### 9.3 Freshness policy

Use change-triggered checks first. New plating, renovations, closed areas and changed policies immediately create reassessment work. A menu rename or price correction alone does not require another photo.

Proposed routine reminder: 90 days for venue spaces and facilities/facts, configurable by subject. Menus are checked when changed and through a lightweight monthly manager confirmation. These reminders ask whether the material remains accurate; unchanged content can be reconfirmed.

To remove ambiguity:

- **Current:** compatible with the active subject and all required checks complete.
- **Review due:** a scheduled check is overdue; this is not a statement that the content is false.
- **Needs replacement:** a known change or quality issue makes the current usage unsuitable.
- **Expired/withdrawn:** past an explicit end date or deliberately removed from eligibility.

Review-due material is excluded from the current-coverage numerator and from new public-ready exports/automated selections until reconfirmed. It remains visible to authorised staff for action. Existing destinations receive a check/update task; the app must show their last acknowledged live version rather than pretend a calendar reminder removed it.

Automated guest answers use only currently confirmed facts. For an overdue/unknown answer, return an explicit unavailable/unconfirmed state to the consuming service; do not turn a previous yes into a no.

Known inaccuracies, withdrawal or explicit expiry stop new public use immediately and create removal/replacement work for all known destinations. First-party website integrations must honour those changes within their declared refresh window.

## 10. State model and invariants

Do not implement one overloaded status column for the whole process.

| Dimension | Core states |
|---|---|
| Transfer | Local draft, Queued, Uploading, Uploaded, Retry needed, Cancelled |
| Processing | Waiting, Processing, Ready, Failed |
| Labelling | Unlabelled, Proposed, Confirmed, Correction requested |
| Review of a usage | Awaiting review, Reference approved, Public approved, Retake requested, Not used, Withdrawn |
| Requirement coverage | Missing, Pending, Covered, Check due, Replacement needed, Inactive |
| Fact verification | Unconfirmed, Confirmed, Check due, Superseded, Withdrawn |
| Publication | Not selected, Exported, Queued, Published confirmed, Update pending, Withdrawal pending, Withdrawn confirmed, Failed/unknown |

Answer values such as Yes, No and Limited are separate from a fact's verification state.

Required invariants:

1. Approval identifies the exact subject, presentation revision and canonical asset/rendition, plus any permitted mechanical derivative policy.
2. A newly edited or relabelled asset does not inherit unrelated approval silently.
3. One effective primary image exists per subject and intended public use. Changing it is atomic.
4. A reference image cannot close a public-photo requirement.
5. A task is completed by approved fulfilment, not by a local upload attempt.
6. A retired offering leaves current coverage without losing its history.
7. Temporary sold-out status does not erase a required photo from coverage.
8. A declined, absent or non-applicable facility is not a permanently empty mandatory photo slot.
9. “Approved” does not mean “Published”; “Exported” does not mean “Installed on a website.”
10. Local drafts and stored originals never enter public feeds merely because they exist.

## 11. Data model

These are domain responsibilities, not a requirement to create a separate table for every row. Use ordinary relational records and derived views where appropriate.

| Record | Minimum fields/responsibility |
|---|---|
| Organisation | ID, name, policy settings, active state |
| Venue | Organisation, ID, name, locality, timezone, operational state |
| User and membership | Identity, venue/organisation scope, role, active state, invitation status |
| Catalog item | Stable ID, canonical name, aliases, category |
| Venue offering | Venue, optional catalog ID, local name, presentation revision, availability |
| Menu and menu version | Venue, menu identity, draft/effective/retired state, start/end, import source |
| Menu entry | Version, offering, section/order, any authoritative contextual source |
| Subject | Venue, type, offering/space/facility reference, label, aliases, active state |
| Requirement | Subject revision, purpose, required view/type, quantity, mandatory flag, effective dates |
| Task/brief | Requirement or fact, short instruction, team/person, priority, due date, status |
| Upload batch/item | Stable client IDs, venue/user, expected file properties, transfer/processing state |
| Asset | Immutable original key, source provenance, uploaded/captured dates, hash, actual format/size |
| Rendition | Asset, transformation/version, object key, dimensions/duration, canonical approval linkage |
| Submission and usage | Asset/rendition, proposed/confirmed subject, requirement, note, review cycle |
| Review decision | Actor, exact version, decision, reason, timestamp, previous decision |
| Venue fact/version | Key, answer, conditions/area, source/evidence, verifier, dates, effective state |
| Collection | Name/purpose and references to selected assets |
| Export/publication | Exact versions, destination, requested action, acknowledgment, external URL/ID |
| Audit/notification/job | Actor/context, event or job identity, state, attempts, version and timestamps |

Use stable IDs instead of filenames to connect records. All scoped records carry or derive organisation and venue ownership. Ordinary associations stay within the same venue. Explicit cross-venue usage records are permitted only within the same organisation through section 4.5's approval process. They preserve the source venue and grant the destination access only to the approved rendition/use, without exposing private source metadata, pending submissions or restricted originals.

Maintain original contributor attribution and recorded source venue. If the source venue was genuinely entered incorrectly, only an admin can apply an audited correction with a reason; retain the original declaration, suspend affected approvals and re-review. This is a correction of a mistake, never a way to fabricate capture provenance for reuse.

Store uploaded time independently of captured time and preserve whether capture time was supplied, read from metadata, estimated or unknown. Display dates in the venue timezone; store unambiguous timestamps.

## 12. Upload service and media processing

### 12.1 Proposed launch limits

| Setting | Proposed default |
|---|---|
| Files per batch | 20 |
| Image size | Up to 25 MB each |
| Image inputs | JPEG, PNG, WebP, HEIC/HEIF |
| Video inputs | MP4 and MOV, validated for supported codecs |
| Video limit | 60 seconds and 250 MB per file |
| Simultaneous transfers per device | 2, adjustable after measurement |
| Public-quality image target | Prefer at least 1600 pixels on the long edge; lower resolution can be accepted for reference |
| Private-preview link lifetime | 5 minutes by default |

These limits are application defaults, not external-platform requirements. Validate target iPhone/Android formats and conversion capability before claiming support in production. Containers alone do not guarantee a supported video codec. Explain unsupported formats and preserve other valid files in the batch.

### 12.2 Transfer contract

1. The client creates a stable batch ID and one stable item ID for each file.
2. The server authenticates the account, validates active venue membership and issues scoped transfer instructions.
3. Upload each original to private storage, tracking progress independently.
4. Finalise each item with its stable ID. The server confirms actual bytes, file signature/type and limits, then creates or returns the same accepted asset/submission.
5. Durable jobs create previews, orientation-corrected display versions and supported conversions.
6. When ready, the item becomes actionable in the review queue; failures remain technical processing issues.
7. Reconcile server receipts on reconnect. A lost response is not permission to create another asset.

Use resumable uploads for large files and unreliable connections. Supabase documents TUS support for this purpose [S1]. Upload originals directly to the authorised storage endpoint; do not route every large video through a page-rendering request.

Finalisation, retries and jobs are idempotent. Stored objects use unique keys; do not let client-controlled overwrite paths replace another original.

### 12.3 Processing

Generate lightweight thumbnails for album/review browsing. Keep the original unchanged. Store transformation settings, output type, dimensions and processing version.

Video work generates a poster frame and a compatible preview, while retaining the source. Long-running conversion/export work uses durable background jobs with retry and terminal-failure visibility.

Strip unnecessary GPS/device metadata from public renditions. Original metadata stays restricted and is not copied into staff-facing search by default.

A publishable crop is an explicitly selected rendition. Do not automatically crop out part of a dish just to fill a website banner.

### 12.4 Duplicates and conflicting operations

Verify exact duplicate hashes server-side within the authorised organisation. Duplicate detection must not reveal another venue's restricted media to a staff member. A permitted repeated upload can point to an existing asset while preserving its submission history.

Exact-file deduplication does not itself create an approved cross-venue usage, transfer review decisions or grant access. Storage reuse and permission to use the image are separate decisions.

Similarity is advisory: a similar image may be a better angle or a more current serving. Never discard it solely on a visual similarity score.

Use record-version checks for label changes, review decisions, menu activation, facts and primary selection. A stale decision returns a clear conflict and current state.

Recheck membership at transfer renewal, finalisation, preview retrieval and export. Access revoked mid-transfer prevents acceptance into the venue's collection. Already transferred partial objects remain private until cleanup.

Signed preview links may remain valid until their short expiry after access removal. If immediate revocation is required, route reads through a service that checks current authorisation instead of promising instantaneous signed-link revocation.

## 13. Service/API capabilities

Endpoint names may fit the existing codebase. The following contracts and behaviours are required regardless of routing style.

| Capability | Essential input/output | Important contract |
|---|---|---|
| Current account/scope | Effective memberships and roles | Authoritative server scope |
| Venue catalog and tasks | Venue, filters, cursor; subject/task records | Only authorised venue data |
| Start/resume upload batch | Stable batch/item IDs, file metadata | Return existing batch on retry |
| Finalise upload item | Item ID, proposed label and record version | Validate object and membership; idempotent receipt |
| Assign/correct labels | Selected item IDs, subject or explicit uncertain state | Atomic selected group; no hidden apply-all |
| Private preview | Asset/rendition ID | Scoped, short-lived access |
| Manager review queue | Venue, filters and cursor | Include Needs label; only ready assets actionable |
| Review decision | Exact usage/version, decision and reason | Permission, current revision and conflict checks |
| Primary selection | Subject/use and eligible rendition | Atomic single primary |
| Fact confirmation | Answer, conditions, source and dates | Independent of photo approval |
| Menu import/activation | Source/version, resolved diff, effective time | Preview, stable identities and transactional activation |
| Library search/export | Scope, explicit selections, output profile | Access revalidated on download; manifest matches files |
| Publication change | Destination, approved snapshot, intent | Idempotent delivery and acknowledgment |
| Account/scope change | User, venue/role, intended action | Prevent escalation and last-admin removal |

Validation errors identify the affected file/field and a next action. Use distinct responses for sign-in required, forbidden scope, stale version, unsupported media, size limit and retryable service failure. Do not send stack traces or secrets to staff.

Use reliable event delivery between committed database changes and indexing/publication jobs. A worker failure must not lose a menu change or withdrawal request.

## 14. Export and downstream publishing

### 14.1 Export packages

Managers export within their venue; admins can export across venues. The selection screen offers approved public versions by default, with an explicitly separate internal/reference export where authorised.

Output profiles: Original, Website image, Social image and Custom dimensions. Format/size presets are editable settings, not hardcoded claims about every external platform. A crop requires a preview and approved selection; automatic resizing can follow the approved derivative policy.

ZIP packages include a CSV or JSON manifest mapping every file to its stable asset/rendition ID, venue, subject, approval version, source venue, capture date if known, upload date and any use restrictions. Public alt text/captions may be proposed automatically but must be reviewed; do not fabricate venue facts.

Generate readable filenames such as white-horse-swavesey-chicken-momo-asset123.webp. The filename is not the identity of the record. Do not use staff names, private notes or precise GPS coordinates in public filenames.

Before download, recheck permissions and eligibility. If a selected file was withdrawn after package preparation, invalidate/rebuild the package or clearly remove that file. Record the exact exported snapshot.

### 14.2 Connected destinations

A destination adapter defines its venue scope, supported media/facts, authentication, publish/update/delete actions, refresh interval, acknowledgment format, retries and cache handling.

Only explicitly selected public-approved versions and currently confirmed facts are sent. Internal evidence and originals stay private unless an authorised export explicitly requests them.

Each change has an immutable publication intent ID and version. Repeated delivery returns the same result or safely updates that same intent. The UI reports success only after a destination acknowledgment or a clearly marked human confirmation.

Each destination and subject/use also has an ordered publication generation. Revalidate eligibility and the latest intended generation before delivery; skip superseded intents. Serialize changes for that destination and subject/use, or use equivalent conditional destination controls, so an older publication cannot take effect after a newer withdrawal. Keep late acknowledgments in history without allowing them to overwrite the status of a newer intended generation. Reconcile uncertain external state explicitly.

Proposed first-party website target: apply an acknowledged update or withdrawal within five minutes under normal operation. Treat this as a target to verify with the actual website integration, not a guarantee for outside platforms.

A database flag cannot recall files already downloaded elsewhere. Manual destinations retain a visible follow-up task until a person confirms the external change. Public-origin access and caches must have an explicit withdrawal strategy.

### 14.3 Guest-answer integration

Return structured answers with conditions, verification date and source/version ID. Unknown and overdue facts return a clear unconfirmed result. A language model may phrase an approved answer but cannot broaden it or infer missing facts from a photograph.

No automatic guest-answer feature is required for the first operational release. The data contract should support it without reworking venue facts later.

## 15. UX, accessibility and performance

### 15.1 Interaction standards

- Staff primary actions should be at least 48 by 48 CSS pixels as a design target, with comfortable spacing.
- Use readable text, meaningful labels, visible focus and sufficient contrast.
- Core flows must work with touch, keyboard and screen readers.
- Selection and grouping must have buttons; drag-and-drop cannot be the only way to label a batch.
- Never rely solely on colour for status.
- Announce upload progress and completion accessibly without continuously stealing focus.
- Retain selections when returning from the phone picker or a full-image preview.
- Use short instructions and familiar terms: Upload, Change label, Submit, Retake.
- Support text enlargement and narrow mobile screens without hiding required actions.

Target WCAG 2.2 AA across the application. W3C's minimum target-size criterion is 24 by 24 CSS pixels, subject to the criterion's exceptions; the larger staff-button target above is an intentional usability choice [S5].

### 15.2 Performance and usability targets

| Measure | Proposed acceptance target |
|---|---|
| Task-based submission | Under 30 seconds of active interaction, excluding photography composition and network transfer |
| Mandatory typing in known-item path | None |
| Label search | p95 below 500 ms at the pilot's documented catalog size and test network |
| Useful Home content | Within 2.5 seconds on the agreed midrange-phone/good-4G test profile after sign-in |
| Review basic known-item submission | Ordinary approval in a small number of actions, measured in the pilot |
| Transfer reliability | No lost acknowledged submissions or duplicated finalisation from tested retries |
| Group administration | Works for all initial pubs without hardcoded venue lists |

Record actual device, file size, network and sample count when evaluating targets. Do not present a laboratory target as proven field performance.

Gallery views use thumbnails and pagination rather than downloading every original. Large exports and video conversions run asynchronously with progress and a recoverable error state.

### 15.3 Browser capability checks

Validate on real target iPhones/Safari and Android/Chrome, as well as desktop browsers used by managers/admins. Check HEIC/MOV handling, orientation, picker return, local draft retention, interrupted upload and accessibility.

Offer installation as a PWA where supported, while preserving browser use. Native camera and library access should use supported platform/browser mechanisms. Background sync and local persistence are capability-dependent [S3, S4].

## 16. Security, retention and operational controls

These are functional requirements for a private multi-venue collection, not extra steps imposed on each staff upload.

- Use individual accounts and current server-side memberships for database records, storage objects, search, exports and jobs.
- Keep originals, draft media and evidence in private storage.
- If using Supabase, define and test row-level policies for both application data and storage operations; Supabase documents its storage access model around Postgres RLS [S2].
- Keep processing/service credentials server-side. Integration credentials are never returned in ordinary account/settings payloads.
- Use validated file signatures and types, limits and safe decoders; do not trust extension or browser MIME alone.
- Exclude secrets, signed URLs and unnecessary personal metadata from logs.
- Review public-use concerns such as identifiable guests or personal paperwork centrally. Staff are not forced through a long rights form for every food photo.
- Store contribution permission and any exceptional use restrictions clearly. Retention in the business archive is not itself a claim of copyright ownership.
- Deactivation removes access while preserving accepted assets and necessary attribution.
- Default to retaining accepted originals until an authorised retention/deletion policy says otherwise. Unaccepted orphan uploads may be cleaned up after a proposed seven-day window, with protection against deleting referenced assets.
- Permanent deletion is an explicit admin action with a reason and impact preview. Published references, dependent renditions and required history must be handled first.
- Back up database records and original files, and test recovery of matching records plus bytes. Database recovery alone is not the application's complete recovery test.
- Monitor storage, processing failures and failed destination work. Alert before capacity problems block uploads; do not delete approved media automatically to meet a quota.

If the application later supports other organisations, all the same boundaries must include organisation isolation. An admin is not a cross-customer superuser.

## 17. Notifications and operating routine

In-app notifications ship first. Optional device push and email digests use explicit user preferences and supported delivery mechanisms.

| Recipient | Notify about | Delivery approach |
|---|---|---|
| Staff | Retake request, direct assignment, upload needing intervention | In-app; optional relevant push |
| Staff | Routine approvals and corrected labels | My uploads or grouped digest |
| Manager | Pending/unlabelled submissions, overdue checks, important change reports | Queue plus digest |
| Admin | Venue setup gaps, sustained backlog, processing/export/publication failures | Group exceptions and digest |

Default quiet hours are 21:00–08:00 in the venue timezone, configurable; no assumption is made about an individual employee's shift. Avoid repeatedly notifying staff about an item already pending review. Collection reminders should respect availability/preferences.

Proposed operating routine: staff capture at suitable moments; managers review a small batch each working day; managers check outstanding priorities weekly; admins check group exceptions weekly. Menu/policy/venue changes trigger work immediately rather than waiting for the routine check.

## 18. Metrics and reporting

### 18.1 Required measures

| Measure | Definition |
|---|---|
| Current required-media coverage | Satisfied active mandatory media requirements / all active mandatory media requirements |
| Item coverage | Subjects for which every mandatory requirement is satisfied / applicable active subjects |
| Confirmed fact coverage | Applicable questions with current confirmed answers, including no/limited / all applicable questions |
| Review delay | Time from ready-for-review to a decision; track technical processing time separately |
| Label correction rate | Reviewed submissions whose confirmed subject differs from proposed subject, by route |
| Needs-label backlog | Accepted ready submissions awaiting classification |
| Useful contributions | First approved fulfilment of a missing requirement or approved replacement of outdated material |
| Content use | Exports and acknowledged publication, separately |
| Operational reliability | Failed transfers, processing failures, retries, stuck jobs and failed destination actions |

Always show numerator/denominator and filters. Separate food, drinks, spaces and facilities. Exclude future menus before activation and permanently retired subjects; retain temporarily unavailable active items.

No leaderboard or raw upload quota is required. Duplicate files and optional extra angles do not increase required coverage. Reconfirming unchanged content is verification work, not a fabricated new photograph.

### 18.2 Worked example

Illustrative only: 40 required public food-photo requirements comprise 30 current approved, five pending, three missing and two needing replacement. Food coverage is 30/40 = 75%. Ten extra optional photographs do not change it. A reference-only photograph of a missing dish also does not change it.

For six applicable facility questions, four confirmed yes answers and one confirmed no answer give five resolved current answers. One unknown remains unconfirmed: 5/6 = 83.3%. An appropriately confirmed negative answer is useful completeness.

### 18.3 Instrumentation

Record flow started, capture route, subject selected, explicit uncertain label, batch grouping, submitted receipt, failure/retry, decision, correction, requirement satisfied and export/publication result.

Use these events to improve the workflow. Do not collect location tracking or photograph contents as analytics event payloads. Staff see their own contributions; managers and admins see their permitted operational scope.

## 19. Recommended technical shape

Reuse a suitable existing implementation. The following is a reasonable proposed baseline if it matches the project's current stack:

- Responsive React/Next.js with TypeScript for the three interfaces and an installable PWA shell.
- Supabase Auth for individual accounts, Postgres for records and private Storage for originals/renditions.
- Server-side permission enforcement and RLS for venue/organisation boundaries.
- Resumable direct-to-storage uploads, with a local retry queue where supported.
- Durable media/export/publication workers, separated from interactive page requests.
- A small API layer for review, menu activation, exports and publication contracts.
- The existing hosting setup; Vercel is a candidate for the web app, with Cloudflare used where it already serves the group's DNS/delivery needs.

Storage access rules and resumable behaviour are supported concepts in Supabase's documentation [S1, S2]. The stack is a recommendation, not evidence of the current repository's configuration.

Do not introduce multiple master catalogs, separate authentication systems or three competing copies of the media collection. Three role experiences share one authoritative model.

## 20. Migration and initial setup

1. Inspect existing accounts, venues, files, labels, menus and approval states.
2. Map actual venue records and user memberships; identify ambiguous legacy labels.
3. Import existing originals with known provenance and capture dates. Preserve unknowns instead of manufacturing dates.
4. Treat files without reliable approval history as awaiting review, even if they were previously in a folder named Approved.
5. Deduplicate exact files without losing legitimate associations or attribution.
6. Enter each current menu and confirm spaces/facilities with the responsible manager.
7. Associate legacy media with stable subjects; compute the first honest coverage view.
8. Record known external usages and nominate primary/backup reviewers.
9. Validate permissions with at least two distinct venues before expanding access.

There is no requirement to discard existing good media or to ask staff to upload it all again.

## 21. Delivery plan

### Release 1: complete operational workflow

Deliver all three role experiences, individual accounts and scoped permissions, manual/CSV menu setup, venue checklists, task and quick upload, batch labels, explicit uncertainty, retry/recovery, original preservation, manager review, basic venue facts, current coverage, searchable archive, primary selection, manual exports, audit and useful notifications.

Core functionality is usable without image recognition or a connected website. Ship local drafts only with the described capability checks and truthful messages; do not hide transfer limitations behind a success notification.

### Release 2: easier preparation and distribution

Add assisted menu extraction, optional image-label suggestions, richer duplicate assistance, practical editing/version workflows, campaign collections and the first fully specified website adapter. Some lightweight collection/version features may ship earlier when existing components already support them.

The website integration is complete only when updates, failures, acknowledgments and withdrawal work as well as first publication.

### Release 3: measured refinements

Improve recommendations, reporting and optional guest-answer consumption using observed pilot needs. Expand to additional destinations individually, each with an explicit adapter contract. Keep the staff capture path short as the admin feature set grows.

### Pilot and rollout

Pilot in one pub with kitchen, bar and front-of-house contributors and a responsible manager. Use a second test venue to validate isolation and people holding different roles at different pubs.

Include a new dish, a changed presentation, a retired dish, a conditional amenity answer, an unknown fact, a mixed batch, a wrong label, a retake, a duplicate, weak connectivity and a manual website handoff.

Roll out the setup template to other pubs only after staff can upload without coaching and managers can keep up with review. The full feature list is specified here; release sequencing does not reduce the required role coverage.

## 22. Acceptance checklist

Each scenario needs a demonstrated result using representative data and relevant real devices. These are implementation acceptance criteria, not claims of completed testing.

| ID | Scenario | Required result |
|---|---|---|
| AC01 | Staff opens a named photo task | Venue, item and required view prefill; no text entry needed |
| AC02 | Staff quick-uploads an ordinary photo | Current-venue label can be selected through recent items/search |
| AC03 | Correct item cannot be found | Submit as Needs label; manager sees it in the main queue |
| AC04 | AI service is unavailable | Capture, search, labels and submission still work |
| AC05 | Batch contains two dishes and a garden | Three explicit groups receive correct independent labels |
| AC06 | One batch image exceeds the limit | Valid files continue; affected file has a clear remedy |
| AC07 | One transfer fails after others succeed | Retry only incomplete work; successful files remain accepted |
| AC08 | Response is lost after finalisation | Retry returns the same asset/submission identity |
| AC09 | Phone is offline | No false Sent message; local persistence is described accurately |
| AC10 | Camera permission is denied | Library-upload route remains accessible where supported |
| AC11 | Batch venue changes before sending | All subject assignments revalidate; no foreign-venue labels survive |
| AC12 | Membership is revoked during upload | Finalisation is refused; partial bytes stay private |
| AC13 | Staff changes another venue ID in a request | No unauthorised data, preview, export or mutation is allowed |
| AC14 | User manages A and is staff at B | Manager privileges apply only to A |
| AC15 | Good photo has a wrong label | Manager fixes it without requesting another upload |
| AC16 | Photo is retained as reference | It remains stored but public-photo coverage stays open |
| AC17 | Manager asks for another photo | Specific reason appears; retake opens the same subject/context |
| AC18 | Two managers decide simultaneously | Stale decision cannot silently overwrite the newer one |
| AC19 | Dish presentation changes during review | Approval cannot silently bind to the obsolete revision |
| AC20 | Approved image is materially edited | New visible version requires approval; original/history retained |
| AC21 | Exact duplicate is submitted | Coverage and useful-contribution counts do not inflate |
| AC22 | Same local dish appears on two menus | Stable offering can share its qualifying photo |
| AC23 | Same name appears at another pub | No automatic image/evidence reuse or changed provenance |
| AC24 | Pool table answer is confirmed no | Fact is resolved and no impossible table-photo task remains |
| AC25 | Router photograph is submitted | Guest Wi-Fi fact stays unconfirmed until separately verified |
| AC26 | Temporary sold-out state is set | Active photo requirement and history remain |
| AC27 | Future menu is prepared | Current menu/public availability stays unchanged until activation |
| AC28 | Menu import is repeated | No duplicated offerings; retirements require explicit diff approval |
| AC29 | Pub has no accommodation | No mandatory bedroom slots; applicability change is recorded |
| AC30 | Review date passes on unchanged garden | Check requested; manager can reconfirm without reshooting |
| AC31 | Approved photo is exported | Mark Exported, not automatically Published |
| AC32 | Withdrawn file was queued in an export | Package is invalidated/rebuilt before download |
| AC33 | Integrated withdrawal fails | Internal eligibility stops; destination remains visibly pending/failed |
| AC34 | Staff member leaves | Access ends; accepted business assets and attribution remain |
| AC35 | Primary image changes | One effective primary per subject/use and traceable history |
| AC36 | Shared-device user signs out | Next person cannot see prior private previews or draft contents |
| AC37 | Core flow uses keyboard/screen reader | Upload, label grouping, review and feedback remain operable |
| AC38 | Recover from backup | Referenced originals and approved versions match restored records |
| AC39 | Coverage number is audited | Numerator and denominator reproduce the displayed result |
| AC40 | Manager invites a new user | New scope is staff-only and limited to that manager's venues |

## 23. Decisions fixed by this specification

To keep implementation moving, use these defaults unless the existing project provides a justified alternative:

1. One responsive app, three role experiences.
2. Staff navigation: Home, Upload, Album, My uploads.
3. Staff categories: Food, Drinks, Spaces, Facilities, Other.
4. Known-item uploads require no typed description.
5. Uncertain labels are allowed and go to the normal manager queue.
6. Staff can edit their own pending labels; reviewed content uses correction requests.
7. Managers can approve ordinary public use, correct local labels, confirm facts, create dated local specials and manage ordinary staff locally.
8. Admins control permanent menu activation, shared definitions, privileged roles and external publication.
9. Managers/admins may download originals in their scope; staff downloads are off by default.
10. Preserve accepted originals and separate capture date from upload date.
11. Core workflows work without AI.
12. Manual export is sufficient to prove the first operational release; each integration must handle later changes and withdrawal.
13. Scope and timing assumptions are proposals to validate; none is a claimed audit of the current app.

## 24. Source notes

The product design, role choices, defaults and acceptance targets above are recommendations. The following primary sources support specific platform and content-handling facts:

- **S1 — [Supabase, Resumable Uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads):** TUS support, interruption recovery and suitability for large files/unstable connections.
- **S2 — [Supabase, Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control):** storage policies and Postgres RLS.
- **S3 — [MDN, Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API):** limited browser availability and deferred synchronisation.
- **S4 — [MDN, Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria):** browser-managed storage limits and persistence/eviction behaviour.
- **S5 — [W3C, Understanding Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum):** WCAG 2.2 target-size criterion and exceptions.
- **S6 — [Google Business Profile, Business-specific photos](https://support.google.com/business/answer/6123536?hl=en-GB):** truthful, useful images and restrained alteration.
- **S7 — [VisitEngland, Providing accessibility information](https://www.visitbritain.org/business-advice/make-your-business-accessible-and-inclusive/providing-accessibility-information):** factual descriptions, measurements and photographs for venue access information.

Sources checked during this conversation. Provider-specific limits and integration behaviour must be rechecked when implementing against the chosen versions and destination APIs.



