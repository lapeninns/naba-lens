# Admin guide

## Sign in and find media

At `/login`, enter your admin **Email**, choose **Send sign-in link**, then
open the single-use email link or enter its 6-digit code in **Sign-in code**
and choose **Sign in with code** (see the
[staff guide](usage-staff.md#sign-in-and-leave-safely)). **Check your email**
does not confirm delivery or access. For **That sign-in link has expired**, request another.
For **Account unavailable**, contact the system owner; that screen offers
**Sign out**. Inside the app, use **Log out**.

1. Open **Content** (`/admin`): every ready photo and video across Lapen Inns,
   newest first, without approval. On a phone, admin navigation is the TabBar
   at the bottom.
   The visible library refreshes about every 15 seconds and on tab focus.
2. Combine **Venue** (initially **All venues**), **Staff member** (**All staff**),
   and **Photos**, **Videos** or **Photos and videos**; all filters apply
   together.
   **Clear filters** resets them. Venue means upload-time venue; inactive
   staff/venues remain selectable for retained media.
3. **Load more** fetches up to 24 older assets with the same filters.
   For **Nothing matches these filters.**, broaden or clear filters.
4. Open a tile. The viewer shows who uploaded it, **Venue at upload** and
   **Uploaded**. Choose **Download original** for one unchanged uploaded file,
   not its preview. For **Preview unavailable in this browser**, download the
   ready original instead; video playback depends on browser/codec support.

**Open profile** leads to `/admin/staff/[id]`. You can also open **Staff**
(`/admin/staff`) and choose **Open profile** in a person's three-dot menu, or
the person's row on phones. A person's admin profile has previews, **Load
more**, **Download original** and **Delete**, using the same gallery behavior
as Content. The gallery
refreshes about every 15 seconds and on tab focus.

## Staff community and team assignments

On a phone, staff have a TabBar with **Home**, **Photos**, **Add**, **People**
and **Me**; from a tablet or computer the same sections sit in the top bar,
and venue managers also have **Manage** there. On a phone, **Manage** is the
first row on **Me**. Staff land on **Home**.
Photos shows ready photos and videos across the organisation with venue,
FOH/BOH team and media filters. People lets staff search colleagues by name,
current venue and team, then open a colleague's profile. See the
[staff guide](usage-staff.md#photos-and-people) for the viewing flow.
Admin navigation is **Content**, **Staff**, **Menus** and **Coverage**.

Community profiles show name, photo, job title, department, current venue and
ready-upload count. Account email and access-management fields stay in admin
tools. Staff viewing a colleague cannot edit the account or labels, delete
the colleague's uploads, or use the admin **Download original** route, and
never see original filenames. Colleague video playback does deliver the
original file, including embedded metadata such as location.
Only ready, non-deleted uploads from active staff are shared with colleagues.
Deactivating an account removes it from People and stops peers reading its
media on subsequent protected requests; admins retain ready media in Content.
Previously issued short-lived media links may work until expiry.

Assign **Department** when inviting staff or in **Edit details**. The choices
are **Front of house (FOH)**, **Back of house (BOH)** or **Unassigned**. Existing
accounts remain unassigned until an admin chooses a department; the app does
not infer it from a job title. Unassigned staff remain visible under **All
teams**. Department is a team label, separate from the `staff` / `admin`
access role, and staff cannot change their own assignment. Coverage needs it:
staff without a department show **Needs setup** for their monthly target, and
it suggests who a manager assigns to a task without granting any access.

The app represents one parent organisation with venues as its units. It uses
the configured venue records and does not create or assume a list of ten
sister companies. The [community deployment notes](community.md) describe the
required database migrations; these guides do not establish production status.

## Filter by labels and correct them

The Content filters also include **More filters**: menu item (and variant) and
menu category (choose a venue first), content type, **Labelled / Needs
labels**, a date range, and a search box over item names, aliases, notes and
missing-item suggestions. Filters combine; each file appears once. Open a file
and choose **Edit labels** to correct its labels (ready files only). Labels are
optional, so unlabelled uploads still appear immediately.

## Menus (catalogue for labelling)

**Menus** holds each venue's menu, used only for labelling. It is not a public
menu, does not change any venue website, and an active menu does not mean the
venue is serving a dish today.

1. Open **Menus → venue**. Start an empty draft, a draft from the active menu,
   or import a file. Only structured **JSON** (`nabalens-menu@1`) and **CSV**
   files are supported (see `docs/menus-import.md`); PDF, image, Word and
   JavaScript menus are not read.
2. The preview lists added, changed, removed and **uncertain** items. Items are
   matched only by their source key; a same-name match is uncertain until you
   choose **Same item as …** or **Treat as new item**. Create the draft.
3. Edit sections, items, variants and aliases, then **Save**. If another admin
   saved first, you get a conflict and can reload the latest copy.
4. **Activate** when there are no unresolved items or errors. The previous
   active version is retired; existing labels are kept. **Retire** removes a
   venue's active menu; **Archive** stops one item being used for new labels.
   Nothing that has labels is ever deleted.
5. Review **missing-item suggestions** on the venue page: link them to an item
   or dismiss them.

Prices, dietary and spice values from an import are stored only as source
details for reference.

Activating a new version for a venue with menu coverage shows **Menu changed —
review coverage** in that venue's coverage screens. Its manager, or an admin,
then decides which accepted photos carry over to which new section. Nothing is
matched by section name, so the venue's menu coverage is not current until
that is done.

## Coverage: venue managers, targets and oversight

**Coverage** (`/admin/coverage`) shows, for one month at a time, every venue's
photo coverage and its staff's monthly participation, counted separately.
Dates are UK time.

- **Venue coverage** lists each venue's checklist progress, items needing setup
  or reassignment, photos waiting for review, overdue items and menu coverage.
  A venue is complete only when every applicable checklist item has enough
  accepted photos and its menu coverage is current. Items marked not
  applicable stay visible with their reason and are not counted.
- **Staff participation** shows targets set, people who need setup and
  accepted photos. A person is complete only with a venue, a team, a target
  and enough of their own photos accepted for that month. Missing setup never
  counts as complete.
- **Monthly preparation** copies last month's targets and checklist items
  into the new month for every venue. It shows how many venues are prepared
  and when it last ran, **Preparation by venue** (targets copied and people who
  need setup), and **Recent runs** from the last 7 days with each result and
  error code. **See all runs** lists every run, any month. **Prepare this
  month** (or **Prepare again**) runs it now; it runs every hour anyway and is
  safe to repeat. Venues not prepared yet are named at the top of Coverage.
  See [operations](operations.md#monthly-coverage-preparation).
- **Self-reviews** lists each decision a manager made on their own photo.
  **Our menu self-reviews** lists, separately, each manager decision on their
  own photo for a dish.
- Open a venue for the same **Overview**, **Review**, **Checklist**, **Menu**,
  **Our menu** and **Team** screens a manager has (see the
  [staff guide](usage-staff.md#manage-venue-managers-only)), for any venue.
  Food menu sections show staff the dish
  [photo guide](usage-staff.md#photo-guide); its examples are fixed app
  images, not venue media, and cannot be changed from the admin screens.
  Admins can also attach retained photos from people who have left, and
  correct a past month's target with a reason; the correction is recorded.

**Our menu** counts menu items with an accepted photo: one photo accepted for
a dish covers that dish (one main photo per dish; variants are recorded as
context). It is separate from section coverage and monthly targets, and
accepting for a dish never changes those totals. An upload or a label alone
never counts. Staff see their own work details, set at `/staff/profile`; only
they and admins see them, and they never change job title, department, team,
venue or access.

Accepting a photo records task completion only. It is not publishing
clearance, and coverage does not gate what staff see: ready photos are in
Photos and on profiles before review.

### Venue managers

A venue manager is a separate account type with its own workspace
(`/manager`; see the [manager guide](usage-manager.md)). To make one, open the
person in **Staff** and, under **Account type**, choose **Make venue manager**
(also in their three-dot menu in the directory). Choose the venue, give a
**Reason** and confirm: the account becomes a venue manager at that venue with
venue access there, in one audited change. Their photos, credit and review
history stay with them; they can no longer add or label photos, or use staff
Photos and People, and their open photo tasks end. **Return to staff account**
reverses it and ends their venue access. Both changes take effect on the
person's next page load and are listed under **History**.

**Venue managers** in Coverage (`/admin/coverage/managers`) lists every grant,
A to Z by surname. **Give a venue manager access** gives access to a manager
account at its own venue that has none (for example after a revoke). A grant
works only while the manager is active at that venue and the venue is active.
Moving them, deactivating them or changing their account type ends it, and it
never moves with them. **Revoke grant**, in the grant's **More actions for**
menu, needs a **Reason**; the manager then sees **Venue access unavailable**
on their next page load. **Show ended grants** lists how each one ended.

Grants made before manager accounts existed are held by staff accounts and
show **Legacy staff grant**. They stay in effect, with the older **Manage**
tools in the staff area (see the
[staff guide](usage-staff.md#manage-venue-managers-only)), until you convert
the person to a venue manager account.

Managers never decide on their own photos or on photos by people who have
left. Review those, and any venue's menu photos, on the admin Review page at
`/admin/coverage/{venue}/menu-photos`: the same lists and decisions as the
manager's **Review**. Being a manager does not let anyone invite or deactivate
people, change roles, venues or teams, publish menus, download originals or
delete colleagues' photos. Manager screens show names, photos and progress,
never email or account details.

## Invite staff and recover email failures

In **Staff**, choose **Invite staff**. Fill **Name**, **Email**,
**Job title (optional)**, **Department** (or leave **Unassigned**) and **Venue**
(an active venue), then **Send invitation**.
Invitations create staff only; additional admins use [setup](setup.md).

- **Invitation sent**: **Close**. Status stays **Invited** until first sign-in.
- **Account created, email not sent**: **Close**, then **Resend invitation** in
  the person's three-dot menu (“More actions for” their name) or profile
  header. Do not create a duplicate.
- Follow existing-email errors. Resend is available only while **Invited**;
  existing users request links at `/login`. Reactivate inactive accounts first.

## Edit details, move venues or stop access

Choose **Edit details** in the menu or profile header. **Edit staff account**
allows **Display name**, **Profile photo** (up to
4 MiB, shown as **4.0 MB**), **Job title**, **Department**, **Venue** or
**Account active**, then **Save changes**. Email and role are not editable here.
Venue changes affect new uploads only; old media keeps its original venue.
A photo may save before a later field fails; recheck errors.

For a confirmed access change, choose **Deactivate**. The
“Deactivate [name]?” dialog says:

> They lose access straight away. On a phone that's still signed in, the next thing they do shows Account unavailable.
>
> Their uploads stay in the library, and you can reactivate the account later.

Choose **Cancel** or **Deactivate**. Existing sessions lose access on their next
protected request; admins retain the person's ready media. **Reactivate**
restores access without confirmation. The **Account active** switch also changes
access on **Save changes**, without the deactivation dialog.

Both changes affect coverage. A venue move ends any manager grant, and the
person can no longer send photos to the old venue's tasks; their past months
and accepted photos stay with the old venue. Deactivation also ends the grant
and closes the person's open task assignments with a reason, so the checklist
shows **Needs reassignment**. Their accepted photos remain visible to that
venue's manager and admins in coverage screens, while Photos and People stop
showing them as before.

## Delete media and use it responsibly

In **Content**, open the item and choose **Delete**. The confirmation reads:

> Remove this file from Priya's profile, Photos and the library? When backups are enabled, copies are retained indefinitely for recovery. Previously downloaded copies cannot be recalled.

(with the owner's first name; when the photo counts toward a task or a target,
it also says what stops counting).

Choose **Keep file** or confirm with **Delete**. Deletion hides the same asset
from the library, the owner's profile and Photos; there is no trash/recovery
screen. Reload Photos or a profile to update its gallery. Existing signed links
may work until expiry, and downloaded copies cannot be recalled.

Check privacy and permissions before external use: ready media is not
publishing clearance.
