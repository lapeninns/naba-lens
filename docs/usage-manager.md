# Venue manager guide

A venue manager runs one venue's album: reviews the photos staff send, asks
for the photos still missing, keeps the venue's facts and menu right and
exports approved photos. The words in **bold** are the words on your screen.
Your staff's side is in the [staff guide](usage-staff.md); setting up venues,
menus and people is in the [admin guide](usage-admin.md).

A manager is a separate account type: an admin makes someone a manager at a
venue (see the [admin guide](usage-admin.md#people)). Roles are per venue, so
you can be a manager at one venue and staff at another.

## Four different things

Keep these apart when you read a number or answer a question from staff.

| Stage     | Words you see                                                                                             | What it means                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uploaded  | **Waiting**, "Uploaded … · waiting …"                                                                     | Staff sent the photo. Nobody has decided yet. It doesn't count towards coverage.                                                                         |
| Approved  | **Approve for public use**, **Keep as reference**, **Ask for another photo**, **Not used**, **Fix label** | Your decision on one photo. Staff see **In the album**, **Kept for reference**, **Retake**, **Not used** or **Label corrected**.                         |
| Covered   | "_n_ of _N_", with the percentage beside it                                                               | A slot counts as covered only with a current photo approved for public use. A reference photo, an extra photo or a duplicate never adds to it.           |
| Published | **Exported**, **Published**                                                                               | Exported means someone downloaded a package. Published means an admin recorded the page address, the date and who checked it. Neither is shown to staff. |

## Sign in and find your way

Sign in at `/login` with the emailed link or the 6-digit code, as staff do
(see the [staff guide](usage-staff.md#sign-in-and-leave-safely)). You land on
**Overview** (`/manager`).

The five tabs are **Overview**, **Review**, **Album**, **Requests** and
**Venue**: in the top bar on a computer, at the bottom on a phone. **Review**
shows a number while photos wait. When adding photos is on for your venue,
**Add photos** sits in the header and works as it does for staff; your own
photos are listed under **My uploads** (`/manager/uploads`).

**Account** (`/manager/account`) has your **Display name**, your venue and
**Sign out**; **Log out** is in the top bar. If **Venue access unavailable**
appears, your access has ended (an admin removed it, or the venue is no
longer active): ask an admin to check your venue access.

If you manage more than one venue, switch venue on the team page (Venue ›
**People and photo targets**). Every screen then shows that venue.

## Overview

- **Do next** starts with **Review next · _n_ photos waiting**, then four
  actions: **Review next**, **Check venue details**, **Request missing
  photos** and **Resolve outdated public content**, each with how much is
  waiting.
- **Collecting and reviewing** keeps two numbers apart: **Still to collect**
  (slots nobody has sent a photo for yet) and **Waiting for your review**
  (photos staff have sent).
- **Coverage by category**: Food, Drinks, Spaces, Facilities and Other, each
  as "_n_ of _N_" approved for public use, of everything the venue needs.
- **This venue**: **Active menu**, **Main reviewer** and **Backup reviewer**.
- Rows lead on to **To confirm**, photos that need labels, **Search photos
  and videos**, **Requests and shot lists**, **Team targets** and
  **Metrics**.

After an admin activates a new menu, a banner says how many items kept their
photo, how many need a new decision and how many are new; **Review changes**
opens them.

## Review

### One photo at a time

**Review** (`/manager/review`) shows the waiting photos one at a time, oldest
first, titled with the count ("12 photos to review"). Each photo shows large
with its slot, the **Brief** staff were given, and who added it. The brief
is the same one staff saw: your open request's brief, else the album brief,
else the facility question's, else the category's shot template (area photos
included).

- **Accept** approves it for public use: it fills its slot and the staff
  member sees **In the album**. The page says so and the next photo comes up.
- **Ask again** opens **What should the next photo fix?**: **Show all of
  it**, **Too dark**, **Out of focus**, **Not how it's served now**, **Show
  the way in**, **Messy background**, **People or personal details in shot**,
  or **Other** to write your own reason. The staff member sees **Retake** and
  the reason.
- **Next photo** moves on. **Details, Fix label and more decisions** opens the
  photo's full review page. **See every photo as a list** opens the list.
- When none are left the page says **Every photo is reviewed**.

### Needs label

Photos that still need a slot are listed above the photo being reviewed,
headed "_n_ photos
need a label", each with why: **Sent as I'm not sure**, **Marked food or
drink, no dish chosen**, or **No slot chosen for 7 days**. Open one and use
**Fix label** to choose its slot. In the list, the **Unlabelled photos**
status gathers them too.

### The list

**See every photo as a list** (`/manager/review?view=list`) shows photos
staff labelled with a menu item, oldest first, then place and amenity photos
with their own decisions. **Status** picks **Awaiting review**, **Needs a
recheck**, **Another photo requested**, **Accepted**, **Labelled for an old menu**,
**Unlabelled photos**, **Your photos** (only when you have some waiting) or
**All**. **Section** and **Contributor** narrow it, and **Narrow** adds
**Waiting 2+ days**, **Waiting 7+ days**, **Possible duplicates** and **Has a
needed-by date**.

- **Approve for public use** counts the photo for its item; **Approve and set
  as menu photo** also makes it the one shown.
- **Choose a different menu item** moves a wrongly labelled photo and accepts
  it, with a reason. The card keeps the staff label and shows **Moved from**
  the old item.
- **Ask for another photo** asks **What should the next photo show?**.
- **Withdraw acceptance** (under **More actions**) needs a reason.
- **Decide several** lets you choose photos waiting for a decision, then
  **Approve for public use**, **Keep as reference** or **Not used** for all of
  them. Each one is still checked on its own.

### The photo's review page

**Photo review** shows **Where it came from**, **Taken by**, **What it is
for**, **Already in the album**, the note and **History**. The decisions:

- **Approve for public use**: it fills its slot; staff see **In the album**.
- **Keep as reference**: kept for the team, not public. The slot stays open.
  Staff see **Kept for reference**.
- **Ask for another photo**: staff see **Retake** with your reason.
- **Fix label**: choose the right menu item. The photo is accepted for it in
  the same step, the staff label stays in the history, and staff see **Label
  corrected**. Nobody sends the photo again.
- **Mark duplicate**: choose the photo already in the album that it repeats.
  It adds no coverage or credit.
- **Not used**: give **Why is this photo not used?**. You can **Use again**
  later. A decided photo must be withdrawn (**Withdraw**) before it can be
  marked Not used or a duplicate.

### Your own photos and single-reviewer venues

You can't decide on your own photo: it reads **This is your photo. Another
reviewer decides on it.** An admin can mark a small venue as one where **One
reviewer is enough here**; there you may decide on your own photos, and each
such decision is listed for an admin's spot check.

If two of you decide the same photo, the second sees **Someone else decided
this photo first** with **Show the latest**; the first decision stands.

## Album

The **Album** tab opens the venue's menu (the page is headed **Album**): every
active menu item by section with its photo state (**Has a photo**,
**Awaiting review**, **Still needs a photo**, **New photo waiting**, **Needs a
recheck**). Search with **Search items**, or filter with **Show** and
**Section**. An item's page shows its **Menu photo**, **Accepted
alternatives** (**Set as menu photo**), rechecks, photos waiting and
**History**, and these controls:

- **Availability**: **Mark not available** keeps the dish's slot and photos
  while it is off; **Back on the menu** ends it.
- **Local name**: the name staff see, if it differs from the menu.
- **Presentation changed**: **Mark as changed** sends its accepted photos back
  for a recheck.
- **Ask for a permanent change**: **Send request** to an admin. The answer
  shows on the **Menus** page.
- **Brief**: one line, up to 140 characters, on what the photo must show.
  **Save brief** or **Clear brief**. It comes before the section's brief.
- **Packaged**: turn on **Packaged (bottled or canned)** for a bottled or
  canned drink, and **Photo wanted** if you still want its photo. Each asks
  once (no reason needed). A packaged item without Photo wanted stays listed
  and takes photos, but no longer counts in coverage (FA-51).

### Album places and briefs

**Album places and briefs** (`/manager/album`, from Venue) says where staff
photograph each menu section and amenity category, so Album shows staff the
empty slots where they are. Choose a place for each group (**Not placed**
clears it) and write each section's brief. Places come from **Places**
(`/manager/amenities/places`); until a group is placed, staff see its slots
under Not placed yet.

### Facilities and questions

**Facilities and questions** (`/manager/amenities`) lists the venue's
amenity questions ("Is there a step-free entrance?"), each answered by staff
with photo or video evidence. It counts **Needs capture**, **Needs recheck**
and **Complete**, and lists **Recently completed** and **Archived** (each
with **Restore**).

- **Add from catalogue**: tick questions, then **Add selected**.
- On a check: **Assign** it to staff at your venue (or **Unassign**), keep
  **Notes**, **Archive** it, or **Reopen** it with a reason.
- **Capture myself** answers it yourself with photos already on Naba-Lens.
- A wrong link shows **This check isn't here** with **See all amenities**.

## Requests

**Requests** (`/manager/requests`) asks staff for photos. Requests read
**Open**, **Submitted**, **Completed**, **Blocked** or **Cancelled**.

1. Choose **New request**, then **From a slot**, **New brief** or **Fact
   check**.
2. Pick the **Slot** (or the **Subject**, or the **Fact**) and write the
   **Brief**: one line on what the photo must show. A slot fills it in with
   its own brief (yours, or the admin's shot template); change it as needed.
3. Optionally set **Needed by**. It orders the slot for staff and never turns
   overdue. **More detail** holds **Priority**, **Team**, **Person**,
   **Orientation**, **When to shoot** and **Shot list**.
4. Choose **Send the request**.

Staff see it on Album under **Asked for**, with your brief. A request on a
slot completes when its photo is accepted; a request with no slot waits for
you to choose **Mark completed**. **Block** and **Cancel the request** ask for
a reason; **Unblock** reopens it. **New shot list** groups requests, for
example for a menu launch. Requests never change coverage totals.

## Venue

**Venue** (`/manager/venue`) holds everything about the venue:

- **Current menus**: the active menu and any that start later.
  **Menus and change requests** (`/manager/menu/versions`) lists them and your
  requests' answers (**Waiting for an admin**, **Accepted**, **Declined**,
  **Admin asks for more detail**). **Dishes, availability and local names**
  opens the menu.
- **Local specials** (`/manager/menu/specials`): dated dishes and drinks.
  **Add special**, or **Accept** or **Decline** one **Suggested by staff**;
  **Extend** or **End it** while it runs.
- **Spaces**: **Album places and briefs**.
- **Facilities and policies**:
  - **To confirm**: say whether each fact or space photo is **Still right**.
    Only the date it was checked changes; no new photo is needed. A fact
    that needs a new answer offers **Answer it**.
  - **Reported changes**: what staff reported with **Report a change** or
    **Ask for a correction**, with who reported it and when. Nothing changes
    until you change it: open the slot, then mark the report **Dealt with**,
    or **Dismiss** it.
  - **Facilities and questions**: the amenity questions above.
- **Team**: **People and photo targets** (`/manager/team`, headed **Team
  targets**). **Invite staff**, **Remove** someone with a **Reason**, set the
  **Venue default photo target** and each person's own number, and switch
  venue. Only an admin can make someone a manager.
- **Export photos**: see below.
- **Review assignments**: an admin names the **Main reviewer**; you choose the
  **Backup reviewer**, who covers when the main reviewer is away (**Save
  backup reviewer**).
- **History**: every recorded change at the venue; **See all history**.

## Export photos

1. From Overview or Venue, open **Export photos** (the page is headed
   **Exports**), then **Make an export package**.
2. Choose photos. Only photos approved for public use now can be chosen.
3. Check the **Alt text**, pick an **Output size**, say **What it's for**,
   then **Make package · _n_ photos**.
4. **Download ZIP**. The package now reads **Exported**.

Exported is not Published. When a photo goes on a website or listing, an
admin records it on the Publishing page; tell your admin where it went up.
If a photo in a package is later withdrawn, the package reads **Needs
rebuilding**: use **Rebuild without withdrawn photos**.

## Metrics

**Metrics** (`/manager/metrics`, from Overview) shows the venue's numbers for
a **Period** and **Category**: **Photo coverage**, **Items and facts**,
**Review**, **Contributions and use** and **Reliability**, each with **How
this is counted**. Covered means a current photo approved for public use.
**Search photos and videos** (`/manager/search`) finds any photo or video
from your venue.

## Older Manage tools

Staff accounts with a grant made before manager accounts existed still see
**Manage** (`/staff/manage`) with the older review, checklist, menu and team
screens. An admin converts such an account to a manager account (see the
[admin guide](usage-admin.md#people)).
