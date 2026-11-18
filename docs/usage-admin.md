# Admin guide

Admins set up and run Naba-Lens across every venue: venues, menus, people,
the photo library, exports and publishing, and the rules every venue follows.
The words in **bold** are the words on your screen. Managers' and staff's
sides are in the [manager guide](usage-manager.md) and the
[staff guide](usage-staff.md).

## Four different things

| Stage     | Where you see it                        | What it means                                                                                                        |
| --------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Uploaded  | Library, Overview's **Oldest waiting**  | A photo is stored and waiting for its venue's reviewer.                                                              |
| Approved  | The photo's **Review history**          | Approved for public use, kept as reference, another photo asked for, or not used. Only a reviewer decides this.      |
| Covered   | Overview, Metrics: "_n_ of _N_"         | A slot is covered only by a current photo approved for public use. Reference photos and duplicates never count.      |
| Published | Publishing: **Exported**, **Published** | Exported means a package was downloaded. Published means you recorded where it went up, the date and who checked it. |

## Sign in

Sign in at `/login` with the emailed link or the 6-digit code (see the
[staff guide](usage-staff.md#sign-in-and-leave-safely)). Admin accounts also
need **Two-step sign-in**. The first time, choose **Set up with an
authenticator app**, scan the code and **Confirm code**. Each sign-in after
that asks you to **Enter your sign-in code** from the app. You then land on
**Overview** (`/admin/overview`). If you lose your phone, another admin can
**Reset authenticator** on your page under People. For **Account
unavailable**, contact the system owner; that screen offers **Sign out**.
Inside the app, use **Log out**.

## Where things are

On a computer the top bar shows **Overview**, **Venues**, **Menus**,
**Library**, **Publishing**, **People** and **Settings**. On a phone or
tablet the tab bar shows **Overview**, **Venues**, **Library** and **More**.
**More** (`/admin/more`, headed **All sections**) lists all seven by their
full names, **Menus & catalog** and **Settings & activity** among them, each
with a line on what it holds.

Each section page is headed as the nav names it.

## Overview

**Overview** shows every venue's coverage and backlog. **Venues needing
attention** comes first: venues with blocked setup, errors, checks due or a
long wait. **By venue** then gives, for each venue, coverage by category
("_n_ of _N_" approved for public use), **Facts confirmed**, **Unlabelled**,
**Oldest waiting**, **Checks due**, **Publication errors** and what was added
in the period. Each number opens the records behind it. Filter by **Venue**,
**Menu**, **Reporting period** and **Categories** (Food, Drinks, Spaces,
Facilities, Other).

## Venues

**Venues** lists every venue; those with setup still to do come first.

1. **Add a venue**: **Name**, **Town or village**, **Timezone** (every Lapen
   Inns pub today uses Europe/London) and **Address**, then **Add the venue**.
2. The venue page opens with its **Setup checklist**: **Current menu
   confirmed**, **Main and backup reviewer**, **Staff invited**, **Spaces and
   facilities checked** and **First accepted photo**.

The venue page's sections:

- **Reviewers**: a **Main reviewer** (reviews this venue's photos first) and
  a **Backup reviewer** (reviews when the main reviewer is away), two
  different people. Only the venue's managers and the group admins can be
  chosen; to add someone, make them the venue's manager under People first.
- **One reviewer is enough here** (single-reviewer venue): tick it, with
  **Why is this changing?**, for a small venue where the manager may decide
  on their own photos. **Decisions on their own photos** lists each one for
  your spot check.
- **Name and location**: changes ask **Why are you changing this?**, and the
  old and new values are kept in Activity.
- **Menus**: opens the venue's menus.
- **What this venue collects** (the venue's scope):
  - **Accommodation**: **Preview turning it on** (or off) shows **What
    changes** (bedroom requirements start or stop applying); then **Turn
    accommodation on** or **Turn accommodation off**, with a reason.
  - **Copy from** **The group catalogue (core questions)**, or another venue:
    **Preview what would be added**, then **Add as requirements to check**.
    These arrive as new, unanswered requirements.
- **Status**: **Operating status** is **Open**, **Temporarily closed** or
  **Closed for good**, with **Why is the status changing?**. Closed for good
  shows **Archiving this venue** (what archiving does) first, then **Archive
  the venue**. An archived venue reads **Archived**: its photos, decisions and
  history are kept, only admins can open it, and you can reopen it under
  Status.

## Menus

**Menus** (`/admin/menus`) holds each venue's menu, used only for labelling.
**Active · for labelling only** means just that: it isn't a public menu, it
doesn't change any website, and it doesn't mean a dish is served today.

1. Open **Menus**, then the venue. **Import a menu** from a CSV or structured
   JSON file (use **Download the CSV template** for the columns; see
   [menus-import.md](menus-import.md)), or **Start a draft from the active
   menu**. PDF, image and Word menus are not read.
2. The preview lists added, changed and removed items, and separates
   **Changed presentation** (those dishes' accepted photos go back for a
   recheck) and **Proposed retirements**. Items are matched by their source
   key; a same-name match is uncertain until you choose **Same item as** (an item) or
   **Treat as new item**. Importing the same file again opens the existing
   draft.
3. Edit sections, items, variants and aliases, then **Save**. If another
   admin saved first, the page says **Someone else saved first** and offers
   **Reload**.
4. **Activate for labelling** now, or **Schedule activation** for a date.
   Activation stays blocked until you tick each proposed retirement. The
   previous active version is retired, and existing labels are kept.
5. **Retire** removes a venue's active menu; **Archive** stops one item being
   used for new labels. **Nothing with labels is ever deleted**.
6. **Change requests** from managers: **Accept**, **Ask for clarification** or
   **Decline** (the last two need a reason the manager sees). Accepting
   records your decision; make the change in a draft.
7. **Missing-item suggestions** from staff (**Item not on the menu?**): link
   each to an item or dismiss it.

Prices, dietary and spice values in a file are kept as source details only.
Staff never see them. After a new menu is activated, the venue's manager sees
which items kept their photo and which need a new decision.

## Library

The Library (`/admin`) holds every ready photo and video
across the group, newest first. Filter by **Venue**, **Staff member** and
**Media**, or open **More filters** for menu item and **Category** (choose a
venue first), **Content type**, **Labelled** or **Needs labels**, dates, and
search over labels and notes, plus **In use**, **Review**, **Orientation**,
**Tag**, **Collection**, **Request**, **Published to**, **Imported**,
**Taken from** and **Taken to**. Then **Apply filters**. Filters combine; each
file appears once.

**Imported** lists each legacy import batch (`pnpm import:legacy`, run by the
owner; see [legacy import](legacy-import.md)) with how many photos and videos
it brought in. Imported photos wait in Review like any upload and cover
nothing until a reviewer accepts them.

Open a photo and choose **Edit labels** (or **Add labels**) to correct its
labels. Labels are optional, so unlabelled photos appear at once.

A photo's page shows **Where it's used**, **Original and provenance**,
**Labels**, **Review history**, **Exports and publication**, **Possible
duplicates** and **History**. From there you can:

- **Download original**: the unchanged file.
- **Export this photo**, when it is approved for public use.
- **Withdraw from use**: it stays in the Library with its history but can't
  be exported or made a main photo, and packages holding it must be rebuilt.
  Review decisions are not changed. **Restore** undoes it.
- **Suspend from use**: for a photo that no longer shows the venue as it is.
  Every approval it holds is withdrawn, so each dish, place or facility it
  filled needs another photo. Using it again needs a new review.
- **Correct venue**: records the right venue; the photo stays withdrawn.
- **Manage tags**, and **Collections** (top of the Library).
- **Permanently remove…** (see below).

### Reference photos

Reference is a review decision made by the venue's reviewer (**Keep as
reference**; see the [manager guide](usage-manager.md#review)). A reference
photo stays stored and visible to the team, never closes a public-photo slot
and never goes in a public export.

### Remove a photo for good

Staff can't delete a photo once it has been accepted; they ask, and their
requests appear under **Removal requests** (a button at the top of the
Library). Choose **Keep the photo** (with **Why it stays**, which the person
sees) or **Review removal**. **Permanently remove…** shows **What this
removes** and asks **Why it must be removed**. The stored files are deleted,
but the record, who took it, the reason and its history are kept. Removal
can't be undone. A published photo must be withdrawn from its public uses
first. Downloaded copies cannot be recalled.

## Publishing

**Publishing** (`/admin/publishing`) shows **Needs following up**, **Export
packages**, **Destinations**, **Published** and **Output sizes**.

1. **Make an export package**. Choose the **Venue** and the **Kind of
   export**:
   - **Approved for public use**: only photos approved for public use now can
     be chosen.
   - **Internal**: every photo at the venue, including reference and
     not-yet-reviewed ones. Each file is marked **Internal only**. Never
     publish an internal package.
2. Choose photos, check **Alt text**, pick an **Output size**, say **What it's
   for**, then **Make package · _n_ photos** and **Download ZIP**. The package
   reads **Exported**.
3. When a photo goes on a website or listing, open the package and choose
   **Record where it's published**: **Where** (a destination), **Page
   address** (or a **Reference**), **Date it went up**, then **Record as
   Published**. Add destinations with **Add destination**.
4. When a published photo is withdrawn from use, its record reads
   **Withdrawal pending** and it shows under **Needs following up**. After it
   is taken down, use **Confirm it's taken down**.

If a photo in a package is withdrawn, the package reads **Needs rebuilding**;
use **Rebuild without withdrawn photos**. Exported is not Published, and only
an admin records Published. Managers can make public packages for their own
venue under Exports, but can't record Published.

## People

**People** (`/admin/staff`) lists everyone.

- **Invite staff**: **Name**, **Email**, **Venue** and team (**Front of
  house**, **Back of house** or **Unassigned**), then **Send invitation**.
  They get a single-use sign-in link. If you see **Account created, email not
  sent**, use **Resend invitation** rather than inviting again.
- A person's page shows **Venues and what they can do**. Roles are per
  venue: use **Add a venue or change the role**, choose **Staff** or
  **Manager** under **Role at this venue**, then **Save venue role**. Someone
  can be staff at one venue and a manager at another.
- **Account type**: **Make venue manager** or **Return to staff account**,
  with a reason.
- **Edit details**: **Display name**, **Profile photo**, job title, team,
  **Venue** or **Account active**, then **Save changes**.
- **Deactivate** removes access straight away. Their photos stay in the
  Library, and **Reactivate** restores the account.
- **Make admin** and **Remove admin role**: there is always at least one
  active admin.
- **Reset authenticator** (with **Why are you resetting it?**) clears a
  person's two-step sign-in, so they set it up again next time.

## Settings and activity

**Settings** (`/admin/settings`) shows what needs attention, **Operations**
(storage, stuck processing, failed uploads) and the **Rules for every
venue**:

- **Quiet hours**: no notices between **Quiet from** and **Quiet until**
  (21:00 to 08:00 by default).
- **Reminders and alerts**: how often managers are reminded about waiting
  photos, and when admins are told a photo has waited too long.
- **Retention**: when unfinished uploads are removed.
- **Allowed export profiles**: Original, Website, Social, Custom.
- **Storage**: the quota and the warning level.

Every change asks **Why are you changing this?**. **Activity**
(`/admin/activity`, the button at the top of Settings) shows who changed
what, where and why, filtered by **Venue** and **Kind of change**.

## Pages without a menu entry

These work by address only; nothing in the navigation links them yet:

- **Albums** (`/admin/albums`): every venue's album at once, as a table of
  venues by category with "filled of total" in each cell, and **Biggest
  gaps**.
- **Coverage** (`/admin/coverage`): every venue's checklist, menu coverage
  and monthly targets, with **Venue managers** (`/admin/coverage/managers`)
  and each venue's older manager screens. It links to **Metrics**.
- **Metrics** (`/admin/metrics`): each venue's coverage, facts, review and
  reliability; choose a venue to see how each number is counted.
- The knowledge pages under `/admin/knowledge` (check dates, sources, runs,
  upgrades).

Check privacy and permissions before external use: a stored photo is not
publishing clearance. See [operations](operations.md).
