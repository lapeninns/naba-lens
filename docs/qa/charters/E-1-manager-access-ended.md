# Charter E-1: a manager's access ends mid-session

**Mission:** As a manager on a phone, review today's dish photos. Then, while an admin ends your grant in another tab, keep navigating, and confirm you are told clearly that your access ended.

- **Journeys:** J18 (manager Review, Menu, item), J20 (Account), J03 (venue access unavailable), J19 (Capture myself), J21 (legacy staff-held Manage, refusal copy only).
- **Issues:**
  - MGR-1: every manager page said "We couldn't load menu photos", and a refused read after the workspace check threw into "Try again".
  - S-A2: after a revoke, client navigation kept the manager shell, and every tab looped back to the unavailable card.
  - MGR-2: the legacy Manage refusal said an admin could make you a venue manager.
  - S-M2: "Capture myself" was the primary action for accounts that cannot upload.
- **Roles:** a venue manager account, an admin, and a staff account with no grant. Role boundaries are unchanged. Every page and Server Function still re-checks the workspace, and the database still checks the venue scope on every read.
- **Time box:** 30 minutes.

## Setup

- A local stack with venue A and:
  - an active menu;
  - two staff members with labelled dish photos waiting for review;
  - a venue manager account for venue A;
  - an admin;
  - a plain staff account at venue A with no grant.
- A phone viewport (390 x 844, touch) for the manager, and a desktop window for the admin.
- To force a page error (step 6): DevTools request blocking, or a Playwright `page.route` abort on the page's RSC request (header `rsc: 1`).
- A screen reader (VoiceOver or NVDA), or the accessibility tree view.

## Explore

1. **Review as normal.** Sign in as the manager on the phone and open **Review**.
   - Accept one photo and ask for another photo on a second one.
   - Expect each decision to update the card in place and the Review badge to count down.
2. **Revoke while on Review.** In the admin window, open **Coverage → Managers** (or the person's page) and revoke the manager's grant with a reason. Do not reload the phone.
   - On the phone, tap **Menu** in the bottom bar.
   - Expect the URL to become `/manager`, and the heading **Venue access unavailable** to take focus and be announced.
   - Expect "Your venue access has ended." and one blue **Sign out** button.
   - Expect the bottom bar and top tabs to disappear (no tab loops back to this card), and no "We couldn't load" or **Try again**.
   - Expect no dish names, contributor names or venue name from venue A on the page.
3. **Every tab and deep link.** While the access is still revoked:
   - use the browser's Back and Forward buttons;
   - open `/manager/review`, `/manager/review/contributors/{staffId}`, `/manager/menu`, `/manager/menu/{itemId}` and `/manager/account` directly.
   - Expect the same unavailable state each time, with no flash of venue data.
   - Record what Back shows. If it shows the earlier Review page from the browser's cache, log it with a screenshot. It is a finding: no new data is read, but the page should not appear.
   - Expect thumbnails (`/api/menu-photos/{id}/thumb`) to return 404.
4. **Revoke during a decision.** Restore the grant, reload, and open Review. In the admin window revoke again, then on the phone tap **Accept** on a card without navigating.
   - Expect the card to say "You do not have access to this venue's workspace. Reload the page." with a **Refresh** link. Nothing is decided: check the item's history in the admin view.
   - Tap **Refresh**. Expect **Venue access unavailable** without the workspace nav.
5. **Venue closed, and account changed.**
   - Restore the grant, then deactivate venue A as admin and tap a tab on the phone. Expect "Your venue is not active."
   - Reactivate venue A, then convert the manager back to a staff account and tap a tab. Expect to land on the staff home, with no manager shell and no error state.
6. **Real failures still say what failed.** With access restored, block the page's data request and open each page in turn. Expect the page's own title and message, each with **Try again**:

   | Page        | Message                                                                  |
   | ----------- | ------------------------------------------------------------------------ |
   | Overview    | "We couldn't load the overview"                                          |
   | Review      | "We couldn't load photos for review"                                     |
   | contributor | "We couldn't load this contributor's photos", plus a link back to Review |
   | Menu        | "We couldn't load the menu"                                              |
   | menu item   | "We couldn't load this menu item", plus **Go to Menu**                   |
   | Account     | "We couldn't load your account"                                          |
   - Unblock the request and tap **Try again**. Expect the page to load in place.
   - With the keyboard only, expect focus to stay visible on **Try again** and on the back link.

7. **Capture myself.** As the manager, open an amenity check.
   - Expect **Capture myself** to be a grey (secondary) button.
   - Expect the line "Capture myself attaches photos and videos already on Naba-Lens. For new ones, assign this check to staff."
   - Repeat as admin through **Coverage → venue → Amenities**: expect the same.
8. **Legacy Manage refusal.** Sign in as the plain staff account and open `/staff/manage`.
   - Expect **Manage isn't available** and "Manage is for venue managers. To manage your venue, ask an admin to change your account to a venue manager account."
   - Expect **Go to Home** to be the only blue button.
9. **Phone checks.** At 390 px, on the states from steps 2, 6, 7 and 8, expect no horizontal scroll and touch targets of at least 44 px.

## Pass when

- Access ending is never shown as a failure. There is no "Try again" for it, only **Venue access unavailable** (or the staff home after a role change), and the workspace nav goes away after the first navigation.
- No venue data from after the revoke is ever rendered, and no decision is recorded after the revoke.
- A real failure names its page's content and offers **Try again**, plus a way back on detail pages.
- There is one blue primary per screen. Focus stays visible. The unavailable heading is announced.

Log any mismatch with the time, the step, the URL and a screenshot.

## Automated coverage

- Unit:
  - `tests/ui/manager-error-boundaries.test.tsx` (7 cases);
  - `tests/ui/manager-access-ended.test.tsx` (19 cases);
  - `tests/ui/manager-unavailable.test.tsx` (2 new cases);
  - `tests/ui/manager-review-decisions.test.tsx` (4 new cases: a refused decision offers Refresh);
  - `tests/ui/manage-not-manager.test.tsx` (1 case);
  - `tests/ui/amenities-manage-check.test.tsx` (1 new case);
  - `tests/ui/manager-amenities.test.tsx` (wiring assertion).
- Playwright: `tests/e2e/manager-access-ended.spec.ts` (2 cases, Chromium; the revoke runs in a 390 px touch context, the account change at 1280 px). Page loads after a revoke stay covered by `manager-workspace.spec.ts`.
