# Charter A-1: staff Home tells the truth about an amenity check

Exploration charter for the e2e runner (`e2e explore`), batch A of the flow
improvement work (HOME-1, AMEN-1, SHELL-1). It complements the repeatable
Playwright spec `tests/e2e/home-todo.spec.ts`; it does not replace it.

## Charter

As staff on a phone with one amenity check and no photo tasks, find out what
you need to do today, do it, and confirm you are told it was sent; then browse
Photos and People and check the Home badge still shows remaining work.

## Setup (isolated stack only, disposable fixtures)

- A world from `provisionAmenitiesWorld()` (`tests/e2e/helpers/amenities-world.ts`):
  venue A with a manager account and staff member A. Staff A has a team set,
  no coverage task and no monthly target.
- `readyCheck(w, w.venueA, "darts", w.staffA)`, then assign the core check
  `guest_toilets` to staff A as well (so work remains after the first send).
  Both take photo evidence.
- `seedPhoto(w.staffA, w.venueA, …)`: one ready photo staff A can attach.
- Sign in as staff A with `signedInPage` at 390 × 844, touch, Chromium.

## Permitted actions

- Read every staff page; tap links, buttons and tabs.
- Answer and send one amenity finding with the seeded photo.
- Dismiss notices.
- Not permitted: uploading new files, signing out, changing the profile,
  acting as the manager or admin, anything on another venue.

## What to check (oracles)

1. Home, first view: To do is not "Nothing to do right now."; its count is 2;
   the lead card names one check with a "Start check" button. The "Amenity
   checks" list below shows both checks. No page scrolls sideways.
2. One tap on "Start check" opens that check's capture page.
3. After sending (answer Yes, attach the photo, Submit finding), the app
   returns to Home and a "Finding sent" notice names the check's question,
   says the check is complete and has keyboard focus. A screen reader would
   hear it (role status, polite).
4. The notice stays after a reload, and goes after Dismiss (also after a
   reload). The sent check is no longer listed; To do now counts 1.
5. Photos, People, a colleague's page, Our menu and Me: the Home tab badge
   reads "1 thing to do" on each, and the phone bar's Me link shows the same
   photo or initials on each.
6. Touch targets at least 44 px (Start check, Dismiss, tabs); one blue
   primary action per screen; text readable at 390 px.

## Record

- Screenshots: Home before the send, the capture page, Home with the notice,
  Photos and People with the badge.
- Every place a status, count or message disagreed with what the person had
  done, with the URL and the exact words.
- Anything that needed more than one tap to start the check from Home.

## Out of scope

Manager review, the photo task flows, real devices and camera handoff
(emulation only), Batch C's sign-in return path.
