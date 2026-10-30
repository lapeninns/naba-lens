-- App-owned triggers attached to Supabase-managed tables are excluded from the
-- CLI's app-schema dump. Their public/private functions are in schema.sql.
-- This query is shared by backup export and post-restore comparison.
set search_path = pg_catalog;

do $$
begin
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261030100000'
  ) and not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'storage.objects'::regclass
      and t.tgname = 'nabalens_guard_media_original_write'
      and t.tgfoid = to_regprocedure('private.guard_media_original_write()')
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ) then
    raise exception 'The media original-write guard is missing or not enabled.';
  end if;
end;
$$;

select pg_get_triggerdef(t.oid, false) || ';' ||
  -- CREATE TRIGGER already enables ordinary (O) triggers. Avoid an unnecessary
  -- owner-only ALTER on managed tables, where postgres has TRIGGER but not ownership.
  case when t.tgenabled = 'O' then '' else E'\n' ||
  format('alter table %I.%I %s trigger %I;', n.nspname, c.relname,
    case t.tgenabled
      when 'D' then 'disable'
      when 'R' then 'enable replica'
      when 'A' then 'enable always'
    end, t.tgname) end
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
join pg_namespace fn on fn.oid = p.pronamespace
where not t.tgisinternal
  and n.nspname in ('auth', 'storage')
  and fn.nspname in ('public', 'private')
order by n.nspname, c.relname, t.tgname;
