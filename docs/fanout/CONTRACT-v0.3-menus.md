# NabaLens v0.3 fan-out contract: menu catalogue and media labels

Supersedes the wave-era ownership table in [CONTRACT.md](CONTRACT.md) **for
this feature only**; that file's hard limits still apply. Product rules:
[spec v0.3](../spec/NabaLens-Menus-Labels-v0.3.md) (read it first; it amends
v0.2's "no tagging" exclusion). Shared TS types: `lib/menus/types.ts`.

## 1. Branches, baseline, process

- Integration branch: **`feat/nabalens-menus`** (lead-owned worktree
  `~/.t3/worktrees/nabalens/feat-nabalens-menus`). Base: `feat/nabalens-mvp`
  @ `1741ccb`. Contract commit: the commit that added this file.
- Each worker: own worktree + own branch `feat/nlm-<packet>`. First command:
  `git merge --ff-only feat/nabalens-menus` (or the SHA in your brief); stop
  and report if that fails. Commit only to your branch (Conventional Commits).
  **Never** merge, rebase or push `feat/nabalens-menus`; the lead integrates.
- No remote exists. Do not add one, push, open PRs or run `lci`.
- The user's populated stack (`supabase_*_nabalens`, ports 554xx) and app on
  :3000 serve the **main checkout**: never stop, reset, seed, or repoint them,
  and never edit files in `~/LapenInns Project/platform/nabalens`.
- A DB-backed worker creates its **own** stack with the copy recipe in
  `docs/setup.md` §2 (unique `mktemp -d` workdir, unique project_id, assigned
  port block below), `supabase --workdir "$W" start`, `db reset --local` on
  that workdir only, and stops it when done (`supabase --workdir "$W" stop`).
  Port blocks: B **620xx**, D **621xx**, F **622xx**, H **623xx**, QA **624xx**,
  lead **625xx**. App ports: D 3621, F 3622, H 3623, QA 3624, lead 3625.
- Disk is tight (~20 GiB free). Do not run `pnpm build` unless your brief says
  so; delete your `.next` afterwards if you did. One Docker stack per worker.
- `pnpm install --frozen-lockfile --offline` if `node_modules` is missing. No
  new dependencies (none are needed: CSV is parsed by hand-written code).
- Never read/print `.env*`, `supabase status` secrets, service keys, cookies or
  tokens into logs, commits, handoffs or test artefacts.
- Next.js 16.4.2: read the relevant guide in `node_modules/next/dist/docs/`
  before writing Next code (Server Actions: sequential per client, 1 MB body;
  Route Handlers for uploads and abortable GETs; `params`/`searchParams` are
  Promises; authorise inside every action/route).
- Required before handoff: `pnpm typecheck`, `pnpm lint`, `pnpm test`, plus
  your packet's DB/security tests. Report real output.

## 2. Ownership (one writer per file)

| Path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Owner                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `docs/spec/NabaLens-Menus-Labels-v0.3.md`, this file, `lib/menus/types.ts`, `components/nabalens/types.ts`, `components/nabalens/index.ts`, `components/nabalens/app-shell.tsx`, `components/nabalens/media-viewer.tsx`, `components/nabalens/media-tile.tsx`, `components/nabalens/upload-dialog.tsx`, `components/nabalens/upload-queue.ts`, `components/nabalens/use-upload-queue.ts`, `lib/upload/**`, `app/_media/**`, `app/staff/**`, `lib/server/media/types.ts`, `package.json`, `pnpm-lock.yaml`, test harness configs, `docs/*.md` user guides | **A lead**               |
| `supabase/migrations/2026103012*.sql`, `lib/db/types.ts`, `tests/security/menus-*.test.ts`, `tests/security/labels-*.test.ts` (DB-level), `docs/menus-data-model.md`                                                                                                                                                                                                                                                                                                                                                                                     | **B database**           |
| `lib/menus/import/**`, `scripts/menus/**`, `tests/fixtures/menus/**`, `tests/unit/menus-import*.test.ts`, `docs/menus-import.md`                                                                                                                                                                                                                                                                                                                                                                                                                         | **C import**             |
| `lib/server/menus/**`, `app/admin/menus/**` (pages, actions, route wiring), `app/api/admin/menus/**`, `tests/security/menus-server*.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                             | **D catalogue server**   |
| `components/nabalens/menus/**`, `tests/ui/menus-*.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **E admin menu UI**      |
| `lib/server/labels/**`, `app/_labels/**`, `app/api/labels/**`, `tests/security/labels-server*.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **F labelling server**   |
| `components/nabalens/labels/**`, `tests/ui/labels-*.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **G staff labelling UI** |
| `lib/server/media/library.ts`, `lib/server/media/library-labels.ts`, `app/admin/admin-library.tsx`, `app/admin/library-search.ts`, `app/admin/library-actions.ts`, `app/admin/page.tsx`, `app/api/library/route.ts`, `components/nabalens/library-filters.tsx`, `tests/security/library-filters*.test.ts`, `tests/unit/library-*.test.ts`                                                                                                                                                                                                                | **H library discovery**  |
| review notes `docs/reviews/menus-*.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **I review**             |
| `tests/e2e/menus-*.spec.ts`, `docs/qa/menus-*.md`, QA artefacts outside the repo                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **J QA**                 |

Presentational components (`components/nabalens/**`) take props/callbacks,
never fetch, never import `lib/supabase` or `lib/server`. They may import
**types/constants only** from `lib/menus/types.ts` and pure helpers from
`lib/menus/import/**`. Server code never imports `components/`.

If you need a change in a file you do not own, describe it in your handoff
(exact diff or signature); do not edit it.

## 3. Database contract (owner B)

Migrations: `20261030120000_menu_catalogue.sql`, `20261030120100_media_labels.sql`
(B may split further within `2026103012*`). Postgres 17. Follow existing style
(private schema helpers, `set search_path = ''`, explicit grants, comments).

### Tables (all RLS on; end users get SELECT only via policies; no INSERT/UPDATE/DELETE grants to `authenticated`; `service_role` all)

```
menu_versions(id uuid pk, venue_id uuid not null → venues, status text check in
  ('draft','active','retired','discarded') default 'draft', title text 1..120,
  source_kind text check in ('manual','json','csv'), source_label text ≤200 null,
  source_sha256 text null (^[0-9a-f]{64}$), source_revision text ≤80 null,
  source_captured_at timestamptz null, source_notes text ≤1000 null,
  based_on_version_id uuid null → menu_versions, revision int not null default 1,
  created_by uuid → profiles, created_at, updated_at, reviewed_by, reviewed_at,
  activated_by, activated_at, retired_by, retired_at,
  unique (id, venue_id), unique (venue_id) where status = 'active')
menu_sections(id, version_id, venue_id, slug (^[a-z0-9]+(-[a-z0-9]+)*$ ≤80),
  name 1..120, kind text check in ('food','drinks','other'), position int,
  unique (version_id, slug), fk (version_id, venue_id) → menu_versions(id, venue_id))
menu_items(id uuid pk, venue_id → venues, created_by, created_at,
  archived_at, archived_by, unique (id, venue_id))           -- stable identity
menu_variants(id uuid pk, item_id → menu_items, venue_id, created_at,
  unique (id, item_id), fk (item_id, venue_id) → menu_items(id, venue_id))
menu_entries(id, version_id, venue_id, section_id → menu_sections, item_id,
  name 1..120, description ≤600 null, aliases text[] (≤10, each 1..80),
  source_key text (^[a-z0-9][a-z0-9:_-]{0,159}$), source_meta jsonb object
  (pg_column_size < 8192), position int, needs_review bool default false,
  review_candidates uuid[] default '{}', review_reason text ≤200 null,
  unique (version_id, item_id), unique (version_id, source_key),
  fk (item_id, venue_id) → menu_items(id, venue_id),
  fk (version_id, venue_id) → menu_versions(id, venue_id))
menu_entry_variants(id, entry_id → menu_entries on delete cascade, item_id,
  variant_id, name 1..80, position int, unique (entry_id, variant_id),
  fk (variant_id, item_id) → menu_variants(id, item_id))
media_labels(asset_id uuid pk, venue_id, content_types text[] default '{}'
  (subset of the 8 codes, ≤4, no duplicates), note text ≤280 null,
  has_labels bool not null default false, revision int not null default 1,
  created_at, updated_at, updated_by → profiles, unique (asset_id, venue_id),
  fk (asset_id, venue_id) → media_assets(id, venue_id))
  -- adds `unique (id, venue_id)` constraint on media_assets (no column change)
media_label_items(id, asset_id, venue_id, item_id, variant_id null,
  item_name text, variant_name text null, section_name text null,
  section_slug text null, version_id uuid null, added_by, added_at,
  unique nulls not distinct (asset_id, item_id, variant_id),
  fk (asset_id, venue_id) → media_labels(asset_id, venue_id) on delete cascade,
  fk (item_id, venue_id) → menu_items(id, venue_id),
  fk (variant_id, item_id) → menu_variants(id, item_id))
media_label_events(id bigint identity, asset_id, venue_id, actor_id, actor_role,
  action text, before jsonb, after jsonb, created_at)       -- append-only audit
menu_item_suggestions(id, venue_id, asset_id null → media_assets,
  suggested_name 1..120, status text check in ('open','resolved','dismissed',
  'withdrawn') default 'open', created_by, created_at, updated_at,
  resolved_item_id null (fk with venue_id → menu_items), resolved_by,
  resolved_at, resolution_note ≤280 null,
  unique (asset_id, created_by) where status = 'open')
menu_events(id bigint identity, venue_id, version_id null, item_id null,
  actor_id, action text, detail jsonb, created_at)          -- append-only audit
```

Triggers: non-draft versions' rows (sections/entries/entry variants) are
immutable for every role except inside the RPCs below; `media_assets` is
**never** updated by any label code (its guard trigger stays untouched).

### Read policies (all also require the caller to be active)

- Admin (`private.is_active_admin()`): every row of every table above.
- Staff, catalogue: rows of **active** versions (and their items/variants)
  for venues where `private.staff_can_label_venue(venue_id)` = active staff
  AND (current `profiles.venue_id` = venue OR caller owns a non-deleted asset
  at that venue). `menu_items`/`menu_variants` readable for those venues.
- Staff, labels: `media_labels`/`media_label_items` of own non-deleted assets.
  Admin: of non-deleted `ready` assets. Events tables: admin only.
- Suggestions: admin all; staff own (`created_by = auth.uid()`).

### RPCs (`security definer`, `set search_path = ''`, granted to `authenticated` + `service_role`)

Error convention (matches existing RPCs): `raise exception '<code>'` with
errcode `42501` (forbidden), `P0002` (not found), `22023` (invalid input),
`40001` (`label_conflict`, `menu_version_conflict`), `P0001` (other rule). The
message is exactly the code; details may carry JSON (e.g. unavailable ids).

| RPC                                                                                                                                                                                                                      | Who                                                     | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_menu_draft(p_venue_id uuid, p_title text, p_source jsonb, p_document jsonb, p_based_on uuid default null) → uuid`                                                                                                | active admin                                            | Insert draft version (source fields from `p_source`: `kind,label,sha256,revision,capturedAt,notes`), then same content write as `save_menu_draft`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `save_menu_draft(p_version_id uuid, p_expected_revision int, p_document jsonb) → int` (new revision)                                                                                                                     | active admin                                            | Draft only (`menu_version_not_draft`). Revision mismatch → `menu_version_conflict`. Replaces the draft's sections/entries/entry-variants from `MenuDocument` JSON (see `lib/menus/types.ts`). `itemId` given → must be a `menu_items` row of the version's venue (`menu_item_wrong_venue`), unique in document. `itemId` null → reuse the item of this version's previous entry with the same `sourceKey`, else create a new `menu_items` row. `variantId` given → must belong to the item; null → reuse that item's variant whose latest entry-variant name matches case-insensitively, else create. `review` non-null → `needs_review = true`, candidates/reason stored (candidates must be same-venue items). Validates all limits; title updates the version title.                                                                                                                                                                                                                                                                        |
| `activate_menu_version(p_version_id uuid, p_expected_revision int) → void`                                                                                                                                               | active admin                                            | Per-venue advisory lock. Draft → active (`reviewed_*`, `activated_*` = caller/now); previous active → retired. Refuses `menu_review_pending` (any `needs_review`), `menu_empty` (no entries), conflict.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `retire_menu_version(p_version_id uuid) → void`                                                                                                                                                                          | active admin                                            | active → retired ("archive menu").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `discard_menu_draft(p_version_id uuid) → void`                                                                                                                                                                           | active admin                                            | draft → discarded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `set_menu_item_archived(p_item_id uuid, p_archived bool) → void`                                                                                                                                                         | active admin                                            | Sets/clears `archived_at/by`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `save_media_labels(p_asset_id uuid, p_expected_revision int, p_content_types text[], p_note text, p_items jsonb, p_missing_item text default null) → table(revision int, has_labels bool)`                               | active staff (own asset) or active admin                | Asset must exist, not deleted, `ready`; staff must own it, else `media_asset_not_found` (P0002, same for forbidden). `p_expected_revision` = 0 when no label row yet; mismatch → `label_conflict`. `p_items` = `[{"itemId":uuid,"variantId":uuid\|null}]`, deduplicated, ≤20. Items already on the asset are kept as-is (snapshot unchanged). New items must be same venue as the asset (`menu_item_wrong_venue`), present in that venue's **active** version and not archived (`menu_item_unavailable`, detail = JSON array of ids); variant must belong to item and appear in the active entry. Snapshot from the active entry. Content types validated (`invalid_content_type`); note trimmed, empty → null, ≤280 (`note_too_long`). `p_missing_item`: null = unchanged, `''` = withdraw caller's open suggestion for this asset, text (1..120) = upsert caller's open suggestion. Sets `has_labels`, bumps revision, writes `media_label_events` (`before`/`after`). Row-locks the label row (`for update`). Never touches `media_assets`. |
| `resolve_menu_item_suggestion(p_suggestion_id uuid, p_status text, p_item_id uuid default null, p_note text default null) → void`                                                                                        | active admin                                            | open → resolved (item required, same venue) or dismissed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `library_assets(p_item uuid default null, p_variant uuid default null, p_category text default null, p_content_type text default null, p_label_state text default null, p_query text default null) → setof media_assets` | **security invoker**, `language sql stable` (inlinable) | Returns `media_assets` rows visible under the caller's RLS that match every non-null argument: item (any label item), variant, category = label snapshot `section_slug` OR the item's section slug in the venue's active version, content type ∈ `content_types`, label state `labelled` (`has_labels`) / `unlabelled` (no row or not `has_labels`), query = case-insensitive substring (escape `%_\`) of label note, snapshot names, any entry name/alias of a labelled item in any version, or open suggestion text. Each asset at most once (EXISTS, no joins that multiply rows). Callers add `venue_id`/`uploader_id`/`media_type`/`upload_state`/`deleted_at`/date/cursor filters, order and limit through PostgREST on the result, and may embed `venues`/`profiles` as today.                                                                                                                                                                                                                                                          |

Indexes for: `media_label_items (item_id)`, `(variant_id)`, `(section_slug)`,
`media_labels (venue_id, has_labels)`, `menu_entries (item_id)`,
`menu_entries (version_id, section_id, position)`, suggestions `(venue_id, status)`.

`lib/db/types.ts` is regenerated by B against B's own stack:
`supabase gen types typescript --workdir "$W" --local --schema public`, then
`pnpm exec prettier --write lib/db/types.ts`.

## 4. TypeScript contract

Shared, pure (`lib/menus/types.ts`, lead): `CONTENT_TYPES`,
`CONTENT_TYPE_LABELS`, `LABEL_LIMITS`, `MENU_IMPORT_LIMITS`, `MenuDocument`
(+ section/item/variant), `MenuSource`, `ImportIssue`, `MenuDiff`,
`MenuVersionSummary`, `MenuVersionDetail`, `MenuVenueSummary`,
`SuggestionView`, `LabelCatalogue`, `MediaLabelSummary`, `SaveLabelsInput`,
`SaveLabelsResult`, `LibraryLabelFilters`, `LibraryLabelFilterOptions`.
Read the file; it is the source of truth for shapes.

Stub modules exist on the contract commit with the **final signatures**;
owners replace bodies, keep signatures (additive changes only, reported in
the handoff):

- C `lib/menus/import/index.ts`: `parseMenuJson`, `parseMenuCsv`,
  `parseMenuFile`, `slugify`, `makeSourceKey`, `matchImportToBase`,
  `diffMenuDocuments`, `applyReviewDecision`, `validateMenuDocument`,
  `sha256Hex` (pure, no Node-only APIs except where noted; must run in the
  browser too: use Web Crypto for hashing).
- D `lib/server/menus/index.ts`: admin catalogue operations (see stub).
- F `lib/server/labels/index.ts`: `getLabellingCatalogue`,
  `getAssetLabelContext`, `saveAssetLabels`, `loadLabelSummaries`.
- H uses `loadLabelSummaries` from F inside `lib/server/media/library.ts`.

Server results use the existing `Outcome<T>` from `lib/server/media/types.ts`.
Map RPC error codes to statuses: `media_asset_not_found` 404,
`label_conflict`/`menu_version_conflict` 409, `menu_item_unavailable`/
`menu_item_wrong_venue`/`invalid_*`/`*_too_long` 400, `42501` 403,
anything else 503 with a redacted log (`lib/server/log/redact`).

`MediaItemView` (server) and `MediaItem` (components) gain
`labels: MediaLabelSummary | null` (server) / `labels?: MediaLabelSummary | null`
(components). Lead owns both files and the gallery/viewer wiring.

## 5. Routes and wiring

- `/admin/menus` (venue list), `/admin/menus/[venueId]` (overview, import,
  new draft, suggestions), `/admin/menus/versions/[versionId]` (editor, diff,
  activate). D wires pages with E's components. Import preview upload goes
  through `POST /api/admin/menus/import-preview` (multipart `file`,
  `venueId`; same-origin check; admin; ≤1 MiB; returns parsed document,
  issues, diff, source with sha256). Admin nav gains **Menus** (lead).
- Labels: F owns `app/_labels/actions.ts` (Server Functions
  `loadLabelEditorContext(assetIds)`, `saveLabelBatch(inputs)` – one action
  saves a whole batch sequentially and returns per-asset results) and
  `app/_labels/label-editor-host.tsx` (client: loads context, renders G's
  `LabelEditorDialog`, calls `onSaved`). Lead mounts the host from the staff
  upload dialog ("Label these files"), the viewer ("Add/Edit labels") in both
  portfolio and admin library.
- Library: H extends URL params: `venue, staff, type` (existing) +
  `item, variant, category, content, labels (labelled|unlabelled), q, from,
to (YYYY-MM-DD, inclusive, Europe/London day)`.

## 6. Handoff (every packet)

Final message ends with `## Handoff`: scope done/status; worktree, branch,
base SHA, commit SHA(s); exact changed files; contract changes requested;
commands run with real results; risks, prerequisites, follow-ups. Commit
everything on your branch before handing off.

## 7. Acceptance matrix (QA owns evidence; owners own the tests)

| #   | Scenario                                                                            | Primary layer         |
| --- | ----------------------------------------------------------------------------------- | --------------------- |
| 1   | Import two venue menus (incl. The Railway fixture); venue separation                | C unit, D/B DB, J e2e |
| 2   | Malformed input rejected; duplicates, repeated names, variants, ambiguous re-import | C unit, D             |
| 3   | Review + activate; draft never exposed to staff as active                           | B RLS, D, J           |
| 4   | Rename, archive, re-import, category move keep historical labels                    | B, F, H               |
| 5   | Upload photo + video, label both with several items                                 | J e2e                 |
| 6   | Upload without labels, label later                                                  | J e2e                 |
| 7   | Batch apply, per-file override, persists after reload                               | G UI, J e2e           |
| 8   | Missing item; unavailable/stale catalogue handled                                   | F, G, J               |
| 9   | Staff own-only; no cross-staff or cross-venue item via UI/API/DB                    | B RLS, F, I           |
| 10  | Inactive users, deleted media, unfinished uploads keep boundaries                   | B, F                  |
| 11  | Staff transfer: old asset uses original venue catalogue                             | B, F, J               |
| 12  | Admin correction, combined filters, search, stable pagination, no duplicates        | H, J                  |
| 13  | Original bytes, upload, preview, download unchanged                                 | existing suites, J    |
| 14  | Phone widths, accessible names, keyboard focus, recovery                            | E, G, J               |
| 15  | Failures/retries/concurrent stale updates: no silent loss/duplicates                | B, F, G               |
