# Staff guide

## Sign in and leave safely

Open `/login`, enter your invited address in **Email**, then choose
**Send sign-in link**. At **Check your email**, open the single-use email link.
This neutral response does not confirm access or delivery, and never
creates an account. For **That sign-in link has expired**, request another.

Staff land on **My tasks** (`/staff/tasks`). If **Account unavailable**
appears, ask an admin; that screen has **Sign out**. In your portfolio header,
use **Log out**, especially on shared devices.

## My tasks: monthly photos and venue tasks

The staff navigation has **My tasks**, **Explore**, **People** and
**My portfolio**; venue managers also see **Manage**. **My tasks** shows what
you need to photograph and how your month is going. Dates are UK time.

- **Finish setting up your profile** appears until you have a name, a venue and
  a team (FOH or BOH). A profile photo is optional. An admin assigns venue and
  team; your manager sets your monthly target. Until all are set you see
  **Needs setup**, which never counts as complete.
- The month card shows your target, how many photos have been accepted and how
  many are waiting for review. **Target met** appears once accepted photos
  reach the target.
- **Assigned to you** lists the venue tasks your manager gave you, overdue
  first, then by due date. **Overdue** is shown for follow-up only: you can
  still send photos.
- **Needs another photo** lists photos your manager wants replaced, with the
  reason.

### Send photos to a task

1. Open a task and read **What to photograph**.
2. Choose **Take or upload photos**. This is the normal upload dialog, for
   photos only, with the usual limits. Photos that finish uploading are
   selected for you. Or use **Or choose from your photos** to pick your own
   ready photos from this venue; a photo that can't be sent says why under it.
3. Choose **Send photos**. You can send up to 10 at a time.

Only tasks assigned to you accept photos. Your team (FOH or BOH) can help your
manager decide who to assign, but it never gives access to a task. To count
photos toward your target without a task, choose **Add photos for this month**
on the month card. It opens **Monthly photos** (`/staff/tasks/month`), which
also shows earlier months, read-only.

If sending fails, **Try again** resends the same request, so nothing is sent
twice. If the task changed while you were working, choose **Reload**.

### What counts toward your monthly target

A photo counts once a reviewer accepts it and all of these are true: you
uploaded it yourself, it is a photo rather than a video, it was uploaded at
your venue, and you uploaded **and** sent it in the same UK calendar month.
A photo's month is set when its upload starts, so an upload started just
before midnight at the end of the month belongs to that month.

- Each photo counts once. Labels, retries and sending it again add nothing.
- A photo accepted after its month ended still counts for the month you sent
  it, marked as a late acceptance.
- An older photo can still complete a task. It shows **Counts for the task
  only, not your monthly target.**
- Deleting a photo reopens any task it completed. Deleted during the month you
  sent it, it also stops counting toward that month; earlier months keep their
  accepted totals and mark the photo as removed.
- Photos a manager adds to a task count for the task only, and stay yours.

### Review results

Each photo you send is **Submitted**, then **Accepted** or **Needs another
photo** with a reason. Decisions are final. To answer a request for another
photo, choose **Send another photo**; the task says **The photos you send now
replace this one.** The earlier photo and its reason stay in your history.

Ready photos are already in your portfolio and Explore before anyone reviews
them. Review decides whether a photo counts, not whether it is shared, and it
is not publishing clearance. You cannot review photos, set targets or change
assignments.

If you move venue, your old venue's tasks stop taking new photos; accepted
photos and past months stay credited to the old venue.

## Manage (venue managers only)

An admin can make you the manager of your current venue. **Manage**
(`/staff/manage`) then appears in the navigation, with **Overview**,
**Review**, **Checklist**, **Menu** and **Team**. Without that grant the page
explains that the tools are for venue managers. A grant ends if you move venue,
your account is deactivated or an admin revokes it; that takes effect on your
next page load or action.

- **Review**: submitted photos wait here, oldest first. Choose **Accept**, or
  **Ask for another photo** and give a reason (up to 500 characters). You may
  review your own photos; the page warns first, and admins can see each
  **Self-review**. If someone else decided first, the page shows the latest
  state instead of overwriting it.
- **Checklist**: suggested items (exterior and signage, entrance, toilets,
  accessible toilet, outdoor seating, parking, dog facilities, family
  facilities and more) start as **Needs setup**. For each one, confirm whether
  it applies, its photo target (1 is only a starting suggestion), guidance,
  due date and who is assigned, then **Save and confirm**. For amenities,
  record whether it is present in **Amenity facts** first; **Needs
  verification** blocks confirming it. **Does not apply** needs a reason; the
  item stays visible and is not counted. Photos never prove an accessibility
  or dog-friendly claim. Use **Add a checklist item** for anything specific to
  your venue.
- **Attach existing photos** adds ready photos already taken at your venue,
  by you or an active colleague, to a checklist item, optionally accepting them
  at once. They count for the venue only; the photographer keeps authorship
  and gets no monthly credit.
- **Menu**: an admin activates menus. Choose **Start from this menu** to add
  one item per menu section, set each one up, then **Confirm menu coverage**.
  A section completes on its number of distinct accepted photos; dish labels
  stay optional. When a new menu is activated you see **Menu changed — review
  coverage**. Nothing moves automatically: for each old section choose which
  accepted photos to carry and the new section to carry them to, with a reason,
  or **Carry nothing and close it**. Menu coverage is not current until every
  old section is done.
- **Team**: set each person's monthly target and optional due date within the
  month. Changing a target already set for this month needs a reason. Past
  months are read-only; only an admin can correct them. **Prepare this month**
  copies each person's last target at this venue, adds the suggested checklist
  items and flags anyone new or without a team. It also runs every hour on its
  own and is safe to repeat.

Being a manager does not let you invite or deactivate people, change roles,
venues or teams, publish menus, download originals or delete colleagues'
photos.

## Explore work across Lapen Inns

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
teams and ready-upload counts are visible; account email, access-management
details and original filenames are not part of the colleague view.

Colleagues see your photos as previews without embedded details. **When a
colleague plays one of your videos, they receive the original file**, including
any embedded details such as the location where it was recorded, and they can
save it. If a video should not carry that, turn off location for your camera
before recording or do not upload it.

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
