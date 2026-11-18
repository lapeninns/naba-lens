-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S5-IMPORT: legacy imports in the reads (FA-54).
--
--   Library     private.library_ref_ids gains kind 'import' (the assets a
--               batch created; duplicate-skipped lines point at earlier
--               assets and are left out), public.library_page gains
--               p_import (the admin Library's "Imported" filter), and
--               public.library_filter_lists lists the batches as 'imports'.
--               library_page is dropped and recreated: a new argument on
--               create or replace would add an overload PostgREST cannot
--               choose between.
--   Unlabelled  private.asset_unlabelled_reason: an imported photo with no
--               label waits at once, with its own reason 'imported' (its
--               legacy label matched no single slot). The 7-day wait (FA-4)
--               keeps a photo with the person who took it; an import has
--               nobody matching it later. A photo whose import staged an amenity is
--               held by that slot, not unlabelled.
--   Amenities   private.amenity_photo_rows also reads the amenity an import
--               staged (media_import_items), so the photo waits in the
--               amenity photo queue like staff evidence, until decided.
--   Credit      private.monthly_credit_items leaves imported assets out: an
--               old photo accepted this month is not this month's
--               contribution (spec §12.4's honest counts).
--   Review      private.menu_photo_reviewable_uploader also lists the
--               importing admin's assets for managers (imports enter Review
--               like any upload); see the comment on it below.
--
-- Bodies start from the latest definitions: library_ref_ids and
-- library_filter_lists (20261118116000), library_page and
-- asset_unlabelled_reason (20261118120300), amenity_photo_rows
-- (20261118100100), monthly_credit_items (20261118109000),
-- menu_photo_reviewable_uploader (20261118120000).
--
-- Rollback: re-apply those bodies (library_page by drop and create with the
-- 20261118120300 signature).

-- ---------------------------------------------------------------------------
-- Library
-- ---------------------------------------------------------------------------

-- Body as in 20261118116000, plus kind 'import'.
create or replace function private.library_ref_ids(p_kind text, p_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when not coalesce(private.is_active_admin(), false) then '{}'::uuid[]
  else coalesce((
    select array_agg(distinct x.asset_id) from (
      select ci.asset_id from public.library_collection_items ci
      where p_kind = 'collection' and ci.collection_id = p_id
      union all
      select t.asset_id from public.library_asset_tags t
      where p_kind = 'tag' and t.tag_id = p_id
      union all
      select s.asset_id from public.coverage_submission_items s
      where p_kind = 'request' and s.requirement_id = p_id
      union all
      select e.asset_id from public.publication_events e
      where p_kind = 'destination' and e.destination_id = p_id
      union all
      select i.asset_id from public.media_import_items i
      where p_kind = 'import' and i.batch_id = p_id and i.outcome = 'imported'
    ) x
  ), '{}'::uuid[]) end;
$$;

-- Body as in 20261118116000, plus 'imports' (every batch, newest first,
-- with how many assets it created).
create or replace function public.library_filter_lists(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.library_assert_admin();
  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.title, 'venueId', r.venue_id,
          'venueName', v.name, 'status', r.status)
        order by v.name, r.title, r.id)
      from public.coverage_requirements r
      join public.venues v on v.id = r.venue_id
      where (p_venue_id is null or r.venue_id = p_venue_id)
        and exists (select 1 from public.coverage_submission_items s where s.requirement_id = r.id)
    ), '[]'::jsonb),
    'destinations', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.label, 'venueId', d.venue_id,
          'venueName', v.name, 'active', d.active)
        order by v.name nulls first, d.label, d.id)
      from public.publication_destinations d
      left join public.venues v on v.id = d.venue_id
      where p_venue_id is null or d.venue_id is null or d.venue_id = p_venue_id
    ), '[]'::jsonb),
    'imports', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.label,
          'createdAt', b.created_at, 'imported', b.imported)
        order by b.created_at desc, b.id)
      from (
        select bb.id, bb.label, bb.created_at,
          (select count(*) from public.media_import_items i
           where i.batch_id = bb.id and i.outcome = 'imported'
             and (p_venue_id is null or i.venue_id = p_venue_id)) as imported
        from public.media_import_batches bb
      ) b
      where p_venue_id is null or b.imported > 0
    ), '[]'::jsonb));
end;
$$;

drop function public.library_page(
  uuid, uuid, public.media_type, timestamptz, timestamptz, uuid, uuid, text, text,
  text, text, timestamptz, uuid, integer, integer, text, text, timestamptz,
  timestamptz, text, uuid, uuid, uuid, uuid
);

-- Body as in 20261118120300, plus p_import (the batch's assets, through
-- library_ref_ids like the other record filters).
create function public.library_page(
  p_venue uuid default null,
  p_staff uuid default null,
  p_type public.media_type default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_item uuid default null,
  p_variant uuid default null,
  p_category text default null,
  p_content_type text default null,
  p_label_state text default null,
  p_query text default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 25,
  p_candidate_cap integer default 3000,
  p_withdrawn text default 'active',
  p_review text default null,
  p_captured_from timestamptz default null,
  p_captured_to timestamptz default null,
  p_orientation text default null,
  p_request uuid default null,
  p_collection uuid default null,
  p_destination uuid default null,
  p_tag uuid default null,
  p_import uuid default null
)
returns setof public.media_assets
language plpgsql
stable
security invoker
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
declare
  v_cap integer := least(greatest(coalesce(p_candidate_cap, 3000), 0), 20000);
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 25);
  v_pattern text;
  v_ids uuid[];
  v_supplier text;
  v_query_items uuid[];
  v_category_items uuid[];
  v_ref_ids uuid[];
  v_ref_set boolean := false;
  v_sql text;
begin
  if p_query is not null and pg_catalog.btrim(p_query) <> '' then
    v_pattern := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
      pg_catalog.btrim(p_query), pg_catalog.chr(92), pg_catalog.chr(92) || pg_catalog.chr(92)),
      '%', pg_catalog.chr(92) || '%'), '_', pg_catalog.chr(92) || '_') || '%';
  end if;

  if v_cap > 0 then
    if p_item is not null or p_variant is not null then
      v_ids := private.library_candidate_ids('item', p_item, p_variant, null, v_cap);
      if v_ids is not null then v_supplier := 'item'; end if;
    end if;
    if v_supplier is null and v_pattern is not null then
      v_ids := private.library_candidate_ids('query', null, null, v_pattern, v_cap);
      if v_ids is not null then v_supplier := 'query'; end if;
    end if;
    if v_supplier is null and p_category is not null then
      v_ids := private.library_candidate_ids('category', null, null, p_category, v_cap);
      if v_ids is not null then v_supplier := 'category'; end if;
    end if;
    if v_supplier is null and p_content_type is not null then
      v_ids := private.library_candidate_ids('content', null, null, p_content_type, v_cap);
      if v_ids is not null then v_supplier := 'content'; end if;
    end if;
  end if;

  if v_cap > 0 and v_supplier is null
     and p_label_state in ('labelled', 'unlabelled')
     and p_item is null and p_variant is null and p_category is null
     and p_content_type is null and v_pattern is null
     -- The set page cannot leave rows out afterwards (a short page would
     -- read as the end), so it is used only when the withdrawn filter
     -- removes nothing.
     and (coalesce(p_withdrawn, 'active') = 'all'
       or (coalesce(p_withdrawn, 'active') = 'active' and not private.library_any_withdrawn()))
     and p_review is null
     and p_captured_from is null and p_captured_to is null and p_orientation is null
     and p_request is null and p_collection is null and p_destination is null and p_tag is null
     and p_import is null then
    v_ids := private.library_label_state_page(
      p_label_state, p_venue, p_staff, p_type, p_from, p_to,
      p_after_created_at, p_after_id, v_limit
    );
    if v_ids is not null then v_supplier := 'state'; end if;
  end if;

  if v_supplier is null then v_ids := null; end if;

  -- Record filters (collection, tag, request, destination): the intersection
  -- of their asset ids.
  if p_collection is not null then
    v_ref_ids := private.library_ref_ids('collection', p_collection); v_ref_set := true;
  end if;
  if p_tag is not null then
    v_ref_ids := case when v_ref_set
      then array(select unnest(v_ref_ids) intersect select unnest(private.library_ref_ids('tag', p_tag)))
      else private.library_ref_ids('tag', p_tag) end;
    v_ref_set := true;
  end if;
  if p_request is not null then
    v_ref_ids := case when v_ref_set
      then array(select unnest(v_ref_ids) intersect select unnest(private.library_ref_ids('request', p_request)))
      else private.library_ref_ids('request', p_request) end;
    v_ref_set := true;
  end if;
  if p_destination is not null then
    v_ref_ids := case when v_ref_set
      then array(select unnest(v_ref_ids) intersect select unnest(private.library_ref_ids('destination', p_destination)))
      else private.library_ref_ids('destination', p_destination) end;
    v_ref_set := true;
  end if;
  -- S5-IMPORT (FA-54): the assets a legacy import batch created.
  if p_import is not null then
    v_ref_ids := case when v_ref_set
      then array(select unnest(v_ref_ids) intersect select unnest(private.library_ref_ids('import', p_import)))
      else private.library_ref_ids('import', p_import) end;
    v_ref_set := true;
  end if;

  if v_pattern is not null and v_supplier is distinct from 'query' then
    v_query_items := private.library_candidate_ids('query_items', null, null, v_pattern, 5000);
  end if;
  if p_category is not null and v_supplier is distinct from 'category' then
    v_category_items := private.library_candidate_ids('category_items', null, null, p_category, 5000);
  end if;

  -- $1-$16 as 20261101100000; $17 review, $18 captured from, $19 captured
  -- to, $20 record-filter asset ids.
  v_sql := 'select a.* from public.media_assets a'
    || ' where a.deleted_at is null and a.upload_state = ''ready''';
  if p_venue is not null then v_sql := v_sql || ' and a.venue_id = $1'; end if;
  if p_staff is not null then v_sql := v_sql || ' and a.uploader_id = $2'; end if;
  if p_type is not null then v_sql := v_sql || ' and a.media_type = $3'; end if;
  if p_from is not null then v_sql := v_sql || ' and a.created_at >= $4'; end if;
  if p_to is not null then v_sql := v_sql || ' and a.created_at < $5'; end if;
  if p_after_created_at is not null and p_after_id is not null then
    v_sql := v_sql || ' and (a.created_at, a.id) < ($11, $12)';
  end if;
  if v_supplier is not null then v_sql := v_sql || ' and a.id = any ($13)'; end if;

  if (p_item is not null or p_variant is not null) and v_supplier is distinct from 'item' then
    v_sql := v_sql
      || ' and exists (select 1 from public.media_label_items li where li.asset_id = a.id'
      || case when p_item is not null then ' and li.item_id = $6' else '' end
      || case when p_variant is not null then ' and li.variant_id = $7' else '' end
      || ' offset 0)';
  end if;
  if p_category is not null and v_supplier is distinct from 'category' then
    v_sql := v_sql
      || ' and (exists (select 1 from public.media_label_items li'
      || ' where li.asset_id = a.id and li.section_slug = $8 offset 0)'
      || case when v_category_items is not null
        then ' or exists (select 1 from public.media_label_items li'
          || ' where li.asset_id = a.id and li.item_id = any ($16) offset 0))'
        else ' or exists (select 1 from public.media_label_items li'
          || ' join public.menu_entries e on e.item_id = li.item_id'
          || ' join public.menu_versions v on v.id = e.version_id'
          || ' join public.menu_sections s on s.id = e.section_id'
          || ' where li.asset_id = a.id and v.venue_id = a.venue_id'
          || ' and v.status = ''active'' and s.slug = $8 offset 0))'
        end;
  end if;
  if p_content_type is not null and v_supplier is distinct from 'content' then
    v_sql := v_sql
      || ' and exists (select 1 from public.media_labels l'
      || ' where l.asset_id = a.id and $9 = any (l.content_types) offset 0)';
  end if;
  if p_label_state is not null and v_supplier is distinct from 'state' then
    if p_label_state = 'labelled' then
      v_sql := v_sql
        || ' and exists (select 1 from public.media_labels l'
        || ' where l.asset_id = a.id and l.has_labels offset 0)';
    elsif p_label_state = 'unlabelled' then
      v_sql := v_sql
        || ' and private.library_unlabelled(a.id)';
    else
      v_sql := v_sql || ' and false';
    end if;
  end if;
  if v_pattern is not null and v_supplier is distinct from 'query' then
    v_sql := v_sql
      || ' and (exists (select 1 from public.media_labels l'
      || ' where l.asset_id = a.id and l.note ilike $10 offset 0)'
      || ' or exists (select 1 from public.media_label_items li where li.asset_id = a.id'
      || ' and (li.item_name ilike $10 or li.variant_name ilike $10 or li.section_name ilike $10) offset 0)'
      || case when v_query_items is not null
        then ' or exists (select 1 from public.media_label_items li'
          || ' where li.asset_id = a.id and li.item_id = any ($15) offset 0)'
        else ' or exists (select 1 from public.media_label_items li'
          || ' join public.menu_entries e on e.item_id = li.item_id'
          || ' where li.asset_id = a.id and (e.name ilike $10'
          || ' or exists (select 1 from pg_catalog.unnest(e.aliases) as al(alias) where al.alias ilike $10)) offset 0)'
        end
      || ' or exists (select 1 from public.menu_item_suggestions su'
      || ' where su.asset_id = a.id and su.status = ''open'' and su.suggested_name ilike $10 offset 0))';
  end if;

  -- The A4 filters.
  if coalesce(p_withdrawn, 'active') = 'active' then
    v_sql := v_sql || ' and not private.library_is_withdrawn(a.id)';
  elsif p_withdrawn = 'withdrawn' then
    v_sql := v_sql || ' and private.library_is_withdrawn(a.id)';
  elsif p_withdrawn <> 'all' then
    v_sql := v_sql || ' and false';
  end if;
  if p_review is not null then
    if p_review in ('public', 'reference', 'not_used', 'unreviewed') then
      v_sql := v_sql || ' and private.library_review_state(a.id) = $17';
    else
      v_sql := v_sql || ' and false';
    end if;
  end if;
  if p_captured_from is not null then v_sql := v_sql || ' and a.captured_at >= $18'; end if;
  if p_captured_to is not null then v_sql := v_sql || ' and a.captured_at < $19'; end if;
  if p_orientation is not null then
    v_sql := v_sql || case p_orientation
      when 'landscape' then ' and a.width > a.height'
      when 'portrait' then ' and a.height > a.width'
      when 'square' then ' and a.width = a.height'
      else ' and false' end;
  end if;
  if v_ref_set then v_sql := v_sql || ' and a.id = any ($20)'; end if;

  v_sql := v_sql || ' order by a.created_at desc, a.id desc limit $14';

  return query execute v_sql
    using p_venue, p_staff, p_type, p_from, p_to, p_item, p_variant, p_category,
      p_content_type, v_pattern, p_after_created_at, p_after_id, v_ids, v_limit,
      v_query_items, v_category_items, p_review, p_captured_from, p_captured_to,
      coalesce(v_ref_ids, '{}'::uuid[]);
end;
$$;
revoke all on function public.library_page(
  uuid, uuid, public.media_type, timestamptz, timestamptz, uuid, uuid, text, text,
  text, text, timestamptz, uuid, integer, integer, text, text, timestamptz,
  timestamptz, text, uuid, uuid, uuid, uuid, uuid
) from public, anon;
grant execute on function public.library_page(
  uuid, uuid, public.media_type, timestamptz, timestamptz, uuid, uuid, text, text,
  text, text, timestamptz, uuid, integer, integer, text, text, timestamptz,
  timestamptz, text, uuid, uuid, uuid, uuid, uuid
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Unlabelled rule
-- ---------------------------------------------------------------------------

-- Body as in 20261118120300: an import without a label waits at once as
-- 'imported', and an import staged on an amenity is held by that slot.
create or replace function private.asset_unlabelled_reason(p_asset_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
      when exists (select 1 from public.media_label_help_requests r where r.asset_id = a.id)
        and not coalesce(ml.has_labels, false) then 'not_sure'
      when ml.content_types && array['dish', 'preparation', 'plating', 'drinks']::text[] then 'no_dish'
      when not coalesce(ml.has_labels, false) and a.provenance = 'legacy_import' then 'imported'
      when not coalesce(ml.has_labels, false)
        and a.created_at <= now() - make_interval(days => private.label_help_unmatched_days()) then 'unmatched'
    end
  from public.media_assets a
  left join public.media_labels ml on ml.asset_id = a.id
  where a.id = p_asset_id
    and a.deleted_at is null
    and a.upload_state = 'ready'
    and a.purpose = 'general'
    and not exists (select 1 from public.media_label_items li where li.asset_id = a.id)
    and not exists (
      select 1 from public.menu_item_photos p
      where p.asset_id = a.id and p.state in ('accepted', 'better_photo_requested', 'needs_recheck'))
    and not exists (
      select 1 from public.media_area_labels l where l.asset_id = a.id and l.removed_at is null)
    and not exists (select 1 from public.amenity_submission_assets sa where sa.asset_id = a.id)
    and not exists (select 1 from public.amenity_photo_decisions d where d.asset_id = a.id)
    and not exists (select 1 from public.knowledge_contribution_assets ka where ka.asset_id = a.id)
    and not exists (select 1 from public.coverage_submission_items ci where ci.asset_id = a.id)
    and not exists (
      select 1 from public.media_import_items i
      where i.asset_id = a.id and i.outcome = 'imported' and i.staged_kind = 'amenity');
$$;

-- ---------------------------------------------------------------------------
-- Amenity photos: the amenity an import staged
-- ---------------------------------------------------------------------------

-- Body as in 20261118100100, plus imports staged on the check.
create or replace function private.amenity_photo_rows(p_venue_id uuid)
returns table (
  check_id uuid,
  venue_id uuid,
  asset_id uuid,
  uploader_id uuid,
  uploaded_at timestamptz,
  state text,
  review_level text,
  reason text,
  decided_by uuid,
  decided_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with checks as (
    select c.id, c.venue_id, c.current_submission_id
    from public.venue_amenity_checks c
    where c.venue_id = p_venue_id and c.status = 'active'
      and private.knowledge_in_scope(c.venue_id, c.template_key)
  ),
  linked as (
    select ch.id as check_id, sa.asset_id
    from checks ch
    join public.amenity_submission_assets sa on sa.submission_id = ch.current_submission_id
    where sa.evidence_kind = 'photo'
    union
    select ch.id, ka.asset_id
    from checks ch
    join public.knowledge_contributions k on k.check_id = ch.id
    join public.knowledge_contribution_assets ka on ka.contribution_id = k.id
    where ka.evidence_kind = 'photo' and not private.knowledge_is_terminal(k.id)
    union
    select ch.id, d.asset_id
    from checks ch
    join public.amenity_photo_decisions d on d.check_id = ch.id
    union
    select ch.id, i.asset_id
    from checks ch
    join public.media_import_items i
      on i.staged_id = ch.id and i.staged_kind = 'amenity' and i.outcome = 'imported'
  )
  select l.check_id, a.venue_id, a.id, a.uploader_id, a.created_at,
    coalesce(d.action, 'pending'), coalesce(d.review_level, 'public'), d.reason, d.decided_by, d.decided_at
  from linked l
  join public.media_assets a on a.id = l.asset_id and a.venue_id = p_venue_id
  left join lateral (
    select x.action, x.review_level, x.reason, x.decided_by, x.decided_at
    from public.amenity_photo_decisions x
    where x.check_id = l.check_id and x.asset_id = l.asset_id
    order by x.id desc limit 1
  ) d on true
  where a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Monthly credit: imports earn none
-- ---------------------------------------------------------------------------

-- Signature and columns as in 20261118109000.
create or replace function private.monthly_credit_items(p_month date)
returns table (author_id uuid, venue_id uuid, asset_id uuid, decided_at timestamptz, evidence_removed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.author_id, c.venue_id, c.asset_id, c.decided_at, c.evidence_removed
  from private.monthly_credit_items_base(p_month) c
  where not private.media_duplicate_suppressed(c.asset_id)
    and not exists (
      select 1 from public.media_assets a
      where a.id = c.asset_id and a.provenance = 'legacy_import');
$$;

-- ---------------------------------------------------------------------------
-- Review: imports by the importing admin reach managers
-- ---------------------------------------------------------------------------

-- Body as in 20261118120000, plus the importing admin as a reviewable
-- uploader. An import with no active staff or manager contributor is held
-- by the admin who ran it (the contributor stays on media_import_items).
-- Admins cannot upload through the app (S1-UPLOAD: admin upload not built),
-- so the only assets such an admin holds are imports, and they enter Review
-- like any upload (FA-54). When admin upload is built, this needs the
-- asset's provenance instead.
create or replace function private.menu_photo_reviewable_uploader(p_uploader uuid, p_admin boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_admin, false)
    or case
      when p_uploader = (select auth.uid()) then
        not private.is_active_manager()
        or private.review_self_allowed(private.my_manager_venue_id())
      else exists (
        select 1 from public.profiles up
        where up.id = p_uploader and up.active and up.role in ('staff', 'manager'))
        or exists (
          select 1 from public.media_import_batches b where b.created_by = p_uploader)
    end;
$$;
