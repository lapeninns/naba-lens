-- =============================================================================
-- TEST ONLY. Never copy into supabase/migrations.
-- Simulates a later, compatible release migration for tests/migrations: it is
-- applied with `supabase migration up` on top of a stack that already holds
-- DEV FIXTURE users, media rows and storage objects. It follows the house rules
-- a real additive migration must follow:
--   * new columns are nullable (or have a constant default), so existing rows
--     and existing writers keep working;
--   * new tables revoke the default anon/authenticated grants and enable RLS
--     before any policy is added;
--   * policy helpers are redeployed with `create or replace` (same signature),
--     so the storage.objects policies that call them stay bound.
-- =============================================================================

alter table public.media_assets add column test_only_caption text
  check (test_only_caption is null or length(test_only_caption) <= 200);
comment on column public.media_assets.test_only_caption is 'TEST ONLY additive column.';

create index media_assets_test_only_caption_idx
  on public.media_assets (uploader_id)
  where test_only_caption is not null;

alter table public.venues add column test_only_sort integer not null default 0;

create table public.test_only_notes (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.media_assets (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
revoke all on public.test_only_notes from anon, authenticated;
grant all on public.test_only_notes to service_role;
alter table public.test_only_notes enable row level security;

-- Redeploy an existing policy helper unchanged in behaviour (same signature).
create or replace function private.can_read_media_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- TEST ONLY redeploy: identical rules to 20261029120200_nabalens_storage.sql.
  select exists (
    select 1
    from public.media_assets a
    where a.id = private.media_asset_id_from_key(p_name)
      and p_name in (a.original_path, a.preview_path, a.thumbnail_path)
      and a.deleted_at is null
      and a.upload_state = 'ready'
      and (
        private.is_active_admin()
        or (a.uploader_id = (select auth.uid()) and private.is_active_staff())
      )
  );
$$;
