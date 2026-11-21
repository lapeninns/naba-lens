# NabaLens information architecture: manager, admin and sign-in

21 November 2026. Companion to `redesign-handoff.html`. Source of truth for routes: `app/manager/**`, `app/admin/**`, `app/login` and `app/auth/**` in the NabaLens repo.

No URL changes. "New home" is the nav section and tab a route lights, "Page title" is its one display heading, and "Back link" is the label of its BackLink (the parent page's title). A dash means the page is a section or tab root and has no back link.

## Manager

Nav, in order: **Overview**, **Review**, **Album**, **Requests**, **Venue**. TabBar on phones, section tabs from 768px, SideNav from 1100px. VenueBar on every page.

| Section  | Tabs                                          | Holds                                                                                                             |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Overview | none                                          | What needs the manager today, as one list of links into the other four sections                                   |
| Review   | One at a time · All photos · Posted by staff  | Every photo decision. Badge: photos waiting                                                                       |
| Album    | Menu · Spaces · Amenities                     | Every slot the venue has and its state, gaps first. Badge: amenity findings to confirm                            |
| Requests | none                                          | Requests to staff and shot lists                                                                                  |
| Venue    | Details · Team · Progress · Exports · History | Facts, reported changes, menus, specials, reviewers; people and targets; metrics; export packages; the change log |

"Album" now means one thing, the venue's album of slots:

| Was               | Route                       | Now                                                |
| ----------------- | --------------------------- | -------------------------------------------------- |
| Album (nav tab)   | `/manager/menu`             | Album › Menu                                       |
| Album places      | `/manager/album`            | Places and briefs, a detail page of Album › Spaces |
| Staff Album       | `/manager/review/album`     | Review › Posted by staff                           |
| Places at {venue} | `/manager/amenities/places` | Album › Spaces                                     |

### Manager route map

| Route today                              | Called today             | New home                                   | Page title                                  | Back link    |
| ---------------------------------------- | ------------------------ | ------------------------------------------ | ------------------------------------------- | ------------ |
| `/manager`                               | Overview                 | Overview                                   | Needs you today                             | —            |
| `/manager/review`                        | Review (count as title)  | Review › One at a time                     | {n} photos to review                        | —            |
| `/manager/review?view=list`              | Review                   | Review › All photos                        | {n} photos to review                        | —            |
| `/manager/review/album`                  | Staff Album              | Review › Posted by staff                   | {n} photos to review                        | —            |
| `/manager/review/photo/[assetId]`        | Photo review             | Review, detail page                        | The slot’s name                             | Review       |
| `/manager/review/contributors/[staffId]` | Contributor              | Review, detail page                        | The person’s name                           | Review       |
| `/manager/menu`                          | Album                    | Album › Menu                               | Album                                       | —            |
| `/manager/menu/[itemId]`                 | Menu item                | Album › Menu, detail page                  | The item’s name                             | Menu         |
| `/manager/amenities/places`              | Places at {venue}        | Album › Spaces                             | Album                                       | —            |
| `/manager/album`                         | Album places             | Album › Spaces, detail page                | Places and briefs                           | Spaces       |
| `/manager/amenities`                     | Amenities                | Album › Amenities                          | Album                                       | —            |
| `/manager/amenities/[checkId]`           | The question             | Album › Amenities, detail page             | The question                                | Amenities    |
| `/manager/amenities/[checkId]/capture`   | Capture form             | Album › Amenities, detail page             | Answer the question                         | The question |
| `/manager/search`                        | Search photos and videos | Album, from the search button              | Search photos and videos                    | Album        |
| `/manager/requests`                      | Requests                 | Requests                                   | Requests                                    | —            |
| `/manager/requests/new`                  | New request              | Requests, detail page                      | New request                                 | Requests     |
| `/manager/requests/[requestId]`          | The subject              | Requests, detail page                      | The subject                                 | Requests     |
| `/manager/venue`                         | Venue                    | Venue › Details                            | Venue                                       | —            |
| `/manager/venue/facts`                   | To confirm               | Venue › Details, detail page               | To confirm                                  | Venue        |
| `/manager/venue/reports`                 | Reported changes         | Venue › Details, detail page               | Reported changes                            | Venue        |
| `/manager/menu/versions`                 | Menus                    | Venue › Details, detail page               | Menus and change requests                   | Venue        |
| `/manager/menu/specials`                 | Specials                 | Venue › Details, detail page               | Local specials                              | Venue        |
| `/manager/team`                          | Team targets             | Venue › Team                               | Venue                                       | —            |
| `/manager/metrics`                       | Metrics                  | Venue › Progress                           | Venue                                       | —            |
| `/manager/exports`                       | Exports                  | Venue › Exports                            | Venue                                       | —            |
| `/manager/exports/new`                   | Make an export package   | Venue › Exports, detail page               | Make an export package                      | Exports      |
| `/manager/exports/packages/[id]`         | The package              | Venue › Exports, detail page               | The package’s title                         | Exports      |
| `/manager/venue/history`                 | History                  | Venue › History                            | Venue                                       | —            |
| `/manager/account`                       | Account                  | Avatar in the venue bar; lights no section | Account                                     | Overview     |
| `/manager/uploads`                       | My uploads               | Account, detail page                       | Your photos                                 | Account      |
| `/manager/[...missing]`                  | Not found                | Inside the shell, nav kept                 | This page isn’t available in your workspace | Overview     |
| `/staff/manage/**`                       | Redirects                | Unchanged: redirect to the routes above    | —                                           | —            |

## Admin

Nav, in order: **Overview**, **Venues**, **Menus**, **Library**, **Publishing**, **People**, **Settings**. SideNav from 1100px, top bar from 1024px, and below that a TabBar of Overview, Venues, Library and More. Rule: Overview is all venues at once; Venues is one venue at a time.

| Section    | Tabs                                                                  | Holds                                                          |
| ---------- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| Overview   | By venue · Albums · This month · Metrics                              | Cross-venue tables. Attention first                            |
| Venues     | List; one venue: Coverage · Review · Album · Checklist · Team · Setup | Everything about one venue. VenueBar with Change venue         |
| Menus      | List; one venue: Versions · Change requests · Suggestions · Imports   | Import, edit, activate for labelling                           |
| Library    | Photos · Collections · Tags · Removal requests                        | Every photo and video                                          |
| Publishing | none                                                                  | Export packages, destinations, publication records             |
| People     | Accounts · Venue managers                                             | Accounts, per-venue roles, admins, authenticator resets        |
| Settings   | Rules · Activity · Venue facts                                        | Shared rules, activity log, venue-fact tools (was "knowledge") |

Resolved:

| Problem                      | Routes                                                                      | Resolution                                                                            |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Orphan: albums matrix        | `/admin/albums`                                                             | Overview › Albums                                                                     |
| Orphan: knowledge            | `/admin/knowledge/*`                                                        | Settings › Venue facts, with picks Sources · Imports · Check dates · Question changes |
| Near-orphan: metrics         | `/admin/metrics`                                                            | Overview › Metrics                                                                    |
| Near-orphan: group coverage  | `/admin/coverage`                                                           | Overview › This month                                                                 |
| Two review screens per venue | `/admin/coverage/[venueId]/review`, `/admin/coverage/[venueId]/menu-photos` | One Review tab on the venue, with a pick: Menu and spaces · Checklist                 |
| Wrong section lit            | `/admin/coverage/managers`                                                  | People › Venue managers                                                               |
| Wrong section lit            | `/admin/coverage/[venueId]/**`                                              | Venues › one venue                                                                    |

### Admin route map

| Route today                                                    | Called today                         | New home                                                                   | Page title                | Back link     |
| -------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- | ------------------------- | ------------- |
| `/admin/overview`                                              | Overview                             | Overview › By venue                                                        | Overview                  | —             |
| `/admin/albums`                                                | Albums (orphan)                      | Overview › Albums                                                          | Overview                  | —             |
| `/admin/coverage`                                              | Coverage                             | Overview › This month                                                      | Overview                  | —             |
| `/admin/metrics`                                               | Metrics (linked only from Coverage)  | Overview › Metrics                                                         | Overview                  | —             |
| `/admin/venues`                                                | Venues                               | Venues                                                                     | Venues                    | —             |
| `/admin/venues/new`                                            | Add a venue                          | Venues, detail page                                                        | Add a venue               | Venues        |
| `/admin/coverage/[venueId]`                                    | Overview (lights Overview)           | Venues › one venue › Coverage                                              | Coverage                  | Venues        |
| `/admin/coverage/[venueId]/menu`                               | Menu coverage                        | Venues › one venue › Coverage, as its Menu section                         | Coverage                  | Venues        |
| `/admin/coverage/[venueId]/menu-photos`                        | Review menu photos (lights Our menu) | Venues › one venue › Review, “Menu and spaces”                             | Review                    | Venues        |
| `/admin/coverage/[venueId]/review`                             | Review photos                        | Venues › one venue › Review, “Checklist”                                   | Review                    | Venues        |
| `/admin/coverage/[venueId]/menu-photos/photo/[assetId]`        | Photo review                         | Venues › one venue › Review, detail page                                   | The slot’s name           | Review        |
| `/admin/coverage/[venueId]/menu-photos/contributors/[staffId]` | Contributor                          | Venues › one venue › Review, detail page                                   | The person’s name         | Review        |
| `/admin/coverage/[venueId]/menu/items`                         | Our menu                             | Venues › one venue › Album, “Menu”                                         | Album                     | Venues        |
| `/admin/coverage/[venueId]/amenities/places`                   | Places at {venue}                    | Venues › one venue › Album, “Spaces”                                       | Album                     | Venues        |
| `/admin/coverage/[venueId]/amenities`                          | Amenities                            | Venues › one venue › Album, “Amenities”                                    | Album                     | Venues        |
| `/admin/coverage/[venueId]/amenities/[checkId]`                | The question                         | Venues › one venue › Album, detail page                                    | The question              | Amenities     |
| `/admin/coverage/[venueId]/amenities/[checkId]/capture`        | Capture form                         | Venues › one venue › Album, detail page                                    | Answer the question       | The question  |
| `/admin/coverage/[venueId]/checklist`                          | Checklist                            | Venues › one venue › Checklist                                             | Checklist                 | Venues        |
| `/admin/coverage/[venueId]/checklist/[requirementId]`          | The item                             | Venues › one venue › Checklist, detail page                                | The item’s title          | Checklist     |
| `/admin/coverage/[venueId]/team`                               | Team                                 | Venues › one venue › Team                                                  | Team                      | Venues        |
| `/admin/venues/[venueId]`                                      | The venue’s name                     | Venues › one venue › Setup                                                 | Setup                     | Venues        |
| `/admin/menus`                                                 | Menus                                | Menus                                                                      | Menus                     | —             |
| `/admin/menus/[venueId]`                                       | {Venue} menus (375 lines)            | Menus › one venue, tabs Versions · Change requests · Suggestions · Imports | {Venue} menus             | Menus         |
| `/admin/menus/[venueId] (import open)`                         | Import a menu, in place              | Menus › one venue, detail page                                             | Import a menu             | {Venue} menus |
| `/admin/menus/versions/[versionId]`                            | The version’s title                  | Menus › one venue, detail page                                             | The version’s title       | {Venue} menus |
| `/admin`                                                       | Library                              | Library › Photos                                                           | Library                   | —             |
| `/admin/library/collections`                                   | Collections                          | Library › Collections                                                      | Library                   | —             |
| `/admin/library/tags`                                          | Tags                                 | Library › Tags                                                             | Library                   | —             |
| `/admin/library/removals`                                      | Removal requests                     | Library › Removal requests                                                 | Library                   | —             |
| `/admin/library/[assetId]`                                     | Photo details                        | Library, detail page                                                       | The photo’s label         | Library       |
| `/admin/library/[assetId]/remove`                              | Remove permanently                   | Library, detail page                                                       | Remove permanently        | The photo     |
| `/admin/library/collections/[collectionId]`                    | The collection                       | Library, detail page                                                       | The collection’s name     | Collections   |
| `/admin/library/compare`                                       | Compare photos                       | Library, detail page                                                       | Compare photos            | The photo     |
| `/admin/search`                                                | Search photos and videos             | Library, from the search field’s “All filters”                             | Search photos and videos  | Library       |
| `/admin/publishing`                                            | Publishing                           | Publishing                                                                 | Publishing                | —             |
| `/admin/publishing/new`                                        | Make an export package               | Publishing, detail page                                                    | Make an export package    | Publishing    |
| `/admin/publishing/packages/[id]`                              | {Venue} · {profile}                  | Publishing, detail page                                                    | {Venue} · {profile}       | Publishing    |
| `/admin/staff`                                                 | People                               | People › Accounts                                                          | People                    | —             |
| `/admin/coverage/managers`                                     | Venue managers (lights Overview)     | People › Venue managers                                                    | People                    | —             |
| `/admin/staff/[id]`                                            | The person’s name                    | People, detail page                                                        | The person’s name         | People        |
| `/admin/settings`                                              | Settings                             | Settings › Rules                                                           | Settings                  | —             |
| `/admin/settings/shot-templates/[category]`                    | {Category} shot template             | Settings, detail page                                                      | {Category} shot template  | Settings      |
| `/admin/activity`                                              | Activity                             | Settings › Activity                                                        | Settings                  | —             |
| `/admin/knowledge/sources`                                     | Sources and mappings (orphan)        | Settings › Venue facts, “Sources”                                          | Settings                  | —             |
| `/admin/knowledge/runs`                                        | Runs (orphan)                        | Settings › Venue facts, “Imports”                                          | Settings                  | —             |
| `/admin/knowledge/runs/[runId]`                                | One run (orphan)                     | Settings › Venue facts, detail page                                        | The run                   | Imports       |
| `/admin/knowledge/check-dates`                                 | Check dates (orphan)                 | Settings › Venue facts, “Check dates”                                      | Settings                  | —             |
| `/admin/knowledge/upgrades`                                    | Schema upgrades (orphan)             | Settings › Venue facts, “Question changes”                                 | Settings                  | —             |
| `/admin/more`                                                  | All sections                         | Phone and tablet only: the More tab                                        | All sections              | —             |
| `/admin/[...missing]`                                          | Not found, “Go to Library”           | Inside the shell, nav kept                                                 | This page isn’t available | Overview      |

## Sign-in

No nav. One frame: the name "Naba-Lens" as text, one column, one display heading, one bottle button.

| Route today              | Called today                                      | New home               | Page title              | Back link             |
| ------------------------ | ------------------------------------------------- | ---------------------- | ----------------------- | --------------------- |
| `/login`                 | Sign in                                           | Sign in, step 1: email | Sign in                 | —                     |
| `/login (after sending)` | Check your email                                  | Sign in, step 2: code  | Check your email        | Use a different email |
| `/auth/confirm`          | Continue signing in / Accept your invitation      | Link confirm           | Continue signing in     | —                     |
| `/auth/mfa`              | Enter your sign-in code / Set up two-step sign-in | Two-step sign-in       | Enter your sign-in code | —                     |
| `/auth/blocked`          | Account unavailable                               | Blocked                | Account unavailable     | —                     |

## Decisions recorded

1. No URL changes; only titles, tabs, lit section and back links move.
2. Album keeps the nav word. "Album places", "Staff Album" and the second "Places" are renamed or folded in.
3. One pair of quick-review words: Keep in the album, Ask for another photo. "Accept" and "Ask again" are retired. The photo detail page keeps the finer decisions.
4. Album filters use the StatusChip words: Missing, Waiting, Retake, In the album, All.
5. One category set everywhere: Food, Drinks, Spaces, Amenities (not Facilities or Areas).
6. Per-venue coverage pages light Venues, not Overview.
7. "Knowledge" is called Venue facts; Runs are Imports; Schema upgrades are Question changes.
8. Venue managers sits under People.
9. Section headings are Figtree; Fraunces is the one display heading per screen, plus sheet titles and figures.
10. Sign-in and authenticator codes are one field each.
11. Error notices say Retry.
12. Not found sends admins to Overview and managers to Overview.

## Open for the owner

- Whether "Keep in the album" on the quick review screen also means approved for public use.
- Nine venues (brief) or ten (repo notes).
- Full names and towns for the venues not named in the repo.
