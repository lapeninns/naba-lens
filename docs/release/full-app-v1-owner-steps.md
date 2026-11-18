# Full App v1: owner release steps

Prepared by the build agents; **none of these steps has been run**. Each one changes a hosted environment, so the owner runs it (or approves it step by step). Release notes: [full-app-v1-release-notes.md](full-app-v1-release-notes.md).

What ships: one PR from `feat/full-app-v1` to `main`, holding the Album design system (A0 to A5, draft PR #33) and Full App v1. It adds **87 migrations** (4 Album, 83 Full App, `20261118100000` to `20261118138100`). All are additive. Merging to `main` deploys production on Vercel, so **the production migrations go first, the merge last**.

Never merge while a production migration is pending: the new code calls functions the old database does not have.

## 0. Before you start

1. The PR's CI result is green (`pnpm verify:release` posts it on the PR).
2. You have read the "Migrations that change existing data" table in the release notes. The changes that people will notice:
   - answers last checked over 90 days ago read **Check due**;
   - a staff Wi-Fi Yes without a manager's confirmation reads **Unconfirmed**;
   - switched-off venues still marked open become **permanently closed**;
   - **every admin must set up an authenticator app** at their next sign-in;
   - staff stop seeing colleagues' unreviewed photos.
3. Tell admins about the authenticator step before release day.

## 1. Staging

Run from a clean checkout of the PR head (no `.env.local`, no `.next`), linked to the **staging** Supabase project.

1. Check the link and what is pending:

   ```bash
   supabase migration list --linked
   ```

   ```bash
   supabase db push --linked --dry-run
   ```

   The dry run should list the 87 migrations above and nothing else.

2. Hosted settings. The repo's `supabase/config.toml` now enables TOTP MFA and a 250 MiB storage limit. Either apply them with `supabase config push` (check `supabase config diff` first; it pushes every setting in the file), or set them in the dashboard:
   - Auth › MFA: TOTP enrol and verify **on**;
   - Storage: global file size limit **at least 250 MiB**;
   - Auth › Sessions: choose the session expiry for remembered devices.
3. Apply the migrations:

   ```bash
   supabase db push --linked
   ```

4. Check the facts change on staging data: the manager's **Venue › Facts** and the admin Overview's Checks due show which answers now read Check due or Unconfirmed. To preview a different check rule for one question before changing it, an admin can call `public.knowledge_freshness_preview(question_key, policy)` (S1-FACTS report).
5. Deploy the PR head to the staging app, the way staging is deployed today (`docs/INFRASTRUCTURE.md`: `vercel deploy --prod` from a clean `git archive` copy for `nabalens-staging`).
6. On staging, as a staff member on a phone (iPhone Safari and Android Chrome) at one venue:
   - add three photos of one dish from the gallery in one go, with no typing;
   - use I'm not sure on one photo;
   - send, then check Me › Your photos.
7. As the manager:
   - approve one photo;
   - Fix label on one (no re-upload);
   - check the Overview numbers.
8. As an admin:
   - set up the authenticator;
   - open Overview, Venues (set the main reviewer), Settings › Shot templates;
   - in Library, use the Imported filter after step 9.
9. Optional, staging only first: try the legacy import with a small folder, as a dry run and then with `--apply` (`docs/legacy-import.md`).
10. Restore rehearsal (AC38), if you approve it: `docs/backup-restore.md`.

## 2. Production

1. Link the **production** project and repeat 1.1 (dry run lists the same 87 migrations).
2. Apply the same hosted settings as staging (1.2).
3. Apply the migrations:

   ```bash
   supabase db push --linked
   ```

   Read back: `supabase migration list --linked` shows nothing pending.

4. Merge the PR **only now**, through the release path (`lci merge` on the PR; no admin merge). The merge deploys production on Vercel. No new environment variables are needed: the three new scheduled routes use the existing internal cron secrets.
5. Live checks:
   - production smoke;
   - signed-out pages redirect;
   - an admin is asked for an authenticator code;
   - a staff phone adds a photo from the gallery and sees it under Your photos as Waiting;
   - the manager sees it in Review.

## 3. After release (admin)

In the order of the release notes' owner actions:

1. Check manager grants, so that every manager who should manage still has a venue membership.
2. Set each venue's main reviewer.
3. Choose any single-reviewer venues.
4. Turn on accommodation where there are rooms.
5. Review the five shot templates.
6. Mark packaged drinks.
7. Import existing photos (dry run first).

Then send the staff and manager notes from the usage guides.

## Rollback

- **App:** redeploy the previous production deployment in Vercel. The old code ignores the new tables and functions.
- **Database:** the migrations are forward-only. Do not try to undo them by hand. Each migration's header has its rollback note, and most roll back with a forward migration that restores an earlier function body. Three changes stay in place after a rollback:
  - the venue status backfill (`125000`), whose earlier state was wrong;
  - the facts freshness rule (`104000`);
  - admin MFA (`107200`).
