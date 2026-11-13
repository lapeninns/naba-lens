import { expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import { world, yes } from "./knowledge-fixtures"

it("rechecks same-name schema version changes unless the old schema has a lossless rule", async () => {
  const w = await world("kn-b03-schema-version")
  const key = "guest_toilets"
  await yes(w.staffA, w, key)

  const addVersion = (
    version: number,
    schemaVersion: number,
    changeKind: "wording" | "schema",
    effectiveFrom: string,
    upgradeRules = "{}"
  ) => `insert into public.knowledge_question_versions
select (jsonb_populate_record(null::public.knowledge_question_versions, to_jsonb(v) || jsonb_build_object(
  'version', ${version}, 'value_schema_version', ${schemaVersion}, 'change_kind', '${changeKind}',
  'created_at', now(), 'effective_from', ${effectiveFrom}, 'upgrade_rules', '${upgradeRules}'::jsonb))).*
from public.knowledge_question_versions v where v.key = '${key}' and v.version = 1;`

  const read = (at: string) => `select jsonb_build_object(
  'status', s.status, 'reason', s.reason, 'detail', s.detail,
  'oldSchema', c.old_schema, 'upgradeState', c.state, 'upgradeRule', c.rule
)
from private.knowledge_slot_state_b03('${w.venue}', array['${key}'], ${at}) s
join private.knowledge_upgrade_candidates('${key}') c on c.check_id = s.check_id;`

  // The registry is append-only. Roll back the simulated form versions so
  // that later tests still see the version shipped by the migration.
  const output = psql(`begin;
${addVersion(2, 1, "wording", "now()")}
${read("now()")}
${addVersion(3, 2, "schema", "now() + interval '1 day'")}
${read("now()")}
${read("now() + interval '2 days'")}
${addVersion(4, 2, "schema", "now() + interval '1 day'", '{"presence@1":"lossless"}')}
${read("now() + interval '2 days'")}
rollback;`)

  const [wording, scheduled, active, lossless] = output
    .split("\n")
    .map((row) => JSON.parse(row))

  expect(wording).toMatchObject({
    status: "available",
    oldSchema: "presence@1",
    upgradeState: "current_schema",
  })
  // The admin dry run prepares the latest version. Live reads switch only
  // once that version takes effect.
  expect(scheduled).toMatchObject({
    status: "available",
    upgradeState: "upgrade",
    upgradeRule: "needs_checking",
  })
  expect(active).toMatchObject({
    status: "unavailable",
    reason: "stale",
    detail: "schema_changed",
    upgradeState: "upgrade",
    upgradeRule: "needs_checking",
  })
  expect(lossless).toMatchObject({
    status: "available",
    oldSchema: "presence@1",
    upgradeState: "upgrade",
    upgradeRule: "lossless",
  })
})
