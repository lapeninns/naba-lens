// SQL for the B04-c1 spec (tests/security/menus-safety-b04.test.ts): modifiers,
// dietary claims, allergen statements, evidence, the uncertainty outcome and
// revocation at activation. One psql session and one transaction that always
// rolls back, on the shared fixture world of
// tests/fixtures/menus/recheck-public-withdrawal/menu.sql (v1 active; the v2
// draft declares D Bean variant_meaning, E presentation, F recipe, G portion,
// H reviewer_flag and drops C's Lamb). Prints one `LABEL json` line per check.
//
// Authorities and the message wording have no product write path (owner
// decisions OD-B4-7, OD-B4-8): the script inserts them as postgres, inside
// the rolled-back transaction, to exercise the confirmed paths.
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

/** The same inside a probe: prints the error message, or "allowed". */
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

/** As a caller, stores one field of the result in psql variable `name`. */
const keep = (
  name: string,
  claims: string,
  sql: string,
  field: string
) => `set role authenticated;
select set_config('request.jwt.claims', :'${claims}', true);
select (${sql}) ->> ${q(field)} as ${name} \\gset
reset role;
select set_config('fx.${name}', :'${name}', false) \\gset`

/** Settings for DO probes, which psql does not interpolate. */
const S = (name: string) => `current_setting('fx.${name}')`
const U = (name: string) => `current_setting('fx.${name}')::uuid`
const key = `gen_random_uuid()`

const propose = (
  item: string,
  variant: string,
  allergens: string,
  complete: boolean
) =>
  `public.menu_allergen_statement_propose(${item}, ${variant}, ${q(allergens)}::jsonb, ${complete}, null, ${key})`
const evidence = (statement: string) =>
  `public.menu_allergen_evidence_attach(${statement}, 'authority_statement', null, 'Fixture: chef''s written statement.', ${key})`
const decide = (statement: string, decision: string) =>
  `public.menu_allergen_statement_decide(${statement}, ${q(decision)}, null, ${key})`
const safety = (item: string) => `public.menu_item_safety(${item})`

export function safetyScript(dir = FIXTURE_DIR) {
  return `\\set ON_ERROR_STOP on
\\pset format unaligned
\\pset tuples_only on
begin;
\\i ${q(join(dir, "menu.sql"))}
select
  max(id::text) filter (where key = 'venue') as fx_venue_id,
  max(id::text) filter (where key = 'staff') as fx_staff_id,
  max(id::text) filter (where key = 'manager') as fx_manager_id,
  max(id::text) filter (where key = 'admin') as fx_admin_id,
  max(item_id::text) filter (where key = 'A') as item_a,
  max(item_id::text) filter (where key = 'C') as item_c,
  max(variant_id::text) filter (where key = 'C') as c_lamb,
  max(item_id::text) filter (where key = 'D') as item_d,
  max(variant_id::text) filter (where key = 'D') as d_bean,
  max(item_id::text) filter (where key = 'E') as item_e,
  max(item_id::text) filter (where key = 'F') as item_f,
  max(asset_id::text) filter (where key = 'F') as f_photo,
  max(item_id::text) filter (where key = 'G') as item_g,
  json_build_object('sub', max(id::text) filter (where key = 'admin'), 'role', 'authenticated')::text as admin_claims,
  json_build_object('sub', max(id::text) filter (where key = 'manager'), 'role', 'authenticated')::text as manager_claims,
  json_build_object('sub', max(id::text) filter (where key = 'staff'), 'role', 'authenticated')::text as staff_claims
from fx_menu_recheck \\gset
select (select max(ev.variant_id::text) from public.menu_entry_variants ev join public.menu_entries e on e.id = ev.entry_id
  where e.version_id = (select id from fx_menu_recheck where key = 'v1') and e.source_key = 'food--d' and ev.name = 'Beef')
  as d_beef \\gset
select set_config('fx.item_a', :'item_a', false), set_config('fx.item_c', :'item_c', false),
  set_config('fx.c_lamb', :'c_lamb', false), set_config('fx.item_d', :'item_d', false),
  set_config('fx.d_bean', :'d_bean', false), set_config('fx.item_e', :'item_e', false),
  set_config('fx.item_f', :'item_f', false), set_config('fx.item_g', :'item_g', false),
  set_config('fx.f_photo', :'f_photo', false), set_config('fx.venue', :'fx_venue_id', false) \\gset
select 'INVARIANTS_BEFORE ' || json_build_object(
  'photos', (select md5(coalesce(string_agg(to_jsonb(p)::text, ',' order by p.id), '')) from public.menu_item_photos p
             where p.venue_id = :'fx_venue_id'),
  'creditMd5', (select md5(pg_get_functiondef('private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))))::text;

-- Nothing stated: every read is the uncertainty outcome, even with F's accepted photo.
${as("F_START_MANAGER", "manager_claims", safety(":'item_f'"))}
${as("F_START_STAFF", "staff_claims", safety(":'item_f'"))}
select 'F_PHOTO_ID ' || to_json(:'f_photo'::text);
select 'F_PHOTO_STATE ' || to_json((select p.state from public.menu_item_photos p
  where p.item_id = :'item_f' and p.asset_id = :'f_photo'));

-- Proposals and their refusals.
${keep("st_f", "manager_claims", propose(":'item_f'", "null", '{"milk":"contains"}', false), "statementId")}
${refused("PROPOSE_STAFF", "staff_claims", propose(U("item_f"), "null", '{"milk":"contains"}', false))}
${refused("PROPOSE_BAD_CODE", "manager_claims", propose(U("item_f"), "null", '{"gluten":"contains","milk":"maybe"}', false))}
${refused("PROPOSE_NO_COMPLETE", "manager_claims", `public.menu_allergen_statement_propose(${U("item_f")}, null, '{}'::jsonb, null, null, ${key})`)}
${keep("st_e", "admin_claims", propose(":'item_e'", "null", '{"eggs":"contains","mustard":"may_contain"}', true), "statementId")}
${keep("st_d", "manager_claims", propose(":'item_d'", "null", '{"cereals_gluten":"contains"}', false), "statementId")}
${keep("st_bean", "manager_claims", propose(":'item_d'", ":'d_bean'", '{"soya":"contains"}', false), "statementId")}
${keep("st_lamb", "manager_claims", propose(":'item_c'", ":'c_lamb'", '{"celery":"contains"}', false), "statementId")}
${keep("st_g", "manager_claims", propose(":'item_g'", "null", '{"mustard":"contains"}', false), "statementId")}
${keep("st_noev", "manager_claims", propose(":'item_a'", "null", '{"milk":"contains"}', false), "statementId")}

-- No authority named: confirmations refuse for everyone, admins included.
${refused("CONFIRM_ADMIN_NO_AUTHORITY", "admin_claims", decide(U("st_f"), "confirmed"))}
${refused("CONFIRM_MANAGER_NO_AUTHORITY", "manager_claims", decide(U("st_f"), "confirmed"))}

-- Evidence: a photo is never evidence; documents arrive with c2.
${refused("EVIDENCE_PHOTO", "manager_claims", `public.menu_allergen_evidence_attach(${U("st_f")}, 'authority_statement', ${U("f_photo")}, null, ${key})`)}
${refused("EVIDENCE_PHOTO_AS_SPEC", "manager_claims", `public.menu_allergen_evidence_attach(${U("st_f")}, 'recipe_specification', ${U("f_photo")}, null, ${key})`)}
${refused("EVIDENCE_DOCUMENT", "manager_claims", `public.menu_allergen_evidence_attach(${U("st_f")}, 'supplier_specification', gen_random_uuid(), null, ${key})`)}
${refused("EVIDENCE_STAFF", "staff_claims", evidence(U("st_f")))}
${as("EVIDENCE_F", "manager_claims", evidence(":'st_f'"))}
${as("EVIDENCE_E", "manager_claims", evidence(":'st_e'"))}
${as("EVIDENCE_D", "manager_claims", evidence(":'st_d'"))}
${as("EVIDENCE_BEAN", "manager_claims", evidence(":'st_bean'"))}
${as("EVIDENCE_LAMB", "manager_claims", evidence(":'st_lamb'"))}
${as("EVIDENCE_G", "manager_claims", evidence(":'st_g'"))}

-- The owner names the manager as the venue's allergen authority (no product path).
insert into private.menu_safety_authorities (venue_id, profile_id, scope, note)
values (:'fx_venue_id', :'fx_manager_id', 'allergens', 'Fixture: named by the owner (OD-B4-7).');
${refused("CONFIRM_ADMIN_NOT_AUTHORITY", "admin_claims", decide(U("st_f"), "confirmed"))}
${refused("CONFIRM_NO_EVIDENCE", "manager_claims", decide(U("st_noev"), "confirmed"))}
${as("CONFIRM_F", "manager_claims", decide(":'st_f'", "confirmed"))}
${refused("CONFIRM_TWICE", "manager_claims", decide(U("st_f"), "confirmed"))}
${as("CONFIRM_E", "manager_claims", decide(":'st_e'", "confirmed"))}
${as("CONFIRM_D", "manager_claims", decide(":'st_d'", "confirmed"))}
${as("CONFIRM_BEAN", "manager_claims", decide(":'st_bean'", "confirmed"))}
${as("CONFIRM_LAMB", "manager_claims", decide(":'st_lamb'", "confirmed"))}
${as("CONFIRM_G", "manager_claims", decide(":'st_g'", "confirmed"))}
${as("DECLINE_ADMIN", "admin_claims", decide(":'st_noev'", "declined"))}
${as("E_CONFIRMED", "staff_claims", safety(":'item_e'"))}
${as("D_CONFIRMED", "manager_claims", safety(":'item_d'"))}

-- Dietary: no dietary authority yet, then one.
${keep("cl_e", "manager_claims", `public.menu_dietary_claim_propose(:'item_e', null, 'vegetarian', 'yes', null, ${key})`, "claimId")}
${refused("DIETARY_BAD", "manager_claims", `public.menu_dietary_claim_propose(${U("item_e")}, null, 'gluten_free', 'yes', null, ${key})`)}
${refused("DIETARY_STAFF", "staff_claims", `public.menu_dietary_claim_propose(${U("item_e")}, null, 'vegan', 'yes', null, ${key})`)}
${refused("DIETARY_NO_AUTHORITY", "admin_claims", `public.menu_dietary_claim_decide(${U("cl_e")}, 'confirmed', null, ${key})`)}
insert into private.menu_safety_authorities (venue_id, profile_id, scope)
values (:'fx_venue_id', :'fx_manager_id', 'dietary');
${as("DIETARY_CONFIRM", "manager_claims", `public.menu_dietary_claim_decide(:'cl_e', 'confirmed', null, ${key})`)}
${keep("cl_f", "manager_claims", `public.menu_dietary_claim_propose(:'item_f', null, 'vegan', 'no', null, ${key})`, "claimId")}
${as("DIETARY_CONFIRM_F", "manager_claims", `public.menu_dietary_claim_decide(:'cl_f', 'confirmed', null, ${key})`)}

-- A message version (owner's wording, OD-B4-7; no product path).
insert into public.menu_public_messages (key, version, text, audience, decided_by)
values ('allergen_unconfirmed', 1, 'Fixture: please ask the team about allergens before ordering.', 'internal', :'fx_admin_id');
${as("A_WITH_MESSAGE", "staff_claims", safety(":'item_a'"))}

-- A recipe change waits in v2: a new F statement proposed now is bound to
-- the old anchor and becomes stale once v2 is active.
${keep("st_f2", "manager_claims", propose(":'item_f'", "null", '{"milk":"contains","celery":"contains"}', true), "statementId")}
${as("EVIDENCE_F2", "manager_claims", evidence(":'st_f2'"))}

select 'PHOTOS_BEFORE_ACTIVATION ' || to_json((select md5(coalesce(string_agg(to_jsonb(p)::text, ',' order by p.id), ''))
  from public.menu_item_photos p where p.venue_id = :'fx_venue_id'));
-- Activation of v2: revocations by declared and automatic changes.
\\i ${q(join(dir, "menu-activate.sql"))}
select 'REVOKED ' || coalesce((select json_agg(json_build_object('statement', case d.statement_id
    when :'st_f'::uuid then 'F' when :'st_e'::uuid then 'E' when :'st_d'::uuid then 'D' when :'st_bean'::uuid then 'Bean'
    when :'st_lamb'::uuid then 'Lamb' when :'st_g'::uuid then 'G' else '?' end, 'reason', d.reason,
    'by', d.decided_by = :'fx_admin_id'::uuid) order by d.reason, d.statement_id)
  from public.menu_allergen_decisions d where d.venue_id = :'fx_venue_id' and d.decision = 'revoked'), '[]'::json)::text;
select 'DIETARY_REVOKED ' || coalesce((select json_agg(json_build_object('claim', case d.claim_id
    when :'cl_e'::uuid then 'E' when :'cl_f'::uuid then 'F' else '?' end, 'reason', d.reason) order by d.reason)
  from public.menu_dietary_decisions d where d.venue_id = :'fx_venue_id' and d.decision = 'revoked'), '[]'::json)::text;
${as("F_AFTER", "manager_claims", safety(":'item_f'"))}
${as("E_AFTER", "manager_claims", safety(":'item_e'"))}
${as("D_AFTER", "manager_claims", safety(":'item_d'"))}
${as("G_AFTER", "manager_claims", safety(":'item_g'"))}
${refused("CONFIRM_STALE_RECIPE", "manager_claims", decide(U("st_f2"), "confirmed"))}
${refused("REVOKE_REVOKED", "manager_claims", decide(U("st_f"), "revoked"))}

-- L3 (a): re-issue F without a recipe declaration (a catalogue rollback
-- writes no decision): F stays not_confirmed; only a new statement on the
-- current anchor, confirmed by the authority, makes it current (L3 (d)).
select count(*) as decisions_before_v3 from public.menu_allergen_decisions d where d.venue_id = :'fx_venue_id' \\gset
set role authenticated;
select set_config('request.jwt.claims', :'admin_claims', false);
select public.create_menu_draft(:'fx_venue_id', 'Fixture Recheck Menu v3', :'fx_source'::jsonb,
  jsonb_build_object('title', 'Fixture Recheck Menu v3', 'sections', jsonb_build_array(
    jsonb_build_object('slug', 'food', 'name', 'Food', 'kind', 'food', 'items', jsonb_build_array(
      jsonb_build_object('itemId', :'item_f', 'sourceKey', 'food--f', 'name', 'Fixture Foxtrot Stew',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null,
        'variants', '[]'::jsonb))))), null) as fx_v3 \\gset
select public.activate_menu_version(:'fx_v3', 1) is null as v3_active \\gset
select set_config('request.jwt.claims', '', false);
reset role;
${as("F_AFTER_ROLLBACK", "manager_claims", safety(":'item_f'") + " -> 'allergens'")}
select 'DECISIONS_BY_V3 ' || ((select count(*) from public.menu_allergen_decisions d
  where d.venue_id = :'fx_venue_id') - :decisions_before_v3);
${keep("st_f3", "manager_claims", propose(":'item_f'", "null", '{"milk":"contains","celery":"contains"}', true), "statementId")}
${as("EVIDENCE_F3", "manager_claims", evidence(":'st_f3'"))}
${as("CONFIRM_F3", "manager_claims", decide(":'st_f3'", "confirmed"))}
${as("F_RESTATED", "staff_claims", safety(":'item_f'") + " -> 'allergens'")}

-- Modifiers.
${keep("grp", "manager_claims", `public.menu_modifier_group_add(:'fx_venue_id', 'Fixture sauce', 'single', 0, null, ${key})`, "groupId")}
${refused("GROUP_BAD", "manager_claims", `public.menu_modifier_group_add(${U("venue")}, 'Fixture sides', 'single', 0, 2, ${key})`)}
${refused("GROUP_STAFF", "staff_claims", `public.menu_modifier_group_add(${U("venue")}, 'Fixture sides', 'multiple', 0, 2, ${key})`)}
${keep("opt", "manager_claims", `public.menu_modifier_option_add(:'grp', 'Fixture peppercorn', 1, ${key})`, "optionId")}
${keep("opt2", "manager_claims", `public.menu_modifier_option_add(:'grp', 'Fixture garlic butter', 2, ${key})`, "optionId")}
${as("ATTACH", "manager_claims", `public.menu_item_modifier_group_attach(:'item_f', :'grp', null, null, ${key})`)}
${refused("ATTACH_TWICE", "manager_claims", `public.menu_item_modifier_group_attach(${U("item_f")}, ${S("grp")}::uuid, null, null, ${key})`)}
${refused("LINE_NOT_OFFERED", "manager_claims", `public.menu_modifier_option_line(${U("item_e")}, ${S("opt")}::uuid, null, ${key})`)}
${keep("opt_line", "manager_claims", `public.menu_modifier_option_line(:'item_f', :'opt', null, ${key})`, "lineId")}
${keep("opt_rev", "manager_claims", `public.menu_trading_propose(:'opt_line', null, null, null, null, 'price', '{"amount":"1.50"}'::jsonb, null, null, null, null, null, ${key})`, "lineRevision")}
select a.id as opt_assertion from public.menu_trading_assertions a where a.line_id = :'opt_line' \\gset
${as("OPT_CONFIRM", "manager_claims", `public.menu_trading_decide(:'opt_assertion', :opt_rev, 'confirmed', null, null, ${key}) -> 'current'`)}
${as("MODIFIERS_STAFF", "staff_claims", `public.menu_item_modifiers(:'item_f')`)}
${as(
  "OPT_LINES",
  "manager_claims",
  `(select l from jsonb_array_elements(public.menu_trading_lines_for_item(:'item_f') -> 'lines') l
  where l ->> 'lineId' = :'opt_line')`
)}
${as("RETIRE_OPT", "manager_claims", `public.menu_modifier_retire(null, :'opt2', ${key})`)}
${refused("RETIRE_TWICE", "manager_claims", `public.menu_modifier_retire(null, ${S("opt2")}::uuid, ${key})`)}
${as("MODIFIERS_AFTER_RETIRE", "manager_claims", `public.menu_item_modifiers(:'item_f')`)}

select 'INVARIANTS_AFTER ' || json_build_object(
  'creditMd5', (select md5(pg_get_functiondef('private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))))::text;
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
