# Charter C-2: an ended session during a manager or admin action

**Mission.** As a manager with an expired session (cookies cleared mid-session), try to accept a photo and rename your account. Record exactly what you see and whether your input survives. Repeat once as an admin (resend an invitation or edit a person).

**Issues:** AUTH-2 (in-place "Sign in again" outside staff uploads), S-A1 (what a Server Action does with no session).
**Automated part:** `tests/e2e/auth-return.spec.ts`, "an ended session mid-task" (manager rename, phone width). The charter covers the parts a script checks poorly: what the screen *says*, the photo review, the admin pages, and the link opened in another tab.

## What the code says happens (derived from Next 16.4 source, not yet observed)

Before this batch (head 4684e76d):

1. The page posts the Server Action with `fetch(page URL, { method: "POST", headers: { "Next-Action": id } })` (`next/dist/client/components/router-reducer/reducers/server-action-reducer.js`, `fetchServerAction`). The default `redirect: "follow"` applies.
2. `proxy.ts` sees no session on a protected path and answers **307 → /login**. The browser follows it, re-POSTing body and headers to `/login`.
3. On `/login`, Next does not find the action in that page's worker and **forwards** it to the worker that owns it (`server/app-render/action-handler.js`, `selectWorkerForForwarding` → `createForwardedActionResponse`, `redirect: "manual"`). That forwarded POST hits the proxy again and gets another 307. Its response is not RSC, so the forwarder returns `{}` as JSON with status 200.
4. The client sees a 200 that is not `text/x-component`, has no `x-action-redirect` and no not-found marker, and throws **"An unexpected response was received from the server."**
5. The action never runs, so its own "Sign in again" copy (`app/_media/actions.ts`, `components/nabalens/tasks/copy.ts`) can never show. Each caller shows its generic failure: for example the manager account form's "Your name could not be saved. Try again.", or an error boundary if the call was not caught. Nothing tells the person the session ended. Reloading leads to `/login` and then to the role home (AUTH-1), so the page and its input are lost.

After this batch:

1. `proxy.ts` answers a `Next-Action` POST on `/staff`, `/manager` or `/admin` without a session with **401, `content-type: text/plain`, body "You were signed out. Sign in again, then try again. Nothing was saved."** For a 4xx `text/plain` response, Next throws that text as the action's error. The action still never runs. Pages reachable signed out (`/login`, `/auth/*`, `/`) are exempt.
2. `SessionGuardHost` (manager and admin layouts) checks the browser session on every tap and submit, when the tab returns or comes online, every 30 s in view, on the auth client's `SIGNED_OUT`, and when an action is rejected with that message. When the session is gone (confirmed once, 1 s later), it opens the **"Sign in again"** sheet over the page. Typed input stays.
3. "Send sign-in link" mails a link and code. A code entered in the sheet signs the same person in, closes the sheet and refreshes the page's server data, keeping client state. Opening the link in another tab closes the sheet too, on focus or within 3 s. A different account's code is refused: "That code signed in a different account. Reload the page to continue as that account."
4. "Not now" closes the sheet. Taps do not reopen it, but an action refused for the ended session does.
5. Offline, or an auth server that cannot be reached, is never treated as signed out.

## Setup

- Stack spare6, production build of `task/flows-batch-c` merged into the integration head.
- A manager account with an effective grant and at least one photo waiting in Review; an admin account. Mailpit open for the codes.
- Phone (390×844, touch) for the manager, desktop (1280×800) for the admin.

## Steps and what to record

| # | Do | Expect after this batch | Record |
|---|---|---|---|
| 1 | Manager: sign in, open Review, start an Accept, or open Account and type a new name. Do not submit. | Normal page | Screenshot |
| 2 | Clear site cookies (DevTools, Application, Cookies, or `context.clearCookies()`) | Nothing changes yet | — |
| 3 | Tap **Accept** (Review) or **Save name** (Account) | Within about 1 s the "Sign in again" sheet opens with your email. The page's own error may also show ("Your name could not be saved. Try again."). The typed name is still in the field. Network: the action POST is **401 text/plain** with the message above, and there is no request to `/login`. | Exact wording, network status, whether input survived, whether the photo's state changed (it must not) |
| 4 | Send sign-in link, enter the code | Sheet closes, page stays, input still there | Time to close; any flash or reload |
| 5 | Repeat the action | Succeeds; Review shows the decision; Account says "Your name is saved." | DB or UI evidence |
| 6 | Repeat 2–3, then choose **Not now**, then tap around | Sheet stays closed; taps do not reopen it | — |
| 7 | Tap Accept or Save again | The action is refused (401); the sheet reopens only if the screen reports it or leaves the rejection unhandled. Note which manager screens do neither. | Screen list |
| 8 | Repeat 2–4, but open the emailed **link** in a new tab | That tab signs in and lands on the role home or the remembered page. The first tab's sheet closes when you return to it. | — |
| 9 | Admin, desktop: Staff, then Resend invitation or edit a person; clear cookies; act | Same as 3–5. Note what the admin control itself says (batch D owns its error copy). | Wording |
| 10 | Turn the network off, then tap around | No sheet (offline is not a sign-out) | — |

## Pass criteria

- No action runs while signed out (no DB change between steps 3 and 5).
- The person is told the session ended and can sign in again **without leaving the page**, and their input survives (acceptance 2 of batch C).
- No open redirect, and no sheet when merely offline.

## Known limits (report, don't fail)

- Screens that catch the rejection pass it to `useSessionEndedCatch()`: for the ended session it opens the sheet at once (even after "Not now") and returns "You were signed out. Sign in again, then try again. Nothing was saved." for a save to show instead of its lost-connection text. Loads keep their own text. Fetch-based routes (avatar upload, menu import preview) are not Server Actions and keep their own 401 handling.
- Staff pages still use the upload-only guard in `AddHost` until integration adopts `SessionGuardHost` there.
