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
label-editing or admin original-download actions. Raw profile-row access remains
own/admin-only. Media routes check authorization again before serving previews
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
   the active-staff discovery index and ready-media read policy.

The migrations do not populate departments or create venues. Confirm the target
database and apply any earlier unapplied migrations in version order; check the
result and run the project's required validation against an owned test stack.
The deployment expands staff read access from own media to eligible colleague
media, so rollback must account for both application routes and the database
policy/RPC change.

This document describes source behavior and release prerequisites. It does not
claim that the migrations have been applied, that the feature is deployed, or
that production checks have passed.
