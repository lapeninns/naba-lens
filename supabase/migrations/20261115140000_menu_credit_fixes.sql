-- One review per photo (docs/plans/one-review-per-photo.md): three fixes to the
-- read-through counts of 20261115100000, 20261115110000 and 20261115120000.
-- Read-through only, as those: no rows change, no write path changes, no
-- backfill. Signatures and grants are unchanged; menu_photo_also_counts gains
-- one return column (variant_id) and is recreated with its grants.
--
-- 1. Month credit (private.monthly_credit_items): a menu photo's month credit
--    is earned by its acceptance, and only a withdrawal takes it away (ORP
--    decision 2). It is read from the photo's decision history: a live row
--    (accepted, needs_recheck or better_photo_requested) with an `accepted`
--    event and no later `withdrawn` event counts. So a photo accepted, sent
--    for recheck by a menu change and then asked for another photo keeps its
--    credit; one asked for another photo without ever being accepted earns
--    nothing. The credit's decision time is the first acceptance. One row per
--    asset, as before; a photo credited through a submission is not counted
--    again.
-- 2. Settlement (private.menu_settlement, so private.menu_settled): a
--    monthly-only submission (no task) is settled only by a menu decision on a
--    tuple the uploader labelled themselves, the only kind that can earn the
--    month credit. A reviewer-added label leaves it pending and reviewable,
--    where accepting it earns the credit through the submission. Task
--    submissions settle as before.
-- 3. Also counts for (public.menu_photo_also_counts): one row per label
--    tuple (asset, item, variant). credit_month follows the month predicate
--    for that exact tuple: an image the uploader labelled with this item and
--    variant themselves. lib/server/menu-photos/read.ts keys on the variant.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Month
-- ---------------------------------------------------------------------------

create or replace function private.monthly_credit_items(p_month date)
returns table (
  author_id uuid,
  venue_id uuid,
  asset_id uuid,
  decided_at timestamptz,
  evidence_removed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with submitted as (
    -- As in 20261102150000: the author submitted their own ready image,
    -- uploaded and submitted in that London month, at its upload venue.
    select i.author_id, i.venue_id, i.asset_id, i.decided_at,
      a.deleted_at is not null as evidence_removed
    from public.coverage_submission_items i
    join public.media_assets a on a.id = i.asset_id
    where i.submitted_month = p_month
      and i.uploaded_month = p_month
      and i.state = 'accepted'
      and i.origin = 'submitted'
      and i.submitted_by = i.author_id
      and a.media_type = 'image'
      and a.upload_state = 'ready'
      and (a.deleted_at is null or a.deleted_at >= private.london_month_end(p_month))
  ),
  menu as (
    -- One row per asset however many items it was accepted for; the earliest
    -- acceptance decides whether it was a late one.
    select m.author_id, m.venue_id, m.asset_id, min(acc.accepted_at) as decided_at,
      bool_or(a.deleted_at is not null) as evidence_removed
    from public.menu_item_photos m
    join public.media_assets a on a.id = m.asset_id
    -- Earned by an acceptance in the row's history that no withdrawal
    -- followed. Withdrawn and invalidated rows are final and earn nothing.
    join lateral (
      select min(e.created_at) as accepted_at
      from public.menu_item_photo_events e
      where e.photo_id = m.id
        and e.action = 'accepted'
        and not exists (
          select 1 from public.menu_item_photo_events w
          where w.photo_id = m.id and w.action = 'withdrawn' and w.id > e.id
        )
    ) acc on acc.accepted_at is not null
    where m.state in ('accepted', 'needs_recheck', 'better_photo_requested')
      and private.london_month(a.created_at) = p_month
      and a.media_type = 'image'
      and a.upload_state = 'ready'
      and (a.deleted_at is null or a.deleted_at >= private.london_month_end(p_month))
      -- The uploader's own label for the reviewed tuple.
      and exists (
        select 1 from public.media_label_items li
        where li.asset_id = m.asset_id
          and li.item_id = m.item_id
          and li.variant_id is not distinct from m.variant_id
          and li.added_by = m.author_id
      )
      and not exists (select 1 from submitted s where s.asset_id = m.asset_id)
    group by m.author_id, m.venue_id, m.asset_id
  )
  select s.author_id, s.venue_id, s.asset_id, s.decided_at, s.evidence_removed
  from submitted s
  union all
  select m.author_id, m.venue_id, m.asset_id, m.decided_at, m.evidence_removed
  from menu m;
$$;

-- ---------------------------------------------------------------------------
-- 2. Settlement
-- ---------------------------------------------------------------------------

create or replace function private.menu_settlement(p_asset_id uuid, p_requirement_id uuid, p_venue_id uuid)
returns table (state text, decided_by uuid, decided_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.state, m.decided_by, m.decided_at
  from public.menu_item_photos m
  where m.asset_id = p_asset_id
    and m.venue_id = p_venue_id
    and m.state in ('accepted', 'better_photo_requested', 'needs_recheck')
    and (
      -- Monthly only: the menu decision settles it only where it can earn the
      -- uploader's month credit, a tuple they labelled themselves.
      (
        p_requirement_id is null
        and exists (
          select 1 from public.media_label_items li
          where li.asset_id = m.asset_id
            and li.item_id = m.item_id
            and li.variant_id is not distinct from m.variant_id
            and li.added_by = m.author_id
        )
      )
      or exists (
        select 1
        from public.coverage_requirements r
        join public.menu_entries me
          on me.version_id = r.menu_version_id
          and me.section_id = r.menu_section_id
          and me.venue_id = r.venue_id
        where r.id = p_requirement_id
          and r.kind = 'menu_section'
          and me.item_id = m.item_id
      )
    )
  order by m.state = 'accepted' desc, m.decided_at desc, m.id
  limit 1;
$$;

revoke all on function private.menu_settlement(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.menu_settlement(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Also counts for
-- ---------------------------------------------------------------------------

-- The return columns change, so the function is recreated.
drop function public.menu_photo_also_counts(uuid, uuid[]);

create function public.menu_photo_also_counts(p_venue_id uuid, p_asset_ids uuid[])
returns table (
  asset_id uuid,
  item_id uuid,
  variant_id uuid,
  task_titles text[],
  credit_month date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
begin
  perform private.assert_can_manage_venue(v_venue);
  if p_asset_ids is null or cardinality(p_asset_ids) > 50 then
    raise exception 'invalid_asset_ids' using errcode = '22023';
  end if;

  return query
  select li.asset_id, li.item_id, li.variant_id,
    coalesce(array(
      select r.title
      from public.coverage_requirements r
      join public.menu_entries me
        on me.version_id = r.menu_version_id
        and me.section_id = r.menu_section_id
        and me.venue_id = r.venue_id
      where r.venue_id = v_venue
        and r.kind = 'menu_section'
        and me.item_id = li.item_id
        and private.requirement_is_current(r.id)
      order by r.title
    ), '{}'::text[]),
    -- As private.monthly_credit_items: the uploader's own label for this
    -- exact tuple, on a still image.
    case
      when li.added_by = a.uploader_id and a.media_type = 'image'
        then private.london_month(a.created_at)
    end
  from public.media_label_items li
  join public.media_assets a on a.id = li.asset_id and a.venue_id = li.venue_id
  where li.venue_id = v_venue
    and li.asset_id = any(p_asset_ids);
end;
$$;

revoke all on function public.menu_photo_also_counts(uuid, uuid[]) from public, anon;
grant execute on function public.menu_photo_also_counts(uuid, uuid[]) to authenticated, service_role;
