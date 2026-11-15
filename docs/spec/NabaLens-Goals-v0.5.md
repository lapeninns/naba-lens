# NabaLens v0.5 amendment: goals, not tasks

**Version:** 0.5 · 15 November 2026
**Status:** Authorised feature scope for local implementation. Amends
[v0.4](NabaLens-Staff-Coverage-v0.4.md); everything there not changed here
still applies. Not a deployment, merge, hosted-migration, real staff/venue
data or publishing authorisation. Build order and acceptance criteria are in
[goals-not-tasks](../plans/goals-not-tasks.md).

## 1. What changes from v0.4

v0.4 made **My tasks** the staff landing experience, with assignments, due
dates and overdue work. For food and drink photos that layer is removed.
Staff see two goals and, when it happens, a note:

- **Our menu** (the venue's goal): every dish and drink on the active menu has
  an accepted photo.
- **Your month** (one person's goal): the monthly target, private to that
  person, their venue manager and admins.
- **Retake note:** a reviewer asked for another photo of a dish.

Review still decides completion only and never gates visibility. Monthly
targets, menu coverage, manager review and the organisation community are
unchanged. Leaderboards, rankings and comparisons between staff stay out of
scope.

## 2. Meanings (normative)

| Term           | Meaning                                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Still needed   | An eligible item on the venue's active menu with no accepted photo. Shared by everyone at the venue. Nobody is assigned to it.                                                      |
| Needed by      | An optional date a manager puts on one still-needed item. It orders the list and is shown. It has no overdue state and blocks nothing.                                              |
| Monthly target | As v0.4, except that a venue has a default target (a number of accepted photos, separate from the venue completion target) and a manager may set a different number for one person. |
| Retake note    | A "Needs another photo" decision shown to the photo's author with the reviewer's reason. It has no due date. The author may set it aside ("Later"); it stays on the photo.          |

## 3. Behaviour rules

Rule numbers continue from v0.4.

21. **Home** is the staff landing experience and replaces My tasks. It shows
    a retake note when one exists, Our menu with items still needed, Your
    month and colleagues' recent photos. It shows no assignment, due date or
    overdue state for food and drink work. This replaces v0.4 rule 1.
22. Any active staff member at the venue may photograph any still-needed
    item. The item leaves Still needed for everyone when a photo of it is
    accepted. Menu-section requirements have no assignees and no deadline;
    v0.4 rule 13's "assignees and dates" no longer applies to them.
23. Staff work has no due date. v0.4 rule 8's default due date and earlier
    manager deadline are withdrawn for monthly targets and menu work. The
    month itself still ends with the London calendar month. Target edits
    still need a recorded reason.
24. A manager may set **needed by** on one still-needed item. It clears when a
    photo of the item is accepted. After the date the item stays first in the
    list, without an overdue state.
25. **Monthly credit** follows v0.4 rules 4 to 7 and the one-review rule: an
    accepted still image that its uploader labelled with a menu item counts
    toward the month its upload started. Each accepted photo of the same item
    counts for its own author. Credit for photos that are not a menu item is
    not part of this amendment beyond the existing send-to-month route.
26. **Rollover** (v0.4 rule 9) uses the person's latest manager-set target at
    the same venue, otherwise the venue default. With neither, the person is
    Needs setup. It still never copies an old venue's target.
27. A **retake note** is cleared when the author's later photo of the item is
    accepted or when the reviewer accepts another photo of that item. A note
    that is set aside or ignored is never escalated, repeated or reported as
    late.
28. Service, venue-specific and amenity requirements are unchanged by this
    amendment.

## 4. Permissions and interfaces

Unchanged from v0.4, with two additions:

- A venue manager may set and clear **needed by** on an item of their venue's
  active menu, and set the venue default target. Admins may do both for any
  venue.
- A staff member may set aside their own retake note and nobody else's.

Oversight shows items without a photo and month progress. It does not list
overdue menu work. The team roster with month progress remains visible to the
venue manager and admins only.

## 5. Data and migrations

No table is dropped and no history is rewritten. Requirements, assignees,
submissions and review events remain and stay readable by admins. New data is
limited to: a venue default target, a needed-by date for an item, and a record
that an author set a note aside. Counts continue to be derived at read time
from distinct eligible assets and acceptance. Nothing applies migrations
automatically; v0.4 §5's release and rollback rules apply.

## 6. Pilot

Home switches to goals at every venue in one release (no per-venue stage).
Every venue is told before the release that task lists and due dates on
food and drink photos are going, and that photos already sent keep counting.
Who tells them, and when, is recorded in the release checklist.
