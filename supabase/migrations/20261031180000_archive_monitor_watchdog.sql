-- Independent Cloudflare monitor heartbeat and ordered email delivery outbox.
-- Only service-role RPCs can access this state; browser users have no grants.
create table private.archive_monitor_heartbeat (
  singleton boolean primary key default true check (singleton),
  last_seen_at timestamptz,
  incident_open boolean not null default false
);
insert into private.archive_monitor_heartbeat(singleton) values (true);
create table private.archive_monitor_alerts (
  sequence bigint generated always as identity primary key,
  id uuid not null default gen_random_uuid() unique,
  kind text not null check (kind in ('stopped', 'recovered')),
  observed_at timestamptz not null default now(),
  last_seen_at timestamptz,
  claim_id uuid,
  claimed_until timestamptz,
  delivered_at timestamptz
);
create index archive_monitor_alerts_pending_idx
  on private.archive_monitor_alerts(sequence) where delivered_at is null;
alter table private.archive_monitor_heartbeat enable row level security;
alter table private.archive_monitor_alerts enable row level security;
revoke all on private.archive_monitor_heartbeat, private.archive_monitor_alerts
  from public, anon, authenticated, service_role;
revoke all on sequence private.archive_monitor_alerts_sequence_seq
  from public, anon, authenticated, service_role;

create function public.record_archive_monitor_heartbeat()
returns void language sql security definer set search_path = '' as $$
  update private.archive_monitor_heartbeat set last_seen_at = now() where singleton;
$$;

-- Locking the singleton serializes transitions and claims across duplicate cron
-- invocations. An old undelivered incident always precedes its recovery.
create function public.claim_archive_monitor_alert()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  state private.archive_monitor_heartbeat%rowtype;
  pending private.archive_monitor_alerts%rowtype;
  stopped boolean;
  claim uuid;
begin
  select * into strict state from private.archive_monitor_heartbeat
    where singleton for update;
  stopped := state.last_seen_at is null or state.last_seen_at < now() - interval '25 minutes';
  if stopped <> state.incident_open then
    insert into private.archive_monitor_alerts(kind, last_seen_at)
      values (case when stopped then 'stopped' else 'recovered' end, state.last_seen_at);
    update private.archive_monitor_heartbeat set incident_open = stopped where singleton;
  end if;
  select * into pending from private.archive_monitor_alerts
    where delivered_at is null order by sequence limit 1 for update;
  if pending.id is null or pending.claimed_until > now() then
    return jsonb_build_object('stopped', stopped, 'event', null);
  end if;
  claim := gen_random_uuid();
  update private.archive_monitor_alerts set claim_id = claim,
    claimed_until = now() + interval '60 seconds' where id = pending.id;
  return jsonb_build_object('stopped', stopped, 'event', jsonb_build_object(
    'id', pending.id, 'claimId', claim, 'kind', pending.kind,
    'observedAt', pending.observed_at, 'lastSeenAt', pending.last_seen_at));
end;
$$;

create function public.complete_archive_monitor_alert(p_event_id uuid, p_claim_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.archive_monitor_alerts set delivered_at = now(), claimed_until = null
    where id = p_event_id and claim_id = p_claim_id and delivered_at is null;
  return found;
end;
$$;
revoke all on function public.record_archive_monitor_heartbeat(),
  public.claim_archive_monitor_alert(), public.complete_archive_monitor_alert(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_archive_monitor_heartbeat(),
  public.claim_archive_monitor_alert(), public.complete_archive_monitor_alert(uuid, uuid)
  to service_role;
