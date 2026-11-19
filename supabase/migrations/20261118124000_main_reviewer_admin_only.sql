-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R5 (release review V1; spec §7 M5, §8 A2): the venue's main
-- reviewer is an admin responsibility. A manager nominates the backup
-- reviewer only (or clears it). public.set_venue_reviewer, which managers
-- call directly, now refuses for a caller who is not an active admin on an
-- aal2 session (private.is_active_admin, FA-23):
--
--   * p_role = 'main', whether naming or clearing (main_reviewer_admin_only);
--   * nominating the current main reviewer as backup, which would end the
--     main role through the 'moved' branch (main_reviewer_admin_only).
--
-- public.admin_set_venue_reviewer keeps calling this function on an admin
-- session, so admins set and clear main as before. Handover (a departing
-- main replaced by the backup) runs in triggers, not through this function,
-- and is unchanged. The body is 20261118113000_venue_reviewers.sql's with the
-- two checks added.
--
-- Rollback: re-run the 20261118113000 definition of public.set_venue_reviewer.

create or replace function public.set_venue_reviewer(
  p_venue_id uuid,
  p_role text,
  p_profile_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_reason text;
  v_admin boolean := private.is_active_admin();
  v_current public.venue_reviewer_assignments;
  v_other public.venue_reviewer_assignments;
begin
  v_venue := private.reviewer_scope_venue(p_venue_id);
  if p_role is null or p_role not in ('main', 'backup') then
    raise exception 'invalid_reviewer_role' using errcode = '22023';
  end if;
  -- Spec §7 M5: managers nominate a backup reviewer; §8 A2: the admin names
  -- the main reviewer.
  if p_role = 'main' and not v_admin then
    raise exception 'main_reviewer_admin_only' using errcode = '42501';
  end if;
  v_reason := private.clean_text(p_reason, 500, 'reason_too_long');

  -- One change at a time per venue.
  perform 1 from public.venues v where v.id = v_venue for update;

  select * into v_current from public.venue_reviewer_assignments
  where venue_id = v_venue and role = p_role and ended_at is null;

  if p_profile_id is null then
    if v_current.id is not null then
      perform private.end_reviewer_assignment(v_current.id, 'cleared', v_reason);
    end if;
    return private.venue_reviewers_json(v_venue);
  end if;

  if not private.venue_reviewer_eligible(p_profile_id, v_venue) then
    raise exception 'reviewer_not_eligible' using errcode = '42501';
  end if;
  if v_current.profile_id = p_profile_id then
    return private.venue_reviewers_json(v_venue);
  end if;

  select * into v_other from public.venue_reviewer_assignments
  where venue_id = v_venue and profile_id = p_profile_id and ended_at is null;
  -- Moving the main reviewer to backup would leave main empty: admin only.
  if v_other.id is not null and v_other.role = 'main' and not v_admin then
    raise exception 'main_reviewer_admin_only' using errcode = '42501';
  end if;
  if v_other.id is not null then
    perform private.end_reviewer_assignment(v_other.id, 'moved', v_reason);
  end if;
  if v_current.id is not null then
    perform private.end_reviewer_assignment(v_current.id, 'replaced', v_reason);
  end if;
  perform private.open_reviewer_assignment(v_venue, p_role, p_profile_id, v_reason, v_uid);
  return private.venue_reviewers_json(v_venue);
end;
$$;

revoke all on function public.set_venue_reviewer(uuid, text, uuid, text) from public, anon, service_role;
grant execute on function public.set_venue_reviewer(uuid, text, uuid, text) to authenticated;
