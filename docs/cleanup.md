# Media removal and cleanup

Spec v0.2 §5 (abandoned uploads) and §7 (removal and account lifecycle).

> **Status: nothing is scheduled or deployed.** The cleanup runner, endpoint and
> script exist and are tested against a local stack. Until one of the scheduling
> options below is set up in the deployed environment, removed media stays hidden
> but its bytes are only deleted when a removal's own storage call succeeds, and
> abandoned uploads are not cleaned. Check this at release (spec §11).

## Removing an asset

`removeMediaAsset(assetId)` in `lib/server/lifecycle/remove.ts` (also exported from
`lib/server/lifecycle`). Call it from the delete Server Functions after the user
confirms: "Remove this file from your portfolio and the admin library? Previously
downloaded copies cannot be recalled."

1. Re-reads the caller's profile from the database: no session → `401
unauthenticated`, no profile → `403 forbidden`, deactivated → `403 inactive`.
2. Calls `delete_media_asset` **as the caller**, so the database checks ownership
   from current data (staff: own assets only; admin: any) and writes the tombstone
   (`deleted_at`). From that moment the asset is gone from the staff portfolio and
   the admin library, and storage policies refuse new reads and signed URLs.
   Missing assets and another staff member's assets both return `404 not_found`, so
   staff cannot probe for asset IDs.
3. Lists and removes the original and derivatives with the service role, then
   returns `{ ok: true, storage: "removed" | "pending" }`. `pending` means storage
   removal failed or is incomplete; the asset stays hidden and the cleanup job
   retries it.

Removal is idempotent: removing a removed asset succeeds again and retries any
leftover objects. Errors are returned, not thrown (Next hides thrown messages in
production). There is no trash or recovery; tombstones are permanent.

Not recalled: signed URLs issued before removal stay valid until they expire (60 s,
`MEDIA_LIMITS.signedUrlExpirySeconds`), and downloaded copies cannot be revoked.

## The cleanup run

`runMediaCleanup(serviceClient, { now? })` in `lib/server/lifecycle/cleanup.ts`
(`runCleanup()` in `lib/server/lifecycle` uses the app's service client). Each run:

1. Takes the `media_cleanup` lease. If another run holds it, the run returns
   `{ status: "skipped", reason: "locked" }`. PostgREST runs each call in its own
   pooled transaction, so a session advisory lock cannot span a run. A lease row
   in `private.maintenance_leases` with a 10-minute expiry does this instead, and is
   released when the run ends.
2. Calls `fail_stale_media_processing(MEDIA_LIMITS.staleProcessingMinutes)` (30 min).
   A finalise killed after its claim (timeout, OOM, lost connection) would otherwise
   leave the asset `processing` forever. Claims older than the window, measured by the
   database clock against the claim's own `updated_at`, become `failed`; the run
   reports them in `reaped` with reason `stale_processing`. Bytes are kept, so the
   uploader can retry (finalise validates again) or delete. `failed` re-stamps
   `updated_at`, so the 24 h abandoned window then starts afresh. The window must stay
   well above the finalise route's `maxDuration`; the database refuses less than 10
   minutes, so an in-flight finalise is never touched.
3. Calls `prepare_media_cleanup(24 hours, 100[, now])`. `now` is passed only when the
   caller sets `options.now` (tests); otherwise the database uses its own `now()`, so
   the app host's clock never decides what is abandoned. It:
   - tombstones `uploading` and `failed` assets whose row **and** every object under
     their key prefix are older than `MEDIA_LIMITS.abandonedUploadWindowHours` (24
     h). `processing` and `ready` assets are never abandoned.
   - returns every tombstoned asset that still has objects in storage. These are
     user removals whose storage call failed, abandoned reservations' stored bytes,
     and failed uploads' leftovers.
4. Removes those objects through the Storage API. A failure is reported in
   `failed`. Storage is the record of what is left, so the asset comes back on the
   next run. Later batches exclude this run's failed asset IDs inside the database
   query, before its limit, so an unavailable oldest batch cannot starve newer
   tombstones. Up to 10 batches of 100 assets run per pass; `more: true` means the
   next pass continues.

A second run with nothing new to do removes nothing and changes nothing.

### Protecting active transfers

An upload counts as active, and is never cleaned, while any of these is within
the 24-hour window:

- the `media_assets` row's `updated_at`. Reserving sets it. **The upload routes
  must also call `recordUploadActivity(assetId)` (or update the row) when an
  attempt starts, including idempotent reserve retries that resume a TUS
  transfer, and when finalise begins.**
- any stored object under the asset's prefix (`created_at`/`updated_at`), such as a
  finished transfer whose finalise has not run yet.

In-progress TUS uploads leave **no trace in the database**: the partial data lives
in the storage backend (checked on the local stack: nothing in `storage.objects` or
`storage.s3_multipart_uploads` until the upload completes). The guard therefore
also depends on TUS upload URLs expiring inside the window. The local storage
server's default is 1 hour (`TUS_URL_EXPIRY_MS`). Supabase documents resumable
upload URLs as valid for up to 24 hours. Re-check that on the hosted project at
release.

Partial TUS data is not reachable through the Storage API, so cleanup cannot
delete it. The storage backend expires it (on S3, incomplete multipart uploads).
If a TUS upload completes after its reservation was tombstoned, the next run
removes the object.

## Running it

**Endpoint:** `POST /api/internal/cleanup` (or `GET`, for Vercel Cron) with
`Authorization: Bearer $CLEANUP_SECRET`.

- The secret is compared in constant time, and other methods get 405. `GET` runs
  the same check; a session cookie is never enough.
- It returns `503` when `CLEANUP_SECRET` is unset or shorter than 32 characters,
  `401` on a wrong or missing secret, and `200` with the JSON report otherwise.
  Responses are `Cache-Control: no-store`.
- Generate the secret with `openssl rand -hex 32` and set it as a server-only
  environment variable. Never use a `NEXT_PUBLIC_` name.

**Script:** `pnpm cleanup` runs one pass and prints the report.

- It needs `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`) and
  `SUPABASE_SERVICE_ROLE_KEY`.
- It exits with `1` if a removal failed and `2` on an error.

Hourly is plenty for a 24-hour window. Running more often is harmless.

## Scheduling options (none configured)

### Supabase pg_cron + pg_net

This calls the endpoint from the database:

```sql
-- once, in the hosted project (Dashboard > Integrations, or SQL):
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('<CLEANUP_SECRET>', 'nabalens_cleanup_secret');

select cron.schedule(
  'nabalens-media-cleanup',
  '17 * * * *',
  $$
  select net.http_post(
    url := 'https://<app-host>/api/internal/cleanup',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'nabalens_cleanup_secret'
      )
    ),
    timeout_milliseconds := 60000
  );
  $$
);
```

`pg_net` is asynchronous: check results in `net._http_response` and job runs in
`cron.job_run_details`. Keep this out of `supabase/migrations`, because the URL and
secret are per environment.

### Vercel Cron

Vercel Cron sends a **GET** request with `Authorization: Bearer $CRON_SECRET`. The
endpoint accepts that GET with the same secret check, so using Vercel Cron needs
only `CLEANUP_SECRET` equal to `CRON_SECRET` and a `crons` entry in `vercel.json`.
Check the plan's cron frequency limits. Not done in this MVP.

### Any external scheduler or an operator

A CI schedule or uptime pinger can run:

```sh
curl -fsS -X POST -H "Authorization: Bearer $CLEANUP_SECRET" https://<app-host>/api/internal/cleanup
```

An operator can also run `pnpm cleanup` with the service-role environment.

## Deactivation

Deactivating a staff member (`profiles.active = false`) deletes nothing. Their
existing session can no longer list, sign or remove media. Their ready assets
stay in the admin library, and admins can still preview and download them.
Cleanup ignores their ready assets. Retention beyond that is an organisational
policy (spec §7).

## Tests

```sh
W=$(node tests/lifecycle/prepare-stack.mjs)   # project nabalens-lifecycle, ports 594xx
supabase --workdir "$W" start && supabase --workdir "$W" db reset
pnpm test:lifecycle "$W"
```

`tests/lifecycle/lifecycle.test.ts` covers the following:

- **Removal:** staff remove their own assets but not other staff members' (404,
  state unchanged). Admins remove any asset. A removed asset disappears from staff
  and admin queries, cannot be signed, and its objects are gone.
- **Retries:** a simulated storage-delete failure is retried on the next run.
- **Abandoned uploads:** abandoned and failed uploads are cleaned. Fresh,
  recently written, `processing` and `ready` assets are kept.
- **Idempotency and concurrency:** a second run is a no-op, and concurrent runs
  skip.
- **Access:** end users cannot call the cleanup functions.
- **Deactivation:** retained media stays available to admins.
- **Endpoint and script:** the endpoint's secret checks, and `pnpm cleanup`.

Tests age rows with `psql`, because the `updated_at` trigger resets timestamps
written through the API.
