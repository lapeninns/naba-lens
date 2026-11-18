-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-INT part 5: accepted amenity photos are retained, and a
-- published photo cannot be removed (Sprint 1 review R2, R22; spec §3.3, §16;
-- FA-21, FA-32).
--
--   Accepted   private.asset_is_accepted also reads the photo's own amenity
--              review (S1-COV amenity_photo_decisions): its latest decision
--              for a check is accepted, at either level. So the uploader can
--              no longer withdraw an amenity photo a manager accepted (it is
--              retained; removal is requested instead), and colleagues see it
--              as they see other accepted photos (FA-20).
--   Impact     private.media_removal_impact_of adds amenityPhotos (accepted
--              amenity reviews), primaryChoices (slots whose current primary
--              it is) and publications (destinations where it is recorded as
--              published, or published with the withdrawal still pending).
--   Removal    public.admin_delete_media_asset refuses with
--              media_asset_published while publications > 0, as it already
--              did for public use grants; public.media_removal_impact reports
--              blocked for either.
--
-- Rollback: re-apply private.asset_is_accepted (20261118107000) and
-- private.media_removal_impact_of, public.media_removal_impact and
-- public.admin_delete_media_asset (20261118107100).

create or replace function private.asset_is_accepted(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.menu_item_photos m
      where m.asset_id = p_asset_id and m.state in ('accepted', 'needs_recheck')
    )
    or exists (
      select 1 from public.coverage_submission_items ci
      where ci.asset_id = p_asset_id and ci.state = 'accepted'
    )
    or exists (
      select 1 from public.media_area_labels l
      where l.asset_id = p_asset_id
        and l.removed_at is null
        and (select d.action from public.area_photo_decisions d
              where d.label_id = l.id order by d.id desc limit 1) = 'accepted'
    )
    or exists (
      select 1 from public.venue_amenity_fact_media fm where fm.asset_id = p_asset_id
    )
    or exists (
      select 1
      from public.amenity_submission_assets sa
      join public.knowledge_decisions d on d.submission_id = sa.submission_id
      where sa.asset_id = p_asset_id
        and d.decision in ('confirmed', 'reaffirmed')
        and d.decider_basis in ('venue_manager', 'admin')
    )
    or exists (
      select 1
      from public.knowledge_contribution_assets ka
      join public.knowledge_decisions d on d.contribution_id = ka.contribution_id
      where ka.asset_id = p_asset_id
        and d.decision in ('confirmed', 'reaffirmed')
        and d.decider_basis in ('venue_manager', 'admin')
    )
    -- S2-INT (R2): the photo's own amenity review, at its latest decision.
    or exists (
      select 1 from public.amenity_photo_decisions d
      where d.asset_id = p_asset_id and d.action = 'accepted'
        and d.id = (select max(x.id) from public.amenity_photo_decisions x
          where x.check_id = d.check_id and x.asset_id = d.asset_id)
    );
$$;

create or replace function private.media_removal_impact_of(p_asset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'assetId', a.id,
    'venueId', a.venue_id,
    'uploaderId', a.uploader_id,
    'removed', a.deleted_at is not null,
    'accepted', private.asset_is_accepted(a.id),
    'menuItems', coalesce((
      select jsonb_agg(jsonb_build_object(
          'itemId', m.item_id, 'name', m.item_name, 'state', m.state, 'isPrimary', m.is_primary)
        order by m.item_name, m.item_id)
      from public.menu_item_photos m
      where m.asset_id = a.id and m.state in ('accepted', 'better_photo_requested', 'needs_recheck')
    ), '[]'::jsonb),
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object(
          'subjectId', l.subject_id, 'label', l.subject_label,
          'state', coalesce((select d.action from public.area_photo_decisions d
                              where d.label_id = l.id order by d.id desc limit 1), 'waiting'))
        order by l.subject_label, l.subject_id)
      from public.media_area_labels l
      where l.asset_id = a.id and l.removed_at is null
    ), '[]'::jsonb),
    'coverageSends', (
      select count(*) from public.coverage_submission_items ci
      where ci.asset_id = a.id and ci.state in ('submitted', 'accepted')
    ),
    'amenityAnswers', (
      select count(distinct c.id)
      from public.venue_amenity_checks c
      join public.amenity_submission_assets sa on sa.submission_id = c.current_submission_id
      where sa.asset_id = a.id
    ),
    'publicUses', (
      select count(*) from public.media_use_grants g
      where g.asset_id = a.id and g.audience = 'public'
        and not exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = g.id)
        and (g.effective_until is null or g.effective_until > now())
    ),
    'internalUses', (
      select count(*) from public.media_use_grants g
      where g.asset_id = a.id and g.audience = 'internal'
        and not exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = g.id)
        and (g.effective_until is null or g.effective_until > now())
    ),
    'openRequests', (
      select count(*) from public.media_removal_requests r
      where r.asset_id = a.id and r.state = 'open'
    ),
    -- S2-INT (review R2): the photo's own amenity reviews, at their latest.
    'amenityPhotos', (
      select count(*) from public.amenity_photo_decisions d
      where d.asset_id = a.id
        and d.id = (select max(x.id) from public.amenity_photo_decisions x
          where x.check_id = d.check_id and x.asset_id = d.asset_id)
        and d.action = 'accepted'
    ),
    -- Area and amenity slots whose latest primary choice is this photo.
    'primaryChoices', (
      select count(*) from public.slot_primary_choices ch
      where ch.asset_id = a.id
        and ch.id = (select max(y.id) from public.slot_primary_choices y
          where y.slot_kind = ch.slot_kind and y.slot_id = ch.slot_id and y.use = ch.use)
    ),
    -- S2-INT (review R22): destinations where it is recorded as published,
    -- or published with a withdrawal not yet confirmed.
    'publications', (
      select count(*) from private.publication_pairs(array[a.venue_id]) pp
      where pp.asset_id = a.id
        and (pp.state = 'published_confirmed'
          or (pp.state = 'withdrawal_pending' and pp.latest_action = 'published'))
    )
  )
  from public.media_assets a
  where a.id = p_asset_id;
$$;

create or replace function public.admin_delete_media_asset(p_asset_id uuid, p_reason text, p_impact_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_venue uuid;
  v_deleted timestamptz;
  v_impact jsonb;
  v_closed uuid[];
begin
  if not private.is_active_admin() then
    raise exception 'not_permitted' using errcode = '42501';
  end if;
  select a.venue_id, a.deleted_at into v_venue, v_deleted
  from public.media_assets a where a.id = p_asset_id for update;
  if v_venue is null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'reason_required' using errcode = '22023',
      detail = 'A reason of 3 to 500 characters.';
  end if;
  if v_deleted is not null then
    return jsonb_build_object('assetId', p_asset_id, 'removed', true, 'closedRequests', '[]'::jsonb);
  end if;
  v_impact := private.media_removal_impact_of(p_asset_id);
  if p_impact_token is distinct from md5(v_impact::text) then
    raise exception 'impact_changed' using errcode = '40001',
      detail = 'What this removal touches has changed. Check the preview again.';
  end if;
  if (v_impact ->> 'publicUses')::bigint > 0 then
    raise exception 'media_asset_published' using errcode = 'P0001',
      detail = 'Withdraw its public uses first.';
  end if;
  -- S2-INT (review R22): never while a destination shows it.
  if (v_impact ->> 'publications')::bigint > 0 then
    raise exception 'media_asset_published' using errcode = 'P0001',
      detail = 'Record its withdrawal from every destination first.';
  end if;

  update public.media_assets set deleted_at = now() where id = p_asset_id;

  with closed as (
    update public.media_removal_requests r
    set state = 'completed', decided_by = v_uid, decided_at = now(), decision_reason = v_reason
    where r.asset_id = p_asset_id and r.state = 'open'
    returning r.id
  )
  select coalesce(array_agg(id), '{}') into v_closed from closed;

  insert into public.media_removal_events (asset_id, venue_id, request_id, actor_id, action, reason, impact)
  select p_asset_id, v_venue, rid, v_uid, 'removed', v_reason, v_impact
  from unnest(case when cardinality(v_closed) = 0 then array[null::uuid] else v_closed end) as rid;

  return jsonb_build_object('assetId', p_asset_id, 'removed', true,
    'closedRequests', to_jsonb(v_closed));
end;
$$;
create or replace function public.media_removal_impact(p_asset_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
  v_impact jsonb;
begin
  if not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select a.venue_id into v_venue from public.media_assets a where a.id = p_asset_id;
  if v_venue is null or not private.can_manage_venue(v_venue) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  v_impact := private.media_removal_impact_of(p_asset_id);
  return v_impact || jsonb_build_object(
    'blocked', (v_impact ->> 'publicUses')::bigint > 0 or (v_impact ->> 'publications')::bigint > 0,
    'token', md5(v_impact::text));
end;
$$;

revoke all on function private.media_removal_impact_of(uuid) from public, anon, authenticated, service_role;
