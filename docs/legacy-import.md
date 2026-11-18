# Legacy import

Brings existing photos and videos into Naba Lens (spec §20 steps 3 to 5 and 7;
decision FA-54). The owner runs it, from a computer with the files, **against
staging first**. Running it against production is an owner action.

## What it does

For each file in the manifest:

- Hashes it (SHA-256, the same hash every upload stores). If the venue already
  has a live photo or video with the same bytes, the file is **skipped** and
  recorded against that photo, keeping its own contributor, label and folder
  (FA-35). Two identical files in one manifest: the second is the duplicate.
- Stores the original unchanged, checks it and makes its preview and
  thumbnail with the same code as an upload.
- Marks it **imported** (provenance `legacy_import`, with its batch).
- Capture date: from the manifest, else from the file (EXIF date taken, or a
  video's creation time), else **unknown**. Never guessed.
- Always **awaiting review**, whatever its old folder was called. Imported
  photos cover nothing and earn no monthly credit until a reviewer accepts
  them.
- Legacy label: if it names exactly one current dish (name or alias on the
  active menu), place, or facility (its key as words, for example "pool
  table") at that venue, the photo is labelled with it for review. Otherwise
  (no match, or more than one) it stays unlabelled, with the legacy label
  kept as its note, and appears at once in the venue's **Needs label** list.
- Who holds it: the contributor, when their email is an active staff or
  manager account; otherwise the admin running the import. The contributor's
  email is kept with the import either way.

Admins find each batch in the Library under **More filters → Imported**.

## Run it

```sh
pnpm import:legacy --folder ./old-photos --manifest ./old-photos.csv \
  --admin you@example.com            # dry run: writes nothing
pnpm import:legacy --folder ./old-photos --manifest ./old-photos.csv \
  --admin you@example.com --apply    # imports
```

- `--admin`: your email; it must be an active admin account.
- `--label`: the batch's name in the Library (default: the manifest's name).
- `--out`: the result CSV (default: next to the manifest,
  `*.dry-run.csv` or `*.result.csv`).

It needs `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`) and
`SUPABASE_SERVICE_ROLE_KEY` in the environment, as `pnpm seed:venues` does,
and never prints them.

**Running it again** with the same manifest changes nothing: lines already
done are reported as `unchanged`, and only failed lines are tried again. A
changed manifest (any edit) is a new batch; its files that were already
imported are then skipped as duplicates.

## Manifest

A CSV with a header row. Column names are not case-sensitive.

| Column              | Required | Meaning                                                                                        |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `file`              | yes      | Path inside `--folder`. Paths outside the folder are refused.                                  |
| `venue`             | yes      | Venue slug or id.                                                                              |
| `contributor_email` | no       | Who took it.                                                                                   |
| `capture_date`      | no       | `YYYY-MM-DD` (read as midday, UK time), or `YYYY-MM-DDTHH:MM` (UK time), or with `Z`/`+01:00`. |
| `legacy_label`      | no       | The old label or caption.                                                                      |
| `legacy_folder`     | no       | The old folder. Kept for the record only; it never makes a photo approved.                     |

```csv
file,venue,contributor_email,capture_date,legacy_label,legacy_folder
2019/fish.jpg,the-bell,sam@example.com,2019-06-01,Fish & chips,Approved
2019/garden.jpg,the-bell,,,Beer garden,
```

Files: JPEG, PNG, WebP, HEIC, MP4, MOV or WebM, up to 25 MB for photos and
250 MB (60 seconds) for videos, the same limits as uploads.

## Result CSV

One row per manifest line: `outcome` is `imported`, `duplicate`, `unchanged`
or `failed` (`would_import` or `would_skip_duplicate` in a dry run), with
`detail` (why it failed), `asset_id`, `duplicate_of`, `label_match`,
`captured_at` and `captured_source` (`supplied`, `metadata` or `unknown`).
The command exits 1 when any line failed.

## Under the hood

Migrations `20261118135000_legacy_import.sql` and
`20261118135100_legacy_import_reads.sql`. The import functions
(`legacy_import_*`) run only with the service role; the batch and item tables
are readable by admins only. Code: `scripts/import/`.
