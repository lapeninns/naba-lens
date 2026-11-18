-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-ADMIN (spec §8 A1; checklist A1-coverage-by-category,
-- A1-fact-coverage, A1-unlabelled-backlog, A1-oldest-review-age,
-- A1-overdue-checks, A1-publication-errors, A1-filters; AC39).
--
--   public.admin_group_overview: one row per venue for the admin Overview.
--   Every number comes from an existing rule, so it reproduces on the page
--   it links to:
--     coverage     the one slot rule (S1-COV private.coverage_slot_rows):
--                  per category total (Not here and inactive leave it),
--                  covered (the numerator), waiting, check due, missing.
--                  With p_menu 'next', Food, Drinks and Other count the
--                  next scheduled menu's dishes instead (AC27: the current
--                  menu is untouched): a dish counts as covered when it has
--                  a live photo accepted for public use.
--     facts        S1-FACTS private.knowledge_fact_rows, applicable rows:
--                  confirmed of all, check due, unconfirmed.
--     unlabelled   private.asset_unlabelled: a ready general photo or video
--                  that no slot holds (no menu label, place or amenity link).
--     review       photos waiting for a decision and the oldest one's upload
--                  time (dish, place and amenity queues).
--     checks       slots in Check due plus facts in Check due.
--     publication  S1-EXPORT private.publication_pairs in failed_unknown or
--                  withdrawal_pending.
--     period       photos added between p_from and p_to (venue-local days).
--     setup        private.venue_setup_checklist (20261118115000).
--   Admins only. Venues are in name order; the page puts blocked setup and
--   exceptions first without ranking anyone.
--
-- Rollback: revoke execute on public.admin_group_overview.

-- A ready general upload that no slot holds. Shared so the Library's
-- "unlabelled" filter can adopt the same rule (S2-LIBRARY).
create function private.asset_unlabelled(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
      select 1 from public.media_labels l where l.asset_id = p_asset_id and l.has_labels)
    and not exists (
      select 1 from public.media_area_labels l where l.asset_id = p_asset_id and l.removed_at is null)
    and not exists (
      select 1 from public.menu_item_photos p where p.asset_id = p_asset_id)
    and not exists (
      select 1 from public.amenity_submission_assets sa where sa.asset_id = p_asset_id)
    and not exists (
      select 1 from public.knowledge_contribution_assets ka where ka.asset_id = p_asset_id)
    and not exists (
      select 1 from public.amenity_photo_decisions d where d.asset_id = p_asset_id);
$$;

create function private.admin_overview_row(
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
                    where p.item_id = e.item_id and p.venue_id = p_venue.id
                      and p.state = 'accepted' and p.review_level = 'public'
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
    (count(*) filter (where f.verification = 'unconfirmed'))::integer as unconfirmed
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

  v_check_due_slots := coalesce((v_cov -> 'totals' ->> 'checkDue')::integer, 0);

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
    'checksDue', jsonb_build_object('slots', v_check_due_slots, 'facts', v_facts.check_due,
      'total', v_check_due_slots + v_facts.check_due),
    'publication', jsonb_build_object('failed', v_publication.failed,
      'withdrawalPending', v_publication.pending,
      'total', v_publication.failed + v_publication.pending),
    'added', case when p_from is not null and p_to is not null then v_added end,
    'setup', private.venue_setup_checklist(p_venue.id));
end;
$$;

-- p_venue_ids: NULL for every venue. p_menu: 'current' or 'next'. p_from and
-- p_to: the reporting period (both or neither, at most 366 days).
create function public.admin_group_overview(
  p_venue_ids uuid[] default null,
  p_menu text default 'current',
  p_from date default null,
  p_to date default null,
  p_include_archived boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_active_admin();
  if coalesce(p_menu, '') not in ('current', 'next') then
    raise exception 'invalid_menu_filter' using errcode = '22023';
  end if;
  if (p_from is null) <> (p_to is null) or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if p_venue_ids is not null and cardinality(p_venue_ids) > 200 then
    raise exception 'invalid_venue_filter' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'menu', p_menu, 'from', p_from, 'to', p_to,
    'rows', coalesce((
      select jsonb_agg(private.admin_overview_row(v, p_menu, p_from, p_to)
        order by lower(v.name), v.id)
      from public.venues v
      where (v.active or coalesce(p_include_archived, false))
        and (p_venue_ids is null or v.id = any(p_venue_ids))
    ), '[]'::jsonb));
end;
$$;

revoke all on function
  private.asset_unlabelled(uuid),
  private.admin_overview_row(public.venues, text, date, date)
from public, anon, authenticated, service_role;

revoke all on function public.admin_group_overview(uuid[], text, date, date, boolean)
from public, anon, service_role;
grant execute on function public.admin_group_overview(uuid[], text, date, date, boolean)
to authenticated;
