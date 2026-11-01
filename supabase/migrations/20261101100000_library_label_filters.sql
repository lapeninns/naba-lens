-- Admin library: label filters, cursor and filter options whose cost follows
-- the page and the filter's selectivity, not the size of the label tables
-- (Workstream 3, fixes 1, 3 and 4; docs/perf/baseline.md section 7).
--
-- No RLS policy, table privilege or label-visibility rule changes here.
-- public.library_page, library_labelled_items and library_labelled_variants are
-- SECURITY INVOKER, so the caller's RLS applies to every table they read. The
-- one SECURITY DEFINER function, private.library_candidate_ids, answers only
-- for an active admin and reads nothing an admin could not already read.
--
-- pg_trgm is a new extension for this database (production migration item).

-- pg_trgm serves the case-insensitive substring search (ILIKE '%text%').
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- All aliases of an entry as one text, for a trigram index. The separator is a
-- control character that cannot be typed into a menu, and a match on the joined
-- text is always re-checked per alias, so it never matches across two aliases.
create or replace function private.menu_aliases_search_text(p_aliases text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.array_to_string(p_aliases, pg_catalog.chr(31));
$$;

revoke all on function private.menu_aliases_search_text(text[]) from public, anon;
grant execute on function private.menu_aliases_search_text(text[]) to authenticated, service_role;

create index media_labels_note_trgm_idx
  on public.media_labels using gin (note extensions.gin_trgm_ops);
-- Labelled assets only: the whole set when few assets are labelled.
create index media_labels_labelled_idx
  on public.media_labels (asset_id) where has_labels;
create index media_labels_content_types_idx
  on public.media_labels using gin (content_types);

create index media_label_items_item_name_trgm_idx
  on public.media_label_items using gin (item_name extensions.gin_trgm_ops);
create index media_label_items_variant_name_trgm_idx
  on public.media_label_items using gin (variant_name extensions.gin_trgm_ops);
create index media_label_items_section_name_trgm_idx
  on public.media_label_items using gin (section_name extensions.gin_trgm_ops);

-- Newest label of an item or variant without reading all of its labels.
create index media_label_items_item_added_idx
  on public.media_label_items (item_id, added_at desc, id desc);
create index media_label_items_variant_added_idx
  on public.media_label_items (variant_id, added_at desc, id desc)
  where variant_id is not null;

-- Text-search indexes on the menu tables that the library search reads.
create index menu_entries_name_trgm_idx
  on public.menu_entries using gin (name extensions.gin_trgm_ops);
create index menu_entries_aliases_trgm_idx
  on public.menu_entries
  using gin ((private.menu_aliases_search_text(aliases)) extensions.gin_trgm_ops);
create index menu_item_suggestions_open_name_trgm_idx
  on public.menu_item_suggestions using gin (suggested_name extensions.gin_trgm_ops)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- Candidate asset ids
-- ---------------------------------------------------------------------------

-- Ids of the assets whose labels match one label filter, read straight from
-- the label indexes, or null when more than p_cap label rows match. A separate SECURITY DEFINER function
-- because under row level security the planner may not run ILIKE (it is not
-- leakproof) before the per-row can_read_asset_labels() policy: every label row
-- is then checked one by one and no trigram index can be used (seconds at
-- 200,000 assets).
--
-- It applies the admin label rule itself, as private.can_read_asset_labels
-- states it for an admin: the caller is an active admin (anyone else gets
-- null, and library_page falls back to its per-asset probes) and the asset is
-- ready and not deleted. Menu entries, sections, versions and suggestions are
-- admin-readable without further conditions. So a candidate is an asset whose
-- matching label rows the admin can read through RLS; library_page then reads
-- the assets as the caller, so media_assets RLS applies on top.
-- If private.can_read_asset_labels or the admin policies on these tables
-- change, change this function with them (see the comment on that function).
-- The kinds query_items and category_items return menu item ids instead of
-- asset ids, from menu_entries with the version scope library_assets uses:
-- every version for a text match, active versions only for a category. An admin
-- reads every menu entry, section and version by policy.
-- p_kind names one fixed query below; p_text is the escaped ILIKE pattern, the
-- category slug or the content type.
create or replace function private.library_candidate_ids(
  p_kind text,
  p_item uuid,
  p_variant uuid,
  p_text text,
  p_cap integer
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw uuid[];
  v_ids uuid[];
begin
  if not coalesce((select private.is_active_admin()), false) then
    return null;
  end if;

  -- Menu items (not assets) whose entries match, for the per-asset probes: one
  -- indexed read here replaces a join to menu_entries, and the staff-visibility
  -- policy function it runs per entry row, for every asset the walk tests.
  if p_kind = 'query_items' then
    select coalesce(pg_catalog.array_agg(s.item_id), '{}') into v_raw
    from (
      select e.item_id
      from public.menu_entries e
      where e.name ilike p_text
         or (
           private.menu_aliases_search_text(e.aliases) ilike p_text
           and exists (
             select 1 from pg_catalog.unnest(e.aliases) as al(alias)
             where al.alias ilike p_text
           )
         )
      group by e.item_id
      limit p_cap + 1
    ) s;
    if pg_catalog.cardinality(v_raw) > p_cap then return null; end if;
    return v_raw;
  elsif p_kind = 'category_items' then
    select coalesce(pg_catalog.array_agg(s.item_id), '{}') into v_raw
    from (
      select e.item_id
      from public.menu_sections sec
      join public.menu_versions v on v.id = sec.version_id and v.status = 'active'
      join public.menu_entries e on e.section_id = sec.id and e.version_id = v.id
      where sec.slug = p_text
      group by e.item_id
      limit p_cap + 1
    ) s;
    if pg_catalog.cardinality(v_raw) > p_cap then return null; end if;
    return v_raw;
  end if;

  if p_kind = 'item' then
    select coalesce(pg_catalog.array_agg(s.asset_id), '{}') into v_raw
    from (
      select li.asset_id
      from public.media_label_items li
      where (p_item is null or li.item_id = p_item)
        and (p_variant is null or li.variant_id = p_variant)
      limit p_cap + 1
    ) s;
  elsif p_kind = 'query' then
    select coalesce(pg_catalog.array_agg(s.asset_id), '{}') into v_raw
    from (
      select u.asset_id from (
        (select l.asset_id
         from public.media_labels l
         where l.note ilike p_text
         limit p_cap + 1)
        union all
        (select li.asset_id
         from public.media_label_items li
         where li.item_name ilike p_text
            or li.variant_name ilike p_text
            or li.section_name ilike p_text
         limit p_cap + 1)
        union all
        (select li.asset_id
         from public.media_label_items li
         where li.item_id in (
           select e.item_id
           from public.menu_entries e
           where e.name ilike p_text
              or (
                private.menu_aliases_search_text(e.aliases) ilike p_text
                and exists (
                  select 1 from pg_catalog.unnest(e.aliases) as al(alias)
                  where al.alias ilike p_text
                )
              )
         )
         limit p_cap + 1)
        union all
        (select su.asset_id
         from public.menu_item_suggestions su
         where su.status = 'open' and su.suggested_name ilike p_text
         limit p_cap + 1)
      ) u
      limit p_cap + 1
    ) s;
  elsif p_kind = 'category' then
    select coalesce(pg_catalog.array_agg(s.asset_id), '{}') into v_raw
    from (
      select u.asset_id from (
        (select li.asset_id
         from public.media_label_items li
         where li.section_slug = p_text
         limit p_cap + 1)
        union all
        (select li.asset_id
         from public.menu_sections sec
         join public.menu_versions v on v.id = sec.version_id and v.status = 'active'
         join public.menu_entries e on e.section_id = sec.id and e.version_id = v.id
         join public.media_label_items li on li.item_id = e.item_id and li.venue_id = v.venue_id
         where sec.slug = p_text
         limit p_cap + 1)
      ) u
      limit p_cap + 1
    ) s;
  elsif p_kind = 'content' then
    select coalesce(pg_catalog.array_agg(s.asset_id), '{}') into v_raw
    from (
      select l.asset_id
      from public.media_labels l
      where l.content_types @> array[p_text]
      limit p_cap + 1
    ) s;
  elsif p_kind = 'labelled' then
    select coalesce(pg_catalog.array_agg(s.asset_id), '{}') into v_raw
    from (
      select l.asset_id
      from public.media_labels l
      where l.has_labels
      limit p_cap + 1
    ) s;
  end if;

  -- More matches than the cap: the caller walks the feed instead.
  if pg_catalog.cardinality(v_raw) > p_cap then
    return null;
  end if;
  -- The admin rule on the asset itself (see above), as one primary-key step
  -- over the few candidates; a join per branch lets the planner scan far more.
  select coalesce(pg_catalog.array_agg(a.id), '{}') into v_ids
  from public.media_assets a
  where a.id = any (v_raw)
    and a.deleted_at is null and a.upload_state = 'ready';
  return v_ids;
end;
$$;

comment on function private.library_candidate_ids(text, uuid, uuid, text, integer) is
  'Admin-only candidate asset ids for library_page label filters. Duplicates the admin rule of private.can_read_asset_labels; keep them in step.';

comment on function private.can_read_asset_labels(uuid) is
  'Who may read an asset''s labels: an active staff member for their own non-deleted assets, an active admin for ready non-deleted assets. Two SECURITY DEFINER functions repeat the admin rule without calling this function, so a change here must change them too: private.library_candidate_ids (library_page label filters) and public.menu_label_counts (menu label counts). Tests compare them with the RLS policies that use this function.';

revoke all on function private.library_candidate_ids(text, uuid, uuid, text, integer)
  from public, anon;
grant execute on function private.library_candidate_ids(text, uuid, uuid, text, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- library_page
-- ---------------------------------------------------------------------------

-- One page of the admin library: the ready, non-deleted assets that match the
-- feed filters (venue, uploader, type, created_at range) and the label filters
-- of public.library_assets, newest first, strictly after the cursor
-- (created_at, id). Label filters mean exactly what they mean in
-- library_assets, and the rows, order and paging are the same as filtering
-- that function with PostgREST; this function is the one the app calls.
--
-- Why not library_assets: PostgREST hands its arguments over as columns, so the
-- "p_x is null or exists (...)" tests cannot be folded away and the planner
-- hashes every label table before the first row. Here only the predicates in
-- use are written into the query, with the real values, so each plan is
-- specific to the request, and the cursor is a row-value bound that the feed
-- indexes can use.
--
-- Strategy, chosen by measuring rather than by planner statistics. A filter
-- that names rows by index (item, variant, text, category, content type,
-- labelled) first asks private.library_candidate_ids for the matching asset
-- ids. It answers null for a non-admin or when more than p_candidate_cap label
-- rows match. With an answer, the page is read from those assets by primary
-- key and sorted. Without one, or for the unlabelled filter, the page is read
-- by walking the feed index in order and testing each asset, which stops after
-- one page. For an admin the walk's menu-entry probes use item ids from the
-- same helper (kinds query_items and category_items) instead of joining the
-- entry tables under row level security for every asset. The asset-id
-- set always replaces the filter that produced it and nothing else, so both
-- strategies return the same rows. p_candidate_cap exists so tests can force
-- either one (0 always walks the feed).
--
-- Dynamic SQL: only fixed fragments written here are concatenated; every
-- caller value is a bound parameter.
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
  p_candidate_cap integer default 3000
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
  v_sql text;
begin
  -- Same escaping as library_assets: LIKE wildcards and the escape character
  -- are plain text. A blank query is no filter.
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
    if v_supplier is null and p_label_state = 'labelled' then
      v_ids := private.library_candidate_ids('labelled', null, null, null, v_cap);
      if v_ids is not null then v_supplier := 'labelled'; end if;
    end if;
  end if;

  if v_supplier is null then v_ids := null; end if;

  -- Items whose entries match, for the probes below (null for non-admins, who
  -- keep the joined probe and its row level security).
  if v_pattern is not null and v_supplier is distinct from 'query' then
    v_query_items := private.library_candidate_ids('query_items', null, null, v_pattern, 5000);
  end if;
  if p_category is not null and v_supplier is distinct from 'category' then
    v_category_items := private.library_candidate_ids('category_items', null, null, p_category, 5000);
  end if;

  -- $1 venue, $2 staff, $3 type, $4 from, $5 to, $6 item, $7 variant,
  -- $8 category, $9 content type, $10 pattern, $11 cursor created_at,
  -- $12 cursor id, $13 asset ids, $14 limit, $15 items matching the query,
  -- $16 items in the category. Each fragment is a fixed string.
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

  -- The EXISTS predicates are exactly those of library_assets. OFFSET 0 keeps
  -- each one a per-asset index probe: without it the planner hashes the whole
  -- label table, because it cannot know the page will stop after a few rows.
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
        -- A label's item always belongs to the label's venue (foreign keys), so
        -- the item's active entry is in the asset's venue.
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
  if p_label_state is not null then
    if p_label_state = 'labelled' then
      if v_supplier is distinct from 'labelled' then
        v_sql := v_sql
          || ' and exists (select 1 from public.media_labels l'
          || ' where l.asset_id = a.id and l.has_labels offset 0)';
      end if;
    elsif p_label_state = 'unlabelled' then
      v_sql := v_sql
        || ' and not exists (select 1 from public.media_labels l'
        || ' where l.asset_id = a.id and l.has_labels offset 0)';
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

  v_sql := v_sql || ' order by a.created_at desc, a.id desc limit $14';

  return query execute v_sql
    using p_venue, p_staff, p_type, p_from, p_to, p_item, p_variant, p_category,
      p_content_type, v_pattern, p_after_created_at, p_after_id, v_ids, v_limit,
      v_query_items, v_category_items;
end;
$$;

comment on function public.library_page(
  uuid, uuid, public.media_type, timestamptz, timestamptz, uuid, uuid, text, text,
  text, text, timestamptz, uuid, integer, integer
) is
  'One page of the admin library (feed filters, label filters, row-value cursor). SECURITY INVOKER; the app''s read path. Same rows and order as filtering public.library_assets.';

comment on function public.library_assets(uuid, uuid, text, text, text, text) is
  'Label filters as an inlined SQL function. The app uses public.library_page instead; this is kept for compatibility and as the reference that tests compare library_page against.';

-- ---------------------------------------------------------------------------
-- Library filter options: labelled items and variants of one venue
-- ---------------------------------------------------------------------------

-- Each menu item (and variant) of the venue that has a label the caller may
-- read, with the newest label's snapshot names. One index probe per item
-- instead of reading every label of the venue. SECURITY INVOKER: RLS decides
-- which labels count. They return one jsonb array, not rows, because PostgREST
-- cuts a row set at max_rows (1,000) and a menu can hold 2,000 items.
create or replace function public.library_labelled_items(p_venue_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'item_id', r.item_id, 'item_name', r.item_name, 'section_name', r.section_name
  ) order by r.item_id), '[]'::jsonb)
  from (
    select i.id as item_id, l.item_name, l.section_name
    from public.menu_items i
    cross join lateral (
      select li.item_name, li.section_name
      from public.media_label_items li
      where li.item_id = i.id
      order by li.added_at desc, li.id desc
      limit 1
    ) l
    where i.venue_id = p_venue_id
  ) r;
$$;

create or replace function public.library_labelled_variants(p_venue_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'variant_id', r.variant_id, 'item_id', r.item_id, 'variant_name', r.variant_name
  ) order by r.variant_id), '[]'::jsonb)
  from (
    select v.id as variant_id, v.item_id, l.variant_name
    from public.menu_variants v
    cross join lateral (
      select li.variant_name
      from public.media_label_items li
      where li.variant_id = v.id
      order by li.added_at desc, li.id desc
      limit 1
    ) l
    where v.venue_id = p_venue_id
  ) r;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  public.library_page(
    uuid, uuid, public.media_type, timestamptz, timestamptz, uuid, uuid, text, text,
    text, text, timestamptz, uuid, integer, integer
  ),
  public.library_labelled_items(uuid),
  public.library_labelled_variants(uuid)
from public, anon;

grant execute on function
  public.library_page(
    uuid, uuid, public.media_type, timestamptz, timestamptz, uuid, uuid, text, text,
    text, text, timestamptz, uuid, integer, integer
  ),
  public.library_labelled_items(uuid),
  public.library_labelled_variants(uuid)
to authenticated, service_role;
