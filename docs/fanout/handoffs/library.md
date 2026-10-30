# Handoff: library track (`feat/nl-library`)

Base: `feat/nabalens-mvp` @ `078b60a`. Worktree:
`~/.t3/worktrees/nabalens/feat-nl-library`.

## Goal

Finish and harden the core media UX: one gallery for the staff portfolio, the admin
library and the admin portfolio; transparent recovery from 60 s signed links; library
correctness tests; verified download/sign headers.

## Done

1. **Unified admin portfolio.** `/admin/staff/[id]` lists through
   `listLibrary(actor, { staffId })` and renders `AdminPortfolio` (a `MediaGallery`
   with preview, download, delete and the 15 s refresh). The account header and
   controls from the accounts track are unchanged. Removed
   `lib/server/accounts/portfolio.ts` (`listMediaForUploader`),
   `app/admin/staff/[id]/portfolio-gallery.tsx` and `loadMorePortfolioAction`; the
   accounts integration tests now call `listLibrary`.
2. **Signed-URL recovery** (`app/_media/preview-recovery.ts`). Gallery media URLs
   are authorised routes that redirect to a link signed for this request, so a held
   URL never goes stale by itself. A failed `<img>`/`<video>` load is re-requested
   once with `?r=N` (re-authorise and re-sign), then the gallery shows
   "N previews could not load." with **Try again**. Each foreground refresh
   (15 s / focus / visibility) gives broken previews one fresh attempt. One
   `onError` on the gallery wrapper catches grid and viewer (portal) errors.
   - `signedUrlTtlSeconds()` in `lib/server/media/access.ts`: 60 s, and
     `NABALENS_SIGNED_URL_TTL_SECONDS` can only **shorten** it (tests).
3. **Tests.**
   - `tests/integration/library.test.ts` (12): newest-first with id tiebreak; equal
     timestamps across pages; inserts, deletes and cursor-boundary ties between
     pages (no duplicates or skips); forged cursors; all 27 venue x staff x type
     combinations including cleared; empty results; filters on every page;
     ready/non-deleted only; TTL override; expired link fails and re-sign works;
     deleted asset gets no new link; original headers.
   - `tests/ui/library-gallery.test.tsx` (10): URL round-trip for every filter
     combination; invalid params dropped; recovery (one re-fetch, then visible
     error, Try again, refresh retry) in grid and viewer; pre-hydration failures;
     one count per URL version; 15 s refresh pauses when hidden and fires on
     visibility/focus.
   - `tests/e2e/library.spec.ts` (3 x mobile/desktop): filters via UI and URL,
     paging under filters, clear, empty result, reload round-trip; refresh hidden /
     visible / interval / focus (Playwright clock); previews after link expiry in the
     staff portfolio and the admin portfolio, retry-once and visible error with Try
     again, download/thumb/preview headers, admin delete, no `/_next/image` requests.
   - `tests/unit/no-image-optimiser.test.ts`: no `next/image` in app/components/lib,
     no remote image patterns.
4. **Bugs found by the e2e and fixed.** A server-rendered thumbnail that failed
   before hydration never reached React's `onError`, so it stayed blank with no
   message. The gallery now scans for complete-but-empty images on mount, and
   counts each `?r=` version's failure once. Without that, the scan and a late
   event double-counted on mobile.
   - `tests/library/seed.ts`: seeds ready assets with chosen `created_at`/`id`
     and real WebP derivatives; `setupIdentity` retries only auth 504s in setup.
   - `tests/library/prepare-stack.mjs`: isolated stack `nabalens-library` (579xx),
     studio/realtime/analytics/edge runtime disabled.

## Status

Complete. Final results on `nabalens-library` (579xx) are in the branch's final
handoff message. Nothing is in progress.

Next steps for the integrator:

- Merge. The only edits outside this track's paths are `components/nabalens/media-viewer.tsx`
  (3 lines, ui) and `tests/integration/staff-accounts.test.ts` (accounts tests moved
  to `listLibrary`).
- The `uploads` track must keep `MediaGallery`'s `refreshSignal` / `loadPage` API.
  This branch did not touch `use-media-uploader.ts`, `reserve.ts`, `finalise.ts` or
  `lib/upload/**`.

## Run the stack and tests

```sh
W=$(node tests/library/prepare-stack.mjs)
supabase --workdir "$W" start            # ~2 min; db reset not needed on first start
supabase --workdir "$W" status -o env | grep -E '^(API_URL|PUBLISHABLE_KEY|SERVICE_ROLE_KEY|MAILPIT_URL)=' \
  | sed 's/^API_URL/NEXT_PUBLIC_SUPABASE_URL/;s/^PUBLISHABLE_KEY/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/;s/^SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY/;s/^/export /' > /tmp/nl-library-env.sh
source /tmp/nl-library-env.sh
pnpm exec vitest run --project integration tests/integration/library.test.ts
pnpm test:integration
E2E_PORT=3517 NABALENS_SIGNED_URL_TTL_SECONDS=5 pnpm exec playwright test tests/e2e/library.spec.ts
supabase --workdir "$W" stop             # when finished
```

## Open questions / notes

- `components/nabalens/media-viewer.tsx` (ui-owned) changed by three lines: a failed
  preview now resets when its URL changes (as `MediaTile` already did). Without it a
  re-signed preview stayed on "Preview unavailable".
- Avatars in the staff directory and the admin portfolio header come from
  `lib/server/accounts/directory.ts` (accounts-owned) as directly signed 60 s URLs.
  They load once and stay loaded, but a remount after 60 s shows initials. Moving
  them to the `/api/avatars/[id]` route (as `/staff` does) is a small accounts change.
- Machine load: with ~10 local stacks running, the local auth server returns 504s
  (Docker DNS timeouts in its logs). This is environmental.

## Compatibility with `security-fixes` (service-client signing)

- Gallery recovery never signs in the browser and never uses the browser Supabase client.
  It only re-requests the app routes (`/api/media/{id}/thumb|preview|stream?r=N`), so it
  keeps working when routes sign with the service client after their caller and asset checks.
- Expected merge overlap: `lib/server/media/access.ts` (`signDerivative`) and
  `lib/server/media/profile.ts` (`signAvatar`). Here the TTL argument changed to
  `signedUrlTtlSeconds()`; security-fixes changes the client on the same lines. To resolve,
  keep their client and this branch's `signedUrlTtlSeconds()`.
- The tests don't depend on which client signs. `tests/integration/library.test.ts` calls
  `signDerivative` and fetches the returned URL. The e2e checks only that the 302 `Location`
  has the `/storage/v1/object/sign/media/` form.
