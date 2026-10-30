# Staff accounts

How admins invite and manage staff (spec v0.2 §3 "Staff directory", §7, backlog M5).
Code: `lib/server/accounts/**` (server logic) and `app/admin/staff/**` (pages, Server
Functions, avatar route). Tests: `tests/integration/staff-accounts.test.ts`,
`tests/e2e/staff-accounts.spec.ts`.

## Screens

- **`/admin/staff`** lists every staff account (admins are not listed) by name: photo or
  initials, name, job title, current venue, email and status. Actions per row: open
  portfolio, edit details, resend invitation (invited only), deactivate or reactivate.
  **Invite staff** opens the invitation dialog.
- **`/admin/staff/[id]`** shows the profile header with the same actions, and the
  person's ready media in the shared gallery. Each item keeps its upload-time venue,
  including after a transfer and after deactivation.

Status is derived, not stored:

| Status   | Meaning                                                           |
| -------- | ----------------------------------------------------------------- |
| Invited  | Active profile; the auth user has never signed in.                |
| Active   | Active profile; has signed in at least once.                      |
| Inactive | `profiles.active = false`. Always wins over the other two states. |

## Authorisation

Every operation in `lib/server/accounts` takes `{ caller, service }`. `caller` is the
request's own Supabase client (RLS applies). Each function first re-reads the caller's
session and **current** profile and refuses anyone but an active admin
(`requireAdminCaller`). This is the same check as `requireActiveAdmin`, so a Server
Function reached by a direct POST is refused even if the page was never rendered.

- Profile edits (name, job title, venue, activation, avatar link) are written through
  `caller`, so `profiles_update_admin` and the `profiles_guard` trigger apply as well.
  Admins can edit staff only. Admin accounts are managed only by
  `pnpm bootstrap:admin`.
- `service` (service role) is used only after that check for:
  - the Auth admin API (create user, send invite, ban/unban, read emails);
  - the profile insert, which end users have no grant for;
  - avatar object writes.
- Invitations hard-code `role: "staff"`. No input field can create an admin.

## Invitation flow

`inviteStaff` (Server Function `inviteStaffAction`):

1. Validate the input; the venue must exist and be active.
2. Look the email up among auth users.
   - **Has a profile** → refused: "already has a NabaLens account". Nothing changes. If
     they have not signed in, use **Resend invitation**.
   - **No profile, created by an earlier interrupted invite** (user metadata
     `nabalens_invite: true` and never signed in) → adopted; the flow continues from
     step 4.
   - **No profile, some other auth user** → refused. Ask the system owner.
3. `auth.admin.createUser({ email_confirm: false })`. This sends no email. A
   concurrent duplicate fails here with `email_exists`, so two parallel invites create
   one account.
4. Insert the `staff` profile. On failure the new auth user is deleted again. If that
   delete also fails, step 2 adopts the user on retry.
5. `auth.admin.inviteUserByEmail(email)` sends the invite template
   (`supabase/templates/invite.html`). Its link is
   `/auth/confirm?token_hash=…&type=invite`, which shows "Accept your invitation" with a
   Continue button; only Continue uses the token (mail scanners that prefetch links cannot).
   - **Email fails** → the account stays and shows as **Invited**. The dialog says
     "Account created, email not sent", never "sent". **Resend invitation** recovers.

**Resend invitation** calls `inviteUserByEmail` again. For an unconfirmed user that sends
a fresh link and creates nothing. It is refused for inactive accounts (reactivate first)
and for people who have already signed in (they use `/login`).

Invitation links expire after `[auth.email] otp_expiry` (3600 s locally). An invitee who
has not accepted yet cannot get a link from `/login`: it answers neutrally and sends
nothing, because sign-ups are disabled and the user is unconfirmed. In both cases the
admin uses **Resend invitation**.

## Edits, venue transfer, deactivation

- **Edit details**: display name, job title, venue (active venues only; the database
  refuses inactive ones too) and profile photo.
  - A venue change applies to future uploads only. `reserve_media_asset` snapshots the
    venue onto each asset.
  - The photo is uploaded to `POST /admin/staff/[id]/avatar` (multipart `file`, at most
    `MEDIA_LIMITS.maxAvatarBytes`). It is a Route Handler because Server Functions cap
    bodies at 1 MB. The server re-encodes it with `createAvatarDerivative`, stores it
    at `avatars/{user_id}/{uuid}.webp`, then links it and removes the old object.
- **Deactivate** first sets `profiles.active = false`.
  - Every page, Server Function, RLS policy and storage policy re-reads that flag, so
    sessions that are already open are refused on their next request
    (`requireActive*` → `/auth/blocked`).
  - It then bans the auth user (`ban_duration`), which revokes refresh tokens and blocks
    new sign-in links. A failed ban is reported as a warning; the account is still
    deactivated.
  - Access tokens already issued (`jwt_expiry`, 1 h) still authenticate to Supabase,
    but every NabaLens check denies an inactive profile.
  - Retained media stays visible to admins.
- **Reactivate** lifts the ban first, then sets `active = true`. The person signs in
  again with a new link.

## Email delivery

### Local

Supabase Auth sends through the stack's bundled Mailpit. Open the URL that
`supabase status` prints as `MAILPIT_URL`, for example http://127.0.0.1:55424 for the
default stack. Templates come from `supabase/templates/*.html` via `config.toml`.

### Production (not configured; needs the owner)

Supabase's built-in email service is for testing only. It is rate-limited and only
delivers to project team members. Before inviting real staff, configure custom SMTP on
the hosted project (Dashboard → Authentication → Emails → SMTP Settings). With
**Resend**, for example:

| Setting           | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| Host              | `smtp.resend.com`                                                       |
| Port              | `465` (TLS) or `587` (STARTTLS)                                         |
| Username          | `resend`                                                                |
| Password          | A Resend API key with sending access only (store it as a secret only)   |
| Sender email/name | An address on a domain verified in Resend (SPF + DKIM), e.g. `NabaLens` |

Also on the hosted project:

- **Email templates**: paste `supabase/templates/invite.html` into "Invite user" and
  `magic_link.html` into "Magic link", with the same subjects as `config.toml`. The
  default templates use `{{ .ConfirmationURL }}`, which goes through the PKCE callback
  and fails when the link is opened in another browser.
- **Site URL** = the production origin. The templates build links from
  `{{ .SiteURL }}`. Add `<origin>/auth/callback` and `<origin>/auth/confirm` to the
  redirect allow-list.
- **Rate limits** (Authentication → Rate Limits): with custom SMTP, the default email
  limit is low (about 30 per hour). Raise it to cover inviting a whole venue at once.
- **OTP expiry**: consider up to 86400 s (24 h) so invitations survive a shift. This
  also lengthens magic-link lifetime; resend works either way.
- Keep "Allow new users to sign up" **off** and the Email provider **on** (see
  `docs/fanout/STATUS.md`).

For a self-hosted or CLI-managed config, the same values go in `[auth.email.smtp]` with
`pass = "env(RESEND_API_KEY)"`. Never commit the key.

## Short admin guide

1. **Staff → Invite staff.** Enter name, email, optional job title and venue. The person
   gets an email titled "You have been invited to NabaLens".
2. If the dialog says the email was not sent, or the person cannot find it or the link
   expired, choose **⋯ → Resend invitation**.
3. To move someone to another venue, choose **⋯ → Edit details → Venue**. Their earlier
   photos keep the old venue.
4. When someone leaves, choose **⋯ → Deactivate**. They are signed out of NabaLens
   everywhere on their next action. Their uploads stay in the library. **Reactivate**
   restores access.
