# Screen recipes

Which components each screen is built from, top to bottom. Screen codes match the app specification.

## Staff (phone, `TabBar`)

| Screen | Built from |
| --- | --- |
| S1 Home | `VenueBar` · `display` count and primary `Button` “Add photos or video” · attention `Notice` for an interrupted upload · work-area `PickChip`s · up to three `JobCard`s and “View all” · `CoverageMeter` · `TabBar` |
| S2 Upload: choose | `Sheet` with Take photo, Record video, Choose from phone |
| S2 Upload: label | `VenueBar` · `ThumbPick` grid · search `Field` · suggested `PickChip`s ending in “I’m not sure” · primary `Button` “Submit” |
| S2 Upload: sending | `UploadRow` per file · `Notice` if offline · `Toast` “Sent for review” |
| S3 Album | category `PickChip`s · `Tabs` (Needed, Awaiting review, Approved, Needs updating, All) · `SubjectCard` grid · `EmptyState` |
| S3 Item | `display` name · photo · `StatusChip` · brief in `body` · primary `Button` “Add photo” · quiet `Button` “Report a change” opening a `Sheet` of `PickChip`s |
| S4 My uploads | `Tabs` (Needs attention, Uploading, Awaiting review, Reviewed) · `UploadRow`s and `ListRow`s with feedback · “Your month” as two `figure` numbers |
| S5 Help and account | `ListRow`s · `Field` checkboxes for notifications · danger `Button` “Sign out” with a confirmation `Sheet` |

## Manager (phone `TabBar`, desktop `SideNav`)

| Screen | Built from |
| --- | --- |
| M1 Overview | `VenueBar` · action `ListRow`s (Review next, Check venue details, Request missing photos) · one `CoverageMeter` per category |
| M2 Review inbox | filter `PickChip`s · `ThumbPick` grid or `ListRow`s, oldest first · `EmptyState` |
| M2 Review detail | large uncropped photo · `MetaList` · existing approved photo for comparison · `DecisionBar` · retake reasons in a `Sheet` |
| M3 Album and item | as S3, plus `Tabs` (Current, Reference, Awaiting review, Archived) and compact `Button`s (Select as main photo, Archive, Export) |
| M4 Tasks | `Tabs` by state · `ListRow`s · “New task” form of `Field`s and `PickChip`s |
| M5 Venue | `Tabs` (Menus, Specials, Spaces, Facilities and policies, Team, History) · fact `ListRow`s · `Field` forms in a `Sheet` |

## Admin (desktop `SideNav`)

| Screen | Built from |
| --- | --- |
| A1 Group overview | filter `PickChip`s · `DataTable` of pubs · problem and attention `Notice`s first |
| A2 Venues | `DataTable` · setup checklist as `ListRow`s with `StatusChip`s |
| A3 Menus and catalog | import `Notice` · change `ListRow`s (Added, Changed, Possible match, Leaving the menu) · primary `Button` “Activate menu” with a confirmation `Sheet` |
| A4 Library | search `Field` · filter `PickChip`s · `ThumbPick` grid · detail with `MetaList` |
| A5 Publishing | destination `ListRow`s with here-and-there status · `DataTable` of history |
| A6 People | `DataTable` with role per pub · invite form of `Field`s in a `Sheet` |
| A7 Settings and activity | `Field` forms · `DataTable` activity log |
