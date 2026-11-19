# Staff guide

## Sign in and leave safely

Open `/login`, enter your invited address in **Email**, then choose
**Send sign-in link**. At **Check your email**, open the single-use email link.
This neutral response does not confirm access or delivery, and never
creates an account. For **That sign-in link has expired**, request another.

Staff land at `/staff`. If **Account unavailable** appears, ask an admin;
that screen has **Sign out**. In your portfolio header, use **Log out**,
especially on shared devices.

## Explore work across Lapen Inns

The staff navigation has **Explore**, **People** and **My portfolio**.
**My portfolio** (`/staff`) remains your own upload and profile workspace.

- Open **Explore** (`/staff/community`) to see ready photos and videos from
  active staff across the organisation, newest first. Choose a **Venue**,
  **Team** (Front of house / Back of house) or **Media** type, then choose
  **Apply filters**. Use **All venues**, **All teams** and **Photos and videos**
  for the full community view.
- Open an upload to preview it and see its contributor and venue at upload.
  **Open portfolio** takes you to that colleague's profile and ready uploads.
  Use **Load more** for older uploads.
- Open **People** (`/staff/people`) to search colleagues by **Name**, **Venue**
  or **Team**, then choose **Find people**. Each card shows the person's
  profile details and ready-upload count. Choose **View portfolio**; use
  **Next people** or **Previous people** when available.

People uses a colleague's current venue; Explore uses the venue recorded when
the file was uploaded. Team filters use the colleague's current assigned team.
Staff without a team assignment still appear under **All teams**.

Community viewing is available to active signed-in staff. Inactive colleagues
are not listed, and their media is unavailable to peers; admins retain access
to their ready media. Uploading, processing, failed and deleted media are not
shown in Explore or colleague portfolios. Your own portfolio can still show
your incomplete uploads so you can manage them.

Colleague portfolios provide viewing, without account editing, label editing,
deletion or **Download original**. Names, profile photos, job titles, venues,
teams and ready-upload counts are visible; account email and access-management
details are not part of the colleague view.

## Update your profile

Choose **Edit profile**, change **Display name** or **Profile photo**, then
**Save changes**. Photos can be up to 4 MiB (shown as **4.0 MB**).
Your admin controls job title, department (FOH or BOH), venue and access. Ask
them to fix a missing or inactive venue if uploads are paused.

## Upload photos or videos

1. Choose **Upload photos or videos**, then **Choose files**. **Use camera**
   is device-dependent. The picker accepts JPEG, PNG, WebP and HEIC/HEIF photos,
   plus MP4, MOV and WebM videos; server validation can still reject a file.
2. Select up to **10 files at a time**. Each photo can be up to **20 MiB**,
   each video **200 MiB** (shown as **20 MB** and **200 MB**). Before starting,
   use a file's × control (“Remove” plus its filename) to deselect it. Choose
   **Upload 1 file** or the button with your selected file count.
3. Keep the page open; at most two transfers run at once. Each file independently
   moves from **Ready to upload** through **Waiting**, **Uploading** (percentage)
   and **Processing** to **Uploaded** or **Failed** with its error. A failure
   does not undo successful files. Ready media reaches your portfolio, the
   admin library and the organisation's Explore and colleague views; processing
   is technical, not editorial approval. Reload Explore or a colleague portfolio
   to pick up new uploads.
4. Use **Retry** beside a failed or **Cancelled** file, or **Retry failed** for
   all failures. Retry here reuses the same upload; do not reselect successful
   files. For rejected or corrupt content, choose a valid replacement rather
   than repeatedly retrying the same bytes.
5. **Cancel** beside a waiting/transferring file stops that item; **Cancel all**
   cancels unfinished queue items. Neither deletes successful uploads, and server
   processing already underway can still finish. Choose **Done** when settled.
   Closing clears the queue and retry context. Do not rely on uploads continuing
   after browser closure; recheck your portfolio before reselecting.

## Add labels (optional)

Labels help admins find your photos and videos later. They are optional:
skipping them never affects the upload, and every upload appears in the admin
library straight away, labelled or not.

- After an upload finishes, choose **Label these files** (or **Done** to skip).
  You can also open any ready photo or video later and choose **Add labels**
  or **Edit labels**.
- Search the menu of the venue the file was **uploaded at** (not your current
  venue, if you have moved). Results show the section, so "Chicken" under Korma
  and "Chicken" under Masala are different items. Pick a variant if asked.
- Add up to four content types (Finished dish, Preparation, Plating, Drinks,
  Kitchen, Team, Venue, Event) and an optional short note (280 characters).
- Dish not listed? Use **Item not on the menu?** and type its name; an admin
  reviews it. Don't pick an item that isn't really in the photo.
- With several files, the **Common to all files** choices apply to every file;
  open a file's **Adjust** panel to change just that one.
- If someone else changed the labels, or the venue's menu changed while you
  were editing, the dialog tells you and keeps your edits so you can retry.

A label describes what is in the file. It is not a claim about allergens,
dietary suitability, price or availability, and not permission to publish.

## View or delete your media

Your newest-first gallery contains only your uploads, including incomplete
states. Open a ready tile to preview; use **Load more** for older items.
**Preview unavailable in this browser** can appear for unsupported video
codecs. Format acceptance does not guarantee playback on every device.

To remove an item, open it and choose **Delete**. Read:

> Remove this file from your portfolio and the admin library? When backups are enabled, copies are retained indefinitely for recovery. Previously downloaded copies cannot be recalled.

Choose **Keep file** to cancel or **Delete** to confirm. The same asset is removed
from your portfolio, the admin library and community views. Reload a community
page to update its gallery. Existing signed links may work until expiry; saved
copies remain.
When the original-media archive is enabled, deletion does not erase its private
recovery copy. The owner has chosen indefinite archive retention; local/staging
environments may explicitly disable archival. See [archive operations](media-archive.md).

Capture safely and follow your organisation's privacy and permission rules.
Uploading is not publishing clearance. See [capture guidance](operations.md).
