# Privacy audit: bundles, caches, headers and logs

Track `privacy-audit`, October 2026, on `feat/nl-privacy` (from `feat/nabalens-mvp` @ 3a23c9b).
Scope (spec §5, §7): privileged credentials stay server-only, and private media must not leak
through caches, image routes or logs.

## What runs

| Check                         | Command                                                                               | Needs                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Client bundle scan            | `pnpm build && node scripts/ci/scan-bundle.mjs`                                       | a build                                              |
| Scanner self-test             | `pnpm exec vitest run --project integration tests/integration/privacy-bundle.test.ts` | nothing (scans this checkout's `.next` when present) |
| Runtime headers, bodies, logs | `tests/integration/privacy-runtime.test.ts` (below)                                   | `next start` on an isolated stack                    |

`pnpm test:integration` includes both files. Without `PRIVACY_BASE_URL` the runtime suite is
**skipped** (vitest reports it as skipped), because it needs a production server.

### `scripts/ci/scan-bundle.mjs`

Scans everything a browser can receive: `.next/static/**` (all client chunks, CSS, fonts),
the prerendered `.next/server/app/**/*.{html,rsc,body,meta}` and `public/`. Server chunks are
not scanned. Exit 1 on any finding, 2 if there is no build. `--json` for machine output,
`--dir`/`--root` to point elsewhere. Secret values are redacted in the output.

Rules:

- **Secret names:** `SUPABASE_SERVICE_ROLE*`, `SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`,
  `CLEANUP_SECRET`, and the bare `service_role` claim.
- **Secret shapes:** `sb_secret_…` keys, PEM private keys, `postgres://user:password@` URLs, and
  any JWT whose payload `role` is not `anon`. The anon key is public by design and is allowed.
- **Secret values:** the current `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY` and
  `CLEANUP_SECRET`, when they are set in the scanner's environment.
- **Server-only code:** `lib/server/`, `lib/supabase/admin` and `scripts/lib/` module paths.
  Also every exported name (10 or more characters) of those modules, except names that a
  `"use server"` file also exports, because those are public action references. The current
  build has 60 such names.

The self-test plants every rule in a fake build: all 9 rule IDs are found, the anon JWT is not
flagged, server chunks are ignored, and values stay redacted. A clean fake build gives exit 0,
and a missing build gives exit 2.

### Runtime suite: how to run

```sh
# 1. Isolated stack: copy supabase/ to a temp workdir and give it its own
#    project_id and a free port block. This audit used nabalens-privacy on 597xx,
#    with studio, realtime, analytics and edge_runtime disabled. The local
#    [auth.rate_limit] email_sent = 2/hour was raised to 100 in that temp copy
#    only, so the suite can be rerun (it sends 2 emails per run). Nothing in
#    supabase/ was changed.
W=/tmp/nabalens-privacy-stack   # prepared like tests/security/prepare-stack.mjs
supabase --workdir "$W" start
S=$(supabase --workdir "$W" status -o json)

# 2. Build and serve with that stack. NEXT_PUBLIC_* are inlined at build time.
export NEXT_PUBLIC_SUPABASE_URL=$(jq -r .API_URL <<<"$S")
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(jq -r .ANON_KEY <<<"$S")
export SUPABASE_SERVICE_ROLE_KEY=$(jq -r .SERVICE_ROLE_KEY <<<"$S")
export CLEANUP_SECRET=$(openssl rand -hex 32)
export NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3597
pnpm build && node scripts/ci/scan-bundle.mjs
pnpm exec next start --hostname 127.0.0.1 --port 3597 > /tmp/privacy-server.log 2>&1 &

# 3. Run against it. PRIVACY_REPORT optionally writes a header table (IDs replaced).
PRIVACY_BASE_URL=http://127.0.0.1:3597 PRIVACY_SERVER_LOG=/tmp/privacy-server.log \
PRIVACY_REPORT=/tmp/privacy-report.json \
  pnpm exec vitest run --project integration tests/integration/privacy-runtime.test.ts

supabase --workdir "$W" stop
```

The suite refuses a 554xx stack. It reads Server Function IDs from this checkout's `.next`,
so the server must serve that build.

### What the runtime suite does

It sets up 1 venue, staff A, staff B and an admin with the service role. Each of them signs in
through the real `/auth/confirm?token_hash=…` landing route, and the suite keeps the
`Set-Cookie` session. Then, all over HTTP against `next start`:

1. Staff A calls the `reserveUpload` Server Function, does a signed storage upload as the
   browser would, then calls `finaliseUpload`. The result is a real JPEG in state `ready`.
2. Staff A sets a profile photo with a multipart `POST /api/profile`.
3. The admin invites a new staff member with `inviteStaffAction` (a real email to Mailpit).
4. An anonymous visitor calls `requestSignInLink` for a known address and an unknown one.
5. The suite requests every page in HTML and RSC form, and every media, avatar and download
   route, as anon, staff A, staff B and admin. Pages: `/`, `/login`, `/auth/blocked`,
   `/staff`, `/admin`, `/admin/staff`, `/admin/staff/[A]`, `/admin/staff/[B]`, `/ui-preview`.
   It also calls `loadMyMedia` and `loadLibraryPage` (library and admin portfolio), makes
   unauthorised `POST`s to `/admin/staff/[id]/avatar` and `/api/profile`, and calls
   `/api/internal/cleanup` with a wrong secret and with the right one.
6. The suite requests `/_next/image?url=<private route>` as admin, staff and anon.
7. The admin deactivates staff B, and staff A deletes the asset. The suite then re-requests
   the routes.

Assertions, over 127 recorded responses:

- **No public or shared caching.** No response has `public`, `s-maxage`,
  `stale-while-revalidate` or `immutable`. The only exception is a build-time prerender that
  is byte-identical for all four roles (the production 404 for `/ui-preview`).
- **`no-store` where it matters.** Every `/api/*` response has `no-store`, and so does every
  non-redirect response to a signed-in user. So does **every response that sets a cookie**.
- **`Vary` includes `rsc`** on every HTML/RSC GET, so HTML and RSC payloads stay apart in any
  cache.
- **`X-Content-Type-Options: nosniff`** on every response.
- **Downloads.** The admin download is `200 image/jpeg`, `Content-Disposition: attachment`, and
  its SHA-256 matches the uploaded bytes. Staff A, staff B and anon get 404/404/401. Thumb and
  preview give staff B and anon no `Location`.
- **Avatars.** Owner and admin get a 302. Other staff get 404, anon gets 401, and a deactivated
  account gets 403.
- **Signed redirects** (thumb, preview, avatar) expire within 60 s (`exp - iat <= 60`).
- **Storage URLs in bodies.** No `/storage/v1/object/public/` URL appears in any body. Signed
  storage URLs appear only in admin responses, and only `no-store` ones.
- **Staff see no one else.** Staff and anon bodies contain no email address except the caller's
  own, no other user's ID (unless the caller typed it into the URL), and no other user's asset
  ID.
- **Image optimiser.** `/_next/image` never returns an image for a private route.
- **After deletion,** thumb, preview and download return 404 with no `Location`.
- **Server log.** Nothing written during the run contains a session cookie value, an access or
  refresh token, a magic-link token hash or action link, a signed upload token, a signed URL,
  the service-role key, `CLEANUP_SECRET`, any email address, a JWT or an `sb_secret_` key.

## Static review

- **`next/image`.** It is not used anywhere. The 3 `<img>` uses in `components/nabalens/**`
  render authorised route URLs. Two of them carry comments explaining why they avoid the
  optimiser. `next.config.ts` has no `images` config, so `remotePatterns` is empty: the
  optimiser refuses storage URLs (400) and fetches local routes **without cookies**. Measured:
  `/_next/image?url=/api/media/<id>/thumb` gives 401 for admin and anon, and nothing private
  reaches `.next/cache/images`.
- **`proxy.ts`.** The matcher skips `_next/static`, `_next/image` and static file extensions.
  Media is served only from `/api/...` routes, which the proxy does run on.
- **No `"use cache"`, `unstable_cache`, `revalidate` exports or `force-static`.**
  `revalidatePath` (accounts) only invalidates. Every user page is dynamic (`ƒ` in the build
  output).
- **Media headers.** `PRIVATE_HEADERS` (`lib/server/media/access.ts`) sets
  `private, no-store`, `nosniff` and `no-referrer` on every media response, including errors and
  302s.
- **Logging.** Every `console.*` in `lib/` and `app/` logs only an error `code`, `status` or
  `name`, never an email, token or URL. The one exception is the cleanup route (R6 below).
  `next start` does not log request URLs.

## Results

Bundle scan of the build served to the suite (`NEXT_PUBLIC_*` from the isolated stack, with
`SUPABASE_SERVICE_ROLE_KEY` and `CLEANUP_SECRET` set for value matching):

```
scan-bundle: 57 files, 1691 KiB, 10 rules (60 server-only export names).
scan-bundle: no findings.
```

The anon JWT is present in a client chunk, as expected, and is accepted. No `service_role`
JWT, no secret names, no `lib/server` paths and no server-only export names were found.

Response headers measured (from `PRIVACY_REPORT`):

| Response                                                            | Cache-Control                                             | Other                                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Pages, signed in (`/staff`, `/admin`, …)                            | `private, no-cache, no-store, max-age=0, must-revalidate` | `Vary: rsc, next-router-state-tree, …`                  |
| Server Function POSTs                                               | `no-cache, no-store, max-age=0, must-revalidate`          |                                                         |
| `/api/media/*`, `/api/avatars/*`, incl. 401/404 and 302             | `private, no-store`                                       | `nosniff`, `Referrer-Policy: no-referrer`               |
| `/api/media/[id]/download` (admin)                                  | `private, no-store`                                       | `attachment; filename="privacy-dish.jpg"`, `image/jpeg` |
| `/api/profile`, `/admin/staff/[id]/avatar`, `/api/internal/cleanup` | `private, no-store` / `no-store`                          |                                                         |
| `/auth/confirm` 303 (sets the session)                              | `private, no-store` (after fix F2)                        |                                                         |
| Proxy 307 to `/login` (anonymous, protected path)                   | none                                                      | no body, no cookies; 307 is not heuristically cacheable |
| `/ui-preview` (production 404 prerender)                            | `s-maxage=31536000`                                       | same bytes for every role, no data                      |

Server log during the passing runs: start-up lines, the optimiser lines from R8, and in some
runs load-induced failures that show the safe log format:

```
⨯ internal image response failed for /api/media/<uuid>/thumb 401
[auth] sign-in link request failed { code: null, status: 504 }
[accounts] deactivate: session revocation failed { code: null }
[accounts] invite: email failed { code: null }
```

## Fixed (minimal changes outside this track's paths)

- **F1. No `nosniff` on pages, redirects and Server Function responses.** Only the media
  routes set it. `next.config.ts` now adds `X-Content-Type-Options: nosniff` to `/:path*`. The
  header reaches pages, the proxy's 307s, auth redirects and error pages (verified).
- **F2. Session-setting redirects were cacheable-by-omission.** `seeOther` in
  `app/auth/redirect.ts` serves `/auth/confirm`, `/auth/callback` and `/auth/logout`. It returned
  a 303 carrying `Set-Cookie` with no `Cache-Control`. It now sends `private, no-store`. The
  suite's new "every `Set-Cookie` response is `no-store`" assertion failed before the change
  and passes after it.

## Reported, not changed

- **R1. The admin staff pages embed signed storage URLs** (accounts track,
  `lib/server/accounts/portfolio.ts` and `directory.ts`). `/admin/staff/[id]` puts 60 s signed
  URLs for thumbnails and previews in its HTML/RSC. For **videos the preview URL is a signed
  URL to the original**. The staff directory does the same for avatars.
  - **Not a cache leak.** These are admin-only responses with `private, no-store`, and the suite
    asserts both.
  - **But it bypasses the slice's media routes.** A video original then comes straight from
    storage with the stored Content-Type, without `nosniff` or `attachment` (see R2).
  - **It also breaks open pages.** Thumbnails and previews stop loading 60 s after render.
  - **Suggested fix:** use `mediaRoutes` and `avatarUrl` from `lib/server/media/library.ts`, as
    the admin library does.
- **R2. Storage's own response headers on signed URLs** (local stack): no `Cache-Control`,
  `Expires` = token expiry (+60 s), no `nosniff`.
  - **Stored `cacheControl` metadata:** derivatives and avatars are `max-age=60`. Originals
    uploaded by TUS are `max-age=3600` (`lib/upload/tus.ts`).
  - **Risk:** a shared cache between a browser and Supabase could keep a derivative until the
    link expires. This is within the spec's "existing short-lived signed links are not
    instantly recalled".
  - **Check at M6:** hosted Supabase or its CDN may send different headers.
  - **Suggestion:** set the TUS `cacheControl` to the same 60 s.
- **R3. Staff get 200 on admin pages.** A staff member who requests `/admin`, `/admin/staff` or
  `/admin/staff/[id]` gets **200** with an in-stream redirect, not a 307. Those pages have a
  `loading.tsx`, so the shell streams before `requireActiveAdmin()` redirects. The bodies hold no
  admin data: the suite checks for emails, IDs and assets. The status code is misleading for
  monitoring, though.
- **R4. `X-Powered-By: Next.js`** is still sent (`poweredByHeader: false` would drop it).
  Fingerprinting only; not changed.
- **R5. `/api/internal/cleanup` logs the whole error object** on failure
  (`console.error("media cleanup failed", error)`). A storage or Postgres error can include
  object keys, which contain user and asset UUIDs. Never emails or tokens. The path was not
  triggered here. Logging `error.code` or `message` only, like the other routes, would be safer.
- **R6. Token hashes in platform access logs.** Magic-link token hashes travel in the
  `/auth/confirm` query string. `next start` does not log them, but a hosting platform's access
  logs (for example Vercel) will. They are single-use and short-lived. Keep platform log access
  restricted.
- **R8. The optimiser logs the internal URL it was refused.** The image-optimiser probe makes
  `next start` log `⨯ internal image response failed for /api/media/<asset uuid>/thumb 401`,
  and the same for avatars, with the user's UUID. These lines contain UUIDs only, no tokens or
  emails, so the log check passes. Anyone can trigger them, though, so log volume is
  attacker-controlled. Setting `images.unoptimized: true` (the app never uses `next/image`)
  would remove the optimiser path entirely. Not changed.
- **R7. Load flakiness in other suites.** On this Mac (load average 27–40, about 15 Supabase
  stacks), local auth admin calls (`createUser`, `generateLink`, ban) and template fetches often
  hit GoTrue's 10 s timeout. `pnpm test:integration` failures in `staff-accounts`, `slice-media`
  and `accounts` in this track's run were all `AuthRetryableFetchError` or an invitation
  `partial` caused by that. None are privacy failures. The runtime suite briefly accepted a
  `partial` invitation for that reason; the followups track restored the strict `sent`
  assertion after it passed on a quiet isolated stack.
