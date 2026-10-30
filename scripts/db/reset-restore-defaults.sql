-- Supabase's blank template grants anon/authenticated broad default privileges
-- in public. pg_dump assumes ordinary PostgreSQL creation defaults and omits
-- REVOKEs for roles absent from a source object's ACL. Remove schema-local extra
-- defaults while schema.sql creates objects; its trailing ALTER DEFAULT
-- PRIVILEGES restores the source defaults. This transaction changes no existing
-- managed-table privileges and grants no new privilege.
do $$
declare d record;
begin
  for d in
    select distinct n.nspname, a.grantee,
      case p.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences'
        when 'f' then 'functions' when 'T' then 'types' end as object_kind
    from pg_default_acl p
    join pg_namespace n on n.oid = p.defaclnamespace
    cross join lateral aclexplode(p.defaclacl) a
    where p.defaclrole = current_user::regrole
      and n.nspname in ('public', 'private') and p.defaclobjtype in ('r', 'S', 'f', 'T')
  loop
    execute format('alter default privileges in schema %I revoke all on %s from %s',
      d.nspname, d.object_kind,
      case when d.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(d.grantee)) end);
  end loop;
end;
$$;
