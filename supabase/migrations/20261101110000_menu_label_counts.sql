-- Menu catalogue performance (WS3, baseline fixes 2 and 6).
--
-- 1. public.menu_label_counts: labels per menu item of one venue in a single
--    grouped read. getMenuVersion used to page through every media_label_items
--    row of the venue (1,000 per request, one policy-function call per row) only
--    to count them.
-- 2. media_label_items (venue_id, item_id): lets that read use an index.
-- 3. Staff read of a version's sections, entries and entry variants: the
--    "may staff read this version?" question is asked once per query (a hashed
--    subplan over the versions the caller may read), not once per row.
--
-- No visibility changes. The staff policies return the same rows as before and
-- the new RPC returns exactly the label rows an active admin can already read.

-- ---------------------------------------------------------------------------
-- 1. Label counts per item (admin only)
-- ---------------------------------------------------------------------------

-- MUST FOLLOW THE ADMIN LABEL RLS. This function is SECURITY DEFINER so the
-- count does not pay private.can_read_asset_labels once per row; instead it
-- repeats what that function (and so the media_label_items select policy)
-- grants an active admin: the label row's asset is not deleted and is `ready`
-- (private.can_read_asset_labels, 20261030120100_media_labels.sql). If that
-- rule changes, change the join condition below with it, and keep
-- tests/security/menus-label-counts.test.ts (counts equal the admin's own RLS
-- read) passing.
-- Rows are counted per label row (an item with two variants labelled on one
-- asset counts twice), as the application's old paged read did. Items without
-- label rows are absent. One jsonb object {item id: count} comes back, so the
-- answer is a single row whatever PostgREST's max_rows is (a menu has up to
-- 2,000 items).
create or replace function public.menu_label_counts(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_active_admin();

  return coalesce(
    (
      select jsonb_object_agg(c.item_id, c.n)
      from (
        select li.item_id, count(*) as n
        from public.media_label_items li
        join public.media_assets a on a.id = li.asset_id
        where li.venue_id = p_venue_id
          and a.deleted_at is null
          and a.upload_state = 'ready'
        group by li.item_id
      ) c
    ),
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.menu_label_counts(uuid) from public, anon;
grant execute on function public.menu_label_counts(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Index for the per-venue count
-- ---------------------------------------------------------------------------

create index media_label_items_venue_item_idx
  on public.media_label_items (venue_id, item_id);

-- ---------------------------------------------------------------------------
-- 3. Staff read policies: one check per version
-- ---------------------------------------------------------------------------

-- The versions private.staff_can_read_menu_version(id) is true for: active
-- versions of venues the caller may label. Defined through that same helper
-- (staff_can_label_venue), so the answer is identical row for row.
create or replace function private.staff_readable_menu_version_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id
  from public.menu_versions v
  where v.status = 'active'
    and private.staff_can_label_venue(v.venue_id);
$$;

revoke all on function private.staff_readable_menu_version_ids() from public, anon, authenticated;
grant execute on function private.staff_readable_menu_version_ids() to authenticated, service_role;

drop policy menu_sections_select_staff on public.menu_sections;
create policy menu_sections_select_staff on public.menu_sections
  for select to authenticated
  using (version_id in (select private.staff_readable_menu_version_ids()));

drop policy menu_entries_select_staff on public.menu_entries;
create policy menu_entries_select_staff on public.menu_entries
  for select to authenticated
  using (version_id in (select private.staff_readable_menu_version_ids()));

drop policy menu_entry_variants_select_staff on public.menu_entry_variants;
create policy menu_entry_variants_select_staff on public.menu_entry_variants
  for select to authenticated
  using (exists (
    select 1 from public.menu_entries e
    where e.id = entry_id
      and e.version_id in (select private.staff_readable_menu_version_ids())
  ));
