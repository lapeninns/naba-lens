# SideNav

The side rail for managers and admins from `bp-desktop` up. Below that width managers use `TabBar` and admins a menu button that opens the same list in a `Sheet`.

- Manager items, in order: Overview, Review, Album, Tasks, Venue. Admin items: Overview, Venues, Menus and catalog, Library, Publishing, People, Settings and activity.
- The current item has `aria-current="page"`, a `bottle-soft` ground and `bottle` text. A count on the right (`nl-rail__count`) shows work waiting, such as the review queue.
- The rail is `rail-width` wide on `surface`. The name at the top is plain text in `title`; there is no logo.
- `VenueBar` sits above the content beside the rail, so the active pub stays visible.
- You provide: the role’s items, the current route and the counts. Don’t nest items or add a second level.
