# NabaLens v0.3 amendment: venue menu catalogue and media labels

**Version:** 0.3 · 30 October 2026
**Status:** Authorised feature scope for local implementation. Amends
[v0.2](NabaLens-MVP-Execution-v0.2.md); everything in v0.2 not changed here
still applies. Not a deployment, hosted-migration or publishing authorisation.

## 1. What changes from v0.2

v0.2 §1 listed "captions or tagging workflow" as out of scope and §2 said "No
mandatory title, caption, tags or category". The owner has now authorised a
**venue menu catalogue** and an **optional media-labelling** feature:

- Admins maintain venue-specific menus (sections, items, variants), by manual
  editing and by importing structured JSON/CSV, with a reviewed draft →
  explicit activation step.
- Staff may optionally label their own photos/videos with items from the
  catalogue of the asset's venue, a controlled content type and a short note.
- Admins can correct labels and filter the central library by them.

Still out of scope (unchanged): approval/rejection/publication/moderation of
media, extra roles, comments, likes, AI, public menus, venue-website sync,
bulk export, analytics. A label is **optional**, never blocks an upload, and
never changes whether an asset is visible: a new ready upload appears in the
admin library immediately, labelled or not.

Two roles only (`staff`, `admin`). "Chef", "bartender" etc. remain job titles.

## 2. Meanings (normative)

| Term                    | Meaning                                                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue version       | A venue's menu at one point: `draft`, `active`, `retired` or `discarded`. At most one `active` per venue.                                                                                                               |
| Activate                | The admin explicitly makes a reviewed draft the venue's catalogue for **labelling**. It does not mean the venue currently serves the food, that an item is in stock, or that the menu is published anywhere.            |
| Menu item               | A **stable identity** (`menu_items.id`) for one venue, carried across versions. Per-version name/section/description live in `menu_entries`. Never shared across venues; the same dish name at two venues is two items. |
| Variant                 | A stable sub-identity of one item (e.g. Veg / Chicken / Lamb of one curry) when the source actually lists options.                                                                                                      |
| Source key              | Deterministic import key (`section-slug--item-slug` or an explicit `key`). Used to match a re-import to existing items. Never file position.                                                                            |
| Label                   | Optional description of one asset: 0–20 menu items (± variant), 0–4 content types, an optional ≤280-char note, optionally a "missing item" suggestion.                                                                  |
| Labelled                | An asset with at least one menu item **or** at least one content type. Otherwise "Needs labels".                                                                                                                        |
| Missing-item suggestion | Free text from staff/admin ("item not on the menu") for an admin to review: resolve (link to an item) or dismiss. It never creates a catalogue item by itself.                                                          |

Controlled content types (final list): **Finished dish** (`dish`),
**Preparation** (`preparation`), **Plating** (`plating`), **Drinks** (`drinks`),
**Kitchen** (`kitchen`), **Team** (`team`), **Venue** (`venue`), **Event**
(`event`).

Price, dietary, allergen, spice and availability values in a source file are
**source metadata** only (`source_meta`): shown to admins as provenance, never
inferred from a photo, never asserted as current, never required for labels.

## 3. Behaviour rules

1. **Asset venue is the upload-time venue.** Labels must use the catalogue of
   `media_assets.venue_id`, never the uploader's current venue. A staff member
   transferred to another venue labels old assets against the old venue.
2. **Writes** go through narrow `SECURITY DEFINER` RPCs that re-check the
   caller (active, role), the asset (exists, not deleted, `ready`, owner for
   staff) and every item (same venue as the asset, present in the venue's
   active version, not archived) on every call. Items already on an asset may
   stay even if later renamed, archived or dropped from the active menu.
3. **Concurrency:** labels carry a `revision`; a save with a stale revision
   fails with a recoverable conflict that returns the current labels. Drafts
   carry a `revision` the same way. Activation takes a per-venue lock.
4. **Historical meaning:** each label item stores a snapshot (item, variant and
   section name/slug and the version used). Display shows the item's current
   name (active version, else latest known) and "labelled as …" when it
   differs, plus _not on active menu_ / _archived_ states. Search matches
   current names, all historical names and aliases, snapshots and notes.
5. **Re-import** matches by exact source key only. A name-only match is an
   _uncertain_ match that the admin must resolve (same item / new item) before
   activation. Nothing is merged by name automatically. Items missing from a
   new version are "removed" from that version only; no catalogue item with
   labels is ever hard-deleted (no DELETE privilege exists).
6. **Archive:** archiving an item stops new labels; existing labels stay.
   Retiring the active version leaves the venue with no catalogue (labelling
   offers content type/note/missing-item only); existing labels stay.
7. **Upload independence:** upload, finalise and gallery code paths do not
   depend on labels. A failed label save never removes, duplicates or hides an
   asset and never reports success falsely.
8. **Import safety:** only JSON and CSV text are accepted (≤1 MiB, limits in
   `lib/menus/types.ts`). Nothing uploaded is executed. PDF/image menus are
   **not** parsed, and the UI says so. JS-shaped venue-site sources are
   converted offline by a reviewed restricted converter, never `import`ed.
9. A catalogue is internal. It never writes to a venue website, listing,
   third-party service or hosted database.

## 4. Screens

- **Admin → Menus** (`/admin/menus`): venues with active-version summary,
  drafts and open suggestions. Venue page: active version, drafts, history,
  import (JSON/CSV, with format help and "PDF/image menus are not supported"),
  new manual draft, missing-item suggestions. Version page: provenance,
  editor (sections, items, variants, aliases), diff vs active (added, changed,
  removed, uncertain), validation errors, **Activate**, retire/discard,
  archive/unarchive item, catalogue search.
- **Staff:** after a successful upload, "Label these files" (optional; can be
  skipped). Viewer: "Add labels" / "Edit labels". Editor: search the asset
  venue's catalogue, pick items (+variant), content types, note, "Item not on
  the menu"; batch: common selection applied to all, per-file adjustments.
- **Admin library:** extra server-side filters: menu item (+variant), menu
  category, content type, labelled / needs labels, text search, date range,
  alongside venue, staff and type. Viewer shows labels and lets admins correct.

## 5. Acceptance additions

See `docs/fanout/CONTRACT-v0.3-menus.md` §7 for the acceptance matrix (15
scenarios) that QA must account for as passed / failed / blocked / not run.
