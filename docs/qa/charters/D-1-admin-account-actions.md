# Charter D-1: admin account actions on a flaky connection

**Mission:** As an admin on a flaky connection, resend an invitation, reactivate a person, and change a photo plus a job title. Confirm that every message matches what actually happened.

- **Journey:** J23 (Admin Staff).
- **Issues:** ADM-1 (Resend and Reactivate gave no pending state and failed silently; a double tap resent the invitation), ADM-2 (the edit dialog said "could not be saved" after the photo had saved).
- **Role:** admin. Role boundaries are unchanged: staff still get 403 from `/admin/staff/{id}/avatar` and cannot open `/admin/staff` (covered by `staff-accounts.spec.ts`).
- **Time box:** 30 minutes.

## Setup

- A local stack with an admin, an **Invited** staff member (never signed in), an **Inactive** staff member and an **Active** staff member.
- A desktop browser at 1280 px and a phone viewport at 390 px.
- DevTools network throttling ("Offline" and "Slow 3G"), or a Playwright `page.route` abort on the page's Server Action POST (header `next-action`).
- A screen reader (VoiceOver or NVDA), or the accessibility tree view, to hear the live region.

## Explore

1. **Resend, slow connection.** On the Invited person's page, set Slow 3G and tap **Resend invitation** twice quickly.
   - Expect the button to change to **Sending invitation…**, become disabled, and keep a 44 px height.
   - Expect "Sending the invitation to {email}…" to be announced.
   - Expect exactly one request in the network panel and one email in Mailpit.
   - Then expect "Invitation sent again to {email}. Earlier links stop working."
2. **Resend from the directory.** On **Staff**, use the row's **More actions → Resend invitation**, then reopen the same menu while the request is pending.
   - Expect the item to read **Sending invitation…** and be disabled.
   - Expect Resend, Reactivate and Deactivate on other rows to be disabled until the request finishes.
   - Edit details also waits (header button and menu item), so an edit can't race the action.
3. **Resend, offline.** Go offline and tap **Resend invitation**.
   - Expect "We couldn't confirm the invitation to {email} was sent. Check your connection, then try again. A new invitation replaces any earlier link." in the live region. The copy never says nothing changed: a dropped reply does not prove the server did nothing.
   - Expect the button to be enabled again.
   - Fully offline, expect no email in Mailpit.
4. **Reactivate, offline then online.** On the Inactive person's page, go offline and tap **Reactivate**.
   - Expect **Reactivating…** (disabled), then "We couldn't confirm {name} was reactivated. Check your connection, then refresh to see their status."
   - Expect the status to still read Inactive until a refresh shows what the server holds.
   - Go back online and tap **Reactivate** again. Expect "{name} can sign in again." and the status to change straight away.
5. **Photo plus job title, details dropped.** On the Active person's page, open **Edit details**, choose a new photo, change the job title, then abort only the Server Action POST (let `/avatar` through) and tap **Save changes**.
   - Expect the alert "Some changes may not have saved: The profile photo was saved. We couldn't confirm the changes to {first}'s job title saved. Check your connection and try again."
   - With only a new photo chosen, expect only "The profile photo was saved." (no alert, no "try again").
   - If the server refuses the details instead (for example an over-long job title), expect "Some changes didn't save: The profile photo was saved. The changes to {first}'s job title weren't saved." followed by the server's reason.
   - Expect the new photo to stay in the preview, and the file input to be empty.
   - Go back online and tap **Save changes**. Expect no second `/avatar` request, the dialog to close, "Saved {name}.", and the new job title and photo on the page.
6. **Fully offline edit.** Go offline before **Save changes** with a photo chosen.
   - Expect "We couldn't confirm the photo uploaded. Check your connection and try again."; after a refresh, nothing saved.
   - With only a job title changed, expect "We couldn't confirm your changes saved. Check your connection and try again."
7. **Keyboard and focus.** Repeat steps 1 and 4 with the keyboard only.
   - Expect focus to stay visible.
   - Expect a disabled pending button to keep its place in the layout.
   - Expect the notice's Close button to work once the result arrives. The pending notice has no Close button.
8. **Phone (390 px).** Repeat steps 2 and 5.
   - Expect no horizontal scroll.
   - Expect the menu inside the screen.
   - Expect the dialog's alert visible above the fields.

## Pass when

- Every message names exactly what saved and what didn't, and says "couldn't confirm" when a reply was lost. "Nothing changed." appears only after a server refusal.
- No action ever runs twice from one intent.
- Every outcome reaches the live region.
- There is one blue primary per screen.

Log any mismatch with the time, the network state, the request count and a screenshot.

## Automated coverage

- Unit: `tests/ui/staff-account-controls.test.tsx` (9 cases).
- Playwright: `tests/e2e/staff-accounts.spec.ts`, describe block "admin account actions on a flaky connection (ADM-1, ADM-2)", 3 cases.
