// SQL for the B04-d database spec (tests/security/menus-recheck-b04.test.ts),
// kept apart so the same scripts can be run as they are against any local
// database. Each script runs the shared fixture fx_menu_recheck_public_withdrawal
// (tests/fixtures/menus/recheck-public-withdrawal) in one psql session and
// one transaction that always rolls back, and prints one `LABEL {json}` line
// per checkpoint.
import { join } from "node:path"

export const FIXTURE_DIR = join(
  process.cwd(),
  "tests/fixtures/menus/recheck-public-withdrawal"
)

const q = (text: string) => `'${text.replace(/'/g, "''")}'`
const include = (dir: string, file: string) => `\\i ${q(join(dir, file))}`

/** The open London month of the credit function, and the one before it. */
const MONTH = `date_trunc('month', now() at time zone 'Europe/London')::date`
const PREVIOUS = `(${MONTH} - interval '1 month')::date`

const head = `\\set ON_ERROR_STOP on
\\pset format unaligned
\\pset tuples_only on
begin;`

/** Fixture keys as psql variables (read as postgres before any role switch). */
const keys = `select
  max(id::text) filter (where key = 'venue') as fx_venue_id,
  max(id::text) filter (where key = 'staff') as fx_staff_id,
  max(id::text) filter (where key = 'manager') as fx_manager_id,
  max(id::text) filter (where key = 'admin') as fx_admin_id,
  max(id::text) filter (where key = 'v2') as fx_v2_id
from fx_menu_recheck \\gset`

const credit = (period: string) =>
  `(select menu_items_completed from private.monthly_venue_completion_counts(
    :'fx_venue_id', :'fx_staff_id', ${period}))`

/** One row per fixture item: the photo's state, kind, primary and head. */
const photos = `(select json_object_agg(f.key, json_build_object(
    'state', p.state, 'recheckKind', p.recheck_kind, 'primary', p.is_primary,
    'head', (select h.revision from public.menu_item_photo_heads h where h.item_id = f.item_id),
    'itemId', p.item_id,
    'events', (select json_agg(e.action || ':' || coalesce(e.detail ->> 'kind', '-') order by e.id)
               from public.menu_item_photo_events e where e.photo_id = p.id)) order by f.key)
  from fx_menu_recheck f join public.menu_item_photos p on p.id = f.photo_id)`

const checkpoint = (
  label: string
) => `select ${q(label)} || ' ' || json_build_object(
  'open', ${credit(MONTH)}, 'closed', ${credit(PREVIOUS)}, 'photos', ${photos},
  'creditMd5', (select md5(pg_get_functiondef(
    'private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))))::text;`

/** The fixture as WS3 runs it: load, activate, re-accept E. */
export function fixtureScript(dir = FIXTURE_DIR) {
  return `${head}
${include(dir, "menu.sql")}
${keys}
${checkpoint("BEFORE")}
${include(dir, "menu-activate.sql")}
${checkpoint("AFTER")}
${include(dir, "menu-reaccept.sql")}
select 'REACCEPT ' || json_build_object('open', ${credit(MONTH)},
  'E', (select json_build_object('state', p.state, 'primary', p.is_primary)
        from public.menu_item_photos p join fx_menu_recheck f on f.key = 'E'
          and p.asset_id = f.asset_id and p.item_id = f.item_id
        order by p.created_at desc, p.id desc limit 1))::text;
rollback;
`
}

/**
 * Variant scope and trading: before activation D gets two more accepted
 * photos (its Beef variant, and the item itself), and C has a trading line
 * for each variant. v2 declares Bean's meaning and drops C's Lamb.
 */
export function scopeScript(dir = FIXTURE_DIR) {
  return `${head}
${include(dir, "menu.sql")}
${keys}
select json_build_object('sub', :'fx_staff_id', 'role', 'authenticated')::text as staff_claims,
  json_build_object('sub', :'fx_manager_id', 'role', 'authenticated')::text as manager_claims,
  (select item_id from fx_menu_recheck where key = 'D') as d_item,
  (select item_id from fx_menu_recheck where key = 'C') as c_item,
  (select max(id::text) from fx_menu_recheck where key = 'v1') as v1,
  (select max(ev.variant_id::text) from public.menu_entry_variants ev join public.menu_entries e on e.id = ev.entry_id
   where e.version_id = (select id from fx_menu_recheck where key = 'v1') and e.source_key = 'food--d' and ev.name = 'Beef') as d_beef,
  (select max(ev.variant_id::text) from public.menu_entry_variants ev join public.menu_entries e on e.id = ev.entry_id
   where e.version_id = (select id from fx_menu_recheck where key = 'v1') and e.source_key = 'food--c' and ev.name = 'Chicken') as c_chicken,
  (select variant_id from fx_menu_recheck where key = 'C') as c_lamb \\gset
set role authenticated;
select set_config('request.jwt.claims', :'staff_claims', false);
select r.id as beef_asset from public.reserve_media_asset('image', 'jpg', 'Fixture recheck D beef.jpg', 4,
  'fixture-recheck-scope-beef-' || substr(md5(random()::text), 1, 12)) r \\gset
select r.id as plain_asset from public.reserve_media_asset('image', 'jpg', 'Fixture recheck D plain.jpg', 4,
  'fixture-recheck-scope-plain-' || substr(md5(random()::text), 1, 12)) r \\gset
reset role;
set role service_role;
update public.media_assets set upload_state = 'processing' where id in (:'beef_asset', :'plain_asset');
update public.media_assets set upload_state = 'ready', validated_mime_type = 'image/jpeg', size_bytes = 4,
  width = 1, height = 1 where id in (:'beef_asset', :'plain_asset');
reset role;
set role authenticated;
select set_config('request.jwt.claims', :'staff_claims', false);
select * from public.save_media_labels(:'beef_asset', 0, '{}', null,
  jsonb_build_array(jsonb_build_object('itemId', :'d_item', 'variantId', :'d_beef')), null, :'v1');
select * from public.save_media_labels(:'plain_asset', 0, '{}', null,
  jsonb_build_array(jsonb_build_object('itemId', :'d_item', 'variantId', null)), null, :'v1');
reset role;
select coalesce((select revision from public.menu_item_photo_heads where item_id = :'d_item'), 1) as d_rev \\gset
set role authenticated;
select set_config('request.jwt.claims', :'manager_claims', false);
select * from public.review_menu_item_photo(:'beef_asset', :'d_item', :'d_beef', 'accepted', :d_rev, null, false, null);
reset role;
select coalesce((select revision from public.menu_item_photo_heads where item_id = :'d_item'), 1) as d_rev \\gset
set role authenticated;
select set_config('request.jwt.claims', :'manager_claims', false);
select * from public.review_menu_item_photo(:'plain_asset', :'d_item', null, 'accepted', :d_rev, null, false, null);
reset role;
insert into public.menu_trading_lines (venue_id, item_id, variant_id, created_by) values
  (:'fx_venue_id', :'c_item', :'c_lamb', :'fx_manager_id'),
  (:'fx_venue_id', :'c_item', :'c_chicken', :'fx_manager_id');
${include(dir, "menu-activate.sql")}
select 'SCOPE ' || json_build_object(
  'dPhotos', (select json_object_agg(coalesce(p.variant_name, 'item'), p.state || ':' || coalesce(p.recheck_kind, '-'))
              from public.menu_item_photos p
              where p.item_id = :'d_item' and p.state in ('accepted', 'needs_recheck')),
  'cLines', (select json_object_agg(case when l.variant_id = :'c_lamb' then 'Lamb' else 'Chicken' end,
                json_build_object('retired', l.retired_at is not null, 'retiredBy', l.retired_by,
                  'revision', l.revision))
             from public.menu_trading_lines l
             where l.item_id = :'c_item'),
  'admin', :'fx_admin_id')::text;
rollback;
`
}

/** Runs one statement as a signed-in caller and prints its outcome. */
const attempt = (
  label: string,
  claims: string,
  sql: string
) => `set role authenticated;
select set_config('request.jwt.claims', ${claims}, true);
do $probe$ begin
  perform set_config('fx.out', coalesce((${sql})::text, 'null'), true);
exception when others then
  perform set_config('fx.out', 'error:' || sqlerrm, true);
end $probe$;
reset role;
select ${q(label)} || ' ' || to_json(current_setting('fx.out'))::text;`

/** The commands: switch, roles, replay, validation, draft only. */
export function commandsScript(dir = FIXTURE_DIR) {
  const admin = `json_build_object('sub', current_setting('fx.admin'), 'role', 'authenticated')::text`
  const manager = `json_build_object('sub', current_setting('fx.manager'), 'role', 'authenticated')::text`
  const add = (item: string, variant: string, kind: string, note: string) =>
    `public.menu_change_declaration_add(current_setting('fx.v2')::uuid, ${item}, ${variant}, ${q(kind)}, ${q(note)})`
  const item = (key: string) => `current_setting('fx.${key}')::uuid`
  return `${head}
${include(dir, "menu.sql")}
${keys}
select set_config('fx.admin', :'fx_admin_id', false), set_config('fx.manager', :'fx_manager_id', false),
  set_config('fx.v2', :'fx_v2_id', false),
  set_config('fx.e', (select item_id::text from fx_menu_recheck where key = 'E'), false),
  set_config('fx.d', (select item_id::text from fx_menu_recheck where key = 'D'), false),
  set_config('fx.other', (select i.id::text from public.menu_items i where i.venue_id <> :'fx_venue_id' limit 1), false),
  set_config('fx.decl', (select d.id::text from public.menu_change_declarations d
    where d.version_id = :'fx_v2_id' and d.kind = 'recipe'), false),
  set_config('fx.presentation', (select d.id::text from public.menu_change_declarations d
    where d.version_id = :'fx_v2_id' and d.kind = 'presentation'), false) \\gset
${attempt("OFF_ADD", admin, add(item("e"), "null", "recipe", "Fixture recipe"))}
${attempt("OFF_REMOVE", admin, `public.menu_change_declaration_remove(current_setting('fx.decl')::uuid)`)}
update private.menu_switches set enabled = true where name = 'menuChangeDeclarations';
${attempt("MANAGER", manager, add(item("e"), "null", "recipe", "Fixture recipe"))}
${attempt("REPLAY", admin, add(item("e"), "null", "presentation", "Fixture: now served in a bowl."))}
${attempt("OTHER_NOTE", admin, add(item("e"), "null", "presentation", "Fixture: another note."))}
${attempt("NEW", admin, add(item("e"), "null", "recipe", "Fixture: new dressing."))}
${attempt("NO_VARIANT", admin, add(item("d"), "null", "variant_meaning", "Fixture: unnamed variant."))}
${attempt("OFF_VERSION", admin, add(`nullif(current_setting('fx.other'), '')::uuid`, "null", "recipe", "Fixture: elsewhere."))}
${attempt("BAD_KIND", admin, add(item("e"), "null", "price", "Fixture: not a kind."))}
${attempt("READ", admin, `public.menu_change_declarations_for_version(current_setting('fx.v2')::uuid)`)}
${attempt("REMOVE", admin, `public.menu_change_declaration_remove(current_setting('fx.decl')::uuid)`)}
select 'REMOVED ' || to_json((select count(*) from public.menu_change_declarations d
  where d.id = current_setting('fx.decl')::uuid))::text;
${include(dir, "menu-activate.sql")}
${attempt("ACTIVE_ADD", admin, add(item("e"), "null", "portion", "Fixture: too late."))}
${attempt("ACTIVE_REMOVE", admin, `public.menu_change_declaration_remove(current_setting('fx.presentation')::uuid)`)}
do $probe$ begin
  update public.menu_change_declarations set note = 'x' where version_id = current_setting('fx.v2')::uuid;
  perform set_config('fx.out', 'allowed', true);
exception when others then perform set_config('fx.out', sqlerrm, true); end $probe$;
select 'DIRECT_UPDATE ' || to_json(current_setting('fx.out'))::text;
do $probe$ begin
  delete from public.menu_change_declarations where version_id = current_setting('fx.v2')::uuid;
  perform set_config('fx.out', 'allowed', true);
exception when others then perform set_config('fx.out', sqlerrm, true); end $probe$;
select 'DIRECT_DELETE ' || to_json(current_setting('fx.out'))::text;
rollback;
`
}

/**
 * Closed months: the fixture's photo history is moved one month back (its
 * append-only guard paused inside this rolled-back transaction), so the
 * author's units belong to a closed month; activation then leaves that month
 * exactly as it was.
 */
export function closedMonthScript(dir = FIXTURE_DIR) {
  return `${head}
${include(dir, "menu.sql")}
${keys}
alter table public.menu_item_photo_events disable trigger menu_item_photo_events_append_only;
update public.menu_item_photo_events set created_at = created_at - interval '1 month'
where venue_id = :'fx_venue_id';
alter table public.menu_item_photo_events enable trigger menu_item_photo_events_append_only;
select 'CLOSED_BEFORE ' || json_build_object('open', ${credit(MONTH)}, 'closed', ${credit(PREVIOUS)})::text;
${include(dir, "menu-activate.sql")}
select 'CLOSED_AFTER ' || json_build_object('open', ${credit(MONTH)}, 'closed', ${credit(PREVIOUS)})::text;
rollback;
`
}

/** Parses `LABEL {json}` lines into a record. */
export function checkpoints(lines: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const line of lines) {
    const m = /^([A-Z_]+) (.*)$/.exec(line)
    if (m) out[m[1]!] = JSON.parse(m[2]!)
  }
  return out
}
