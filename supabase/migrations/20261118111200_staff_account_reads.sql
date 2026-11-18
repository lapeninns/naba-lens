-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-STAFF (spec §6 S4 "Your month", §6 S5 "contact-manager
-- route"; FA-34, AC39): two small reads for Me.
--
--   public.my_venue_managers()
--     Who manages the caller's current venue: display name and job title of
--     each person whose role there is manager (private.venue_role_of), so
--     staff know whom to ask. Staff, managers and admins with a current
--     venue; nothing about another venue, and no contact detail the profile
--     does not already show to colleagues.
--
--   public.my_month_replacements(p_month)
--     The caller's own month in the spec's two figures: slots their photo
--     now covers for public use (accepted for public use in the month), and
--     of those, the ones where it replaced an outdated photo (the slot had
--     an earlier accepted photo by anyone, or a retake or recheck was asked
--     for). Europe/London months. Personal only: no colleague figures and no
--     ranking (FA-34, DESIGN.md §9).
--
-- Rollback: drop the two functions.

create function public.my_venue_managers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  v_venue := (select p.venue_id from public.profiles p where p.id = v_uid);
  if v_venue is null or private.venue_role_of(v_uid, v_venue) is null then
    return jsonb_build_object('venueId', null, 'items', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'venueId', v_venue,
    'venueName', (select v.name from public.venues v where v.id = v_venue),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id, 'displayName', p.display_name, 'jobTitle', p.job_title,
          'isYou', p.id = v_uid)
        order by p.display_name, p.id)
      from public.profiles p
      where p.active
        and exists (
          select 1 from public.venue_memberships m
          where m.profile_id = p.id and m.venue_id = v_venue
            and m.ended_at is null and m.role = 'manager')
        and private.venue_role_of(p.id, v_venue) = 'manager'
    ), '[]'::jsonb));
end;
$$;

create function public.my_month_replacements(p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_month date := date_trunc('month', coalesce(p_month, (now() at time zone 'Europe/London')::date))::date;
  v_from timestamptz := (v_month::timestamp at time zone 'Europe/London');
  v_to timestamptz := ((v_month + interval '1 month')::timestamp at time zone 'Europe/London');
  v_covered integer;
  v_replaced integer;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;

  with mine as (
    -- Dish photos of mine accepted for public use in the month.
    select 'dish'::text as kind, p.item_id as slot_id, p.decided_at,
      exists (
        select 1 from public.menu_item_photos o
        where o.item_id = p.item_id and o.id <> p.id and o.created_at < p.created_at
          and (o.state in ('accepted', 'needs_recheck', 'better_photo_requested', 'invalidated')
               or o.decided_at < p.decided_at)
      ) as replaced
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where a.uploader_id = v_uid and a.deleted_at is null
      and p.state = 'accepted' and coalesce(p.review_level, 'public') = 'public'
      and p.decided_at >= v_from and p.decided_at < v_to
    union all
    -- Place photos of mine accepted for public use in the month.
    select 'area', l.subject_id, d.decided_at,
      exists (
        select 1 from public.media_area_labels o
        join public.area_photo_decisions od on od.label_id = o.id
        where o.subject_id = l.subject_id and o.id <> l.id and od.decided_at < d.decided_at
          and od.action in ('accepted', 'needs_another_photo')
      )
    from public.media_area_labels l
    join public.media_assets a on a.id = l.asset_id
    join lateral (
      select x.action, x.review_level, x.decided_at from public.area_photo_decisions x
      where x.label_id = l.id order by x.id desc limit 1
    ) d on true
    where a.uploader_id = v_uid and a.deleted_at is null and l.removed_at is null
      and d.action = 'accepted' and coalesce(d.review_level, 'public') = 'public'
      and d.decided_at >= v_from and d.decided_at < v_to
    union all
    -- Amenity photos of mine accepted for public use in the month.
    select 'amenity', d.check_id, d.decided_at,
      exists (
        select 1 from public.amenity_photo_decisions o
        where o.check_id = d.check_id and o.asset_id <> d.asset_id and o.decided_at < d.decided_at
          and o.action in ('accepted', 'needs_another_photo')
      )
    from public.amenity_photo_decisions d
    join public.media_assets a on a.id = d.asset_id
    where a.uploader_id = v_uid and a.deleted_at is null
      and d.action = 'accepted' and coalesce(d.review_level, 'public') = 'public'
      and d.decided_at >= v_from and d.decided_at < v_to
      and d.id = (select max(x.id) from public.amenity_photo_decisions x
                  where x.check_id = d.check_id and x.asset_id = d.asset_id)
  )
  select count(distinct (kind, slot_id))::integer,
    count(distinct (kind, slot_id)) filter (where replaced)::integer
  into v_covered, v_replaced
  from mine;

  return jsonb_build_object('month', v_month, 'covered', v_covered, 'replaced', v_replaced);
end;
$$;

revoke all on function public.my_venue_managers() from public, anon, service_role;
revoke all on function public.my_month_replacements(date) from public, anon, service_role;
grant execute on function public.my_venue_managers() to authenticated;
grant execute on function public.my_month_replacements(date) to authenticated;
