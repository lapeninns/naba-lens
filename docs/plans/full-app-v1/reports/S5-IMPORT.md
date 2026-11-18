# S5-IMPORT: legacy import (FA-54)

Branch `fa/s5-import`, from `068f67d9e`. Builds checklist row
**S20-legacy-import** (spec §20 steps 3 to 5 and 7; AC21 dedupe) as decided
in FA-54. Nothing was pushed, deployed or run against a hosted project.
`lib/db/types.ts` was regenerated locally for typecheck and is **not
committed** (the coordinator regenerates on merge; until then the committed
tree does not typecheck on its own, because the new RPCs and `p_import` are
not in the committed types).

## What was built

- **`pnpm import:legacy`** (`scripts/import/legacy.ts`, run with `tsx` like
  `pnpm seed:venues`; environment from `NEXT_PUBLIC_SUPABASE_URL` or
  `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY` through
  `scripts/lib/service-client.ts`; never prints keys). Flags: `--folder`,
  `--manifest`, `--admin <email>` (an active admin), `--label`, `--out`,
  `--apply`. **Dry run by default**: reads only and writes
  `*.dry-run.csv`; `--apply` writes `*.result.csv`. Exit 1 when any line
  failed, 2 on an error before any line ran.
- **Per file** (`scripts/import/legacy-import.ts`): SHA-256 of the bytes (the
  hash finalise stores, FA-35). An exact duplicate of a live, ready asset at
  the same venue (or of an earlier line in the same run) is **skipped and
  recorded** against that asset with its own contributor, label and folder,
  so both attributions are kept. Otherwise: original stored under the
  pipeline's key (`mediaObjectKeys`), validated with `lib/media`
  (`validateMedia`, the same limits, HEIC, video length), preview and
  thumbnail written and recorded with finalise's `recordRenditions`, archive
  receipt through `ensureMediaOriginalArchived`, then finished by
  `legacy_import_complete`, which runs finalise's own core
  (`private.complete_media_finalise_core`).
- **Provenance** `legacy_import` and an **import batch** row
  (`media_import_batches`, one per manifest SHA-256).
- **Capture date**: manifest (`supplied`), else EXIF / QuickTime metadata
  (`metadata`), else **unknown** (null). Never invented.
- **Never accepted**: no review decision is written, whatever the legacy
  folder says. Imports wait in Review; they cover nothing and earn no monthly
  credit until accepted.
- **Labels**: a legacy label matching exactly one current dish (active menu
  name or alias), place (not retired) or amenity (active check; key read as
  words) is staged as a staff-style label for review: dish through
  `private.save_media_labels_as`, place as a `media_area_labels` row, amenity
  as the item's staged check, read by `private.amenity_photo_rows`. No match
  or several: unlabelled, the legacy label kept as the note ("Imported.
  Legacy label: …"), and the photo appears **at once** in the venue's Needs
  label list with the reason **Imported, no slot matched**.
- **Idempotent**: re-running the same manifest reports every done line as
  `unchanged` and writes nothing; only failed lines are tried again. A crash
  part way through is picked up (asset ids are derived from batch and line).
- **Result CSV**: line, file, venue, outcome, detail, asset_id,
  duplicate_of, legacy_label, label_match, captured_at, captured_source,
  contributor_email. Formula characters are neutralised.
- **Admin Library**: **More filters → Imported** lists each batch ("name ·
  N imported"); URL param `import=<batch>`.
- **Docs**: `docs/legacy-import.md` (owner runs it, staging first) and the
  Library paragraph in `docs/usage-admin.md`.

## Migrations

| File                                     | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261118135000_legacy_import.sql`       | `media_assets.provenance` ('upload' default, 'legacy_import') and `import_batch_id` (FK, fixed by trigger `media_assets_provenance_fixed`); tables `media_import_batches`, `media_import_items` (RLS on, admin read only, writes revoked from authenticated); service-role-only functions `legacy_import_context`, `legacy_import_begin`, `legacy_import_reserve`, `legacy_import_record_duplicate`, `legacy_import_complete`; private helper `legacy_import_admin`. |
| `20261118135100_legacy_import_reads.sql` | `private.library_ref_ids` + kind `import`; `public.library_page` dropped and recreated with `p_import` (body from 20261118120300); `public.library_filter_lists` + `imports`; `private.asset_unlabelled_reason` + reason `imported` and the amenity-staged hold; `private.amenity_photo_rows` + staged imports; `private.monthly_credit_items` leaves imports out; `private.menu_photo_reviewable_uploader` lists the importing admin's assets for managers.         |

Every redefinition started from the latest body found with `grep -rn` across
`supabase/migrations/` (sources named in each migration's header). Security
definer functions use `set search_path = ''`. Both migrations apply through
`supabase db reset` (CLI statement splitter) on my stack and on the e2e stack.

## Decisions (owner asleep; recorded here)

1. **Import functions are service role only**, not `authenticated`. The import
   is a command-line owner action; nothing in the browser may call it. This is
   stricter than the batch rule ("granted to authenticated only") and tested.
2. **Who holds an imported asset**: the contributor when their email is an
   active staff or manager account; otherwise the importing admin. The
   contributor's email and id stay on `media_import_items` either way. Reason:
   the dish review rule (`menu_photo_reviewable_uploader`) hides photos of
   inactive or admin uploaders from managers.
3. **Managers review the importing admin's imports**:
   `menu_photo_reviewable_uploader` treats an admin who ran an import batch as
   a reviewable uploader. Admins cannot upload through the app (S1-UPLOAD:
   admin upload not built), so the only assets such an admin holds are
   imports. **Follow-up when admin upload is built**: key this on the asset's
   provenance instead (needs the asset at each call site).
4. **Imports are unlabelled at once** (reason `imported`), not after FA-4's 7
   days: the 7-day wait keeps a photo with the person who took it; an import
   has nobody to match it later. Manager copy: "Imported, no slot matched"
   (`inbox-copy.ts`).
5. **Imports earn no monthly credit** (`monthly_credit_items`): an old photo
   accepted this month is not this month's contribution (spec §12.4's honest
   counts).
6. **Amenity match**: the amenity catalogue has no short name, so a legacy
   label matches an amenity by its key read as words ("pool table"). The
   staged amenity is stored on the import item (no fact is invented: an
   amenity link otherwise needs an answer). Places and amenities take photos
   only, as in the app; a video matches dishes only.
7. **Date-only capture date** is stored as midday Europe/London (the day is
   what the manifest knows; midday keeps it on that day in UK displays). A
   time without an offset is Europe/London, as S1-UPLOAD reads EXIF.
8. **Matching is exact after normalising** (case, punctuation, `&`/and,
   accents). Never fuzzy.
9. **Batch identity is the manifest's SHA-256**: the same manifest is the same
   batch; any edit makes a new batch, whose already-imported files are then
   skipped as duplicates.
10. **Every import gets a note** ("Imported", plus the legacy label when
    present) so reviewers can tell an import from an upload.
11. **Scope guard**: one allowlist line for the new migration, which copies
    `library_page`'s existing tag filter (same precedent as S3-R1's
    `20261118120300`). Nothing broader.

## Files

- New: `scripts/import/{legacy.ts, legacy-import.ts, manifest.ts, labels.ts}`,
  the two migrations, `docs/legacy-import.md`,
  `tests/unit/legacy-import.test.ts`, `tests/security/legacy-import.test.ts`,
  `tests/e2e/full-app/s20-legacy-import.spec.ts`, this report.
- Changed: `package.json` (`import:legacy`), `lib/server/media/finalise.ts`
  (`recordRenditions` exported, service-only parameter; no behaviour change),
  `lib/library/model.ts` (`importId`, `import` param, `imports` list),
  `lib/server/media/library.ts` (`p_import`), `app/admin/library-more-filters.tsx`
  (Imported field), `app/admin/(content)/page.tsx` (options),
  `app/(dev)/ui-preview/ui-preview.tsx` (preview option),
  `lib/server/menu-photos/{types,read}.ts` and
  `components/nabalens/manager/review/inbox-copy.ts` (reason `imported`),
  `docs/usage-admin.md`, `tests/unit/library-model.test.ts`,
  `tests/ui/library-screens.test.tsx`, `tests/unit/scope-guard.test.ts`.
- Not touched: `app/staff/staff-portfolio.tsx`, `tests/e2e/helpers/`,
  checklist, decisions, progress, committed `lib/db/types.ts`. No new
  component, so no catalogue row (the Imported field extends
  `LibraryMoreFilters`).

## Checks (real output)

- `pnpm typecheck` (with locally regenerated types): clean (`tsc --noEmit`, no
  output).
- `pnpm exec eslint . --ignore-pattern '.claude/**'`: exit 0, no output.
- Prettier `--check` on every changed file: "All matched files use Prettier
  code style!"
- `pnpm test`: `Test Files 423 passed (423)`, `Tests 5205 passed (5205)`.
  (The first run failed only the scope guard, fixed by decision 11.)
- Security, stack `nabalens-s5-import` (ports 639, after `supabase db reset`):
  - `tests/security/legacy-import.test.ts`: 7/7. Dry run writes nothing;
    apply imports 4, skips 2 duplicates (one in-run, one of an existing app
    photo) with their own attribution, fails 2 (not media, unknown venue);
    staged dish, place and amenity labels and a note; never accepted; unknown
    date kept null; imports in the manager's dish, place, amenity and Needs
    label queues (reason `imported`); re-apply and a later dry run change
    nothing; Library `p_import` and `imports` list; import RPCs refused
    (42501) for staff, manager and an aal2 admin session; batch tables empty
    for staff, a manager, a manager at another venue and an admin without
    MFA (aal1); direct writes refused (42501); provenance fixed.
  - Related files on the same stack: 10 files / 110 tests passed
    (legacy-import, admin-overview-repairs, area-photos, label-help, library,
    library-page, library-filters, library-candidates, library-suspend-repairs,
    upload-pipeline) and 8 files / 125 tests passed (coverage-slots,
    review-inbox, s3-r1-review, s3-r8-review, s3-r13-fix-label, metrics,
    menus-review-fixes, asset-search).
  - Not run: the full security suite (coordinator's broad regression).
- E2E, stack `nabalens-s5-import-e2e` (ports 640, app 3640):
  `tests/e2e/full-app/s20-legacy-import.spec.ts --project chromium`:
  `1 passed`. Runs the real CLI (dry run, apply, re-apply), then the admin
  Library's Imported filter and the manager's Review at 390 and 1280, with
  no sideways scroll.
  - The first `next build` stopped on Next.js's security notice
    (`SecurityFatalError`, "Your version of Next.js is affected by a known
    security vulnerability … recommend you upgrade"). Retried once as the
    brief says; the retry built. Not upgraded: for the owner.
- CLI by hand on my stack: dry run "would import 2", apply "imported 2",
  re-apply "unchanged 2", exit 0 each.

## Known limits

- Asset search (`asset_search`) keeps its own copy of the unlabelled gate
  (7 days); a manager finds an unlabelled import there after 7 days, though
  Review lists it at once.
- A video import is covered by the pipeline's validation code but not by a
  video fixture in my tests.
- If a file's bytes change between a crashed run and its rerun, the stored
  original is the first run's; the hash recorded is the rerun's. Rerun with
  an unchanged folder.
