-- B05-m1 restore check (docs/backup-restore.md, contracts/b05-design.md §2.4
-- gate fix 1). A replica-mode load (session_replication_role = replica) skips
-- the media_assets_use_baseline_on_insert trigger, so every row created
-- before the B05-m1 cutover must already read 'legacy_unknown'. Runs inside
-- the load transaction and aborts it otherwise. Read only. A pre-B05 schema
-- has no cutover table: B05-m1's constant default marks those rows when the
-- migration runs, so there is nothing to check.
do $$
declare
  v_bad bigint;
begin
  if to_regclass('private.media_use_settings') is null then
    return;
  end if;
  if (select count(*) from private.media_use_settings) <> 1 then
    raise exception 'use_baseline check: private.media_use_settings must hold exactly one cutover row';
  end if;
  select count(*) into v_bad
  from public.media_assets a, private.media_use_settings s
  where a.created_at < s.cutover_at and a.use_baseline <> 'legacy_unknown';
  if v_bad <> 0 then
    raise exception 'use_baseline check: % row(s) created before the B05 cutover are not legacy_unknown', v_bad;
  end if;
end;
$$;
