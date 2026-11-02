# Organisation community

This source change adds staff discovery within one parent organisation. Venues
are organisational units in the existing deployment, not separate tenants. It
uses the existing configured venues; it neither creates a venue list nor proves
which venues are live.

## What staff can use

- **Explore** (`/staff/community`): newest-first ready photos and videos from
  active staff, filtered by upload-time venue, current FOH/BOH department and
  photo/video type. **Load more** fetches older items.
- **People** (`/staff/people`): a paged directory with name search, current-venue
  and team filters. Cards link to `/staff/people/[id]`, a colleague's profile and
  ready portfolio.
- **My portfolio** (`/staff`): the existing own-upload workspace, including
  incomplete upload states, profile editing, labels and deletion.

Community pages require active staff access. The safe colleague profile
contains name, avatar, job title, department, current venue and ready-upload
count. Account-management fields and email are not included. Community media
must be ready, non-deleted and owned by active staff; deactivated staff disappear
from the directory and peer media access. Admins retain their existing library
and account-management access. Short-lived media URLs already issued may remain
usable until expiry.

Colleague views have previews and portfolio links, without editing, deleting,
label-editing or admin original-download actions. Colleagues never see original
filenames; the viewer says "Photo by <name>" or "Video by <name>". Colleagues
get photos only as re-encoded previews, which carry no embedded metadata.

**Colleague video playback delivers the original file**, including any embedded
metadata such as location or device. It is served inline with no filename, but
a colleague can still save it, and saved copies cannot be recalled. The owner
chose this over hiding colleagues' videos until a sanitised video version
exists. Raw profile-row access remains own/admin-only. Media routes check authorization again before serving previews
or video playback. This increment does not add comments, reactions, follows or
direct messaging.

Admins assign **Front of house (FOH)** or **Back of house (BOH)** in staff
invitation and account editing. The nullable department is independent of access
role; existing accounts remain **Unassigned**, and staff cannot assign or change
their own department. A person's team filter follows their current assignment;
media's venue remains its upload-time venue.

## Deployment requirements

Apply these versioned migrations to the intended database in the normal
authorized release sequence before deploying the application code that requires
their column, policies and RPCs:

1. `20261102110000_staff_departments.sql` adds the nullable department and its
   admin-only update guard.
2. `20261102120000_organization_community.sql` adds community profile/media RPCs,
   the active-staff discovery index and a ready-media read policy.
3. `20261102160000_community_asset_access.sql` (after the coverage migrations)
   drops that read policy, so colleagues no longer read whole media rows with
   storage paths, filenames or upload keys. Instead, `community_readable_assets`
   returns a narrow projection the server checks before it signs or streams
   with the service role, and `community_media_page` returns the original
   filename only to its uploader.

The migrations do not populate departments or create venues. Confirm the target
database and apply any earlier unapplied migrations in version order; check the
result and run the project's required validation against an owned test stack.
Apply migration 3 together with the code that calls `community_readable_assets`:
until that code is live, the previous version shows colleagues' media as
unavailable (it fails closed, it does not leak).

The deployment expands staff read access from own media to eligible colleague
media, so rollback must account for both application routes and the database
policy/RPC change. Rolling back colleague reads is separate from the
[coverage withdrawal script](operations.md#withdrawing-coverage-access-rollback),
which does not touch community access. Withdrawing colleague reads means a
reviewed migration that revokes `community_readable_assets`,
`community_media_page` and `community_members` from signed-in users. Reverting
migration 3 itself would bring back the broad row policy, so do not use that as
a rollback. Roll back code and database together.

This document describes source behavior and release prerequisites. It does not
claim that the migrations have been applied, that the feature is deployed, or
that production checks have passed.
