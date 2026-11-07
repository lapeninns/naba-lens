# Venue manager guide

A venue manager account reviews the menu photos staff contribute at one venue
and gets every item on the active menu to an accepted photo. It is a separate
account type: an admin converts a staff account (see the
[admin guide](usage-admin.md#venue-managers)). A manager account cannot add or
label photos, and has no portfolio, staff Photos or People.

## Sign in

Sign in at `/login` like staff, with the emailed link or the 6-digit code (see
the [staff guide](usage-staff.md#sign-in-and-leave-safely)). A manager lands on
**Overview** (`/manager`). The venue name is in the top bar, with **Overview**,
**Review** and **Menu** at every width (a bottom bar on a phone). **Account**
has your display name, your venue and **Sign out**; **Log out** is in the top
bar.

Staff and admin pages send a manager back to `/manager`, and `/manager` sends
staff and admins to their own home. If **Venue access unavailable** appears,
your access has ended (an admin revoked it, you moved venue, or the venue is no
longer active). That page offers only **Sign out**: ask an admin to check your
venue access.

## Overview

**Menu photos · {covered} of {items} covered** counts the active menu's food
and drink items that have an accepted photo; several photos of one item count
once. Under it: photos waiting for a decision, items awaiting review, items
with no ready photo and the oldest wait, each a link to the matching list.
**Review photos** appears when photos are waiting. **By section** shows each
section's count. After an admin activates a new menu, a banner for 14 days
says how many items kept their photo, how many need a new decision and how many
are new; **Review changes** opens them. Before the venue has an active menu,
Overview says menu photos appear once it is set up.

## Review

`/manager/review` lists photos staff labelled with a menu item, oldest first.
**Status** chooses the list: **Waiting**, **Needs a recheck**, **Asked for
another**, **Accepted**, **Labelled for an old menu**, **Unlabelled photos**,
**Your photos** (only when you have some) and **All**. **Section** and
**Contributor** narrow it. Select a photo to see it large (arrow keys move
between photos, Esc closes).

- **Accept for this item** counts the photo for the labelled item. When the
  item already has a photo, **Accept and set as menu photo** also makes it the
  one shown for the item.
- **Choose a different menu item** moves a wrongly labelled photo to the right
  item and accepts it. It needs a reason; the card keeps the staff label and
  shows **Moved from {item}**.
- **Ask for another photo** needs a reason (what the next photo should show).
  The contributor sees **Better photo requested** in their own area.
- **Withdraw acceptance** (under **More actions** when there are other
  choices) needs a reason. Another accepted photo becomes the menu photo, or
  the item needs a photo again. The photo stays in Photos.
- **Labelled for an old menu** and **Unlabelled photos** offer **Choose a menu
  item**. Unlabelled photos are ready photos uploaded at your venue that staff
  tagged as food or drink but did not label with an item.
- **Needs a recheck** lists accepted photos whose item changed on a new menu;
  **Accept again for this menu** keeps them.

You never decide on your own earlier photos: they show **This is your photo.
Another reviewer decides on it.** and an admin decides. Photos by people who
have left are decided by admins. If someone else decided first, the page shows
**Someone else changed {item} first** with the latest state instead of
overwriting it. After a network failure, trying again never decides twice.

A contributor's name opens their contributions at your venue
(`/manager/review/contributors/{id}`).

## Menu

`/manager/menu` lists every item of the active menu by section, with its menu
photo and its state (**Has a photo**, **Awaiting review**, **Still needs a
photo**, **New photo waiting**, **Needs a recheck**). Search by name, or filter
by state and section. An item page shows the menu photo, accepted
alternatives (**Set as menu photo**), requests, rechecks, photos waiting and
the item's history. An id that is not on your venue's current menu shows
**This item isn't on your current menu**.

Staff see the same totals in **Our menu**.
