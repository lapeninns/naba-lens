-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R1 K1 (FA-4, spec §7 M1, M2, §8 A1, A4): one unlabelled
-- rule. Before this, four counts and a filter each had their own.
--
--   Rule     private.asset_unlabelled_reason(asset): why a photo or video
--            waits for someone to label it, or null. A ready, undeleted
--            general upload that no slot holds (no dish label, no live dish
--            decision, no live place label, no amenity, knowledge or
--            checklist link) and:
--              not_sure   its uploader chose I'm not sure (a help request)
--                         and it still has no label;
--              no_dish    staff tagged it food or drink but chose no dish;
--              unmatched  it has no label at all and has waited 7 days or
--                         more (Match later for 7 days, FA-4; videos too,
--                         which Match does not take).
--            A photo left in Match later for less than 7 days stays with the
--            person (FA-4) and is not unlabelled here.
--   Set      private.asset_unlabelled(asset): the reason is not null and the
--            photo is not set aside (Not used or Mark duplicate). Every count
--            and list reads it:
--              Review Needs label    public.manager_menu_photo_queue
--                                    (20261118120400)
--              label_help_queue      the venue's Needs label list
--              Overview (manager)    private.venue_unlabelled_photos, with
--                                    the Review queue's own visibility rule,
--                                    so the number is the list it links to
--              Overview (admin)      private.admin_overview_row (unchanged:
--                                    it already reads asset_unlabelled)
--              Library               labels=unlabelled for admins
--                                    (library_page and
--                                    private.library_label_state_page); a
--                                    staff member's own library keeps "no
--                                    label saved" (Me's rule D-12)
--   Gate     private.menu_photo_unlabelled_eligible (who may open the photo
--            and label it) follows the rule for images, set aside or not, so
--            a manager can open and label an I'm not sure photo; and
--            public.assign_menu_item_photo labels any photo the rule lists.
--
-- Rollback: re-apply private.menu_photo_unlabelled_eligible (20261107100300),
-- public.assign_menu_item_photo (20261107100400), public.label_help_queue
-- (20261118112000), private.venue_unlabelled_photos (20261118113100),
-- private.asset_unlabelled (20261118115100), private.library_label_state_page
-- (20261101100000) and public.library_page (20261118116000); drop the new
-- functions.

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

create function private.asset_unlabelled_reason(p_asset_id uuid)
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
    and not exists (select 1 from public.coverage_submission_items ci where ci.asset_id = a.id);
$$;

comment on function private.asset_unlabelled_reason(uuid) is
  'S3-R1 K1 (FA-4): the one unlabelled rule. not_sure, no_dish or unmatched (no label for 7 days); null when a slot holds the upload or it is not unlabelled.';

-- Body replaced: the rule, not set aside. Signature as in 20261118115100.
create or replace function private.asset_unlabelled(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.asset_unlabelled_reason(p_asset_id) is not null
    and not private.asset_set_aside(p_asset_id);
$$;

-- The library's unlabelled filter (library_page is security invoker, so the
-- asset rows are already the caller's). For an admin, the rule. For anyone
-- else the library is their own photos, and "needs labels" keeps its own
-- meaning there (no label saved yet, Me's rule D-12), as before.
create function private.library_unlabelled(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_active_admin() then private.asset_unlabelled(p_asset_id)
    else not exists (
      select 1 from public.media_labels l where l.asset_id = p_asset_id and l.has_labels)
  end;
$$;

revoke all on function private.asset_unlabelled_reason(uuid) from public, anon, authenticated, service_role;
revoke all on function private.asset_unlabelled(uuid) from public, anon, authenticated, service_role;
revoke all on function private.library_unlabelled(uuid) from public, anon;
grant execute on function private.library_unlabelled(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Gate: who may open and label an unlabelled photo
-- ---------------------------------------------------------------------------

-- Body as in 20261107100300, with the food-or-drink test replaced by the
-- rule's reason. Images only (dish decisions take images). Set aside is not
-- tested here: a photo set aside still opens for its reviewer; the queue and
-- the detail test it themselves.
create or replace function private.menu_photo_unlabelled_eligible(p_asset uuid, p_venue uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.menu_photo_can_review_unlabelled() and exists (
    select 1
    from public.media_assets a
    left join public.media_labels ml on ml.asset_id = a.id
    where a.id = p_asset and a.venue_id = p_venue
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      -- Cheap first: one of the rule's three reasons can hold at all.
      and (ml.content_types && array['dish', 'preparation', 'plating', 'drinks']::text[]
        or exists (select 1 from public.media_label_help_requests r where r.asset_id = a.id)
        or (not coalesce(ml.has_labels, false)
          and a.created_at <= now() - make_interval(days => private.label_help_unmatched_days())))
      and private.asset_unlabelled_reason(a.id) is not null);
$$;

-- ---------------------------------------------------------------------------
-- Counts and lists
-- ---------------------------------------------------------------------------

-- Body replaced: the rule, with the Review queue's visibility (whose photos
-- the caller may decide on), so Overview's number is the Needs label list it
-- links to.
create or replace function private.venue_unlabelled_photos(p_venue_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.media_assets a
  where a.venue_id = p_venue_id
    and a.upload_state = 'ready' and a.deleted_at is null and a.purpose = 'general'
    and private.menu_photo_can_review_unlabelled()
    and private.asset_unlabelled(a.id)
    and private.menu_photo_reviewable_uploader(a.uploader_id, private.is_active_admin());
$$;

-- Body as in 20261118112000, listing the rule's photos: reason is not_sure,
-- no_dish or unmatched.
create or replace function public.label_help_queue(
  p_venue_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid := p_venue_id;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_admin boolean;
  v_result jsonb;
begin
  if not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  v_admin := private.is_active_admin();
  if v_venue is null and not v_admin then
    select p.venue_id into v_venue from public.profiles p where p.id = v_uid;
  end if;
  if v_venue is null then
    raise exception 'venue_required' using errcode = '22023';
  end if;
  if not (v_admin or coalesce(private.venue_role_of(v_uid, v_venue) = 'manager', false)) then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;

  with q as (
    select a.id, a.uploader_id, a.media_type, a.created_at, a.captured_at,
      a.thumbnail_path is not null as has_thumbnail,
      r.requested_at,
      private.asset_unlabelled_reason(a.id) as reason,
      coalesce(r.requested_at, a.created_at) as since
    from public.media_assets a
    left join public.media_label_help_requests r on r.asset_id = a.id
    where a.venue_id = v_venue
      and a.deleted_at is null
      and a.upload_state = 'ready'
      and a.purpose = 'general'
      and private.asset_unlabelled(a.id)
  )
  select jsonb_build_object(
    'venueId', v_venue,
    'unmatchedDays', private.label_help_unmatched_days(),
    'total', (select count(*) from q),
    'notSure', (select count(*) from q where q.reason = 'not_sure'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'assetId', s.id,
          'reason', s.reason,
          'note', l.note,
          'uploaderId', s.uploader_id,
          'uploaderName', up.display_name,
          'mediaType', s.media_type,
          'createdAt', s.created_at,
          'capturedAt', s.captured_at,
          'requestedAt', s.requested_at,
          'hasThumbnail', s.has_thumbnail
        ) order by s.since, s.id)
      from (select * from q order by q.since, q.id limit v_limit) s
      join public.profiles up on up.id = s.uploader_id
      left join public.media_labels l on l.asset_id = s.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Body as in 20261101100000, with unlabelled read from the rule.
create or replace function private.library_label_state_page(
  p_state text,
  p_venue uuid,
  p_staff uuid,
  p_type public.media_type,
  p_from timestamptz,
  p_to timestamptz,
  p_after_created_at timestamptz,
  p_after_id uuid,
  p_limit integer
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_sql text;
  v_ids uuid[];
begin
  if not coalesce((select private.is_active_admin()), false)
     or p_state is null or p_state not in ('labelled', 'unlabelled') then
    return null;
  end if;

  -- $1 venue, $2 staff, $3 type, $4 from, $5 to, $6 cursor created_at,
  -- $7 cursor id, $8 limit. Each fragment is a fixed string.
  v_sql := 'select coalesce(pg_catalog.array_agg(s.id order by s.created_at desc, s.id desc), ''{}'')'
    || ' from (select a.id, a.created_at from public.media_assets a'
    || ' where a.deleted_at is null and a.upload_state = ''ready''';
  if p_venue is not null then v_sql := v_sql || ' and a.venue_id = $1'; end if;
  if p_staff is not null then v_sql := v_sql || ' and a.uploader_id = $2'; end if;
  if p_type is not null then v_sql := v_sql || ' and a.media_type = $3'; end if;
  if p_from is not null then v_sql := v_sql || ' and a.created_at >= $4'; end if;
  if p_to is not null then v_sql := v_sql || ' and a.created_at < $5'; end if;
  if p_after_created_at is not null and p_after_id is not null then
    v_sql := v_sql || ' and (a.created_at, a.id) < ($6, $7)';
  end if;
  v_sql := v_sql
    || case when p_state = 'labelled'
      then ' and exists (select 1 from public.media_labels l where l.asset_id = a.id and l.has_labels)'
      else ' and a.purpose = ''general'' and private.asset_unlabelled(a.id)' end
    || ' order by a.created_at desc, a.id desc limit $8) s';

  execute v_sql into v_ids
    using p_venue, p_staff, p_type, p_from, p_to, p_after_created_at, p_after_id, v_limit;
  return v_ids;
end;
$$;

-- Body as in 20261118116000, with labels=unlabelled read from the rule
-- (private.library_unlabelled).
create or replace function public.library_page(
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
  p_tag uuid default null
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
     and p_request is null and p_collection is null and p_destination is null and p_tag is null then
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

-- Body as in 20261107100400; an unlabelled photo the rule lists may be
-- labelled (K1), not only one tagged food or drink.
create or replace function public.assign_menu_item_photo(
  p_asset_id uuid,
  p_item_id uuid,
  p_variant_id uuid,
  p_corrects_item_id uuid,
  p_corrects_variant_id uuid,
  p_reason text,
  p_expected_revision integer,
  p_make_primary boolean default false,
  p_client_request_key text default null
)
returns table (
  photo_id uuid,
  item_id uuid,
  state text,
  is_primary boolean,
  item_revision integer,
  corrects_item_revision integer,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_event public.menu_item_photo_events;
  v_asset public.media_assets;
  v_active uuid;
  v_entry_name text;
  v_section_name text;
  v_section_kind text;
  v_variant_name text;
  v_live public.menu_item_photos;
  v_label_at timestamptz;
  v_reason text;
  v_kind text;
  v_items uuid[];
  v_item uuid;
  v_rev integer;
  v_head integer;
  v_corrects_head integer;
  v_self boolean;
  v_role text;
  v_primary boolean := false;
  v_photo uuid;
begin
  if v_uid is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_client_request_key is not null then
    perform private.assert_request_key(p_client_request_key);
    perform private.lock_coverage_request(v_uid, p_client_request_key);
    select e.* into v_event from public.menu_item_photo_events e
    where e.actor_id = v_uid and e.client_request_key = p_client_request_key;
    if found then
      -- A replay answers only someone still in scope, and only the same assignment.
      if not private.can_manage_venue(v_event.venue_id) then
        raise exception 'media_asset_not_found' using errcode = 'P0002';
      end if;
      if v_event.action is distinct from 'accepted'
         or v_event.detail ->> 'op' is distinct from 'assign'
         or v_event.asset_id is distinct from p_asset_id
         or v_event.item_id is distinct from p_item_id
         or v_event.variant_id is distinct from p_variant_id
         or (v_event.detail ->> 'correctsItemId')::uuid is distinct from p_corrects_item_id
         or (v_event.detail ->> 'correctsVariantId')::uuid is distinct from p_corrects_variant_id
         or coalesce((v_event.detail ->> 'makePrimary')::boolean, false)
           is distinct from coalesce(p_make_primary, false) then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
      photo_id := v_event.photo_id;
      item_id := v_event.item_id;
      state := v_event.to_state;
      is_primary := coalesce((v_event.detail ->> 'isPrimary')::boolean, false);
      item_revision := v_event.item_revision;
      corrects_item_revision := (v_event.detail ->> 'correctsItemRevision')::integer;
      replayed := true;
      return next;
      return;
    end if;
  end if;

  if p_item_id is null or (p_corrects_variant_id is not null and p_corrects_item_id is null) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Lock order: asset row, shared venue menu lock, item heads.
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found or not private.can_manage_venue(v_asset.venue_id) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if private.menu_photo_self_blocked(v_asset.uploader_id) then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  if not private.menu_photo_reviewable_uploader(v_asset.uploader_id, private.is_active_admin()) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_venue_menu(v_asset.venue_id, true);

  -- The target item is on the active version in a food or drinks section, not
  -- archived, and offers the variant (a variant_removed recheck can only be
  -- withdrawn).
  v_active := private.active_menu_version_id(v_asset.venue_id);
  select e.name, s.name, s.kind, ev.name
  into v_entry_name, v_section_name, v_section_kind, v_variant_name
  from public.menu_items i
  join public.menu_entries e on e.item_id = i.id and e.version_id = v_active
  join public.menu_sections s on s.id = e.section_id
  left join public.menu_entry_variants ev on ev.entry_id = e.id and ev.variant_id = p_variant_id
  where i.id = p_item_id and i.venue_id = v_asset.venue_id and i.archived_at is null
    and s.kind in ('food', 'drinks')
    and (p_variant_id is null or ev.variant_id is not null);
  if not found then
    raise exception 'menu_item_unavailable' using errcode = 'P0001';
  end if;

  -- The live row of the target tuple decides first.
  select p.* into v_live from public.menu_item_photos p
  where p.asset_id = p_asset_id and p.item_id = p_item_id
    and p.variant_id is not distinct from p_variant_id
    and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
  for update;
  if found and v_live.basis = 'staff_label' then
    raise exception 'menu_item_labelled' using errcode = 'P0001';
  end if;

  if found then
    -- Accepting a reviewer row again: same correction as stored.
    if p_corrects_item_id is distinct from v_live.corrects_item_id
       or p_corrects_variant_id is distinct from v_live.corrects_variant_id then
      raise exception 'corrects_mismatch' using errcode = '22023';
    end if;
    -- An unlabelled association: manager accounts and admins only.
    if v_live.corrects_item_id is null and not private.menu_photo_can_review_unlabelled() then
      raise exception 'not_venue_manager' using errcode = '42501';
    end if;
    -- Already accepted with the same correction: a no-op.
    if v_live.state = 'accepted' then
      photo_id := v_live.id;
      item_id := v_live.item_id;
      state := v_live.state;
      is_primary := v_live.is_primary;
      item_revision := coalesce(
        (select h.revision from public.menu_item_photo_heads h where h.item_id = p_item_id), 1);
      corrects_item_revision := null;
      replayed := true;
      return next;
      return;
    end if;
    v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
    v_kind := 'reaccept';
    v_items := array[p_item_id];
  else
    if p_corrects_item_id is not null then
      -- A corrected label (item on the menu) or a label for an earlier menu.
      if exists (
        select 1
        from public.menu_entries e
        join public.menu_sections s on s.id = e.section_id and s.kind in ('food', 'drinks')
        join public.menu_items i on i.id = e.item_id and i.archived_at is null
        where e.version_id = v_active and e.item_id = p_corrects_item_id
      ) then
        v_reason := private.require_reason(p_reason);
        v_kind := 'correction';
      else
        v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
        v_kind := 'stale';
      end if;
      select li.added_at into v_label_at from public.media_label_items li
      where li.asset_id = p_asset_id and li.item_id = p_corrects_item_id
        and li.variant_id is not distinct from p_corrects_variant_id;
      if not found then
        raise exception 'relink_requires_label' using errcode = 'P0001';
      end if;
      if private.menu_photo_tuple_relinked(p_asset_id, p_corrects_item_id, p_corrects_variant_id, v_label_at) then
        raise exception 'menu_item_relinked' using errcode = 'P0001';
      end if;
      -- A decision on the staff label stands until withdrawn.
      if exists (
        select 1 from public.menu_item_photos p
        where p.asset_id = p_asset_id and p.item_id = p_corrects_item_id
          and p.variant_id is not distinct from p_corrects_variant_id
          and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
      ) then
        raise exception 'invalid_transition' using errcode = 'P0001', detail = 'withdraw first';
      end if;
    else
      -- Q1 unlabelled (begin)
      if not private.menu_photo_can_review_unlabelled() then
        raise exception 'not_venue_manager' using errcode = '42501';
      end if;
      if exists (select 1 from public.media_label_items li where li.asset_id = p_asset_id) then
        raise exception 'asset_has_labels' using errcode = 'P0001';
      end if;
      -- S3-R1 K1: any photo the unlabelled rule lists (I'm not sure, Match
      -- later for 7 days), as well as a food or drink tag.
      if private.asset_unlabelled_reason(p_asset_id) is null and not exists (
        select 1 from public.media_labels ml
        where ml.asset_id = p_asset_id
          and ml.content_types && array['dish', 'preparation', 'plating', 'drinks']::text[]
      ) then
        raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_food_or_drink';
      end if;
      v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
      v_kind := 'unlabelled';
      -- Q1 unlabelled (end)
    end if;
    if exists (
      select 1 from public.media_label_items li
      where li.asset_id = p_asset_id and li.item_id = p_item_id
        and li.variant_id is not distinct from p_variant_id
    ) then
      raise exception 'menu_item_labelled' using errcode = 'P0001';
    end if;
    v_items := array(
      select distinct u.id from unnest(array[p_item_id, p_corrects_item_id]) as u(id)
      where u.id is not null order by u.id);
  end if;

  if v_asset.deleted_at is not null then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'evidence_removed';
  end if;
  if v_asset.media_type <> 'image' then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_image';
  end if;
  if v_asset.upload_state <> 'ready' then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_ready';
  end if;

  -- Heads in item_id order; only the target's revision is compared.
  foreach v_item in array v_items loop
    v_rev := private.lock_item_photo_head(v_item, v_asset.venue_id);
    if v_item = p_item_id then
      v_head := v_rev;
    else
      v_corrects_head := v_rev;
    end if;
  end loop;
  if p_expected_revision is distinct from v_head then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_head)::text;
  end if;

  v_self := v_uid = v_asset.uploader_id;
  v_role := private.coverage_actor_role(v_asset.venue_id);
  perform private.bump_item_photo_heads(v_items, v_asset.venue_id);
  v_head := v_head + 1;
  v_corrects_head := case
    when v_kind = 'reaccept' then null
    -- An option-only correction: one item, one head.
    when p_corrects_item_id = p_item_id then v_head
    else v_corrects_head + 1
  end;

  v_primary := coalesce(p_make_primary, false)
    or private.menu_item_effective_primary(p_item_id) is null;
  if v_primary then
    perform private.clear_item_primary(p_item_id, null, v_role);
  end if;

  if v_live.id is null then
    insert into public.menu_item_photos as p (
      venue_id, item_id, variant_id, asset_id, author_id, state, is_primary, reason,
      item_name, variant_name, section_name, section_kind, menu_version_id,
      decided_by, self_review, basis, corrects_item_id, corrects_variant_id
    )
    values (
      v_asset.venue_id, p_item_id, p_variant_id, p_asset_id, v_asset.uploader_id, 'accepted', v_primary,
      v_reason, v_entry_name, v_variant_name, v_section_name, v_section_kind, v_active, v_uid, v_self,
      'reviewer', p_corrects_item_id, p_corrects_variant_id
    )
    returning p.id into v_photo;
  else
    update public.menu_item_photos p
    set state = 'accepted', reason = coalesce(v_reason, p.reason), recheck_kind = null,
        is_primary = v_primary,
        item_name = v_entry_name, variant_name = v_variant_name, section_name = v_section_name,
        section_kind = v_section_kind, menu_version_id = v_active,
        decided_by = v_uid, decided_at = now(), self_review = v_self, revision = p.revision + 1
    where p.id = v_live.id
    returning p.id into v_photo;
  end if;
  perform private.record_item_photo_event(v_photo, 'accepted', v_live.state, v_reason, v_self,
    p_client_request_key, v_role, jsonb_build_object(
      'op', 'assign',
      'basis', 'reviewer',
      'kind', v_kind,
      'correctsItemId', p_corrects_item_id,
      'correctsVariantId', p_corrects_variant_id,
      'makePrimary', coalesce(p_make_primary, false),
      'isPrimary', v_primary,
      'correctsItemRevision', v_corrects_head));
  if not v_primary then
    -- A flagged primary whose photo was deleted gives way to the earliest eligible one.
    perform private.promote_item_primary(p_item_id, v_role);
  end if;

  photo_id := v_photo;
  item_id := p_item_id;
  state := 'accepted';
  is_primary := v_primary;
  item_revision := v_head;
  corrects_item_revision := v_corrects_head;
  replayed := false;
  return next;
end;
$$;
