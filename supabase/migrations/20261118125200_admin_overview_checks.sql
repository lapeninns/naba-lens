-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, Sprint 3 repair S3-R6 (review V20; spec §8 A1 "every number
-- links to its underlying records"; AC39).
--
-- Checks due counted a facility twice when its fact was due (once as a
-- Check due slot, because a facility slot is due whenever its fact is not
-- confirmed, and once as a fact), and its one link went to the facilities
-- page, which lists no dish or place rechecks. private.admin_overview_row
-- now counts each subject once and returns the parts (dishes, places,
-- facilities, facts) so each can link to the page that lists it. Body as in
-- 20261118115100 otherwise; 'slots' stays (the three photo parts).
--
-- Rollback: restore the 20261118115100 body.

create or replace function private.admin_overview_row(
  p_venue public.venues, p_menu text, p_from date, p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cov jsonb := private.coverage_slots_json(p_venue.id);
  v_categories jsonb := v_cov -> 'categories';
  v_next_id uuid;
  v_next_title text;
  v_next_at timestamptz;
  v_facts record;
  v_review record;
  v_unlabelled integer;
  v_added integer;
  v_publication record;
  v_check_due_slots integer;
  v_check_dishes integer;
  v_check_places integer;
  v_check_facilities integer;
begin
  -- Next scheduled menu (AC27): its dishes replace the current menu's counts.
  if p_menu = 'next' then
    select m.id, m.title, m.scheduled_for into v_next_id, v_next_title, v_next_at
    from public.menu_versions m
    where m.venue_id = p_venue.id and m.status = 'draft' and m.scheduled_for is not null
    order by m.scheduled_for, m.id limit 1;
    v_categories := (
      select jsonb_agg(case
          when c ->> 'category' in ('food', 'drinks', 'other') then
            jsonb_build_object('category', c ->> 'category') || coalesce((
              select jsonb_build_object(
                'total', count(*), 'covered', count(*) filter (where n.covered),
                'pending', 0, 'checkDue', 0, 'replacementNeeded', 0,
                'missing', count(*) filter (where not n.covered),
                'notHere', 0, 'inactive', 0, 'unavailable', 0)
              from (
                select distinct e.item_id,
                  exists (
                    select 1 from public.menu_item_photos p
                    join public.media_assets a on a.id = p.asset_id and a.venue_id = p.venue_id
                    where p.item_id = e.item_id and p.venue_id = p_venue.id
                      and p.state = 'accepted' and p.review_level = 'public'
                      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
                      and not exists (
                        select 1 from public.menu_item_photos l
                        where l.asset_id = p.asset_id and l.item_id = p.item_id
                          and l.variant_id is not distinct from p.variant_id and l.created_at > p.created_at)
                  ) as covered
                from public.menu_entries e
                join public.menu_sections s on s.id = e.section_id
                where e.version_id = v_next_id and s.kind = c ->> 'category'
              ) n
            ), jsonb_build_object('total', 0, 'covered', 0))
          else c end
        order by ord)
      from jsonb_array_elements(v_cov -> 'categories') with ordinality as x(c, ord)
    );
  end if;

  select
    (count(*) filter (where f.verification = 'confirmed'))::integer as confirmed,
    count(*)::integer as total,
    (count(*) filter (where f.verification = 'check_due'))::integer as check_due,
    (count(*) filter (where f.verification = 'unconfirmed'))::integer as unconfirmed,
    coalesce(array_agg(f.check_id) filter (
      where f.verification = 'check_due' and f.check_id is not null), '{}'::uuid[]) as due_checks
  into v_facts
  from private.knowledge_fact_rows(p_venue.id) f where f.applicable;

  select count(*)::integer as waiting, min(w.at) as oldest into v_review
  from (
    select a.created_at as at
    from private.menu_photo_pending_tuples(p_venue.id, true) t
    join public.media_assets a on a.id = t.asset_id
    where not t.is_recheck
    union all
    select l.added_at
    from public.media_area_labels l
    join public.media_assets a on a.id = l.asset_id and a.venue_id = l.venue_id
    where l.venue_id = p_venue.id and l.removed_at is null and l.added_by = a.uploader_id
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
      and not exists (select 1 from public.area_photo_decisions d where d.label_id = l.id)
    union all
    select r.uploaded_at from private.amenity_photo_rows(p_venue.id) r where r.state = 'pending'
  ) w;

  select count(*)::integer into v_unlabelled
  from public.media_assets a
  where a.venue_id = p_venue.id and a.purpose = 'general' and a.upload_state = 'ready'
    and a.deleted_at is null and private.asset_unlabelled(a.id);

  select count(*)::integer into v_added
  from public.media_assets a
  where a.venue_id = p_venue.id and a.upload_state = 'ready' and a.deleted_at is null
    and p_from is not null and p_to is not null
    and (a.created_at at time zone p_venue.timezone)::date between p_from and p_to;

  select
    (count(*) filter (where pp.state = 'failed_unknown'))::integer as failed,
    (count(*) filter (where pp.state = 'withdrawal_pending'))::integer as pending
  into v_publication
  from private.publication_pairs(array[p_venue.id]) pp
  where pp.venue_id = p_venue.id;

  -- Checks due, each subject once (S3-R6, V20). A facility slot is in Check
  -- due when its fact is not confirmed, so a facility whose fact is itself
  -- due is counted once, as a fact; a facility photo counts only when the
  -- check was asked to be done again (progress needs_recheck). Dish slots
  -- are due only for a recheck, place slots past their check date.
  select
    (count(*) filter (where s.kind = 'dish'))::integer,
    (count(*) filter (where s.kind = 'area'))::integer,
    (count(*) filter (where s.kind = 'amenity' and c.progress = 'needs_recheck'
      and not (s.slot_id = any(v_facts.due_checks))))::integer
  into v_check_dishes, v_check_places, v_check_facilities
  from (
    select x ->> 'kind' as kind, (x ->> 'slotId')::uuid as slot_id
    from jsonb_array_elements(v_cov -> 'slots') x
    where x ->> 'state' = 'check_due' and coalesce((x ->> 'counted')::boolean, true)
  ) s
  left join public.venue_amenity_checks c on s.kind = 'amenity' and c.id = s.slot_id;
  v_check_due_slots := v_check_dishes + v_check_places + v_check_facilities;

  return jsonb_build_object(
    'venueId', p_venue.id, 'name', p_venue.name, 'timezone', p_venue.timezone,
    'operatingStatus', p_venue.operating_status, 'active', p_venue.active,
    'categories', v_categories,
    'nextMenu', case when p_menu = 'next' and v_next_id is not null then jsonb_build_object(
      'versionId', v_next_id, 'title', v_next_title, 'scheduledFor', v_next_at) end,
    'facts', jsonb_build_object('confirmed', v_facts.confirmed, 'total', v_facts.total,
      'checkDue', v_facts.check_due, 'unconfirmed', v_facts.unconfirmed),
    'unlabelled', v_unlabelled,
    'review', jsonb_build_object('waiting', v_review.waiting, 'oldestAt', v_review.oldest),
    'checksDue', jsonb_build_object('dishes', v_check_dishes, 'places', v_check_places,
      'facilities', v_check_facilities, 'slots', v_check_due_slots,
      'facts', v_facts.check_due, 'total', v_check_due_slots + v_facts.check_due),
    'publication', jsonb_build_object('failed', v_publication.failed,
      'withdrawalPending', v_publication.pending,
      'total', v_publication.failed + v_publication.pending),
    'added', case when p_from is not null and p_to is not null then v_added end,
    'setup', private.venue_setup_checklist(p_venue.id));
end;
$$;

revoke all on function private.admin_overview_row(public.venues, text, date, date)
from public, anon, authenticated, service_role;
