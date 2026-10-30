# Menu catalogue and media labels: data model

Database side of [spec v0.3](spec/NabaLens-Menus-Labels-v0.3.md) and
[contract §3 + amendment A1](fanout/CONTRACT-v0.3-menus.md). Migrations:
`supabase/migrations/20261030120000_menu_catalogue.sql` (catalogue) and
`20261030120100_media_labels.sql` (labels, suggestions, read functions).
Tests: `tests/security/menus-db.test.ts`, `tests/security/labels-db.test.ts`
(fixtures in `tests/security/menus-fixtures.ts`).

## Tables

| Table                               | Purpose                                                                                                                               | Key integrity rules                                                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `menu_versions`                     | A venue's menu at one point: `draft → active → retired`, or `draft → discarded`. Provenance in `source_*`.                            | `unique (id, venue_id)`; one `active` per venue (partial unique index); `based_on_version_id` must be the same venue (composite FK).                                                                                                                                 |
| `menu_sections`                     | Sections of one version.                                                                                                              | `(version_id, venue_id) → menu_versions`; slug unique per version.                                                                                                                                                                                                   |
| `menu_items`                        | **Stable identity** of one dish/drink of one venue across versions.                                                                   | `unique (id, venue_id)`; only `archived_at/by` ever change.                                                                                                                                                                                                          |
| `menu_variants`                     | Stable sub-identity of an item.                                                                                                       | `(item_id, venue_id) → menu_items`; rows never change.                                                                                                                                                                                                               |
| `menu_entries`                      | Per-version name/section/description/aliases/source metadata of an item; `needs_review` + candidates for uncertain re-import matches. | `(item_id, venue_id) → menu_items`, `(version_id, venue_id) → menu_versions`, `(section_id, version_id, venue_id) → menu_sections`; item and source key unique per version.                                                                                          |
| `menu_entry_variants`               | Variants listed on one entry.                                                                                                         | `(entry_id, item_id) → menu_entries` (cascade), `(variant_id, item_id) → menu_variants`; `lower(btrim(name))` unique per entry.                                                                                                                                      |
| `media_labels`                      | One row per labelled asset: content types (≤4 of 8 codes), note (≤280), `has_labels`, `revision`.                                     | `(asset_id, venue_id) → media_assets (id, venue_id)`, so `venue_id` is always the asset's upload-time venue.                                                                                                                                                         |
| `media_label_items`                 | 0–20 `(item, variant)` tuples per asset with a **snapshot** (item/variant/section name, section slug, version id).                    | `(asset_id, venue_id) → media_labels`, `(item_id, venue_id) → menu_items`, `(variant_id, item_id) → menu_variants`, `(version_id, venue_id) → menu_versions`; `unique nulls not distinct (asset_id, item_id, variant_id)`. Rows are inserted/deleted, never updated. |
| `menu_item_suggestions`             | "Item not on the menu" text: `open → resolved (with item)                                                                             | dismissed                                                                                                                                                                                                                                                            | withdrawn`. | `(asset_id, venue_id) → media_assets`, `(resolved_item_id, venue_id) → menu_items`; one open suggestion per (asset, person). |
| `menu_events`, `media_label_events` | Append-only audit.                                                                                                                    | No update/delete/truncate for any role (privileges revoked, including `service_role`, plus a trigger).                                                                                                                                                               |

The only change to `media_assets` is the constraint `unique (id, venue_id)`
(target of the composite keys) and the index `(uploader_id, venue_id) where
deleted_at is null`. No column or guard trigger changed, and no label code
updates `media_assets` (`save_media_labels` only row-locks it).

## Privileges and read policies

`authenticated` has **SELECT only** on every new table; all writes go through
the SECURITY DEFINER RPCs below, which re-read the caller's current
`profiles` row on every call. `anon` has nothing. `service_role` has all on
data tables and `select, insert` on the event tables. Every policy requires an
active profile.

| Who                  | Catalogue (`menu_*`)                                                                                                                                                                                                                      | Labels (`media_labels`, `media_label_items`)                      | Suggestions        | Events |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------ | ------ |
| Active admin         | all rows                                                                                                                                                                                                                                  | assets that are non-deleted and `ready` (no blanket admin policy) | all                | all    |
| Active staff         | **active** versions (and their sections/entries/entry variants) of venues where `private.staff_can_label_venue(venue)`; `menu_items`/`menu_variants` only if in such an active version or attached to one of their own non-deleted assets | own non-deleted assets                                            | own (`created_by`) | none   |
| Inactive / anonymous | none                                                                                                                                                                                                                                      | none                                                              | none               | none   |

`private.staff_can_label_venue(venue)` = active staff AND (current
`profiles.venue_id` = venue OR they own a non-deleted asset there). Drafts,
retired and discarded versions are therefore admin-only, and other venues'
catalogues are invisible unless the staff member has an asset there (a
transfer). Label visibility is one helper, `private.can_read_asset_labels`,
used by both label policies and `media_label_details`.

## RPCs and error codes

Errors are `raise exception '<code>'`; the message is exactly the code.
SQLSTATE: `42501` forbidden, `P0002` not found, `22023` invalid input,
`40001` conflict, `P0001` other rule. PostgREST returns HTTP 500 for `P0002`
(as for the existing `delete_media_asset`), so map by `error.message`/`code`.

| RPC                                                                                                                                                       | Caller                     | Errors (besides `not_active_admin` 42501)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_menu_draft(p_venue_id, p_title, p_source, p_document, p_based_on?) → uuid`                                                                        | admin                      | `venue_not_found`, `menu_version_not_found` (base not same venue) P0002; `invalid_menu_source`, `invalid_menu_document`, `menu_item_wrong_venue` 22023                                                                                                                                                                                                                                                                                                                 |
| `save_menu_draft(p_version_id, p_expected_revision, p_document) → int`                                                                                    | admin                      | `menu_version_not_found` P0002; `menu_version_not_draft` P0001; `menu_version_conflict` 40001 (detail `{"revision":n}`); `invalid_menu_document`, `menu_item_wrong_venue` 22023                                                                                                                                                                                                                                                                                        |
| `activate_menu_version(p_version_id, p_expected_revision)`                                                                                                | admin                      | `menu_version_not_draft`, `menu_review_pending`, `menu_empty` P0001; `menu_version_conflict` 40001                                                                                                                                                                                                                                                                                                                                                                     |
| `retire_menu_version(p_version_id)`                                                                                                                       | admin                      | `menu_version_not_active` P0001                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `discard_menu_draft(p_version_id)`                                                                                                                        | admin                      | `menu_version_not_draft` P0001                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `set_menu_item_archived(p_item_id, p_archived)`                                                                                                           | admin                      | `menu_item_not_found` P0002; idempotent (no event when unchanged)                                                                                                                                                                                                                                                                                                                                                                                                      |
| `save_media_labels(p_asset_id, p_expected_revision, p_content_types, p_note, p_items, p_missing_item?, p_catalogue_version_id?) → (revision, has_labels)` | active staff (own) / admin | `not_active_user` 42501; `media_asset_not_found` P0002 (unknown, forbidden, deleted, not ready: identical); `label_conflict` 40001 (detail `{"revision":n}`); `menu_catalogue_conflict` 40001 (detail `{"activeVersionId":…}`); `menu_item_wrong_venue` 22023 (detail = JSON id array); `menu_item_unavailable` P0001 (detail = JSON item id array); `invalid_revision`, `invalid_content_type`, `note_too_long`, `missing_item_too_long`, `invalid_label_items` 22023 |
| `resolve_menu_item_suggestion(p_suggestion_id, p_status, p_item_id?, p_note?)`                                                                            | admin                      | `menu_item_suggestion_not_found` P0002; `menu_item_suggestion_not_open` P0001; `invalid_suggestion_status`, `invalid_suggestion_item`, `menu_item_wrong_venue`, `note_too_long` 22023                                                                                                                                                                                                                                                                                  |
| `media_label_details(p_asset_ids uuid[])`                                                                                                                 | anyone signed in           | `too_many_assets` (>100) 22023; returns rows only for assets whose labels the caller may read                                                                                                                                                                                                                                                                                                                                                                          |
| `library_assets(p_item?, p_variant?, p_category?, p_content_type?, p_label_state?, p_query?) → setof media_assets`                                        | invoker (RLS)              | none; unknown `p_label_state`/`p_content_type` match nothing                                                                                                                                                                                                                                                                                                                                                                                                           |

`invalid_menu_document` detail is JSON `{"path":"sections[2].items[5].name","message":"…"}`.

### Draft documents (`MenuDocument`, limits = `MENU_IMPORT_LIMITS`)

`save_menu_draft` replaces the draft's sections/entries/entry variants in one
transaction. Identity rules (A1.3, no implicit reuse in SQL):

- `itemId` given → a `menu_items` row of the version's venue
  (`menu_item_wrong_venue`), at most once per document; `itemId: null` → a
  **new** item. Re-import matching by source key is the import matcher's job
  (packet C), which fills `itemId`; the editor carries ids forward.
- `variantId` given → must belong to that item; `null` → a **new** variant.
  Two variants of one entry may not share `lower(btrim(name))`.
- `review` non-null → `needs_review = true` with candidates (same-venue items)
  and reason; activation refuses while any entry needs review.
- Also checked: section slug format/uniqueness, kind, names, description ≤600,
  ≤10 aliases of 1–80, source key format/uniqueness, `sourceMeta` object of
  text/number/boolean/null/text-list values ≤4096 bytes, ≤100 sections,
  ≤2000 items, ≤12 variants, ≤20 candidates, reason ≤200.

### Locking and concurrency (A1.4–A1.6)

- Every catalogue write takes `pg_advisory_xact_lock(hashtextextended(
'nabalens_menu:'||venue_id, 0))`, then `FOR UPDATE` on the target row, then
  checks status/revision.
- `save_media_labels`: `FOR UPDATE` on the `media_assets` row first (serialises
  saves of one asset with finalise/delete), then caller/asset checks, then the
  label row (missing = revision 0) and the revision compare-and-set. A
  concurrent first save therefore fails with `label_conflict`, never a unique
  violation. Only when the save **adds** a tuple does it take the venue lock
  **shared**, compare `p_catalogue_version_id` with the active version
  (`menu_catalogue_conflict`) and validate availability.

## Historical meaning

- A label tuple is `(item_id, variant_id)`; keeping it on a save (exact match,
  `IS NOT DISTINCT FROM`) preserves its snapshot and `added_by/added_at` even
  if the item was renamed, moved, archived or dropped since. A changed variant
  is a new tuple and is fully re-validated.
- New tuples must be in the venue's **active** version, not archived, with the
  variant listed on that active entry; the snapshot comes from that entry.
- Version content (sections/entries/entry variants) is immutable once a
  version leaves `draft`, for every role (trigger). Headers: identity fields
  never change; title/source/revision only while draft; afterwards only the
  documented transition fields (A1.8).
- Current name (`media_label_details`): the active version's entry, else the
  most recently activated (now retired) version's entry, else the snapshot.
  Drafts and discarded versions never supply names. `state` is `archived`
  (item archived) > `current` (in the active version, with its variant) >
  `not_on_active_menu`.
- No DELETE privilege exists for end users, and composite foreign keys use
  `on delete restrict` for catalogue identities, so an item with labels is
  never hard-deleted.

## How the special cases are enforced

| Case                       | Enforcement                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin vs staff             | RPCs re-check `profiles.role/active` each call (`private.assert_active_admin`, profile read in `save_media_labels`).                                          |
| Inactive user              | Every policy and RPC requires `profiles.active`; an old JWT gains nothing.                                                                                    |
| Staff own-only             | `save_media_labels` requires `uploader_id = auth.uid()` for staff, same `media_asset_not_found` as unknown.                                                   |
| Cross-venue item           | Composite FKs make it impossible to store; the RPC reports `menu_item_wrong_venue`.                                                                           |
| Deleted / unfinished media | Saves require non-deleted `ready`; label reads require non-deleted (staff) or non-deleted `ready` (admin). Tombstoning hides labels immediately.              |
| Staff transfer             | Labels use `media_assets.venue_id`; `staff_can_label_venue` lets the uploader read the old venue's active catalogue while they own a non-deleted asset there. |
| Retired catalogue          | No active version → no new tuples (`menu_item_unavailable`); notes, content types and existing tuples still save.                                             |

## `library_assets` and PostgREST

`LANGUAGE sql STABLE SECURITY INVOKER`, no `SET` clause, fully schema-qualified,
one SELECT of `public.media_assets` with EXISTS predicates, so PostgreSQL 17
inlines it and the caller's RLS and PostgREST filters/order/limit apply to
`media_assets` directly. `p_item` + `p_variant` must match the same tuple;
category is asset-wide; `p_query` escapes `\`, `%`, `_` and uses `ILIKE`.

PostgREST builds the RPC source from the **selected and filtered** columns
only: a column used only in `order` is missing ("column media_assets.created_at
does not exist"). Select every order/cursor column (`created_at`, `id`):

```ts
db.rpc("library_assets", { p_category: "curries" })
  .select("id, created_at, venue:venues(name)")
  .eq("venue_id", venueId)
  .order("created_at", { ascending: false })
  .order("id", { ascending: false })
  .limit(pageSize + 1)
```

### Inlining evidence (local stack, `set role authenticated`, 30 Oct 2026)

Admin, direct call with venue filter/order/limit: the plan starts
`Limit → Index Scan using media_assets_venue_feed_idx on media_assets a` with
the RLS predicate and every label EXISTS as `SubPlan`s in its filter; there is
no `Function Scan on library_assets`.

Staff, the exact PostgREST statement shape (CTE + `LATERAL
"public"."library_assets"(…)`): `Limit → Sort → Nested Loop → Function Scan on
json_to_record` (the payload) `+ Seq Scan on media_assets a` with
`deleted_at IS NULL AND venue_id = … AND (uploader_id = auth.uid() …)` (RLS)
and the item EXISTS as a `SubPlan` (an index-only scan on
`media_label_items_tuple_key`). Again no function scan.
