import { describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import { photo, slotRevision, world } from "./knowledge-fixtures"

describe("B03 event-end freshness", () => {
  it("ends a timed fixture at its venue-local end and an untimed fixture at next midnight", () => {
    const cutoffs = psql(`select jsonb_agg(
        private.knowledge_event_end(event, date '2026-07-12', 'Europe/London')
        at time zone 'UTC' order by n)
      from (values
        (1, '{"start":"16:45","end":"19:00"}'::jsonb),
        (2, '{"start":"22:00","end":"02:00"}'::jsonb),
        (3, '{}'::jsonb)
      ) e(n, event)`)
    expect(JSON.parse(cutoffs)).toEqual([
      "2026-07-12T18:00:00",
      "2026-07-13T01:00:00",
      "2026-07-12T23:00:00",
    ])
  })

  it("requires event details at submission and forecasts the live state after an in-place correction", async () => {
    const w = await world("kn-b03-event-end")
    const checkId = w.checks.guest_toilets
    const revision = slotRevision(w.venue, "guest_toilets")
    const assetId = await photo(w.manager.id, w.venue)
    const claims = (id: string) =>
      JSON.stringify({ sub: id, role: "authenticated" })
    const submitArgs = `'${checkId}', ${revision}, gen_random_uuid(), 'finding', 'yes',
      null, null, null, null, null, null, null, array['${assetId}'::uuid], null, null, false`
    // Keep the registry and policy fixtures in a rolled-back transaction.
    // Before noon, an overnight fixture is still running. After noon, today's
    // morning fixture has already ended. Next midnight is wrong in both cases.
    const out = psql(`begin;
create temp table event_end_fixture on commit drop as
select case when t::time < time '12:00' then 'current' else 'expired' end as expected_state,
  t::date + case when t::time < time '12:00' then -2 else 1 end as corrected_date,
  jsonb_build_object('event', jsonb_build_object('title', 'Test fixture',
    'localDate', t::date - case when t::time < time '12:00' then 1 else 0 end,
    'start', case when t::time < time '12:00' then '23:00' else '09:00' end,
    'end', case when t::time < time '12:00' then '12:00' else '10:00' end)) as detail
from (select now() at time zone 'Europe/London' as t) clock;

insert into public.knowledge_freshness_policies (id, version, claim_class, use, basis)
values ('test_event_cutoff', 1, 'event', 'internal', 'event_end');

insert into public.knowledge_question_versions
select (jsonb_populate_record(null::public.knowledge_question_versions, to_jsonb(v) || jsonb_build_object(
  'version', (select max(m.version) + 1 from public.knowledge_question_versions m where m.key = v.key),
  'value_schema', 'schedule_event', 'value_schema_version', 1,
  'freshness', '{"internal":"test_event_cutoff","public":null}'::jsonb,
  'material_fields', jsonb_build_array('headline'),
  'change_kind', 'schema', 'change_note', 'TEST event-end preview',
  'created_at', now(), 'effective_from', null, 'created_by', null))).*
from public.knowledge_question_versions v where v.key = 'guest_toilets' and v.version = 1;

do $$ begin
  perform set_config('test.event_detail', detail::text, true) from event_end_fixture;
  perform set_config('test.corrected_event_detail',
    jsonb_set(detail, '{event,localDate}', to_jsonb(corrected_date))::text, true)
  from event_end_fixture;
end $$;

set local "request.jwt.claims" to '${claims(w.manager.id)}';
set local role authenticated;
do $$
declare
  v_fields text;
  v_sent jsonb;
begin
  begin
    perform public.knowledge_submit(${submitArgs});
    raise exception 'legacy_event_without_detail_was_accepted';
  exception when sqlstate '22023' then
    get stacked diagnostics v_fields = pg_exception_detail;
    perform set_config('test.legacy_event_refusal', v_fields, true);
  end;
  v_sent := public.knowledge_submit(${submitArgs},
    current_setting('test.event_detail')::jsonb, null::date, null::text);
  perform set_config('test.sent_event', v_sent::text, true);
end $$;
reset role;

set local "request.jwt.claims" to '${claims(w.admin.id)}';
set local role authenticated;
do $$
declare
  v_rule jsonb := '{"internal":"test_event_cutoff"}';
  v_live_before text;
  v_preview_before jsonb;
  v_correction jsonb;
begin
  v_live_before := public.knowledge_check('${checkId}') -> 'freshness' -> 0 ->> 'state';
  v_preview_before := public.knowledge_freshness_preview('guest_toilets', v_rule) -> 'items';
  v_correction := public.knowledge_correct('${checkId}',
    (current_setting('test.sent_event')::jsonb ->> 'slotRevision')::bigint,
    gen_random_uuid(), 'yes',
    current_setting('test.corrected_event_detail')::jsonb, 'Test corrected fixture date');

  perform set_config('test.event_results', jsonb_build_object(
    'liveBefore', v_live_before,
    'previewBefore', v_preview_before,
    'materialCorrection', v_correction -> 'material',
    'liveAfter', public.knowledge_check('${checkId}') -> 'freshness' -> 0 ->> 'state',
    'previewAfter', public.knowledge_freshness_preview('guest_toilets', v_rule) -> 'items'
  )::text, true);
end $$;
reset role;

select current_setting('test.event_results')::jsonb || jsonb_build_object(
  'expected', expected_state,
  'legacyRefusal', current_setting('test.legacy_event_refusal')::jsonb,
  'sentOutcome', current_setting('test.sent_event')::jsonb ->> 'outcome',
  'canExecuteCore', has_function_privilege('authenticated',
    'private.knowledge_submit_core(uuid,bigint,uuid,text,text,text,text,text,text,text,text,uuid,uuid[],jsonb,boolean,boolean)',
    'execute'))
from event_end_fixture;
rollback;`)
    const result = JSON.parse(out.split("\n").pop()!) as {
      expected: "expired" | "current"
      liveBefore: string
      liveAfter: string
      previewBefore: { venueId: string }[]
      previewAfter: { venueId: string }[]
      materialCorrection: boolean
      legacyRefusal: unknown
      sentOutcome: string
      canExecuteCore: boolean
    }
    const assertForecast = (
      items: { venueId: string }[],
      state: "expired" | "current"
    ) =>
      expect(items.find((item) => item.venueId === w.venue)).toEqual({
        venueId: w.venue,
        use: "internal",
        answers: 1,
        dueSoon: 0,
        expired: state === "expired" ? 1 : 0,
        basisMissing: 0,
      })
    const after = result.expected === "expired" ? "current" : "expired"
    expect(result.legacyRefusal).toEqual({
      fields: [{ path: "detail.event", problem: "required" }],
    })
    expect(result.sentOutcome).toBe("current")
    expect(result.canExecuteCore).toBe(false)
    expect(result.liveBefore).toBe(result.expected)
    assertForecast(result.previewBefore, result.expected)
    expect(result.materialCorrection).toBe(false)
    expect(result.liveAfter).toBe(after)
    assertForecast(result.previewAfter, after)
  })
})
