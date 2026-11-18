# Venue manager guide

A venue manager account reviews the menu photos staff contribute at one venue
and gets every item on the active menu to an accepted photo. It is a separate
account type: an admin converts a staff account (see the
[admin guide](usage-admin.md#venue-managers)). A manager account cannot add or
label menu photos, and has no portfolio, staff Photos or People. It cannot
upload at all: **Capture myself** attaches media already on Naba-Lens as
amenity evidence, and new photos or videos come from staff (see
[Amenities](#amenities)).

## Sign in

Sign in at `/login` like staff, with the emailed link or the 6-digit code (see
the [staff guide](usage-staff.md#sign-in-and-leave-safely)). A manager lands on
**Overview** (`/manager`). The venue name is in the top bar, with **Overview**,
**Review**, **Menu** and **Amenities** at every width (a bottom bar on a
phone). **Account**
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

### One photo at a time

`/manager/review` opens on the waiting photos one at a time, oldest first:
menu photos and area photos together (docs/design-system/DESIGN.md §6.5). The
title counts the photos you can decide ("12 photos to review"). Each photo
shows large, with its slot (the dish, or the place), the **Brief** staff were
given, who added it and when, and where it sits in the album.

- **Accept** puts the photo in the album. The page says so ("Soup is in the
  album.") and the next photo comes up.
- **Ask again** opens the reason chips: **Too dark**, **Out of focus**,
  **Wrong item**, **Show more of it**, **Messy background** and **Other**.
  Choosing a chip sends it as the reason. **Other** asks what the next photo
  should show; it cannot be sent empty. **Cancel** goes back. The contributor
  sees the reason, as with **Ask for another photo** below.
- The brief is the one you wrote for the dish, else its section's (see
  [Briefs](#briefs)); with neither, no brief shows. It is never the menu
  description guests see.
- Your own photos never come up: the page counts them under the photo ("1 of
  your own photos is waiting. Another reviewer decides on it."). If someone
  else decided on a photo first, the page says so and shows the next one.
- More photos load as you go. When none are left the page says **Every photo
  is reviewed**.
- **See every photo as a list** opens the full list
  (`/manager/review?view=list`) for everything else: rechecks, moving a photo
  to another item, decided photos and withdrawing an acceptance.

### The full list

The full list shows photos staff labelled with a menu item, oldest first.
Changing a filter keeps you in the list. **Status** chooses the list: **Waiting**, **Needs a recheck**, **Asked for
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
  The contributor sees a **Needs another photo** note with your reason on
  their Home and on **Me**, with **Reshoot**. It has no date and is never
  repeated. They may choose **Later** to hide it from Home. The note clears
  once any new photo of the item is accepted, whoever took it. The item stays
  in **Still needs a photo** for everyone at the venue until then.
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

### What staff see

The menu is the whole venue's goal. Staff Home lists the items that **still
need a photo** (up to four, then **See all**), and anyone at the venue may
photograph any of them; nobody is assigned an item and food and drink photos
have no due date or **Overdue**. An item whose photo is waiting for your
decision stays on their list marked **Waiting for review**, and an item you
are rechecking after a menu change is marked **Being checked**. Each person
also sees their own month: accepted food and drink photos they labelled, and
photos they sent to the month, count toward their target. Staff never see
each other's months, and no screen ranks or compares people. Amenity checks
and other venue jobs keep their dates; staff reach them from **Other jobs** on
Home.

## Amenities

`/manager/amenities` is the same Amenities screen venue managers had in
`/staff/manage`, for your venue only: questions guests ask ("Is there a
step-free entrance?"), each answered with photo or video evidence. Amenities
are separate from menu photos and never change their counts. The full guide to
the screen is in the [admin guide](usage-admin.md#amenities-evidence-checks-per-venue).

- Until an admin turns Amenities on for the venue, the page says an admin must
  enable them. Then it counts **Needs capture**, **Needs recheck** and
  **Complete**, lists the active checks, **Recently completed** and
  **Archived** (each with **Restore**).
- **Add from catalogue** adds questions: tick them and choose **Add selected**.
- A check (`/manager/amenities/{id}`) has its capture brief, progress and
  answer. **Assign** gives it to active staff at your venue (manager accounts
  are not assignable); **Unassign**, **Notes**, **Archive** and **Reopen**
  (with a reason) work as in the admin guide. There is no review step: a valid
  finding is the answer at once.
- **Capture myself** (`/manager/amenities/{id}/capture`) opens the staff
  capture form for that check, without uploads: it says **You can't upload
  here** and lists the photos and videos you may attach (your own earlier
  uploads, and matching Coverage photos where the check allows). After
  **Submit finding** you return to the check. For new evidence, **Assign** the
  check to a staff member to capture it.

A check from another venue, or a wrong link, shows **This check isn't here**
with **See all amenities**. If your venue access ends, the page goes to
Overview, which shows **Venue access unavailable**.

## Album places

`/manager/album` (linked from **Places**) says where staff photograph each
menu section and each amenity category, so Album can show staff the empty
slots wherever they are standing (docs/design-system/DESIGN.md §6.2). It also
holds each menu section's brief (see [Briefs](#briefs)).

- Each menu section of the active menu and each amenity category has a list
  of your venue's places. Choosing one saves it straight away and says so
  under the list ("Saved: Desserts is photographed at Kitchen pass."). **Not
  placed** clears it.
- A section is kept by its name in the menu file, so the place carries over
  when a new menu version keeps the section.
- Places come from **Places** (`/manager/amenities/places`). With none listed,
  the page asks you to add the bar, the kitchen pass and the other places, and
  each group shows **Not placed**; section briefs can still be written. Each
  place is also a slot of its own in Album: its own photo, from area photos.
- Until a group is placed, staff see its slots under **Not placed yet**.

## Briefs

A brief is one line on what a slot's photo must show ("The bowl from above,
steam showing"), up to 140 characters. Staff read it on the slot and when
they match a photo; you judge against the same words in Review
(DESIGN.md §2, §5 Brief).

- **Section brief:** on `/manager/album`, under each menu section. Every dish
  in the section uses it unless the dish has its own. It is kept by the
  section's name in the menu file, so it carries over to a new menu version
  that keeps the section.
- **Dish brief:** on the dish's page (`/manager/menu/{id}`), under **Brief**.
  It comes first. The hint says which section brief staff see without it, or
  that the section has none yet.
- **Save brief** saves the line and says so beside the field; **Clear brief**
  removes it. A failure is written beside the field and keeps what you typed.
- Amenity questions have the catalogue's capture brief; there is nothing to
  write for them here.
