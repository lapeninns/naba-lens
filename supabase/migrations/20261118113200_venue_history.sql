-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-MGR: the Venue screen's History (spec §7 M5; checklist
-- M5-history).
--
--   venue_history   one venue's change history, newest first, for its
--                   managers and for admins. It reads the same rows as admin
--                   Activity (private.activity_rows, S1-OPS) for the venue,
--                   plus the Sprint 1 histories that are not in it yet:
--                   amenity and venue applicability (AC29), fact
--                   reconfirmations, local specials, menu change requests and
--                   menu month checks. Keyset paging on (at, source, id) as in
--                   admin_activity. Rows without a venue (organisation
--                   settings) never appear.
--
-- Rollback: revoke execute on public.venue_history.

create function private.venue_history_rows(p_venue_id uuid)
returns table (
  source text,
  id text,
  created_at timestamptz,
  actor_id uuid,
  actor_role text,
  action text,
  object_type text,
  object_id text,
  reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.source, r.id::text, r.created_at, r.actor_id, r.actor_role, r.action,
    r.object_type, r.object_id, r.reason
  from private.activity_rows() r
  where r.venue_id = p_venue_id
  union all
  select 'amenity_scope', e.id::text, e.created_at, e.actor_id, null,
    case when e.applicable then 'applicability_restored' else 'applicability_removed' end,
    'amenity_check', e.check_id::text, e.reason
  from public.amenity_scope_events e
  where e.venue_id = p_venue_id
  union all
  select 'venue_scope', e.id::text, e.created_at, e.actor_id, null,
    case when e.applicable_after then 'scope_applies' else 'scope_not_applicable' end,
    'venue_scope', e.scope_key, e.reason
  from public.venue_scope_events e
  where e.venue_id = p_venue_id
  union all
  select 'fact_check', e.id::text, e.created_at, e.decided_by, null,
    case e.kind when 'reconfirmed' then 'fact_reconfirmed' else 'fact_next_check_set' end,
    'fact', e.question_key, e.note
  from public.knowledge_fact_checks e
  where e.venue_id = p_venue_id
  union all
  select 'special', s.id::text, s.created_at, s.created_by, null,
    'special_' || s.status, 'menu_special', s.name, s.decision_reason
  from public.menu_specials s
  where s.venue_id = p_venue_id
  union all
  select 'change_request', c.id::text, c.requested_at, c.requested_by, null,
    'change_request_' || c.status, 'menu_change_request', c.kind, c.decision_reason
  from public.menu_change_requests c
  where c.venue_id = p_venue_id;
$$;

-- {items, nextCursor}. Each item: {source, id, at, actorId, actorName,
-- actorRole, action, objectType, objectId, reason}. Filter by source with
-- p_source; continue with p_before = the previous page's nextCursor.
create function public.venue_history(
  p_venue_id uuid default null,
  p_source text default null,
  p_before jsonb default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.reviewer_scope_venue(p_venue_id);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_at timestamptz;
  v_source text;
  v_id text;
  v_items jsonb;
  v_count integer;
begin
  if p_before is not null then
    begin
      v_at := (p_before ->> 'at')::timestamptz;
      v_source := p_before ->> 'source';
      v_id := p_before ->> 'id';
    exception when others then
      raise exception 'invalid_cursor' using errcode = '22023';
    end;
    if v_at is null or v_source is null or v_id is null then
      raise exception 'invalid_cursor' using errcode = '22023';
    end if;
  end if;

  with page as (
    select r.*
    from private.venue_history_rows(v_venue) r
    where (p_source is null or r.source = p_source)
      and (v_at is null or (r.created_at, r.source, r.id) < (v_at, v_source, v_id))
    order by r.created_at desc, r.source desc, r.id desc
    limit v_limit + 1
  ),
  numbered as (
    select page.*, row_number() over (order by page.created_at desc, page.source desc, page.id desc) as rn
    from page
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'source', n.source, 'id', n.id, 'at', n.created_at,
      'actorId', n.actor_id, 'actorName', p.display_name,
      'actorRole', coalesce(n.actor_role, p.role::text, 'system'),
      'action', n.action, 'objectType', n.object_type, 'objectId', n.object_id,
      'reason', n.reason)
      order by n.rn) filter (where n.rn <= v_limit), '[]'::jsonb),
    count(*)::integer
  into v_items, v_count
  from numbered n
  left join public.profiles p on p.id = n.actor_id;

  return jsonb_build_object('venueId', v_venue, 'items', v_items,
    'nextCursor', case when v_count > v_limit then jsonb_build_object(
      'at', v_items -> (v_limit - 1) ->> 'at',
      'source', v_items -> (v_limit - 1) ->> 'source',
      'id', v_items -> (v_limit - 1) ->> 'id') end);
end;
$$;

revoke all on function private.venue_history_rows(uuid) from public, anon, authenticated;
revoke all on function public.venue_history(uuid, text, jsonb, integer) from public, anon, service_role;
grant execute on function public.venue_history(uuid, text, jsonb, integer) to authenticated;
