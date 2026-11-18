-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, Sprint 3 repair S3-R6 (review V22; spec §8 A2 operating
-- status; checklist A2-operating-status).
--
-- 20261118100000 added venues.operating_status with default 'open' and
-- 20261118115000 added archived_at, neither with a backfill. A venue switched
-- off before then (active = false) therefore read as Open: Open could not be
-- chosen for it (no change), and Temporarily closed turned it back on.
--
--   1. Backfill: a switched-off venue still marked 'open' is archived
--      (permanently_closed, archived_at set). Its history is kept; only the
--      two columns change, so revision and updated_at are left alone.
--   2. admin_venue_set_status: a call is a no-op only when both the status
--      and venues.active already match the target. Body as in
--      20261118115000 otherwise.
--
-- Rollback: the backfill is not reversed (the earlier state was wrong);
-- restore the 20261118115000 body of admin_venue_set_status.

update public.venues v
set operating_status = 'permanently_closed',
    archived_at = coalesce(v.archived_at, v.updated_at, now())
where not v.active and v.operating_status <> 'permanently_closed';

create or replace function public.admin_venue_set_status(
  p_venue_id uuid, p_status text, p_reason text, p_revision integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_reason text := private.clean_text(p_reason, 500, 'reason_too_long');
  v_old public.venues;
  v_new public.venues;
  v_was_closed boolean;
begin
  if p_status is null or p_status not in ('open', 'temporarily_closed', 'permanently_closed') then
    raise exception 'invalid_operating_status' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select v.* into v_old from public.venues v where v.id = p_venue_id for update;
  if v_old.id is null then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if v_old.revision is distinct from p_revision then
    raise exception 'venue_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_old.revision)::text;
  end if;
  -- A no-op only when the venue already is what was asked for: the status
  -- and whether it is switched on (S3-R6, V22).
  if v_old.operating_status = p_status
      and v_old.active = (p_status <> 'permanently_closed') then
    return private.venue_json(v_old) || jsonb_build_object('changed', false);
  end if;
  -- Archived means switched off, whatever the stored status said.
  v_was_closed := v_old.operating_status = 'permanently_closed' or not v_old.active;

  update public.venues v
  set operating_status = p_status,
      active = p_status <> 'permanently_closed',
      archived_at = case when p_status = 'permanently_closed'
        then coalesce(v.archived_at, now()) end,
      revision = v.revision + 1, updated_at = now()
  where v.id = p_venue_id
  returning * into v_new;
  perform private.record_activity(v_new.id,
    case
      when p_status = 'permanently_closed' then 'venue_archived'
      when v_was_closed then 'venue_restored'
      else 'venue_status_changed'
    end,
    'venue', v_new.id::text, v_old.revision, v_new.revision, v_reason,
    jsonb_build_object('operatingStatus', v_old.operating_status, 'active', v_old.active),
    jsonb_build_object('operatingStatus', v_new.operating_status, 'active', v_new.active));
  return private.venue_json(v_new) || jsonb_build_object('changed', true);
end;
$$;

revoke all on function public.admin_venue_set_status(uuid, text, text, integer)
from public, anon, service_role;
grant execute on function public.admin_venue_set_status(uuid, text, text, integer)
to authenticated;
