# Charter C-1: a manager review deep link from an email, on a phone

**Mission.** Signed out, open a manager review deep link from an email on a phone, sign in with the code, and confirm you land on that review.

**Issue:** AUTH-1. **Automated part:** `tests/e2e/auth-return.spec.ts` ("manager on a phone: code sign-in returns to the review deep link", plus link, admin, wrong-role and unsafe `?next=` cases).

## Steps

1. Phone (390×844), no session. Open `/manager/review?status=pending` (or any review deep link with a query).
2. Expect `/login?next=%2Fmanager%2Freview%3Fstatus%3Dpending`. The page looks exactly like plain sign-in; the return path is never shown.
3. Send the link, then enter the code from the email in the same tab. Expect to land on `/manager/review?status=pending` with the filter applied.
4. Sign out, then repeat with the **emailed link** in the same browser instead of the code. Same result (the return path rides in a 1-hour HttpOnly cookie, because the email templates link to the site URL).
5. Sign out, then open `/staff/tasks` and sign in as the manager. Expect `/manager`, not the staff page (wrong-role paths fall back to the role home).
6. Open `/login?next=//evil.example`, then `/login?next=https://evil.example`, then `/login?next=/api/library`, and sign in. Expect the role home on this origin every time. View the source: the value never appears.

## Record

- The URL after each sign-in; time from code entry to the page.
- Anything on screen that mentions the return path (there should be nothing).
- Cookie `nl-return-to`: HttpOnly, Lax, Path=/, about 1 h, Secure on HTTPS. It is gone after the first app page following sign-in.
