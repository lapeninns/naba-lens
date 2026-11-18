# S5-TEMPLATES: shot templates (FA-52)

Checklist row A7-shot-templates; spec §8 A7, §5.2 step 2, §11. Branch
`fa/s5-templates`, based on `068f67d9e`.

## What was built

- **Shot templates.** One default instruction per category (Food, Drinks,
  Spaces, Facilities, Other), one line of up to 140 characters (the album
  brief limit), with an optional example photo. Seeded in plain words after
  spec §11, for example Food: "The dish as it is normally served, on its usual
  plate, in good light. A clear, true photo of what guests get."
- **Admin Settings › Shot templates.** A section on `/admin/settings` lists
  the five with their instruction and example state, and **Edit** opens
  `/admin/settings/shot-templates/[category]`: the instruction (with a
  character count), **Example photo** (No example, the current one, or a
  Library photo accepted for public use, newest first, with **Older photos**),
  an optional reason, and **Save template**. A save over a newer change is
  refused with "reload" words; errors sit beside their field.
- **Activity.** Every change writes one `activity_events` row
  (`shot_template_set`, object `shot_template`/category, old and new revision,
  reason, before and after). Activity shows it as "Changed a shot template".
  A repeat with the same values records nothing.
- **One brief resolver.** `public.slot_briefs(venue, include_requests)`
  returns every slot's brief at the venue, resolved in one place:
  1. the brief of an open request on the slot (the caller's own first, then
     priority, date, age: the `my_media_requests` order);
  2. the manager's brief: the dish's own, else its section's (`album_briefs`);
  3. a facility question's catalogue capture brief;
  4. the category's shot template.
     The example is the request's reference photo when the brief is the
     request's (and the caller may see it), else the category template's example.
- **Where it is used.** `loadAlbum` reads `slot_briefs`, so the Album tiles,
  the slot page, Match (slot briefs in the picker) and Asked for all show the
  resolved brief. The slot page shows **Example of a good photo** beside the
  brief. Asked for shows the manager's reference photo, else the slot's
  example. **New request › From a slot** prefills **Brief** with the slot's
  standing brief (`include_requests = false`); choosing another slot replaces
  a prefilled brief but never one the manager typed. A standing brief over
  140 characters (one catalogue brief is 165) is not prefilled.
- **Example thumbnails.** `signDerivative` gains a second thumbnail gate,
  `shot_template_example_can_open`, so any active person can see a current,
  eligible example from another venue. Originals and previews are unchanged.

## Migrations

`20261118134000_shot_templates.sql` (one file, forward only):

- table `public.shot_templates` (RLS on, no table grants to users; seeded);
- `private.shot_template_example_eligible(asset)`: ready image with a
  thumbnail, not deleted, not withdrawn in the Library, use not withdrawn,
  public use grant not withdrawn, accepted at the public level on a dish,
  place or facility (or the legacy checklist), as `library_review_state`
  counts public. The same rule picks, lists and shows examples;
- `private.shot_template_rows()`;
- `public.shot_templates()`, `public.shot_template_set(...)`,
  `public.shot_template_example_choices(...)`,
  `public.shot_template_example_can_open(asset)`, `public.slot_briefs(...)`.

All security definer with `set search_path = ''`; execute revoked from
public, anon and service_role, granted to authenticated. No existing function
is redefined.

## Files

- `supabase/migrations/20261118134000_shot_templates.sql`
- `lib/album/brief.ts` (types, parsers, limits), `lib/server/shot-templates.ts`
- `lib/album/model.ts` (`slotBriefs` input, `exampleAssetId` on a slot),
  `lib/server/album.ts` (`loadAlbum` reads `slot_briefs`)
- `lib/server/media/access.ts` (template example thumbnail gate)
- `lib/ops/activity.ts` (action words)
- `components/nabalens/album/slot-screen.tsx`,
  `components/nabalens/requests/staff-requests.tsx`,
  `components/nabalens/requests/request-form.tsx`,
  `app/manager/requests/new/page.tsx`
- `app/admin/settings/page.tsx`, `app/admin/settings/shot-templates-panel.tsx`,
  `app/admin/settings/shot-templates/actions.ts`,
  `app/admin/settings/shot-templates/[category]/page.tsx`,
  `app/admin/settings/shot-templates/[category]/shot-template-form.tsx`
- Tests: `tests/unit/shot-templates.test.ts`, `tests/ui/shot-templates.test.tsx`,
  `tests/security/shot-templates.test.ts`,
  `tests/e2e/full-app/fa52-shot-templates.spec.ts`; route added to
  `tests/unit/scope-guard.test.ts`'s allow-list.
- Docs: `docs/usage-admin.md`, `docs/usage-manager.md`, `docs/usage-staff.md`,
  `docs/design-system/catalogue.md` (S5-TEMPLATES-1 `ShotTemplatesPanel`,
  S5-TEMPLATES-2 `ShotTemplateForm`).

`lib/db/types.ts` was regenerated locally for typecheck and is **not
committed** (the coordinator regenerates on merge).

## Decisions (owner asleep; chosen to fit FA-52 and the architecture)

1. **Resolver in the database.** One function, `public.slot_briefs`, rather
   than a TypeScript merge, so every reader (Album, slot page, Match, Asked
   for, request prefill) and the security tests see the same order. It reads
   `media_requests` directly (open = not closed) instead of
   `private.media_request_rows`, which recomputes coverage; a request whose
   slot was just covered may keep its brief until the next settle.
2. **Order inside "manager":** the dish's own brief before its section's (both
   are the manager's, AL-4). **Catalogue before template:** a facility
   question's capture brief is more specific than the Facilities default.
3. **Example follows the category**, not the brief's source: the request's
   reference with the request's brief, otherwise the category example, also
   beside a manager's brief. It is captioned "Example of a good photo".
4. **Eligibility is re-checked on every read.** An example that stops
   qualifying (withdrawn, use withdrawn, decision changed) disappears for
   staff and the thumbnail gate refuses it; it stays stored so Settings says
   "Example not shown: no longer accepted for public use". Saving the words
   again keeps it without re-checking; choosing a new one must qualify.
5. **Copy avoids "approved"** (scope guard bans `approv` outside allow-listed
   routes): Settings says "accepted for public use". No guard was weakened.
6. **Reason optional** on a template change (Settings' main form requires
   one); the change is always in Activity.
7. **Prefill skips briefs over 140 characters** instead of truncating them.
8. **Areas now have a brief** (the Spaces template); before FA-52 they had
   none.

## Checks (real output)

- `pnpm typecheck`: exit 0.
- `pnpm exec eslint . --ignore-pattern '.claude/**'`: exit 0, no output.
- Prettier `--check` on every file this branch changed (SQL excluded): clean
  after one `--write` commit.
- `pnpm test`: `Test Files 424 passed (424)`, `Tests 5200 passed (5200)`.
- Security, on stack `nabalens-s5-templates` (ports 635), fresh migrations:
  `tests/security/shot-templates.test.ts`, `album-briefs.test.ts`,
  `media-requests.test.ts`: `Test Files 3 passed (3)`, `Tests 37 passed (37)`.
  Covers staff, managers (own and another venue), legacy grant holder, an
  aal1 admin, inactive and anon refused; limits; revision; activity; example
  rule (unreviewed, reference level, video, withdrawn); order request >
  manager > template; venue isolation.
- E2E, stack `nabalens-s5-templates-e2e` (ports 636, app 3636):
  `fa52-shot-templates.spec.ts --project chromium`: `2 passed (15.4s)`
  (phone 390, desktop 1280). The first run stopped at Next.js's security
  notice during `next build`; the retry passed. Next.js was not upgraded.

Not run: the full security suite and other e2e specs (coordinator's
qualification), `pnpm verify:change`/`verify:batch`, `lci`.

## For the coordinator

- **Next.js security notice:** `next build` printed an upgrade
  recommendation (`next upgrade --agent=security`). Not acted on; owner
  decision, as recorded in Sprint 1.
- **No edits needed** in `app/staff/staff-portfolio.tsx` or
  `tests/e2e/helpers/`. The e2e spec uses `tests/e2e/full-app/helpers.ts`
  (`exportablePhoto`, `acceptAsManager`) read-only.
- **Merge overlap:** `lib/server/album.ts` `loadAlbum` now reads
  `slot_briefs` instead of `album_briefs` (`briefsOrNone` became
  `slotBriefsOrNone`). FA-51 (packaged items) may touch the same loader;
  keep both. If FA-51 changes how a dish's category is decided,
  `slot_briefs` reads the section kind (as `coverage_slot_rows` does) for
  the template category.
- **Org-wide state in tests:** the security test and e2e spec change the
  shared templates and put the seeded words back afterwards.
