-- Run against an isolated database after applying the watchdog migration.
-- Uses only synthetic monitor state and rolls its changes back.
begin;
do $$
declare
  first_claim jsonb;
  retry_claim jsonb;
  recovery_claim jsonb;
  result jsonb;
begin
  if has_function_privilege('anon', 'public.record_archive_monitor_heartbeat()', 'execute')
    or has_function_privilege('authenticated', 'public.claim_archive_monitor_alert()', 'execute')
    or has_function_privilege('anon', 'public.complete_archive_monitor_alert(uuid,uuid)', 'execute')
    or has_table_privilege('service_role', 'private.archive_monitor_heartbeat', 'update') then
    raise exception 'watchdog privilege boundary failed';
  end if;

  first_claim := public.claim_archive_monitor_alert();
  if first_claim->>'stopped' <> 'true' or first_claim#>>'{event,kind}' <> 'stopped' then
    raise exception 'missing heartbeat did not create an incident';
  end if;
  result := public.claim_archive_monitor_alert();
  if result->'event' <> 'null'::jsonb then
    raise exception 'duplicate invocation claimed an in-flight email';
  end if;

  perform public.record_archive_monitor_heartbeat();
  result := public.claim_archive_monitor_alert();
  if result->>'stopped' <> 'false' or result->'event' <> 'null'::jsonb then
    raise exception 'recovery lost ordering behind a claimed incident';
  end if;
  update private.archive_monitor_alerts set claimed_until = now() - interval '1 second';
  retry_claim := public.claim_archive_monitor_alert();
  if retry_claim#>>'{event,id}' <> first_claim#>>'{event,id}'
    or retry_claim#>>'{event,claimId}' = first_claim#>>'{event,claimId}' then
    raise exception 'expired delivery claim did not retain original event';
  end if;
  if public.complete_archive_monitor_alert(
    (first_claim#>>'{event,id}')::uuid, (first_claim#>>'{event,claimId}')::uuid) then
    raise exception 'stale claim acknowledged a newer delivery attempt';
  end if;
  if not public.complete_archive_monitor_alert(
    (retry_claim#>>'{event,id}')::uuid, (retry_claim#>>'{event,claimId}')::uuid) then
    raise exception 'current delivery claim could not acknowledge';
  end if;
  recovery_claim := public.claim_archive_monitor_alert();
  if recovery_claim#>>'{event,kind}' <> 'recovered' then
    raise exception 'recovery event was not retained behind failed incident';
  end if;
  perform public.complete_archive_monitor_alert(
    (recovery_claim#>>'{event,id}')::uuid, (recovery_claim#>>'{event,claimId}')::uuid);
  result := public.claim_archive_monitor_alert();
  if result->'event' <> 'null'::jsonb or result->>'stopped' <> 'false' then
    raise exception 'healthy state was not deduplicated';
  end if;

  update private.archive_monitor_heartbeat set last_seen_at = now() - interval '26 minutes';
  result := public.claim_archive_monitor_alert();
  if result#>>'{event,kind}' <> 'stopped' then
    raise exception '25-minute heartbeat timeout did not alert';
  end if;
  if (select count(*) from private.archive_monitor_alerts) <> 3 then
    raise exception 'condition transitions generated duplicate or missing events';
  end if;
end;
$$;
rollback;
