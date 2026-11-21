# UX audit before the redesign (21 Nov 2026)

Read-only audit of every role's routes, shells and journeys. File references
are from the head of `codex/staff-photo-label-later` on 21 Nov 2026.

## Staff (`app/staff/**`)

Shell: `components/nabalens/app-shell.tsx` (`variant="staff"`), rendered by
each page. Phone TabBar Today / Album / Add / My photos / Me; top bar from
768px with "Manage" for managers. `app/staff/layout.tsx` hosts the Add
sheet, Match screen, tray and older UploadDialog (`_shell/add-host.tsx`).

Journeys: Add → Match (or Match later) → My photos → one photo; fill a gap
from Album → slot → Add; retake or request → `/staff/tasks/[id]` (older
UploadDialog path); amenity question → `/staff/tasks/amenities/[checkId]`;
first run → `/staff/tasks/welcome`.

Problems:

- `app/staff/loading.tsx` is Me's skeleton and `app/staff/error.tsx` says
  "Me could not load" for every staff page, with no shell or tabs.
- "Home" leftovers: `BackToTasks` says "Home" but lands on Album
  (`components/nabalens/tasks/task-summary.tsx:29`, `app/staff/tasks/result.ts:28`);
  `app/staff/tasks/error.tsx` says "We couldn't load Home".
- `app-shell.tsx:199-211` links Me and Album through redirects; an
  unreachable non-photoNav branch at :377.
- `/staff/community` and `/staff/people` light no tab and have no way back
  to Me; `/staff/notifications` and `/staff/profile` don't use `MeSubpage`.
- Two add flows (UploadDialog b01 vs Add sheet + Match b02), chosen per venue.
- Three "photos" screens with confusing names: My photos, Photos
  (`/staff/community`), Recent photos (`/staff/album/recent`).
- Dead code listed as adopted: `album-home.tsx` (`AlbumHome`), `album-place.tsx`.
- Legacy `/staff/tasks/*` pages (month 479 lines, other, guide, welcome) on
  Common Room or uncited.

## Manager (`app/manager/**`)

Shell: `manager-shell.tsx` + `manager-nav.tsx`, sections Overview, Review,
Album, Requests, Venue (TabBar, SectionTabs from 768px, SideNav from 1100px).
`app/staff/manage/**` only redirects here.

Problems:

- "Album" means four things: the nav tab opens `/manager/menu` titled
  "Album"; `/manager/album` is "Album places"; `/manager/review/album` is
  "Staff Album"; `/manager/amenities/places` is a second "Places".
- `app/manager/loading.tsx` and `error.tsx` name Overview for every section
  without its own boundary (album, exports, uploads, account).
- Duplicates: own uploads (`app/manager/uploads/my-uploads.tsx` vs
  `components/nabalens/me/my-uploads.tsx`); amenity fallbacks twice.
- Team, metrics, search, uploads and account have no nav entry.
- `NotManagerPage` names tabs that no longer exist and links "Home" to a redirect.
- No VenueBar on review screens (DESIGN.md §15).
- Overview, Venue hub and Team still on Common Room.

## Admin (`app/admin/**`)

Shell: `AppShell variant="admin"` per page; `ADMIN_NAV` Overview, Venues,
Menus, Library, Publishing, People, Settings; TabBar + More below lg.

Problems:

- Orphans: nothing links to `/admin/albums` or `/admin/knowledge/*`;
  `/admin/metrics` only from coverage.
- Knowledge and metrics pages light Overview (`active="coverage"`).
- Two review screens per venue (`coverage/[venueId]/review` and `/menu-photos`).
- `app/admin/error.tsx` titles every unbounded error "Library"; no loading
  for knowledge, publishing, more.
- Detail pages without back links (collections, compare, tags, package,
  staff/[id], menus/[venueId]).
- Long pages: `menus/[venueId]` 375, `coverage` 333, `knowledge/check-dates` 263.

## Auth

`/login`, `/auth/confirm`, `/auth/mfa`, `/auth/blocked` share
`app/login/sign-in-frame.tsx`, still Common Room. No `/login` loading, no
auth error boundary.

## Across the app

1. The shell is repeated per page instead of a layout, so boundaries lose nav.
2. Five different back-link builders; no shared BackLink in the catalogue.
3. Flags fork the UX: contribution entry b01/b02, staff Album posts, upload tray.
