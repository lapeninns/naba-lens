-- Extend the established label and photo decision RPCs to the current venue
-- offerings shared with matching, coverage and review. A standalone special
-- can be photographed before the venue publishes its first menu.
alter table public.menu_item_photos alter column menu_version_id drop not null;

create or replace function private.save_media_labels_as(
  p_actor uuid,
  p_asset_id uuid,
  p_expected_revision integer,
  p_content_types text[],
  p_note text,
  p_items jsonb,
  p_missing_item text default null,
  p_catalogue_version_id uuid default null
)
returns table (revision integer, has_labels boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c_codes constant text[] := array['dish', 'preparation', 'plating', 'drinks', 'kitchen', 'team', 'venue', 'event'];
  c_max_items constant integer := 20;
  c_max_types constant integer := 4;
  v_uid uuid := p_actor;
  v_role public.app_role;
  v_asset public.media_assets;
  v_label public.media_labels;
  v_revision integer;
  v_types text[];
  v_note text;
  v_missing text;
  v_element jsonb;
  v_item_id uuid;
  v_variant_id uuid;
  v_requested jsonb := '[]'::jsonb;
  v_new jsonb;
  v_new_count integer;
  v_active uuid;
  v_wrong uuid[];
  v_unavailable uuid[];
  v_before jsonb;
  v_after jsonb;
  v_suggestion_before text;
  v_suggestion_after text;
  v_has boolean;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = v_uid and p.active;
  if v_uid is null or v_role is null then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if v_role not in ('staff', 'admin', 'manager') then
    raise exception 'not_active_user' using errcode = '42501';
  end if;

  -- Serialises every label save of this asset with finalise/delete. No column changes.
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found
     or v_asset.deleted_at is not null
     or v_asset.upload_state <> 'ready'
     or (v_role = 'staff' and v_asset.uploader_id <> v_uid)
     or (
       v_role = 'manager'
       and (
         v_asset.uploader_id <> v_uid
         or v_asset.uploader_role is distinct from 'manager'
         or private.effective_manager_venue_id(v_uid) is distinct from v_asset.venue_id
       )
     ) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;

  -- Input validation.
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid_revision' using errcode = '22023';
  end if;

  v_types := coalesce(p_content_types, '{}');
  if array_position(v_types, null) is not null or not (v_types <@ c_codes) then
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;
  select coalesce(array_agg(c.code order by c.ord), '{}') into v_types
  from unnest(c_codes) with ordinality as c(code, ord)
  where c.code = any(v_types);
  if cardinality(v_types) > c_max_types then
    raise exception 'invalid_content_type' using errcode = '22023',
      detail = format('At most %s content types.', c_max_types);
  end if;

  v_note := nullif(btrim(p_note), '');
  if length(v_note) > 280 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  if p_missing_item is not null then
    v_missing := btrim(p_missing_item);
    if length(v_missing) > 120 then
      raise exception 'missing_item_too_long' using errcode = '22023';
    end if;
  end if;

  if p_items is not null and jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid_label_items' using errcode = '22023';
  end if;
  for v_element in select x.value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as x(value) loop
    if jsonb_typeof(v_element) is distinct from 'object' then
      raise exception 'invalid_label_items' using errcode = '22023';
    end if;
    v_item_id := private.jsonb_uuid(v_element -> 'itemId');
    if v_item_id is null then
      raise exception 'invalid_label_items' using errcode = '22023', detail = 'itemId';
    end if;
    if coalesce(jsonb_typeof(v_element -> 'variantId'), 'null') = 'null' then
      v_variant_id := null;
    else
      v_variant_id := private.jsonb_uuid(v_element -> 'variantId');
      if v_variant_id is null then
        raise exception 'invalid_label_items' using errcode = '22023', detail = 'variantId';
      end if;
    end if;
    -- Deduplicate exact tuples.
    if not v_requested @> jsonb_build_array(jsonb_build_object('itemId', v_item_id, 'variantId', v_variant_id)) then
      v_requested := v_requested || jsonb_build_array(jsonb_build_object('itemId', v_item_id, 'variantId', v_variant_id));
    end if;
  end loop;
  if jsonb_array_length(v_requested) > c_max_items then
    raise exception 'invalid_label_items' using errcode = '22023',
      detail = format('At most %s menu items per asset.', c_max_items);
  end if;

  -- Revision compare-and-set. A missing row is revision 0; the asset lock above
  -- makes a concurrent first save see the row and fail here, not on a unique key.
  select l.* into v_label from public.media_labels l where l.asset_id = p_asset_id for update;
  v_revision := coalesce(v_label.revision, 0);
  if p_expected_revision <> v_revision then
    raise exception 'label_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;

  -- Lock order for every label save: asset row (above), label row, then the
  -- venue menu lock SHARED, then the caller's open suggestion row. Activation
  -- and suggestion resolution take the venue lock exclusively, so neither can
  -- change the active version or this suggestion until the save commits
  -- (final review I-1: a resolve between read and update lost the edit).
  perform private.lock_venue_menu(v_asset.venue_id, true);

  select s.suggested_name into v_suggestion_before
  from public.menu_item_suggestions s
  where s.asset_id = p_asset_id and s.created_by = v_uid and s.status = 'open'
  for update;

  v_before := jsonb_build_object(
    'revision', v_revision,
    'contentTypes', to_jsonb(coalesce(v_label.content_types, '{}')),
    'note', v_label.note,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('itemId', li.item_id, 'variantId', li.variant_id)
        order by li.added_at, li.id)
      from public.media_label_items li where li.asset_id = p_asset_id), '[]'::jsonb),
    'missingItem', v_suggestion_before);

  -- New tuples: requested but not already on the asset (exact match, A1.7).
  select coalesce(jsonb_agg(r.value), '[]'::jsonb) into v_new
  from jsonb_array_elements(v_requested) as r(value)
  where not exists (
    select 1 from public.media_label_items li
    where li.asset_id = p_asset_id
      and li.item_id = (r.value ->> 'itemId')::uuid
      and li.variant_id is not distinct from (r.value ->> 'variantId')::uuid
  );
  v_new_count := jsonb_array_length(v_new);

  if v_new_count > 0 then
    v_active := private.active_menu_version_id(v_asset.venue_id);

    if p_catalogue_version_id is distinct from v_active then
      raise exception 'menu_catalogue_conflict' using errcode = '40001',
        detail = jsonb_build_object('activeVersionId', v_active)::text;
    end if;

    -- Items of another venue are a forged request, not a stale catalogue.
    select array_agg(distinct i.id) into v_wrong
    from jsonb_array_elements(v_new) as n(value)
    join public.menu_items i on i.id = (n.value ->> 'itemId')::uuid
    where i.venue_id <> v_asset.venue_id;
    if v_wrong is not null then
      raise exception 'menu_item_wrong_venue' using errcode = '22023',
        detail = to_jsonb(v_wrong)::text;
    end if;

    -- New tuples must name a current offering and an offered variant, if any.
    select array_agg(distinct (n.value ->> 'itemId')::uuid) into v_unavailable
    from jsonb_array_elements(v_new) as n(value)
    where not exists (
      select 1
      from private.current_photo_menu_items(v_asset.venue_id) e
      where e.item_id = (n.value ->> 'itemId')::uuid
        and (
          n.value ->> 'variantId' is null
          or exists (
            select 1 from public.menu_entry_variants ev
            where ev.entry_id = e.entry_id and ev.variant_id = (n.value ->> 'variantId')::uuid
          )
        )
    );
    if v_unavailable is not null then
      raise exception 'menu_item_unavailable' using errcode = 'P0001',
        detail = to_jsonb(v_unavailable)::text;
    end if;
  end if;

  v_has := jsonb_array_length(v_requested) > 0 or cardinality(v_types) > 0;

  if v_label.asset_id is null then
    insert into public.media_labels as l (asset_id, venue_id, content_types, note, has_labels, revision, updated_by)
    values (p_asset_id, v_asset.venue_id, v_types, v_note, v_has, 1, v_uid);
  else
    update public.media_labels l
    set content_types = v_types, note = v_note, has_labels = v_has,
        revision = l.revision + 1, updated_by = v_uid
    where l.asset_id = p_asset_id;
  end if;

  -- Removed tuples.
  delete from public.media_label_items li
  where li.asset_id = p_asset_id
    and not exists (
      select 1 from jsonb_array_elements(v_requested) as r(value)
      where (r.value ->> 'itemId')::uuid = li.item_id
        and (r.value ->> 'variantId')::uuid is not distinct from li.variant_id
    );

  -- New tuples record the name and section shown to the labeller.
  if v_new_count > 0 then
    insert into public.media_label_items (
      asset_id, venue_id, item_id, variant_id, item_name, variant_name,
      section_name, section_slug, version_id, added_by
    )
    select p_asset_id, v_asset.venue_id, e.item_id, ev.variant_id, e.name, ev.name,
      e.section_name, e.section_slug, v_active, v_uid
    from jsonb_array_elements(v_new) with ordinality as n(value, ordinality)
    join private.current_photo_menu_items(v_asset.venue_id) e on e.item_id = (n.value ->> 'itemId')::uuid
    left join public.menu_entry_variants ev
      on ev.entry_id = e.entry_id and ev.variant_id = (n.value ->> 'variantId')::uuid
    order by n.ordinality;
  end if;

  -- Missing-item suggestion: null = unchanged, '' = withdraw, text = upsert own open one.
  v_suggestion_after := v_suggestion_before;
  if v_missing is not null then
    if v_missing = '' then
      update public.menu_item_suggestions s
      set status = 'withdrawn'
      where s.asset_id = p_asset_id and s.created_by = v_uid and s.status = 'open';
      v_suggestion_after := null;
    elsif v_suggestion_before is not null then
      update public.menu_item_suggestions s
      set suggested_name = v_missing
      where s.asset_id = p_asset_id and s.created_by = v_uid and s.status = 'open';
      v_suggestion_after := v_missing;
    else
      insert into public.menu_item_suggestions (venue_id, asset_id, suggested_name, created_by)
      values (v_asset.venue_id, p_asset_id, v_missing, v_uid);
      v_suggestion_after := v_missing;
    end if;
  end if;

  v_after := jsonb_build_object(
    'revision', v_revision + 1,
    'contentTypes', to_jsonb(v_types),
    'note', v_note,
    'items', v_requested,
    'missingItem', v_suggestion_after,
    'catalogueVersionId', v_active);

  insert into public.media_label_events (asset_id, venue_id, actor_id, actor_role, action, before, after)
  values (p_asset_id, v_asset.venue_id, v_uid, v_role, 'labels_saved', v_before, v_after);

  -- The uploader's successful save settles their stored upload draft. Anyone
  -- else's (an admin's) leaves it for the uploader to fix or discard.
  delete from public.media_pending_labels pl
  where pl.asset_id = p_asset_id and pl.uploader_id = v_uid;

  return query select v_revision + 1, v_has;
end;
$$;

create or replace function public.review_menu_item_photo(
  p_asset_id uuid,
  p_item_id uuid,
  p_variant_id uuid,
  p_decision text,
  p_expected_revision integer,
  p_reason text default null,
  p_make_primary boolean default false,
  p_client_request_key text default null
)
returns table (
  photo_id uuid,
  item_id uuid,
  state text,
  is_primary boolean,
  item_revision integer,
  self_review boolean,
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
  v_label_at timestamptz;
  v_head integer;
  v_live public.menu_item_photos;
  v_reason text;
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
      -- A replay answers only someone still in scope, and only the same decision.
      if not private.can_manage_venue(v_event.venue_id) then
        raise exception 'media_asset_not_found' using errcode = 'P0002';
      end if;
      if v_event.asset_id is distinct from p_asset_id or v_event.item_id is distinct from p_item_id
         or v_event.variant_id is distinct from p_variant_id
         or v_event.action is distinct from p_decision
         -- An assign_menu_item_photo key is never a review.
         or v_event.detail ? 'op' then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
      photo_id := v_event.photo_id;
      item_id := v_event.item_id;
      state := v_event.to_state;
      is_primary := coalesce((v_event.detail ->> 'isPrimary')::boolean, false);
      item_revision := v_event.item_revision;
      self_review := v_event.self_review;
      replayed := true;
      return next;
      return;
    end if;
  end if;

  if p_decision is null or p_decision not in ('accepted', 'better_photo_requested') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if p_decision = 'better_photo_requested' then
    v_reason := private.require_reason(p_reason);
  else
    v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
  end if;

  -- Lock order: asset row, shared venue menu lock, item head.
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found or not private.can_manage_venue(v_asset.venue_id) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  -- A manager account never decides on its own photo. Reviewers decide on
  -- active staff and manager accounts' photos; admins also on leavers'.
  if private.menu_photo_self_blocked(v_asset.uploader_id) then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  if not private.menu_photo_reviewable_uploader(v_asset.uploader_id, private.is_active_admin()) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_venue_menu(v_asset.venue_id, true);

  -- The asset's venue currently offers this food or drinks item and variant.
  v_active := private.active_menu_version_id(v_asset.venue_id);
  select e.canonical_name, e.section_name, e.section_kind, ev.name
  into v_entry_name, v_section_name, v_section_kind, v_variant_name
  from private.current_photo_menu_items(v_asset.venue_id) e
  left join public.menu_entry_variants ev on ev.entry_id = e.entry_id and ev.variant_id = p_variant_id
  where e.item_id = p_item_id and e.section_kind in ('food', 'drinks')
    and (p_variant_id is null or ev.variant_id is not null);
  if not found then
    raise exception 'menu_item_unavailable' using errcode = 'P0001';
  end if;
  select li.added_at into v_label_at from public.media_label_items li
  where li.asset_id = p_asset_id and li.item_id = p_item_id
    and li.variant_id is not distinct from p_variant_id;
  if not found then
    raise exception 'menu_item_not_labelled' using errcode = 'P0001';
  end if;
  -- A reviewer moved this label to another item; withdraw that decision first.
  if private.menu_photo_tuple_relinked(p_asset_id, p_item_id, p_variant_id, v_label_at) then
    raise exception 'menu_item_relinked' using errcode = 'P0001';
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

  v_head := private.lock_item_photo_head(p_item_id, v_asset.venue_id);
  if p_expected_revision is distinct from v_head then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_head)::text;
  end if;

  select p.* into v_live from public.menu_item_photos p
  where p.asset_id = p_asset_id and p.item_id = p_item_id
    and p.variant_id is not distinct from p_variant_id
    and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
  for update;
  if found and v_live.state = p_decision then
    photo_id := v_live.id;
    item_id := v_live.item_id;
    state := v_live.state;
    is_primary := v_live.is_primary;
    item_revision := v_head;
    self_review := v_live.self_review;
    replayed := true;
    return next;
    return;
  end if;
  if found and v_live.state = 'accepted' then
    raise exception 'invalid_transition' using errcode = 'P0001',
      detail = format('%s -> %s', v_live.state, p_decision);
  end if;

  v_self := v_uid = v_asset.uploader_id;
  v_role := private.coverage_actor_role(v_asset.venue_id);
  perform private.bump_item_photo_heads(array[p_item_id], v_asset.venue_id);
  v_head := v_head + 1;

  if p_decision = 'accepted' then
    v_primary := coalesce(p_make_primary, false)
      or private.menu_item_effective_primary(p_item_id) is null;
    if v_primary then
      perform private.clear_item_primary(p_item_id, null, v_role);
    end if;
  end if;

  if v_live.id is null then
    insert into public.menu_item_photos as p (
      venue_id, item_id, variant_id, asset_id, author_id, state, is_primary, reason,
      item_name, variant_name, section_name, section_kind, menu_version_id,
      decided_by, self_review
    )
    values (
      v_asset.venue_id, p_item_id, p_variant_id, p_asset_id, v_asset.uploader_id, p_decision, v_primary,
      v_reason, v_entry_name, v_variant_name, v_section_name, v_section_kind, v_active, v_uid, v_self
    )
    returning p.id into v_photo;
  else
    update public.menu_item_photos p
    set state = p_decision, reason = v_reason, recheck_kind = null, is_primary = v_primary,
        item_name = v_entry_name, variant_name = v_variant_name, section_name = v_section_name,
        section_kind = v_section_kind, menu_version_id = v_active,
        decided_by = v_uid, decided_at = now(), self_review = v_self, revision = p.revision + 1
    where p.id = v_live.id
    returning p.id into v_photo;
  end if;
  perform private.record_item_photo_event(v_photo, p_decision, v_live.state, v_reason, v_self,
    p_client_request_key, v_role, jsonb_build_object('isPrimary', v_primary));
  if p_decision = 'accepted' and not v_primary then
    -- A flagged primary whose photo was deleted gives way to the earliest eligible one.
    perform private.promote_item_primary(p_item_id, v_role);
  end if;

  photo_id := v_photo;
  item_id := p_item_id;
  state := p_decision;
  is_primary := v_primary;
  item_revision := v_head;
  self_review := v_self;
  replayed := false;
  return next;
end;
$$;

create or replace function public.menu_item_photo_candidates(
  p_venue_id uuid default null,
  p_item_id uuid default null,
  p_include_reviewed boolean default false,
  p_after_created_at timestamptz default null,
  p_after_label_id uuid default null,
  p_limit integer default 25
)
returns table (
  label_id uuid,
  asset_id uuid,
  venue_id uuid,
  item_id uuid,
  variant_id uuid,
  item_name text,
  variant_name text,
  section_name text,
  uploader_id uuid,
  uploader_name text,
  uploader_active boolean,
  is_self boolean,
  photo_id uuid,
  photo_state text,
  is_primary boolean,
  item_revision integer,
  has_thumbnail boolean,
  has_preview boolean,
  width integer,
  height integer,
  created_at timestamptz,
  labelled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_admin boolean := private.is_active_admin();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 101);
begin
  perform private.assert_can_manage_venue(v_venue);
  return query
  select li.id, a.id, a.venue_id, li.item_id, li.variant_id, e.name, ev.name, e.section_name,
    a.uploader_id, up.display_name, up.active and up.role in ('staff', 'manager'), a.uploader_id = v_uid,
    lp.id, lp.state, coalesce(lp.is_primary, false), coalesce(h.revision, 1),
    a.thumbnail_path is not null, a.preview_path is not null, a.width, a.height,
    a.created_at, li.added_at
  from public.media_label_items li
  join public.media_assets a on a.id = li.asset_id
  join public.profiles up on up.id = a.uploader_id
  join private.current_photo_menu_items(v_venue) e
    on e.item_id = li.item_id and e.section_kind in ('food', 'drinks')
  left join public.menu_entry_variants ev on ev.entry_id = e.entry_id and ev.variant_id = li.variant_id
  left join public.menu_item_photo_heads h on h.item_id = li.item_id
  left join lateral (
    select p.id, p.state, p.is_primary from public.menu_item_photos p
    where p.asset_id = li.asset_id and p.item_id = li.item_id
      and p.variant_id is not distinct from li.variant_id
      and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
  ) lp on true
  -- A withdrawal since the label was (re)saved: the tuple is decided, so it
  -- stays out of the waiting queue (still listed with p_include_reviewed).
  left join lateral (
    select p.withdrawn_at from public.menu_item_photos p
    where p.asset_id = li.asset_id and p.item_id = li.item_id
      and p.variant_id is not distinct from li.variant_id
      and p.state = 'withdrawn' and p.withdrawn_at >= li.added_at
    order by p.withdrawn_at desc
    limit 1
  ) wd on true
  where li.venue_id = v_venue
    and (p_item_id is null or li.item_id = p_item_id)
    -- A variant no longer offered stays listed while its row awaits a recheck,
    -- with a null variant_name: reviewers can withdraw it (review rejects it).
    and (li.variant_id is null or ev.variant_id is not null or lp.state = 'needs_recheck')
    and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
    and private.menu_photo_reviewable_uploader(a.uploader_id, v_admin)
    and (coalesce(p_include_reviewed, false) or lp.state = 'needs_recheck'
      or (lp.id is null and wd.withdrawn_at is null))
    and (coalesce(p_include_reviewed, false)
      or not private.menu_photo_tuple_relinked(li.asset_id, li.item_id, li.variant_id, li.added_at))
    and (p_after_created_at is null or p_after_label_id is null
      or (a.created_at, li.id) > (p_after_created_at, p_after_label_id))
  order by a.created_at, li.id
  limit v_limit;
end;
$$;

create or replace function public.media_label_details(p_asset_ids uuid[])
returns table (
  asset_id uuid,
  item_id uuid,
  variant_id uuid,
  name text,
  variant_name text,
  section_name text,
  section_slug text,
  snapshot_name text,
  snapshot_variant_name text,
  snapshot_section_name text,
  state text,
  added_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if cardinality(p_asset_ids) > 100 then
    raise exception 'too_many_assets' using errcode = '22023';
  end if;

  return query
    with labels as materialized (
      select li.*
      from (select distinct u.id from unnest(coalesce(p_asset_ids, '{}')) as u(id)) ids
      join public.media_label_items li on li.asset_id = ids.id
      where private.can_read_asset_labels(li.asset_id)
    ), live_items as (
      select v.venue_id, m.*
      from (select distinct l.venue_id from labels l) v
      cross join lateral private.current_photo_menu_items(v.venue_id) m
    )
    select
      li.asset_id,
      li.item_id,
      li.variant_id,
      coalesce(live.name, cur.name, li.item_name),
      coalesce(curv.name, li.variant_name),
      coalesce(live.section_name, cur.section_name, li.section_name),
      coalesce(live.section_slug, cur.section_slug, li.section_slug),
      li.item_name,
      li.variant_name,
      li.section_name,
      coalesce(
        (select 'archived'::text where i.archived_at is not null),
        (select 'current'::text where live.item_id is not null and (li.variant_id is null or curv.is_active)),
        'not_on_active_menu'
      ),
      li.added_at
    from labels li
    join public.menu_items i on i.id = li.item_id
    left join live_items live on live.venue_id = li.venue_id and live.item_id = li.item_id
    left join lateral (
      select e.name, s.name as section_name, s.slug as section_slug, v.status = 'active' as is_active
      from public.menu_entries e
      join public.menu_versions v on v.id = e.version_id
      join public.menu_sections s on s.id = e.section_id
      where e.item_id = li.item_id
        and v.venue_id = li.venue_id
        and v.status in ('active', 'retired')
        and v.activated_at is not null
      order by v.status = 'active' desc, v.activated_at desc
      limit 1
    ) cur on true
    left join lateral (
      select ev.name, v.status = 'active' as is_active
      from public.menu_entry_variants ev
      join public.menu_entries e on e.id = ev.entry_id
      join public.menu_versions v on v.id = e.version_id
      where ev.variant_id = li.variant_id
        and v.venue_id = li.venue_id
        and v.status in ('active', 'retired')
        and v.activated_at is not null
      order by v.status = 'active' desc, v.activated_at desc
      limit 1
    ) curv on li.variant_id is not null
    order by li.asset_id, li.added_at, li.id;
end;
$$;

create or replace function public.menu_item_photo_asset(p_asset_id uuid)
returns table (
  asset_id uuid,
  venue_id uuid,
  uploader_id uuid,
  media_type public.media_type,
  validated_mime_type text,
  has_preview boolean,
  has_thumbnail boolean,
  width integer,
  height integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.venue_id, a.uploader_id, a.media_type, a.validated_mime_type,
    a.preview_path is not null, a.thumbnail_path is not null, a.width, a.height
  from public.media_assets a
  where a.id = p_asset_id
    and a.upload_state = 'ready'
    and a.deleted_at is null
    and private.is_active_user()
    and (
      (
        private.can_manage_venue(a.venue_id)
        and (
          exists (select 1 from public.media_label_items li where li.asset_id = a.id)
          or exists (select 1 from public.menu_item_photos p where p.asset_id = a.id)
          -- Q1 unlabelled
          or private.menu_photo_unlabelled_eligible(a.id, a.venue_id)
        )
      )
      or (
        a.venue_id = private.active_staff_venue_id()
        and exists (
          select 1
          from public.menu_item_photos p
          join private.current_photo_menu_items(a.venue_id) e on e.item_id = p.item_id
          where p.asset_id = a.id and p.state = 'accepted'
            and private.menu_item_effective_primary(p.item_id) = p.id
        )
      )
      or (
        a.uploader_id = (select auth.uid())
        and exists (select 1 from public.menu_item_photos p where p.asset_id = a.id)
      )
      -- Admin oversight (self-review audit) keeps the photo after its label goes.
      or (
        private.is_active_admin()
        and exists (select 1 from public.menu_item_photos p where p.asset_id = a.id)
      )
    );
$$;

-- Keep pending special labels visible in the uploader's own photo history.
create or replace function private.feed_photo_json(p_asset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'assetId', a.id,
    'venueId', a.venue_id,
    'venueName', v.name,
    'mediaType', a.media_type,
    'uploadState', a.upload_state,
    'uploaderRole', a.uploader_role,
    'sentAt', a.created_at,
    'labels', jsonb_build_object(
      'hasLabels', coalesce(l.has_labels, false),
      'needsLabels', private.asset_needs_labels(a.id),
      'needsAttention', exists (
        select 1 from public.media_pending_labels pl
        where pl.asset_id = a.id and pl.status = 'needs_attention'
      )
    ),
    'menuDecisions', coalesce((
      select jsonb_agg(d.row order by d.waiting, d.decided_at desc, d.photo_id desc, d.item_name, d.label_id)
      from (
        select jsonb_build_object(
            'photoId', m.id, 'itemId', m.item_id, 'itemName', coalesce(n.display_name, m.item_name),
            'variantName', m.variant_name, 'state', m.state, 'reason', m.reason,
            'decidedAt', m.decided_at) as row,
          false as waiting, m.decided_at, m.id as photo_id, null::text as item_name, null::uuid as label_id
        from public.menu_item_photos m
        left join public.menu_item_display_names n on n.item_id = m.item_id and n.venue_id = a.venue_id
        where m.asset_id = a.id and m.state not in ('withdrawn', 'invalidated')
        union all
        select jsonb_build_object(
            'photoId', null, 'itemId', t.item_id, 'itemName', coalesce(n.display_name, e.name, sp.name, li.item_name),
            'variantName', coalesce(ev.name, li.variant_name), 'state', 'waiting',
            'reason', null, 'decidedAt', null),
          true, null::timestamptz, null::uuid, coalesce(n.display_name, e.name, sp.name, li.item_name), t.label_id
        from private.menu_photo_pending_tuples(a.venue_id, false, true) t
        join public.media_label_items li on li.id = t.label_id
        left join public.menu_entries e on e.id = t.entry_id
        left join public.menu_specials sp on sp.item_id = t.item_id and sp.venue_id = a.venue_id
        left join public.menu_item_display_names n on n.item_id = t.item_id and n.venue_id = a.venue_id
        left join public.menu_entry_variants ev on ev.entry_id = t.entry_id and ev.variant_id = t.variant_id
        where t.asset_id = a.id and t.live_photo_id is null
      ) d
    ), '[]'::jsonb),
    'menuUseAccepted', exists (
      select 1 from public.menu_item_photos m where m.asset_id = a.id and m.state = 'accepted'
    ),
    -- B05-02e: the uploader's view (no granter, period or note).
    'use', private.media_asset_use_summary(a.id, 'uploader')
  )
  from public.media_assets a
  join public.venues v on v.id = a.venue_id
  left join public.media_labels l on l.asset_id = a.id
  where a.id = p_asset_id;
$$;
