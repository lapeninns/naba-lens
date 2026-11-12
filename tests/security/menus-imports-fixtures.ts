// SQL for the B04-e spec (tests/security/menus-imports-b04.test.ts): import
// dry runs, per-line review, releases bound to a catalogue version, the
// activation guard, an injected failure and retry, and two successive source
// versions. One psql session and one transaction that always rolls back, on
// the shared fixture world of tests/fixtures/menus/recheck-public-withdrawal
// (v1 active; the v2 draft renames A, moves B to drinks, drops C's Lamb).
// Prints one `LABEL json` line per check.
//
// Field authority switches have no product path yet (S1 refuses them until
// the owner decides OD-B4-1): the script inserts the price row as postgres,
// inside the rolled-back transaction, to exercise the guard.
import { join } from "node:path"

export const FIXTURE_DIR = join(
  process.cwd(),
  "tests/fixtures/menus/recheck-public-withdrawal"
)

const q = (text: string) => `'${text.replace(/'/g, "''")}'`

/** Runs `sql` as the admin into a label. */
const admin = (label: string, sql: string) => `set role authenticated;
select set_config('request.jwt.claims', :'admin_claims', true);
select set_config('fx.out', coalesce(to_jsonb(${sql})::text, 'null'), true);
reset role;
select ${q(label)} || ' ' || current_setting('fx.out');`

/** As `claims`, prints the error message (or "allowed") of `sql`. */
const refused = (
  label: string,
  sql: string,
  claims = "admin_claims"
) => `set role authenticated;
select set_config('request.jwt.claims', :'${claims}', true);
savepoint fx_try;
do $probe$ begin
  perform ${sql};
  -- Succeeded: undo it (the probe never leaves a side effect) and say so.
  raise exception 'allowed';
exception when others then
  perform set_config('fx.err', sqlerrm, true);
end $probe$;
release savepoint fx_try;
reset role;
select ${q(label)} || ' ' || to_json(current_setting('fx.err'))::text;`

/** As the admin, keeps one field of the result in psql variable and setting `name`. */
const keep = (
  name: string,
  sql: string,
  field: string
) => `set role authenticated;
select set_config('request.jwt.claims', :'admin_claims', true);
select (${sql}) ->> ${q(field)} as ${name} \\gset
reset role;
select set_config('fx.${name}', :'${name}', false) \\gset`

const S = (name: string) => `current_setting('fx.${name}')`
const U = (name: string) => `current_setting('fx.${name}')::uuid`
const key = `gen_random_uuid()`

type Entry = {
  locator: string
  name: string
  section: string
  priceText?: string
  variants?: string[]
}
/** A snapshot document of entries with their source keys (= locators). */
const doc = (entries: Entry[]) =>
  JSON.stringify(entries.map((e) => ({ ...e, sourceKey: e.locator })))
const sha = (text: string) =>
  `encode(sha256(convert_to(${q(text)}, 'UTF8')), 'hex')`

const S1: Entry[] = [
  {
    locator: "food--a",
    name: "Fixture Alpha Pasty",
    section: "Food",
    priceText: "8.50",
  },
  {
    locator: "food--b",
    name: "Fixture Bravo Soup",
    section: "Drinks",
    priceText: "4.00",
  },
  {
    locator: "food--c",
    name: "Fixture Charlie Curry",
    section: "Food",
    priceText: "12.00",
    variants: ["Chicken"],
  },
  {
    locator: "food--d",
    name: "Fixture Delta Burger",
    section: "Food",
    priceText: "MP",
    variants: ["Beef", "Bean"],
  },
  {
    locator: "food--e",
    name: "Fixture Echo Salad",
    section: "Food",
    priceText: "from 9.95",
  },
  {
    locator: "food--f",
    name: "Fixture Foxtrot Stew",
    section: "Food",
    priceText: "nine pounds",
  },
  {
    locator: "food--g",
    name: "Fixture Golf Steak",
    section: "Food",
    priceText: "15.00",
  },
  { locator: "drinks--h", name: "Fixture Hotel Spritz", section: "Drinks" },
  {
    locator: "drinks--i",
    name: "Fixture India Ale",
    section: "Drinks",
    priceText: "5.20",
  },
  {
    locator: "bar--h",
    name: "Fixture Hotel Spritz",
    section: "Bar",
    priceText: "6.00",
  },
]
// v3 source: A renamed (same key), C unchanged, two prices changed (A, B);
// every other dish gone.
const S2: Entry[] = [
  {
    locator: "food--a",
    name: "Fixture Alpha Pie Deluxe",
    section: "Food",
    priceText: "8.75",
  },
  {
    locator: "food--b",
    name: "Fixture Bravo Soup",
    section: "Drinks",
    priceText: "4.25",
  },
  {
    locator: "food--c",
    name: "Fixture Charlie Curry",
    section: "Food",
    priceText: "12.00",
    variants: ["Chicken"],
  },
]

/** Confirms every proposed or needs_review entry row of the source on its item. */
const confirmCrosswalk = (
  source: string
) => `select set_config('request.jwt.claims', :'admin_claims', true);
do $cw$
declare h record;
begin
  for h in select x.row_id, x.revision, coalesce(x.item_id, x.candidates[1]) as item, x.channel
           from public.menu_crosswalk_heads x
           where x.source_id = current_setting('fx.${source}')::uuid and x.entry_locator is null
             and x.status in ('proposed', 'needs_review') and coalesce(x.item_id, x.candidates[1]) is not null
           order by x.locator
  loop
    perform public.menu_crosswalk_decide(h.row_id, h.revision, 'confirmed', h.item, null, h.channel,
      'Fixture: same dish.', gen_random_uuid());
  end loop;
end $cw$;
select set_config('request.jwt.claims', '', true);`

const v3Draft = `public.create_menu_draft(:'fx_venue_id', 'Fixture Recheck Menu v3', :'fx_source'::jsonb,
  jsonb_build_object('title', 'Fixture Recheck Menu v3', 'sections', jsonb_build_array(
    jsonb_build_object('slug', 'food', 'name', 'Food', 'kind', 'food', 'items', jsonb_build_array(
      jsonb_build_object('itemId', :'item_a', 'sourceKey', 'food--a', 'name', 'Fixture Alpha Pie Deluxe',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null, 'variants', '[]'::jsonb),
      jsonb_build_object('itemId', :'item_c', 'sourceKey', 'food--c', 'name', 'Fixture Charlie Curry',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null,
        'variants', jsonb_build_array(jsonb_build_object('variantId', :'c_chicken', 'name', 'Chicken'))))),
    jsonb_build_object('slug', 'drinks', 'name', 'Drinks', 'kind', 'drinks', 'items', jsonb_build_array(
      jsonb_build_object('itemId', :'item_b', 'sourceKey', 'food--b', 'name', 'Fixture Bravo Soup',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null,
        'variants', '[]'::jsonb))))), :'fx_v2_id')`

const prices = `(select json_object_agg(k.key, json_build_object(
    'amount', private.menu_trading_field_state(l.id, 'price', now()) #> '{value,amountMinor}',
    'basis', (select a.basis from public.menu_trading_assertions a
              where a.id = (private.menu_trading_field_state(l.id, 'price', now()) ->> 'assertionId')::uuid),
    'assertions', (select count(*) from public.menu_trading_assertions a where a.line_id = l.id)) order by k.key)
  from public.menu_trading_lines l
  join (values ('A', :'item_a'::uuid), ('B', :'item_b'::uuid), ('C', :'item_c'::uuid), ('E', :'item_e'::uuid),
    ('G', :'item_g'::uuid), ('I', :'item_i'::uuid)) k(key, item) on k.item = l.item_id
  where l.variant_id is null and l.portion_label is null and l.modifier_option_id is null)`

const releaseLines = (
  release: string
) => `(select json_object_agg(k.key, case when rl.withdrawn then 'tombstone'
    else cardinality(rl.assertion_ids)::text end order by k.key)
  from public.menu_trading_release_lines rl
  join public.menu_trading_lines l on l.id = rl.line_id
  join (values ('A', :'item_a'::uuid), ('B', :'item_b'::uuid), ('C', :'item_c'::uuid), ('E', :'item_e'::uuid),
    ('G', :'item_g'::uuid), ('I', :'item_i'::uuid)) k(key, item) on k.item = l.item_id
  where rl.release_id = :'${release}')`

export function importsScript(dir = FIXTURE_DIR) {
  const s1 = doc(S1)
  const s2 = doc(S2)
  return `\\set ON_ERROR_STOP on
\\pset format unaligned
\\pset tuples_only on
begin;
\\i ${q(join(dir, "menu.sql"))}
select
  max(id::text) filter (where key = 'venue') as fx_venue_id,
  max(id::text) filter (where key = 'v1') as fx_v1_id,
  max(id::text) filter (where key = 'v2') as fx_v2_id,
  max(item_id::text) filter (where key = 'A') as item_a,
  max(item_id::text) filter (where key = 'B') as item_b,
  max(item_id::text) filter (where key = 'C') as item_c,
  max(item_id::text) filter (where key = 'E') as item_e,
  max(item_id::text) filter (where key = 'G') as item_g,
  max(item_id::text) filter (where key = 'I') as item_i,
  json_build_object('sub', max(id::text) filter (where key = 'admin'), 'role', 'authenticated')::text as admin_claims,
  json_build_object('sub', max(id::text) filter (where key = 'manager'), 'role', 'authenticated')::text as manager_claims
from fx_menu_recheck \\gset
select (select max(ev.variant_id::text) from public.menu_entry_variants ev join public.menu_entries e on e.id = ev.entry_id
  where e.version_id = :'fx_v1_id' and e.source_key = 'food--c' and ev.name = 'Chicken') as c_chicken \\gset
select set_config('fx.venue', :'fx_venue_id', false), set_config('fx.v1', :'fx_v1_id', false),
  set_config('fx.v2', :'fx_v2_id', false) \\gset
select 'CREDIT_BEFORE ' || to_json(md5(pg_get_functiondef('private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure)));

-- Source, snapshot 1 and its reviewed crosswalk.
${keep("src", `public.menu_declare_source(:'fx_venue_id', 'menu_design', 'Fixture menu design', null, ${key})`, "sourceId")}
${keep("snap1", `public.menu_record_snapshot(:'src', 'r1', ${sha(s1)}, null, ${q(s1)}::jsonb, ${key})`, "snapshotId")}
${refused("NO_CROSSWALK", `public.menu_import_dry_run(${U("snap1")}, ${key})`)}
${admin("CROSSWALK_1", `public.menu_crosswalk_propose(:'snap1', ${key}) - 'replayed'`)}
${confirmCrosswalk("src")}
${refused("SAME_REVISION_OTHER_BYTES", `public.menu_record_snapshot(${U("src")}, 'r1', ${sha(s1 + " ")}, null, ${q(s1)}::jsonb, ${key})`)}

-- Dry run 1 and its review.
${refused("DRY_RUN_MANAGER", `public.menu_import_dry_run(${U("snap1")}, ${key})`, "manager_claims")}
${keep("run1", `public.menu_import_dry_run(:'snap1', ${key})`, "runId")}
${admin("RUN1", `public.menu_import_run(:'run1') - 'proposals' - 'release'`)}
${admin(
  "PROPOSALS1",
  `(select jsonb_object_agg(p ->> 'locator', jsonb_build_object('status', p ->> 'parseStatus',
  'basis', p ->> 'identityBasis', 'mapped', p ->> 'itemId' is not null, 'amount', p #> '{parsed,amountMinor}'))
  from jsonb_array_elements(public.menu_import_run(:'run1') -> 'proposals') p)`
)}
${admin("BULK1", `public.menu_trading_proposals_accept_exact(:'run1', ${key}) - 'replayed'`)}
select p.id as prop_e, p.revision as prop_e_rev from public.menu_trading_proposals p
  where p.run_id = :'run1' and p.locator = 'food--e' \\gset
select p.id as prop_d, p.revision as prop_d_rev from public.menu_trading_proposals p
  where p.run_id = :'run1' and p.locator = 'food--d' \\gset
select p.id as prop_g from public.menu_trading_proposals p where p.run_id = :'run1' and p.locator = 'food--g' \\gset
select p.id as prop_bar from public.menu_trading_proposals p where p.run_id = :'run1' and p.locator = 'bar--h' \\gset
select set_config('fx.prop_d', :'prop_d', false), set_config('fx.prop_d_rev', :'prop_d_rev', false), set_config('fx.prop_bar', :'prop_bar', false),
  set_config('fx.prop_e', :'prop_e', false) \\gset
${refused("ACCEPT_AMBIGUOUS", `public.menu_trading_proposal_decide(${U("prop_d")}, ${S("prop_d_rev")}::integer, 'accepted', null, ${key})`)}
${refused("ACCEPT_UNMAPPED", `public.menu_trading_proposal_decide(${U("prop_bar")}, 1, 'accepted', null, ${key})`)}
${refused("DECIDE_STALE_REVISION", `public.menu_trading_proposal_decide(${U("prop_e")}, 7, 'rejected', null, ${key})`)}
${admin("EDIT_E", `public.menu_trading_proposal_decide(:'prop_e', :prop_e_rev, 'edited', '{"amount":"9.95"}'::jsonb, ${key}) - 'replayed'`)}
${admin("REJECT_D", `public.menu_trading_proposal_decide(:'prop_d', :prop_d_rev, 'rejected', null, ${key}) ->> 'decision'`)}

-- Apply onto the fixture's v2 draft (based on v1), then confirm.
${refused("APPLY_WRONG_DRAFT", `public.menu_import_apply(${U("run1")}, ${U("v1")}, ${key})`)}
${keep("rel1", `public.menu_import_apply(:'run1', :'fx_v2_id', ${key})`, "releaseId")}
${refused("APPLY_TWICE", `public.menu_import_apply(${U("run1")}, ${U("v2")}, ${key})`)}
select r.release_number as rel1_number from public.menu_trading_releases r where r.id = :'rel1' \\gset
select private.menu_release_hash(:'rel1') as rel1_hash \\gset
${refused("CONFIRM_WRONG_HASH", `public.menu_release_confirm(${U("rel1")}, repeat('0', 64), ${key})`)}
${refused("ACTIVATE_UNCONFIRMED", `public.menu_activate_with_release(${U("v2")}, 1, ${U("rel1")}, ${key})`)}
${admin("CONFIRM1", `public.menu_release_confirm(:'rel1', :'rel1_hash', ${key}) ->> 'status'`)}
-- A change after confirmation makes activation stale until re-confirmed.
select p.revision as prop_g_rev from public.menu_trading_proposals p where p.id = :'prop_g' \\gset
${admin("EDIT_G_AFTER_CONFIRM", `public.menu_trading_proposal_decide(:'prop_g', :prop_g_rev, 'edited', '{"amount":"15.50"}'::jsonb, ${key}) ->> 'decision'`)}
${refused("ACTIVATE_STALE", `public.menu_activate_with_release(${U("v2")}, 1, ${U("rel1")}, ${key})`)}
select private.menu_release_hash(:'rel1') as rel1_hash2 \\gset
${admin("RECONFIRM1", `public.menu_release_confirm(:'rel1', :'rel1_hash2', ${key}) ->> 'status'`)}

-- The guard: once price has authority nabalens, today's path is refused and
-- the flag alone grants nothing.
insert into public.menu_field_authority (venue_id, field, channel, authority, basis, decided_by, decided_at, reason,
  supersedes)
select :'fx_venue_id', 'price', 'all', 'nabalens', 'owner_decision', (select id from fx_menu_recheck where key = 'admin'),
  now(), 'Fixture: owner decision (OD-B4-1).',
  (select a.id from public.menu_field_authority a
   where a.venue_id = :'fx_venue_id' and a.field = 'price' and a.channel = 'all'
     and not exists (select 1 from public.menu_field_authority s where s.supersedes = a.id));
select 'AUTHORITY_NABALENS ' || to_json(private.menu_trading_authority_nabalens(:'fx_venue_id'));
${refused("PLAIN_ACTIVATE_REFUSED", `public.activate_menu_version(${U("v2")}, 1)`)}
set role authenticated;
select set_config('request.jwt.claims', :'admin_claims', true);
savepoint fx_flag;
do $probe$ begin
  perform set_config('nabalens.menu_release_id', gen_random_uuid()::text, true);
  perform public.activate_menu_version(current_setting('fx.v2')::uuid, 1);
  raise exception 'allowed';
exception when others then perform set_config('fx.err', sqlerrm, true); end $probe$;
release savepoint fx_flag;
reset role;
select 'FLAG_ARBITRARY ' || to_json(current_setting('fx.err'))::text;

-- Injected failure inside activation (test-only trigger): nothing changes.
create function pg_temp.fx_fail() returns trigger language plpgsql as $f$
begin raise exception 'fx_injected_failure'; end $f$;
create trigger fx_fail before insert on public.menu_trading_release_lines
  for each row execute function pg_temp.fx_fail();
select gen_random_uuid() as act_key \\gset
select set_config('fx.act_key', :'act_key', false) \\gset
${refused("ACTIVATE_INJECTED", `public.menu_activate_with_release(${U("v2")}, 1, ${U("rel1")}, ${U("act_key")})`)}
select 'AFTER_FAILURE ' || json_build_object(
  'v1', (select status from public.menu_versions where id = :'fx_v1_id'),
  'v2', (select status from public.menu_versions where id = :'fx_v2_id'),
  'release', (select status from public.menu_trading_releases where id = :'rel1'),
  'assertions', (select count(*) from public.menu_trading_assertions a where a.venue_id = :'fx_venue_id'),
  'releaseLines', (select count(*) from public.menu_trading_release_lines rl where rl.venue_id = :'fx_venue_id'))::text;
drop trigger fx_fail on public.menu_trading_release_lines;
${admin("ACTIVATE1", `public.menu_activate_with_release(:'fx_v2_id', 1, :'rel1', :'act_key')`)}
${admin("ACTIVATE1_REPLAY", `public.menu_activate_with_release(:'fx_v2_id', 1, :'rel1', :'act_key') ->> 'replayed'`)}
select 'AFTER_RELEASE1 ' || json_build_object(
  'v1', (select status from public.menu_versions where id = :'fx_v1_id'),
  'v2', (select status from public.menu_versions where id = :'fx_v2_id'),
  'release', (select status from public.menu_trading_releases where id = :'rel1'),
  'prices', ${prices}, 'lines', ${releaseLines("rel1")},
  'photoA', (select p.state || ':' || coalesce(p.recheck_kind, '-') || ':' ||
      (select count(*) from public.menu_item_photo_events e where e.photo_id = p.id)
    from public.menu_item_photos p join fx_menu_recheck f on f.key = 'A' and p.id = f.photo_id),
  'events', (select json_agg(e.kind order by e.seq) from public.menu_trading_events e
    where e.venue_id = :'fx_venue_id'))::text;
${refused("DECIDE_AFTER_ACTIVATION", `public.menu_trading_proposal_decide(${U("prop_e")}, 2, 'rejected', null, ${key})`)}

-- The same file again (another revision, same bytes) after it was applied.
${keep("snap1b", `public.menu_record_snapshot(:'src', 'r1-again', ${sha(s1)}, null, ${q(s1)}::jsonb, ${key})`, "snapshotId")}
${admin("SAME_FILE", `public.menu_import_dry_run(:'snap1b', ${key}) - 'replayed'`)}

-- Source version 2 against v2 and release 1: a rename by the same key, two
-- price changes; the reviewer keeps A's old price (rejects), B and C go on.
${keep("snap2", `public.menu_record_snapshot(:'src', 'r2', ${sha(s2)}, null, ${q(s2)}::jsonb, ${key})`, "snapshotId")}
${admin("CROSSWALK_2", `public.menu_crosswalk_propose(:'snap2', ${key}) - 'replayed'`)}
${confirmCrosswalk("src")}
${keep("run2", `public.menu_import_dry_run(:'snap2', ${key})`, "runId")}
${admin("RUN2", `public.menu_import_run(:'run2') -> 'report'`)}
${admin("BULK2", `public.menu_trading_proposals_accept_exact(:'run2', ${key}) ->> 'accepted'`)}
select p.id as prop2_a, p.revision as prop2_a_rev from public.menu_trading_proposals p
  where p.run_id = :'run2' and p.locator = 'food--a' \\gset
${admin("REJECT_A2", `public.menu_trading_proposal_decide(:'prop2_a', :prop2_a_rev, 'rejected', null, ${key}) ->> 'decision'`)}
select p.id as prop2_b, p.revision as prop2_b_rev from public.menu_trading_proposals p
  where p.run_id = :'run2' and p.locator = 'food--b' \\gset
select p.id as prop2_c, p.revision as prop2_c_rev from public.menu_trading_proposals p
  where p.run_id = :'run2' and p.locator = 'food--c' \\gset
${admin("ACCEPT_B2", `public.menu_trading_proposal_decide(:'prop2_b', :prop2_b_rev, 'accepted', null, ${key}) ->> 'decision'`)}
${admin("ACCEPT_C2", `public.menu_trading_proposal_decide(:'prop2_c', :prop2_c_rev, 'accepted', null, ${key}) ->> 'decision'`)}
set role authenticated;
select set_config('request.jwt.claims', :'admin_claims', true);
select ${v3Draft} as fx_v3 \\gset
reset role;
${keep("rel2", `public.menu_import_apply(:'run2', :'fx_v3', ${key})`, "releaseId")}
select private.menu_release_hash(:'rel2') as rel2_hash \\gset
${admin("CONFIRM2", `public.menu_release_confirm(:'rel2', :'rel2_hash', ${key}) ->> 'status'`)}
${admin("ACTIVATE2", `public.menu_activate_with_release(:'fx_v3', 1, :'rel2', ${key}) - 'replayed' - 'releaseId' - 'menuVersionId' - 'previousReleaseId'`)}
select 'AFTER_RELEASE2 ' || json_build_object(
  'release1', (select status from public.menu_trading_releases where id = :'rel1'),
  'release2', (select status from public.menu_trading_releases where id = :'rel2'),
  'numbers', (select json_agg(r.release_number order by r.release_number) from public.menu_trading_releases r
    where r.venue_id = :'fx_venue_id'),
  'prices', ${prices}, 'lines', ${releaseLines("rel2")},
  'itemA', (select e.name from public.menu_entries e where e.version_id = :'fx_v3' and e.item_id = :'item_a'))::text;

-- Base changes after a dry run: apply refuses.
${keep("snap3", `public.menu_record_snapshot(:'src', 'r3', ${sha(s2 + "\n")}, null, ${q(s2)}::jsonb, ${key})`, "snapshotId")}
${admin("CROSSWALK_3", `public.menu_crosswalk_propose(:'snap3', ${key}) ->> 'snapshotId' is not null`)}
${keep("run3", `public.menu_import_dry_run(:'snap3', ${key})`, "runId")}
set role authenticated;
select set_config('request.jwt.claims', :'admin_claims', true);
select ${v3Draft.replace("Fixture Recheck Menu v3", "Fixture Recheck Menu v4").replace(":'fx_v2_id')", ":'fx_v3')")} as fx_v4 \\gset
reset role;
select set_config('fx.run3', :'run3', false), set_config('fx.v4', :'fx_v4', false) \\gset
alter table public.menu_import_runs disable trigger menu_import_runs_append_only;
update public.menu_import_runs set started_at = started_at - interval '25 hours' where id = :'run3';
alter table public.menu_import_runs enable trigger menu_import_runs_append_only;
${refused("APPLY_EXPIRED", `public.menu_import_apply(${U("run3")}, ${U("v4")}, ${key})`)}
${keep("run4", `public.menu_import_dry_run(:'snap3', ${key})`, "runId")}
select set_config('fx.run4', :'run4', false) \\gset
set role authenticated;
select set_config('request.jwt.claims', :'admin_claims', true);
select public.retire_menu_version(:'fx_v3') is null as fx_retired \\gset
reset role;
${refused("APPLY_BASE_CHANGED", `public.menu_import_apply(${U("run4")}, ${U("v4")}, ${key})`)}

select 'CREDIT_AFTER ' || to_json(md5(pg_get_functiondef('private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure)));
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
