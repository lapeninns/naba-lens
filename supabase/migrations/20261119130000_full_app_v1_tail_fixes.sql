-- Full App v1 fixes that landed after the release (PR 34's last commits,
-- 73d452b25, 06338b78c and fecf90d05). They were written as edits to
-- migrations production had already applied on 19 Nov 2026, so they are
-- restated here. Each body is the latest definition with the fix:
--
--   private.venue_slug_for          trims a trailing hyphen after the 70-character
--                                   cap (20261118115000)
--   public.menu_item_photo_asset    previews of special photos follow the same
--                                   current-item rule as asset search
--                                   (is_current_photo_item, 20261118137000)
--   private.admin_overview_row      an archived dish leaves the next menu's
--                                   count (20261118125200)
--
-- Rollback: re-apply the bodies from those three migrations.

set lock_timeout = '5s';


create or replace function private.venue_slug_for(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base text := rtrim(
    left(btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), '-'), 70),
    '-');
  v_slug text;
  v_n integer := 1;
begin
  if v_base = '' then
    v_base := 'venue';
  end if;
  v_slug := v_base;
  while exists (select 1 from public.venues v where v.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
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
          where p.asset_id = a.id and p.state = 'accepted'
            and private.is_current_photo_item(a.venue_id, p.item_id, array['food', 'drinks', 'other'])
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
              -- Same counting rules as current coverage
              -- (private.coverage_slot_rows): a duplicate copy never covers
              -- a dish, and a packaged item without Photo wanted (FA-51,
              -- public.menu_item_packaging from 20261118133000, read at run
              -- time) is optional: inactive, out of the total.
              select jsonb_build_object(
                'total', count(*) filter (where not n.optional),
                'covered', count(*) filter (where n.covered and not n.optional),
                'pending', 0, 'checkDue', 0, 'replacementNeeded', 0,
                'missing', count(*) filter (where not n.covered and not n.optional),
                'notHere', 0, 'inactive', count(*) filter (where n.optional),
                'unavailable', 0)
              from (
                select distinct e.item_id,
                  coalesce((
                    select k.packaged and not k.photo_wanted
                    from public.menu_item_packaging k where k.item_id = e.item_id
                  ), false) as optional,
                  exists (
                    select 1 from public.menu_item_photos p
                    join public.media_assets a on a.id = p.asset_id and a.venue_id = p.venue_id
                    where p.item_id = e.item_id and p.venue_id = p_venue.id
                      and p.state = 'accepted' and p.review_level = 'public'
                      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
                      and not private.media_duplicate_suppressed(a.id)
                      and not exists (
                        select 1 from public.menu_item_photos l
                        where l.asset_id = p.asset_id and l.item_id = p.item_id
                          and l.variant_id is not distinct from p.variant_id and l.created_at > p.created_at)
                  ) as covered
                from public.menu_entries e
                join public.menu_sections s on s.id = e.section_id
                join public.menu_items i on i.id = e.item_id and i.archived_at is null
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
