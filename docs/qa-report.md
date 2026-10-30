# NabaLens QA report: release journey E2E

Branch `feat/nl-journey` (base `feat/nabalens-mvp` @ 078b60a). Browser automation with
Playwright 1.64.1 against a production build (`next build && next start`) and an isolated
local Supabase stack (`tests/e2e/prepare-stack.mjs`, ports 583xx). Magic links and
invitations are read from that stack's Mailpit inbox.

> **Browser emulation is not device testing.** Nothing here proves physical-phone camera
> capture, real iPhone/Android HEIC files, phone video codecs, mobile Safari, or upload
> behaviour when a phone backgrounds the browser or sleeps. The "mobile-chromium" project is
> Chromium at a 412 px touch viewport. The "webkit" project is Playwright's WebKit engine on
> macOS: it is not Safari on iPhone. The HEIC in these tests is generated with macOS `sips`
> from a synthetic image, not taken by a phone camera. See "Untested" below.

## Suite

| Spec                      | Engines                                    | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `journey.spec.ts` (@core) | chromium, firefox, webkit, mobile-chromium | Admin A invites via UI → invite email (Mailpit) → staff lands on own portfolio → uploads JPEG + H.264 MP4 + HEIC; each row shows Uploading → Processing → Uploaded (recorded by a MutationObserver) and the DB rows are `ready` → visible after reload and in a fresh context signed in through the login form + email → Admin B's already-open library shows all three without a reload within the 15 s refresh window → venue + staff + type filters combine (URL-driven) → preview renders → originals of all three download with SHA-256 equal to the source → contributor portfolio opens → staff deletes the JPEG → it disappears from the portfolio and from Admin B's open library without reload; `/thumb`, `/preview`, `/download` now 404; the previously signed storage URL no longer serves bytes; the original, preview and thumbnail objects are gone (service-client listing).                                                                               |
| `negative.spec.ts`        | chromium                                   | Staff A vs Staff B (same venue): media routes 404, admin pages/B's portfolio redirect to `/staff`, admin avatar route 403; anonymous 401 and `/login`. Uninvited email: neutral copy identical to an invited one, no auth user, no email sent. Reused link and expired link (send time moved past `otp_expiry`) → `link_invalid` page with recovery that works; garbage token. Deactivated staff with a live session: refresh refused, upload refused with no row reserved, delete refused, `/api/media/*/thumb` 403, navigation → `/auth/blocked`; admin keeps the asset. Venue transfer: earlier upload stays at venue 2, later upload at venue 1 (DB, tile names, viewer). HEVC MP4 (ffmpeg libx265, `hvc1`): viewer either decodes it or shows "Preview unavailable in this browser", never a dead player; original downloads byte-identical. Empty states; a ready record whose original is missing from storage: route 404, browser download fails, page stays usable. |
| `filters.spec.ts`         | chromium                                   | 47 provisioned ready records: venue + staff + Photos gives 24 then 30 after "Load more", every name matching all three filters; Videos; venue 2; All staff; reload keeps filters; Clear filters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `responsive.spec.ts`      | chromium                                   | Every screen and dialog at 360/390/768/1280/1440: no horizontal overflow (page and dialog), primary action visible inside the viewport, zero serious/critical axe-core (WCAG 2.0/2.1/2.2 A+AA) violations, screenshot to `.artifacts/screenshots/`. Keyboard-only path: upload (file chooser opened from "Choose files" with Enter), viewer open/close with focus returned to the tile, admin download with Enter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Screens and dialogs covered: `/login` (plain and expired-link), `/staff`, upload dialog with a
selected file, edit-profile dialog, photo viewer, delete confirmation, `/admin` library,
venue filter open, video viewer, `/admin/staff`, invite dialog, row actions menu,
`/admin/staff/[id]`, edit-details dialog, deactivate confirmation.

## Results

_Filled in from the final runs below._

## Defects found

| #   | Defect                                                                                                                                                                                                                               | Where                                        | Status                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Admin individual portfolio viewer has no **Download original** or **Delete** (spec §3: "Admin's preview/download/delete actions work here too").                                                                                     | `app/admin/staff/[id]/portfolio-gallery.tsx` | Not fixed here: already fixed on `feat/nl-library` f3ee17b. `negative.spec.ts` keeps a `test.fail()` check that flips when it merges. |
| 2   | Library filters race: choosing Venue, then Staff, then Photos before each navigation returns drops earlier choices (ended at `?type=image`). Each change was built from stale server props. Reproduced deterministically under load. | `app/admin/admin-library.tsx`                | **Fixed** with `React.useOptimistic` (3 lines). `filters.spec.ts` failed before, passes after.                                        |
| 3   | WCAG 2.5.3 label-in-name (axe `label-content-name-mismatch`, serious): video tiles show a duration badge ("0:00") not contained in the button's `aria-label`.                                                                        | `components/nabalens/media-tile.tsx`         | **Fixed**: name ends with `duration m:ss`. UI unit tests 21/21.                                                                       |
| 4   | A gallery refresh that hangs (no response) blocks every later refresh: `refreshing.current` stays true and `fetch` has no timeout. Seen when the auth/storage stack stalled.                                                         | `app/_media/media-gallery.tsx`               | Reported, not fixed (slice/library own it).                                                                                           |
| 5   | `/admin/staff` fails to render at all when GoTrue `listUsers` is slow/fails ("Could not list auth users").                                                                                                                           | `lib/server/accounts`                        | Reported, not fixed (accounts own it).                                                                                                |
| 6   | A failed original download gives no in-app message (the browser shows a failed download; page stays usable).                                                                                                                         | viewer                                       | Reported.                                                                                                                             |

Visual review notes (screenshots read, not just captured): see "Visual review" below.

## Flakiness investigation

Earlier runs failed with GoTrue 504 / timeouts. Findings on 30 Oct 2026:

- The 504 is GoTrue's own 10 s request deadline (`request_timeout`, `context deadline exceeded`)
  on `/admin/users`, `/admin/generate_link` and `/otp`. Idle, the same call takes 22–39 ms
  (12/12 samples).
- The Docker VM (8 GB, 18 CPUs) was shared by 12–14 local Supabase stacks from parallel
  worktrees. Inside it: MemAvailable 0.37–0.9 GB, swap 100 % used, memory PSI
  `full avg60` 63–97 % (all tasks stalled on memory most of the time). Stalls hit auth,
  storage (a 404 for a missing object took >15 s, against 10 ms idle) and Kong.
- Not caused by the suite: one worker, `retries: 0`, no shared state between specs.
- Changes made instead of retries: fixture users created by one SQL statement in the
  `supabase/seed.sql` shape (removes 5 auth calls per spec), Mailpit polled for a NEW message
  to a specific address, waits on state text and DOM events, the pre-existing hidden 504
  retry loop in `slice.spec.ts` removed, the isolated stack runs without studio, realtime,
  analytics and edge runtime. The throwaway stack's per-IP `sign_in_sign_ups` and
  `token_verifications` limits are raised to 300 because every browser context shares one IP;
  the committed `supabase/config.toml` is unchanged.
- Firefox could not launch at all on this Mac ("Could not find profile folder."): macOS 27
  denies Playwright's Firefox build access to `~/Library/Application Support/Firefox`. The
  Firefox project sets `MOZ_APP_DATA` to `.artifacts/firefox-appdata`.

## Untested (needs physical devices or hosted services)

- Physical iPhone and Android: camera capture input, real HEIC/HEIF from phone cameras,
  phone-recorded MOV/MP4 (HEVC, Dolby Vision, HDR), mobile Safari/Chrome playback.
- Upload behaviour when the phone locks, the tab is backgrounded, or the network drops
  mid-transfer on a real device.
- Real email delivery (SMTP), hosted Supabase, deployed HEIC worker, scheduled cleanup.
- Screen readers (axe-core is automated rule checking, not an assistive-technology test).
