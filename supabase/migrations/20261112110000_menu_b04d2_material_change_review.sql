-- B04-d2 (b04-design §7.1 B04-04c, §7.2, A1-6, A1-8; task B04-04): material
-- changes drive trading review. Completes the trading half of B04-04c that
-- B04-d (20261110204000, author default 5) deferred; review-b04-s3s4 M2 named
-- it a precondition for enabling menuChangeDeclarations. Dietary and
-- allergen revocation arrive with their statements in B04-c.
--
-- At activation (draft -> active), for every live trading line of the
-- activated version whose item has a `portion` declaration (item-wide, or for
-- the line's own variant) or whose variant has a `variant_meaning`
-- declaration, menu_versions_review_trading_lines:
--   * appends one public.menu_trading_line_reviews row (line, version, kinds,
--     opened_at = activation time, opened_by = the activating account);
--   * moves the line revision by one (a decision prepared against the
--     earlier revision fails menu_trading_conflict and re-reads);
--   * opens one `material_change` task (internal, due at activation) when
--     the line then has a price or availability waiting for a manager.
-- The trigger sorts after menu_versions_retire_trading_lines, so a line the
-- same activation retires is left alone (§7.2 "variant removed: retired").
--
-- Reads (A1-6). private.menu_trading_field_state is re-created from S2 with
-- one rule: a single live price or availability whose confirmation was
-- recorded before a review opened on its line (decision seq at most the
-- review's last_decision_seq; the review opened at or before the read
-- instant) reads
--   { status: 'unavailable', reason: 'not_confirmed', detail: 'pending',
--     previousAssertionId, reviewSince }
-- until a manager confirms a new assertion (a later decision) or
-- withdraws it. Withdrawn and disputed keep precedence (reader order:
-- withdrawn, disputed, stale, not_confirmed, unknown). Reads at instants
-- before the review are unchanged, so history is preserved. A not_confirmed
-- value carries no freshness and opens no freshness task. Temporary
-- unavailability is not a confirmation of the dish and is unaffected.
--
-- Rechecks. private.menu_close_rechecks (B04-b3 body) closes a
-- material_change task once neither price nor availability of the line reads
-- not_confirmed. Time never moves a photo; no credit input changes.
--
-- The declarations themselves stay behind menuChangeDeclarations (OFF).
--
-- Rollback: drop the trigger; re-create the 20261110203000 body of
-- private.menu_trading_field_state and the 20261112100000 body of
-- private.menu_close_rechecks. The review table stays (history).

create table public.menu_trading_line_reviews (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  venue_id uuid not null references public.venues (id) on delete restrict,
  line_id uuid not null,
  version_id uuid not null,
  kinds text[] not null check (
    cardinality(kinds) between 1 and 2 and kinds <@ array['portion', 'variant_meaning']::text[]),
  opened_at timestamptz not null default now(),
  opened_by uuid not null references public.profiles (id) on delete restrict,
  -- The line's latest decision when the review opened (0: none). Activation
  -- holds the exclusive venue menu lock and decisions the shared one, so
  -- decision seq order is exact: a confirmation with seq <= this precedes
  -- the change, whatever the clock says.
  last_decision_seq bigint not null check (last_decision_seq >= 0),
  constraint menu_trading_line_reviews_line_fkey foreign key (line_id, venue_id)
    references public.menu_trading_lines (id, venue_id) on delete restrict,
  constraint menu_trading_line_reviews_version_fkey foreign key (version_id, venue_id)
    references public.menu_versions (id, venue_id) on delete restrict,
  constraint menu_trading_line_reviews_once unique (line_id, version_id)
);

create index menu_trading_line_reviews_line_idx on public.menu_trading_line_reviews (line_id, opened_at);

comment on table public.menu_trading_line_reviews is
  'Append-only: a declared portion or variant-meaning change reached a trading line at activation (A1-6). Confirmations made before opened_at read not_confirmed / pending from then on.';

create trigger menu_trading_line_reviews_append_only
  before update or delete on public.menu_trading_line_reviews
  for each row execute function private.append_only_guard();
create trigger menu_trading_line_reviews_no_truncate
  before truncate on public.menu_trading_line_reviews
  for each statement execute function private.append_only_guard();

revoke all on public.menu_trading_line_reviews from public, anon, authenticated, service_role;
grant select on public.menu_trading_line_reviews to service_role;
alter table public.menu_trading_line_reviews enable row level security;

-- ---------------------------------------------------------------------------
-- Resolution: S2's body plus the A1-6 review rule
-- ---------------------------------------------------------------------------

create or replace function private.menu_trading_field_state(p_line_id uuid, p_field text, p_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recursive
  venue_zone as (
    select private.venue_timezone(l.venue_id) as name
    from public.menu_trading_lines l where l.id = p_line_id
  ),
  confirmed as (
    select a.id, a.supersedes, a.value, a.basis, a.effective_from, a.effective_to,
      c.decided_at as confirmed_at, c.stated_on, c.stated_on_source,
      w.decided_at as withdrawn_at,
      greatest(c.decided_at,
        coalesce(a.effective_from::timestamp at time zone z.name, c.decided_at)) as starts_at,
      coalesce((a.effective_to + 1)::timestamp at time zone z.name, 'infinity'::timestamptz) as ends_at,
      -- A1-6: a material change opened on the line after this confirmation.
      (select max(r.opened_at) from public.menu_trading_line_reviews r
       where r.line_id = a.line_id and r.opened_at <= p_at and r.last_decision_seq >= c.seq
         and p_field in ('price', 'availability')) as review_since
    from public.menu_trading_assertions a
    cross join venue_zone z
    join public.menu_trading_decisions c
      on c.assertion_id = a.id and c.decision = 'confirmed' and c.decided_at <= p_at
    left join public.menu_trading_decisions w
      on w.assertion_id = a.id and w.decision = 'withdrawn' and w.decided_at <= p_at
    where a.line_id = p_line_id and a.field = p_field
  ),
  -- In force at some moment (not withdrawn before it started) and covering p_at.
  covering as (
    select x.* from confirmed x
    where x.starts_at <= p_at and x.ends_at > p_at
      and (x.withdrawn_at is null or x.withdrawn_at > x.starts_at)
  ),
  ancestors (id) as (
    select x.supersedes from covering x where x.supersedes is not null
    union
    select a.supersedes
    from ancestors an
    join public.menu_trading_assertions a on a.id = an.id
    where a.supersedes is not null
  ),
  heads as (
    select x.* from covering x where not exists (select 1 from ancestors an where an.id = x.id)
  ),
  live as (
    select h.* from heads h where h.withdrawn_at is null
  )
  select case
    when (select count(*) from live) = 1 and (select l.review_since from live l) is not null then (
      select jsonb_build_object(
        'status', 'unavailable', 'reason', 'not_confirmed', 'detail', 'pending',
        'previousAssertionId', l.id, 'reviewSince', l.review_since)
      from live l)
    when (select count(*) from live) = 1 then (
      select jsonb_build_object(
        'status', 'available',
        'assertionId', l.id,
        'value', l.value,
        'updatedBy', case when l.basis = 'source_mapping' then 'menu_source' else 'manager' end,
        'effectiveFrom', l.effective_from,
        'effectiveTo', l.effective_to,
        'startsAt', l.starts_at,
        'endsAt', case when l.ends_at = 'infinity'::timestamptz then null else l.ends_at end,
        'confirmedAt', l.confirmed_at,
        'statedOn', l.stated_on,
        'statedOnSource', l.stated_on_source)
      from live l)
    when (select count(*) from live) > 1 then jsonb_build_object(
      'status', 'unavailable', 'reason', 'disputed', 'detail', 'conflict',
      'assertionIds', (select jsonb_agg(l.id order by l.confirmed_at, l.id) from live l))
    when exists (select 1 from heads) then jsonb_build_object(
      'status', 'unavailable', 'reason', 'withdrawn', 'detail', 'value_withdrawn')
    else jsonb_build_object('status', 'unavailable', 'reason', 'unknown', 'detail', 'not_recorded')
  end;
$$;

-- ---------------------------------------------------------------------------
-- Activation: declared portion and variant-meaning changes reach the lines
-- ---------------------------------------------------------------------------

-- Under activate_menu_version's exclusive venue menu lock; lines locked by id.
create function private.menu_versions_review_trading_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
begin
  if new.activated_by is null then
    return null;
  end if;
  for v_line in
    select x.id, x.venue_id, array_agg(distinct d.kind order by d.kind) as kinds
    from public.menu_trading_lines x
    join public.menu_change_declarations d
      on d.version_id = new.id and d.item_id = x.item_id
     and ((d.kind = 'portion' and (d.variant_id is null or d.variant_id = x.variant_id))
          or (d.kind = 'variant_meaning' and d.variant_id = x.variant_id))
    where x.venue_id = new.venue_id and x.retired_at is null
      and exists (select 1 from public.menu_entries e where e.version_id = new.id and e.item_id = x.item_id)
    group by x.id, x.venue_id
    order by x.id
  loop
    perform 1 from public.menu_trading_lines l where l.id = v_line.id for update;
    insert into public.menu_trading_line_reviews (venue_id, line_id, version_id, kinds, opened_by, last_decision_seq)
    values (v_line.venue_id, v_line.id, new.id, v_line.kinds, new.activated_by,
      coalesce((select max(d.seq) from public.menu_trading_decisions d where d.line_id = v_line.id), 0));
    update public.menu_trading_lines l
    set revision = l.revision + 1, updated_at = now()
    where l.id = v_line.id;
    if private.menu_trading_field_state(v_line.id, 'price', now()) ->> 'reason' = 'not_confirmed'
       or private.menu_trading_field_state(v_line.id, 'availability', now()) ->> 'reason' = 'not_confirmed' then
      insert into public.menu_trading_recheck_tasks (venue_id, line_id, cause, use, due_at)
      values (v_line.venue_id, v_line.id, 'material_change', 'internal', now())
      on conflict on constraint menu_trading_recheck_tasks_once do nothing;
    end if;
  end loop;
  return null;
end;
$$;

-- Fires after menu_versions_retire_trading_lines (trigger name order).
create trigger menu_versions_review_trading_lines
  after update of status on public.menu_versions
  for each row
  when (old.status = 'draft' and new.status = 'active')
  execute function private.menu_versions_review_trading_lines();

-- ---------------------------------------------------------------------------
-- Rechecks: B04-b3's body plus material_change
-- ---------------------------------------------------------------------------

create or replace function private.menu_close_rechecks(p_line_id uuid, p_now timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task public.menu_trading_recheck_tasks;
  v_state jsonb;
  v_current boolean;
  v_fresh jsonb;
  v_venue uuid;
  v_policy public.knowledge_freshness_policies;
  v_closed integer := 0;
begin
  if not exists (select 1 from public.menu_trading_recheck_tasks t where t.line_id = p_line_id and t.state = 'open') then
    return 0;
  end if;
  v_state := private.menu_trading_field_state(p_line_id, 'temporary_unavailability', p_now);
  v_current := v_state ->> 'status' = 'available' and (
    v_state #>> '{value,state}' = 'back_in_service'
    or (v_state #>> '{value,state}' = 'temporarily_unavailable'
        and (jsonb_typeof(v_state #> '{value,until}') = 'null'
             or (v_state #>> '{value,until}')::timestamptz > p_now)));
  select l.venue_id into v_venue from public.menu_trading_lines l where l.id = p_line_id;
  for v_task in
    select t.* from public.menu_trading_recheck_tasks t
    where t.line_id = p_line_id and t.state = 'open'
      and t.cause in ('temporary_until_passed', 'due_soon', 'expired', 'basis_missing', 'material_change')
    order by t.created_at, t.id
    for update
  loop
    if v_task.cause = 'material_change' then
      -- A1-6: closes once no field of the line still waits for a manager
      -- (re-confirmed with a new value, or explicitly withdrawn).
      if private.menu_trading_field_state(p_line_id, 'price', p_now) ->> 'reason' = 'not_confirmed'
         or private.menu_trading_field_state(p_line_id, 'availability', p_now) ->> 'reason' = 'not_confirmed' then
        continue;
      end if;
    elsif v_task.cause = 'temporary_until_passed' then
      if not (v_task.use = 'internal'
              and coalesce(v_current and (v_state ->> 'assertionId')::uuid is distinct from v_task.assertion_id, false)) then
        continue;
      end if;
    else
      v_policy := private.menu_freshness_policy_at(v_venue, v_task.field, v_task.use, p_now);
      if v_policy.id is null then
        -- Unbound for this field and use: it reads unrated and never current.
        update public.menu_trading_recheck_tasks t
        set state = 'cancelled', closed_at = now()
        where t.id = v_task.id;
        continue;
      end if;
      v_fresh := private.menu_trading_freshness(v_venue, v_task.field,
        private.menu_trading_field_state(p_line_id, v_task.field, p_now), p_now);
      if v_fresh is null or not exists (
           select 1 from jsonb_array_elements(v_fresh) e
           where e ->> 'use' = v_task.use and e ->> 'state' = 'current') then
        continue;
      end if;
    end if;
    update public.menu_trading_recheck_tasks t
    set state = 'done', closed_at = now(),
        closed_by = (select p.id from public.profiles p where p.id = auth.uid())
    where t.id = v_task.id;
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end;
$$;

revoke all on function private.menu_versions_review_trading_lines() from public, anon, authenticated;
