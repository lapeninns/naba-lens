# Releasing batch R (redesign, 21 Nov 2026)

Production changes need the owner. Nothing here has been run against
production. Run these in order, from the repo, on the final head of
`redesign/whole-app` after `pnpm verify:release` (lci) is green.

## What production gains

- D21: staff photos post straight to the venue's private Album, with
  labelling then or later (`NEXT_PUBLIC_NABALENS_STAFF_ALBUM_POSTS` unset
  means on; set it to `0` in Vercel to switch back to Match before send).
- The staff, manager, admin and sign-in redesign (see `plan.md`, `ia.md`).

## Database: two migrations production does not have

| Migration                                       | Effect                                                                                                                                                    | Reversible                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `20261120130000_staff_album_posts.sql`          | Adds `staff_album_feedback` and the staff Album read functions (`staff_album_posts`, `staff_album_own_states`, `staff_album_folder_covers`, …). Additive. | Yes, by a forward migration that drops them      |
| `20261120120000_remove_manual_capture_date.sql` | Drops `public.set_media_captured_at`, the RPC behind the old "Fix date taken" button. Stored dates are untouched.                                         | Recreate the function from its earlier migration |

The code on `main` today still offers "Fix date taken". Between the database
push and the merge's deployment that button fails with an error, so do the
merge straight after the push.

## Steps

1. Check what production lacks (read-only):
   `supabase migration list --linked` — expect only the two above as
   local-only.
2. Dry run: `supabase db push --linked --dry-run`.
3. Apply: `supabase db push --linked`.
4. Merge: `lci merge` for the PR (never an admin merge). Vercel deploys
   `naba-lens` from `main`.
5. Live checks on production, with one staff and one manager account:
   - Staff: Add photos from the gallery → each row says Posted → "N photos
     added" → Label now → tick, choose a dish, Save → "Open folder" shows
     them → Undo returns them to To label.
   - My photos opens on Unlabelled with the same count Today shows.
   - Manager: Review → Posted by staff lists the new photos; Album tab
     shows Menu · Spaces · Amenities.
   - Admin: every nav section opens; Overview › Albums and Settings › Venue
     facts are reachable.
6. If staff posting must be switched off: set
   `NEXT_PUBLIC_NABALENS_STAFF_ALBUM_POSTS=0` in Vercel production and
   redeploy (it is read at build time). The migrations can stay.
