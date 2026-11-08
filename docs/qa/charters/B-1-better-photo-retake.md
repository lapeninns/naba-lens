# Charter B-1: retake a dish photo a manager asked to improve

Exploration charter for the e2e runner (`e2e explore`), batch B of the flow
improvement work (ME-1, PPL-1, PPL-2, S-ME1, S-ME2, S-ME3). It complements
the repeatable Playwright spec `tests/e2e/better-photo.spec.ts`; it does not
replace it.

## Charter

As staff whose dish photo a manager asked to retake, find the request on your
phone and send a better photo of the same dish; then check People and a
colleague's page, and edit your profile.

## Setup (isolated stack only, disposable fixtures)

- A world from `provisionCoverageWorld()` (`tests/e2e/helpers/coverage-world.ts`)
  with The Railway food menu imported and activated on venue 1
  (`importRailway`), and `legacyStaffGrant(admin, manager, venue1)`.
- One seeded photo by staff A (`seedImages`), labelled by staff A's own
  session with Momo, variant Veg (`save_media_labels`).
- As the manager, on `/staff/manage/menu/items`: "Ask for a better photo" on
  that photo with a reason (for example "Show all ten momos, in focus").
- Sign in as staff A with `signedInPage` at 390 × 844, touch, Chromium.

## Permitted actions

- Read every staff page; tap links, buttons and tabs.
- Take or choose one new photo from the request (the runner supplies a
  synthetic JPEG to the picker), keep or remove the dish chip, tap Done.
- Edit profile: change the display name and save; then put it back.
- Not permitted: deleting photos, acting as the manager or admin after setup,
  anything on another venue, signing out.

## What to check (oracles)

1. Me shows "Better photo requested" with a count, and a row for Momo (Veg)
   with the photo, the dish name and the manager's note. No other
   section repeats it.
2. One tap on "Take a new photo" opens the camera picker (capture
   `environment`). After picking, the "Saving 1 photo" sheet shows a
   removable Momo (Veg) chip. Done closes it: at most 2 taps from Me.
3. The new photo is labelled Momo (Veg) once saved (the Add sheet row says
   Saved with that dish) and appears in the portfolio. Nothing says it was
   sent to the manager before it is saved.
4. "Choose from photos" on the same row opens the library picker with the
   same chip.
5. People: the list is A to Z by name; "Showing 1 to N, A to Z by name";
   "Next people" adds below without jumping. A colleague's page: opening a
   photo shows no "Open profile" button; on Photos the same viewer does.
6. Edit profile: Save changes closes the dialog and Me shows "Profile
   saved." (role status); it goes when Edit profile opens again.
7. Touch targets at least 44 px (Take a new photo, Choose from photos, Next
   people, Save changes); one blue primary action per screen (Upload on Me);
   keyboard focus visible on each button; no sideways scrolling at 390 px.

## Record

- Screenshots: Me with the request, the Saving sheet with the chip, Me after
  the save, People footer, a colleague's viewer.
- Every place a status or message disagreed with what had happened, with
  the URL and the exact words.
- The tap count from Me to Done.

## Out of scope

Manager review of the new photo, real devices and camera handoff
(emulation only), server error pages for the profile save (413/504 are
covered by unit tests), Home and Tasks (batch A).
