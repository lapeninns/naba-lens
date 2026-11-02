# NabaLens v0.4 amendment: staff portfolios, monthly targets and venue coverage

**Version:** 0.4 · 1 November 2026
**Status:** Authorised feature scope for local implementation on `main`. Amends
[v0.2](NabaLens-MVP-Execution-v0.2.md) and
[v0.3](NabaLens-Menus-Labels-v0.3.md); everything there not changed here still
applies. Not a deployment, merge, hosted-migration, real staff/venue data or
publishing authorisation.

## 1. What changes from v0.2 and v0.3

v0.2 §1 excluded content tasks, an approval/rejection workflow, a manager role
and staff-to-staff browsing. v0.3 kept approval/rejection and extra roles out of
scope. The owner has now authorised a private platform where every active staff
member maintains a portfolio and meets a monthly photo contribution target, and
each venue has reviewed menu-section, service and amenity photo coverage:

- **Organisation community** (already in source, see [community](../community.md)):
  Explore, People and colleague portfolios for active staff of one parent
  organisation using the existing configured venues.
- **Monthly participation:** every active staff member has a manager-set monthly
  photo target.
- **Venue coverage:** manager-configured menu-section, service and amenity
  requirements per venue.
- **Review of task submissions:** a manager accepts a submitted photo or asks for
  another one. Review decides **completion only**. It never gates visibility:
  ready photos appear in the portfolio and Explore immediately.
- **Venue-manager grants:** admin-managed grants for current staff. A grant is
  not a new application role; roles stay `staff` and `admin`.

The app must answer what each person needs to contribute, what each venue is
missing, what awaits manager review and where follow-up is needed.

Still out of scope: reactions, comments, follows, announcements, messaging,
richer social posts, leaderboards, automated employee scoring and automated
image scoring. Everything else v0.2/v0.3 exclude stays excluded, including
publication/moderation gates, AI, public portfolios or menus, venue-website
sync, bulk export, usage analytics and notifications other than authentication
emails. Coverage oversight is an operational status view, not usage tracking.
Overdue work is displayed for follow-up, not sent as a notification.

## 2. Meanings (normative)

| Term                         | Meaning                                                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Venue manager                | Active staff member with an admin-issued, unrevoked grant for their current, active venue. Effective only while all four hold. Transfers never carry a grant to the destination venue.                     |
| Monthly target               | Positive integer of accepted photos for one staff member + venue + Europe/London calendar month, set by a manager. Part-time and joiner targets are manager-configured. There is no global default target. |
| Coverage requirement         | A persistent venue requirement: subject, photo target, guidance, deadline, applicability/retirement, assignees and evidence. Several named staff may share one requirement and its aggregate target.       |
| Submission                   | A reference from a target or requirement to an existing ready media asset. There is no second upload or storage pipeline. Upload readiness is separate from review.                                        |
| Review outcome               | Per photo: **To do** → **Submitted** → **Accepted** or **Needs another photo**. Asking for another photo requires a reason.                                                                                |
| Self-review                  | A manager accepting their own photo. Allowed by owner decision and recorded for admin oversight.                                                                                                           |
| Needs setup                  | A missing target, team (FOH/BOH), venue or required profile field. Never counts as complete.                                                                                                               |
| Menu changed—review coverage | Shown when a venue activates a new menu version while menu coverage still refers to the old one.                                                                                                           |
| Amenity fact                 | Present / absent / unknown, with confirmer and date, recorded separately from supporting photos.                                                                                                           |

All calendar periods, deadlines and user-facing dates use Europe/London. Stored
instants are UTC.

## 3. Behaviour rules

### Staff

1. **My tasks** is the staff landing experience; My portfolio, Explore and
   People remain. It shows profile setup, this month's accepted/target count,
   assignments, pending review, replacement reasons, due dates and overdue work.
2. Flow: open task → capture or select → existing upload pipeline → submit ready
   photos → review result. Staff may attach their own ready photos from the same
   venue. Existing upload batch/size limits apply.
3. Profile setup requires name, assigned venue and FOH/BOH. A profile photo is
   optional.

### Monthly credit

4. A photo earns monthly credit only when all hold: the original uploader is the
   target staff member; the asset is a ready, undeleted image; its upload-time
   venue is the target venue; it was uploaded **and** submitted in that month;
   and a reviewer accepted it. Videos do not count toward photo targets.
5. Each distinct asset counts once. Labels, retries, resubmission and duplicate
   review never add credit. Attaching someone else's photo never transfers
   authorship.
6. The submission month fixes the period. A later review credits the original
   month and shows late acceptance. Later-month uploads are never backdated.
7. During the current month, deleted or invalid evidence stops counting. Past
   months keep accepted contribution history with evidence-removed flags.
8. Default due date is the end of the London month; a manager may set an
   earlier deadline within it. Current-month target edits require a recorded
   reason. Historical corrections are admin-only and audited.
9. **Rollover:** one idempotent monthly preparation, callable by an
   authenticated hourly scheduled handler and by an explicit manager/admin
   action, computes the London month, copies the latest same-venue manager-set
   target, flags new staff and missing settings as Needs setup and never copies
   an old venue's target after a transfer. Repeated or concurrent runs must not
   duplicate targets. Missing periods or preparation failures appear in
   oversight.

### Venue coverage

10. Coverage persists across months. FOH/BOH may suggest assignees but never
    grants permissions.
11. One accepted photo may count once toward its author's eligible monthly
    target and once toward one current coverage requirement. Historical
    associations remain when evidence is replaced.
12. Older photos may satisfy ongoing coverage after review but never a new
    monthly target. Managers may attach existing ready photos of active
    colleagues at their venue for coverage review; admins may also attach
    retained evidence from inactive contributors.
13. **Menu sections:** draft requirements are generated from a manager-confirmed
    active menu version. The manager selects sections and sets counts, guidance,
    assignees and dates. Completion counts distinct accepted photos, not
    labelled dishes or variants; dish labels stay optional. Managers judge
    relevance, clarity, presentation and variety.
14. Menu section IDs are version-specific and can be regenerated. They, and
    section names or slugs, are never a durable cross-version identity. A new
    active menu shows **Menu changed—review coverage**, preserves the old plan
    and history, and requires the manager to reconcile old evidence to new
    requirements explicitly. No automatic mapping by name, slug or ID. A venue
    cannot show fully current menu coverage while reconciliation is pending.
15. **Venue, services and amenities:** a common candidate template (exterior/
    signage, entrance, bar/dining/service areas, toilets, access features/
    routes, accessible toilet where present, outdoor seating/garden, parking,
    dog-related facilities/policy, family facilities, venue-specific additions)
    supplies candidates, not venue claims. Entries start unconfirmed; the
    manager confirms applicability, photo target (one is an editable starting
    suggestion), guidance and assignees. Unknown stays **Needs verification**
    and blocks confirmation. Exclusions need a reason, stay visible and leave the
    applicable denominator. Photos never establish accessibility or
    dog-friendly claims by themselves.

### Review and lifecycle

16. Decisions record actor, time, revision and self-review. A concurrent stale
    review returns a conflict rather than overwriting. Retries are idempotent.
17. Processing or failed photos cannot count. Deletion or invalidation reopens
    current venue coverage; replacement preserves history.
18. A venue transfer blocks new submissions for the old venue while preserving
    past venue and credit. Deactivation ends access, closes outstanding personal
    assignments with a reason and exposes coverage reassignment needs.
19. Accepted venue evidence stays available to authorised reviewers after a
    contributor leaves. The ordinary community keeps its active-staff
    visibility rule. Already-issued signed URLs may last until expiry; saved
    copies cannot be recalled. Archive policy is unchanged.

### Completion

20. Staff monthly completion requires valid setup plus the accepted eligible
    photo target. Venue completion requires every applicable requirement to be
    satisfied and current menu reconciliation to be complete. Participation and
    venue coverage are reported separately.

## 4. Permissions and interfaces

| Actor                                  | May                                                                                                                    | May not                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Staff                                  | See own tasks, target and progress; submit own ready photos                                                            | Review; edit assignments or targets                                                                                    |
| Venue manager (own current venue only) | Configure requirements, targets, applicability and amenity facts; assign; view the queue; review, including own photos | Invite/deactivate accounts; manage roles, venues or teams; publish menus; download originals; delete colleagues' media |
| Admin                                  | Everything above for all venues; manage grants; admin-only historical corrections                                      | —                                                                                                                      |

- Manager tools live at `/staff/manage`; organisation oversight at
  `/admin/coverage`.
- Every page, action and RPC rechecks current scope (active staff, current
  venue, active venue, unrevoked grant) inside the boundary. Never infer it
  from JWT metadata, job title or team.
- Rosters use narrow operational projections (name, avatar, team, progress),
  never admin account DTOs with email or auth data.
- A scoped task-evidence preview serves ready, undeleted assets attached to
  authorised same-venue submissions, including retained evidence from inactive
  uploaders. It keeps `private, no-store`, the 60-second signed-URL cap and no
  direct Storage read or signing. Ordinary community access and original
  downloads are not broadened.

## 5. Data and migrations

Minimum concepts: manager grants; coverage requirements; assignments; monthly
targets; submissions referencing existing assets; review/audit events; amenity
facts; menu coverage revisions with version/section references and display
snapshots. Database constraints enforce venue consistency, and counts derive
from distinct eligible assets and acceptance. Services derive the actor from
auth and apply RLS plus transactional authorisation, idempotent retries and
revision-conflict handling.

New migrations follow the pending local-only
`20261102110000_staff_departments.sql` and
`20261102120000_organization_community.sql`, in the order manager
authorisation → domain records and policies → task procedures and reporting.
Nothing applies migrations automatically. A release must confirm the exact
target, apply all earlier pending migrations in order, verify the outcome and
compatibility, and only then deploy dependent code. Never seed hosted
development fixtures.

Rollback preserves evidence and audit, stops the scheduler if needed and
explicitly revokes new database capabilities/RPCs; reverting the UI alone does
not revoke database permissions. Archive and monitoring infrastructure stay.

## 6. Pilot

A pilot needs two owner-confirmed venues with real FOH and BOH staff, manager
grants, confirmed menu and amenity coverage and explicit targets. Do not invent
pilot names or data. See the [release checklist](../release-checklist.md).
