// SQL for the B04-b2 freshness spec (tests/security/menus-freshness-b04.test.ts).
// One psql session and one transaction that always rolls back, on the shared
// fixture world of tests/fixtures/menus/recheck-public-withdrawal/menu.sql
// (a synthetic venue, manager, staff author and admin, with menu v1 active
// and one accepted photo per item). Prints one `LABEL json` line per check.
import { join } from "node:path"

export const FIXTURE_DIR = join(
  process.cwd(),
  "tests/fixtures/menus/recheck-public-withdrawal"
)

const q = (text: string) => `'${text.replace(/'/g, "''")}'`

/** Runs `sql` as a signed-in caller (claims psql variable) into a label. */
const as = (
  label: string,
  claims: string,
  sql: string
) => `set role authenticated;
select set_config('request.jwt.claims', :'${claims}', true);
select set_config('fx.out', coalesce((${sql})::text, 'null'), true);
reset role;
select ${q(label)} || ' ' || current_setting('fx.out');`

/** The same, catching the error message instead. */
const refused = (
  label: string,
  claims: string,
  sql: string
) => `set role authenticated;
select set_config('request.jwt.claims', :'${claims}', true);
savepoint fx_try;
do $probe$ begin
  perform set_config('fx.err', 'allowed', true);
  perform ${sql};
exception when others then
  perform set_config('fx.err', sqlerrm, true);
end $probe$;
release savepoint fx_try;
reset role;
select ${q(label)} || ' ' || to_json(current_setting('fx.err'))::text;`

/** Arguments inside a DO probe, which psql does not interpolate. */
const V = `current_setting('fx.venue')::uuid`
const S = (name: string) => `current_setting('fx.${name}')`

const propose = (item: string, field: string, value: string) =>
  `public.menu_trading_propose(null, :'${item}', null, null, null, ${q(field)}, ${q(value)}::jsonb, null, null, null, null, null, gen_random_uuid())`

/** As the manager: propose and confirm, stated on `statedOn` (SQL date). */
const confirmed = (
  key: string,
  item: string,
  field: string,
  value: string,
  statedOn: string
) => `set role authenticated;
select set_config('request.jwt.claims', :'manager_claims', true);
select p ->> 'assertionId' as ${key}_assertion, p ->> 'lineId' as ${key}_line, p ->> 'lineRevision' as ${key}_rev
from (select ${propose(item, field, value)} as p) x \\gset
select public.menu_trading_decide(:'${key}_assertion', :${key}_rev, 'confirmed', null, ${statedOn},
  gen_random_uuid()) is not null as ${key}_ok \\gset
reset role;`

const history = (line: string, at: string) =>
  `public.menu_trading_history(:'${line}', ${at})`

const tasks = `(select coalesce(json_agg(t.key || ':' || t.field || ':' || t.cause || ':' || t.use || ':' || t.state
    order by t.key, t.cause, t.use), '[]'::json)
  from (select case t.line_id when :'a_line'::uuid then 'A' when :'b_line'::uuid then 'B'
      when :'c_line'::uuid then 'C' when :'d_line'::uuid then 'D' else '?' end as key, t.*
    from public.menu_trading_recheck_tasks t where t.venue_id = :'fx_venue_id') t)`

const invariants = `json_build_object(
  'photos', (select md5(coalesce(string_agg(to_jsonb(p)::text, ',' order by p.id), '')) from public.menu_item_photos p
             where p.venue_id = :'fx_venue_id'),
  'events', (select count(*) from public.menu_item_photo_events e where e.venue_id = :'fx_venue_id'),
  'credit', (select menu_items_completed from private.monthly_venue_completion_counts(:'fx_venue_id', :'fx_staff_id',
             date_trunc('month', now() at time zone 'Europe/London')::date)),
  'creditMd5', (select md5(pg_get_functiondef('private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))))`

export function freshnessScript(dir = FIXTURE_DIR) {
  return `\\set ON_ERROR_STOP on
\\pset format unaligned
\\pset tuples_only on
begin;
\\i ${q(join(dir, "menu.sql"))}
select
  max(id::text) filter (where key = 'venue') as fx_venue_id,
  max(id::text) filter (where key = 'staff') as fx_staff_id,
  max(item_id::text) filter (where key = 'A') as item_a,
  max(item_id::text) filter (where key = 'B') as item_b,
  max(item_id::text) filter (where key = 'E') as item_c,
  max(item_id::text) filter (where key = 'F') as item_d,
  json_build_object('sub', max(id::text) filter (where key = 'admin'), 'role', 'authenticated')::text as admin_claims,
  json_build_object('sub', max(id::text) filter (where key = 'manager'), 'role', 'authenticated')::text as manager_claims,
  json_build_object('sub', max(id::text) filter (where key = 'staff'), 'role', 'authenticated')::text as staff_claims,
  'fx_menu_price_' || substr(md5(random()::text), 1, 12) as pol,
  ((now() at time zone 'Europe/London')::date) as today
from fx_menu_recheck \\gset
\\set pol_pub :pol '_pub'
\\set pol_obs :pol '_obs'
\\set pol_evt :pol '_evt'
select set_config('fx.venue', :'fx_venue_id', false), set_config('fx.pol', :'pol', false),
  set_config('fx.pol_obs', :'pol_obs', false), set_config('fx.pol_evt', :'pol_evt', false) \\gset
insert into public.knowledge_freshness_policies (id, version, claim_class, use, max_age, recheck_lead, basis, note)
values
  (:'pol', 1, 'offering', 'internal', interval '10 days', interval '2 days', 'stated_on', 'Fixture menu price'),
  (:'pol_pub', 1, 'offering', 'public', interval '30 days', null, 'stated_on', 'Fixture menu price, public'),
  (:'pol_obs', 1, 'offering', 'internal', interval '10 days', null, 'observed_on', 'Fixture observed basis'),
  (:'pol_evt', 1, 'event', 'internal', null, null, 'event_end', 'Fixture event');
select 'INVARIANTS_BEFORE ' || ${invariants}::text;
${confirmed("a", "item_a", "price", '{"amount":"12.00"}', `(:'today'::date - 9)`)}
${confirmed("b", "item_b", "price", '{"amount":"8.00"}', `:'today'::date`)}
${confirmed("c", "item_c", "price", '{"amount":"9.50"}', `(:'today'::date - 12)`)}
${confirmed("d", "item_d", "availability", '{"state":"always"}', `(:'today'::date - 12)`)}
${as("UNBOUND", "manager_claims", `${history("a_line", "now()")} -> 'price'`)}
${as("BIND_INTERNAL", "admin_claims", `public.menu_freshness_binding_add(:'fx_venue_id', 'price', 'internal', :'pol', 1, null)`)}
${as("BIND_PUBLIC", "admin_claims", `public.menu_freshness_binding_add(:'fx_venue_id', 'price', 'public', :'pol_pub', 1, null)`)}
${as("BIND_AVAILABILITY", "admin_claims", `public.menu_freshness_binding_add(:'fx_venue_id', 'availability', 'internal', :'pol', 1, null)`)}
${refused("BIND_OBSERVED", "admin_claims", `public.menu_freshness_binding_add(${V}, 'price', 'internal', ${S("pol_obs")}, 1, null)`)}
${refused("BIND_EVENT", "admin_claims", `public.menu_freshness_binding_add(${V}, 'price', 'internal', ${S("pol_evt")}, 1, null)`)}
${refused("BIND_WRONG_USE", "admin_claims", `public.menu_freshness_binding_add(${V}, 'price', 'public', ${S("pol")}, 1, null)`)}
${refused("BIND_UNKNOWN", "admin_claims", `public.menu_freshness_binding_add(${V}, 'price', 'internal', 'fx_menu_no_such_policy', 1, null)`)}
${refused("BIND_RETRO", "admin_claims", `public.menu_freshness_binding_add(${V}, 'price', 'internal', ${S("pol")}, 1, now() - interval '1 day')`)}
${refused("BIND_FIELD", "admin_claims", `public.menu_freshness_binding_add(${V}, 'photo', 'internal', ${S("pol")}, 1, null)`)}
${refused("BIND_MANAGER", "manager_claims", `public.menu_freshness_binding_add(${V}, 'price', 'internal', ${S("pol")}, 1, null)`)}
select ((:'today'::date - 9)::timestamp + interval '10 days') at time zone 'Europe/London' as a_due \\gset
select 'A_DUE ' || to_json(:'a_due'::timestamptz)::text;
${as("A_BEFORE_DUE", "manager_claims", `${history("a_line", `:'a_due'::timestamptz - interval '1 second'`)} -> 'price'`)}
${as("A_AFTER_DUE", "manager_claims", `${history("a_line", `:'a_due'::timestamptz + interval '1 second'`)} -> 'price'`)}
${as("B_NOW", "manager_claims", `${history("b_line", "now()")} -> 'price'`)}
${as("C_MANAGER", "manager_claims", `${history("c_line", "now()")} -> 'price'`)}
${as(
  "C_STAFF",
  "staff_claims",
  `(select l from jsonb_array_elements(public.menu_trading_lines_for_item(:'item_c') -> 'lines') l
  where l ->> 'lineId' = :'c_line') -> 'price'`
)}
${as("D_MANAGER", "manager_claims", `${history("d_line", "now()")} -> 'availability'`)}
${as(
  "D_STAFF",
  "staff_claims",
  `(select l from jsonb_array_elements(public.menu_trading_lines_for_item(:'item_d') -> 'lines') l
  where l ->> 'lineId' = :'d_line') -> 'availability'`
)}
select 'BASIS_MISSING ' || private.menu_trading_freshness(:'fx_venue_id', 'price', '{"status":"available"}'::jsonb, now())::text;
select 'TASKS_STOPPED ' || ${tasks}::text;
${as("PREVIEW", "admin_claims", `public.menu_freshness_preview(:'fx_venue_id', 'price', jsonb_build_object('internal', :'pol'))`)}
${refused("PREVIEW_MANAGER", "manager_claims", `public.menu_freshness_preview(${V}, 'price', jsonb_build_object('internal', ${S("pol")}))`)}
${refused("PREVIEW_UNKNOWN", "admin_claims", `public.menu_freshness_preview(${V}, 'price', jsonb_build_object('internal', 'fx_menu_no_such_policy'))`)}
select 'OPENED_1 ' || private.menu_open_rechecks(now(), array[:'fx_venue_id']::uuid[]);
select 'OPENED_2 ' || private.menu_open_rechecks(now(), array[:'fx_venue_id']::uuid[]);
select 'TASKS_NOW ' || ${tasks}::text;
select 'OPENED_DUE ' || private.menu_open_rechecks(:'a_due'::timestamptz + interval '1 second', array[:'fx_venue_id']::uuid[]);
select 'TASKS_DUE ' || ${tasks}::text;
select l.revision as c_rev_now from public.menu_trading_lines l where l.id = :'c_line' \\gset
set role authenticated;
select set_config('request.jwt.claims', :'manager_claims', true);
select public.menu_trading_decide(:'c_assertion', :c_rev_now, 'withdrawn', null, null,
  gen_random_uuid()) is not null as c_withdrawn \\gset
reset role;
select 'OPENED_AFTER_WITHDRAW ' || private.menu_open_rechecks(now(), array[:'fx_venue_id']::uuid[]);
select 'TASKS_AFTER_WITHDRAW ' || ${tasks}::text;
${confirmed("c2", "item_c", "price", '{"amount":"9.75"}', `:'today'::date`)}
select 'TASKS_AFTER_RESTATE ' || ${tasks}::text;
select 'INVARIANTS_AFTER ' || ${invariants}::text;
${as("UNBIND", "admin_claims", `public.menu_freshness_binding_add(:'fx_venue_id', 'price', 'internal', null, null, now() + interval '1 second')`)}
${as("A_UNBOUND", "manager_claims", `${history("a_line", "now() + interval '2 seconds'")} -> 'price'`)}
savepoint fx_append;
do $probe$ begin
  update public.menu_freshness_bindings set policy_version = 1;
  perform set_config('fx.err', 'allowed', true);
exception when others then perform set_config('fx.err', sqlerrm, true); end $probe$;
select 'BINDING_UPDATE ' || to_json(current_setting('fx.err'))::text;
rollback to savepoint fx_append;
rollback;
`
}

/** Parses `LABEL json` lines into a record. */
export function checkpoints(lines: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const line of lines) {
    const m = /^([A-Z0-9_]+) (.*)$/.exec(line)
    if (m) out[m[1]!] = JSON.parse(m[2]!)
  }
  return out
}
