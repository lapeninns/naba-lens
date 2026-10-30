# Admin guide

## Sign in and find media

At `/login`, enter your admin **Email**, choose **Send sign-in link**, and open
the single-use email link. **Check your email** does not confirm
delivery or access. For **That sign-in link has expired**, request another.
For **Account unavailable**, contact the system owner; that screen offers
**Sign out**. Inside the app, use **Log out**.

1. Open **Content** (`/admin`): ready media, newest first, without approval.
   The visible library refreshes about every 15 seconds and on tab focus.
2. Combine **Venue** (initially **All venues**), **Staff member** (**All staff**),
   and **Photos**, **Videos** or **All**; all filters apply together.
   **Clear filters** resets them. Venue means upload-time venue; inactive
   staff/venues remain selectable for retained media.
3. **Load more** fetches up to 24 older assets with the same filters.
   For **Nothing matches these filters.**, broaden or clear filters.
4. Open a tile. The viewer shows **Contributor**, **Venue at upload** and
   **Uploaded**. Choose **Download original** for one unchanged uploaded file,
   not its preview. For **Preview unavailable in this browser**, download the
   ready original instead; video playback depends on browser/codec support.

**Open portfolio** leads to `/admin/staff/[id]`. You can also open **Staff**
(`/admin/staff`) → **Portfolio** on desktop, or the person's row on phones.
Individual portfolios have previews and **Load more**, but **no download or
delete actions**. Use **Content** filtered by **Staff member** instead.
Reload a portfolio page if its previews expire.

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

## Invite staff and recover email failures

In **Staff**, choose **Invite staff**. Fill **Name**, **Email**,
**Job title (optional)** and **Venue** (an active venue), then **Send invitation**.
Invitations create staff only; additional admins use [setup](setup.md).

- **Invitation sent**: **Close**. Status stays **Invited** until first sign-in.
- **Account created, email not sent**: **Close**, then **Resend invitation** in
  the person's three-dot menu (“More actions for” their name) or portfolio
  header. Do not create a duplicate.
- Follow existing-email errors. Resend is available only while **Invited**;
  existing users request links at `/login`. Reactivate inactive accounts first.

## Edit details, move venues or stop access

Choose **Edit details** in the menu or portfolio header. **Edit staff account**
allows **Display name**, **Profile photo** (up to
5 MiB, shown as **5.0 MB**), **Job title**, **Venue** or **Account active**,
then **Save changes**. Email and role are not editable here.
Venue changes affect new uploads only; old media keeps its original venue.
A photo may save before a later field fails; recheck errors.

For a confirmed access change, choose **Deactivate**. The
“Deactivate [name]?” dialog says:

> They lose access straight away, including on phones where they are still signed in. Their uploads stay in the library, and you can reactivate the account later.

Choose **Cancel** or **Deactivate**. Existing sessions lose access on their next
protected request; admins retain the portfolio's ready media. **Reactivate**
restores access without confirmation. The **Account active** switch also changes
access on **Save changes**, without the deactivation dialog.

## Delete media and use it responsibly

In **Content**, open the item and choose **Delete**. The confirmation reads:

> Remove this file from your portfolio and the admin library? Previously downloaded copies cannot be recalled.

Choose **Keep file** or confirm with **Delete**. Deletion hides the same asset
from both library and portfolio; there is no trash/recovery screen. Existing
signed links may work until expiry, and downloaded copies cannot be recalled.

Check privacy and permissions before external use: ready media is not
publishing clearance.
