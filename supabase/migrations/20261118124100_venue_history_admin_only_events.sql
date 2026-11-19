-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R5 (release review V2; FA-23, spec §3.2, §7 M5): a
-- manager's venue History no longer shows admin-only account-security events.
-- public.admin_reset_mfa_authorise files 'mfa_reset' under the person's venue
-- with the admin's free-text reason; private.venue_history_rows passed every
-- activity row for the venue through to managers.
--
--   private.venue_history_admin_only(action)  true for activity actions only
--     admins may read (today: mfa_reset). Add new account-security actions
--     here when they are recorded with a venue.
--   private.venue_history_rows                the 20261118113200 body; the
--     activity source leaves those actions out unless the caller is an
--     active admin on an aal2 session (private.is_active_admin). Admin
--     Activity (public.admin_activity) is unchanged and still shows them.
--
-- Rollback: re-run the 20261118113200 definition of private.venue_history_rows
-- and drop private.venue_history_admin_only(text).

create function private.venue_history_admin_only(p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_action in ('mfa_reset');
$$;

create or replace function private.venue_history_rows(p_venue_id uuid)
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
    and (not private.venue_history_admin_only(r.action) or private.is_active_admin())
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

revoke all on function private.venue_history_admin_only(text) from public, anon, authenticated;
revoke all on function private.venue_history_rows(uuid) from public, anon, authenticated;
