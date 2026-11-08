# Charter F-1: coverage writes on a flaky connection

**Mission:** As an admin on a flaky phone connection, revoke a venue manager and correct a staff member's monthly target. Confirm that every message matches what actually happened after you refresh.

- **Journeys:** Admin Coverage → Venue managers (revoke), Team roster (Correct target, Save targets), and any coverage write that uses the shared page notice.
- **Rule under test:** a lost reply (offline, or the response never arrived) must never say "Nothing changed", because the server may have applied the change. A server refusal keeps "Nothing changed." and gives the server's reason.
- **Role:** admin; a venue manager in a second tab for the revoke.
- **Time box:** 30 minutes.

## Setup

- A local stack with an admin, a venue with a venue manager grant, and staff with targets for this month and last month.
- A phone viewport (390 px) and a desktop browser.
- A way to lose only the reply: Playwright `page.route` that calls `route.fetch()` and then `route.abort()` for the page's Server Action POST (header `next-action`). DevTools "Offline" set after the request leaves works too.
- `psql` (or Supabase Studio) to read `venue_manager_grants` and `monthly_targets`.

## Explore

1. **Revoke, reply lost.** On Venue managers, open the manager's More actions, choose Revoke grant, give a reason, and drop the reply.
   - Expect in the dialog: "We couldn't confirm {first} is no longer {venue}'s venue manager. Check your connection, then refresh to see."
   - Expect the page notice: "We couldn't confirm your change was saved. Check your connection, then try again or refresh to see if it was."
   - Never "Nothing changed".
   - Check the database: `revoked_at` is set. Cancel, refresh, and the person is no longer under Current grants.
2. **Revoke, refused.** Revoke a grant that another tab has already ended, or one the server refuses for a reason you can trigger.
   - Expect "Nothing changed. {first} is still {venue}'s venue manager." followed by the server's reason, or, for a stale grant, the page notice that it changed and the page re-reading itself.
3. **Correct target, reply lost.** Last month, Correct target for a person, lower it, add a reason, and drop the reply.
   - Expect the title "Couldn't confirm the correction" and "We couldn't confirm the target changed. Check your connection, then refresh to see."
   - Retry once online. Expect the target to be correct, or a "someone changed this" refresh notice; never a second change.
4. **Correct target, refused.** Make the server refuse (for example a reason over the limit).
   - Expect the title "Couldn't save the correction" and "Nothing changed. {reason}".
5. **Save targets, reply lost mid-batch.** This month, change two people's targets and drop the second reply.
   - Expect "1 target saved. We couldn't confirm {name}'s target was saved. Check your connection, then refresh to see."
   - Refresh and compare both targets with the database.
6. **Fully offline.** Go offline before each action.
   - Expect the same "couldn't confirm" wording, and after a refresh, nothing changed.
7. **Keyboard and screen reader.** Repeat steps 1 and 3 with the keyboard only.
   - Expect the dialog error to be announced (role alert) and focus to stay in the dialog.
   - Expect focus on the page notice after a dialog closes.

## Pass when

- After every action, the message and the state after a refresh agree.
- "Nothing changed." appears only after a server refusal.
- No action applies twice.

Log any mismatch with the time, the network state, the request count and a screenshot.

## Automated coverage

- Unit: `tests/ui/coverage-lost-reply.test.tsx` (lost reply and refusal pairs for Revoke, Correct target, the shared notice and Save targets).
- Playwright: `tests/e2e/coverage-manager.spec.ts`, "revoke whose reply is lost: says it can't confirm, the grant really ended, and a reload shows it".
