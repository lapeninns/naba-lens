-- Stable ACL inventory for app objects. Resolve role/object OIDs to names so a
-- fresh cluster can be compared exactly, including column and default grants.
set search_path = pg_catalog;

with objects(kind, name, owner, acl) as (
  select 'schema', nspname, nspowner, coalesce(nspacl, acldefault('n', nspowner))
  from pg_namespace where nspname in ('public', 'private')
  union all
  select 'relation', format('%I.%I', n.nspname, c.relname), c.relowner,
    coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end, c.relowner))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  union all
  select 'column', format('%I.%I.%I', n.nspname, c.relname, a.attname), c.relowner,
    a.attacl
  from pg_attribute a join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and a.attnum > 0 and not a.attisdropped
    and a.attacl is not null
  union all
  select 'function', format('%I.%I(%s)', n.nspname, p.proname,
    pg_get_function_identity_arguments(p.oid)), p.proowner,
    coalesce(p.proacl, acldefault('f', p.proowner))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
  union all
  select 'type', format('%I.%I', n.nspname, t.typname), t.typowner,
    coalesce(t.typacl, acldefault('T', t.typowner))
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname in ('public', 'private') and t.typtype in ('d', 'e')
  union all
  select 'default', coalesce(n.nspname, '*') || '/' || d.defaclobjtype::text,
    d.defaclrole, d.defaclacl
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
  where d.defaclnamespace = 0 or n.nspname in ('public', 'private')
), normalized as (
  select kind, name, pg_get_userbyid(owner) as owner,
    coalesce((select jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),
      case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      a.privilege_type, a.is_grantable)
      order by a.grantor::regrole::text, a.grantee::regrole::text, a.privilege_type, a.is_grantable)
      from aclexplode(acl) a), '[]'::jsonb) as grants
  from objects
)
select coalesce(jsonb_agg(to_jsonb(normalized) order by kind, name, owner), '[]'::jsonb)
from normalized;
