// Full App v1, Sprint 3 repair S3-R6 (performance; metrics_overview timed
// out once under load in the security suite):
//   20261118125300  media_duplicate_suppressed asks asset_is_accepted about
//                   the one original only, not every photo in the database
//   20261118125400  metrics_overview computes each venue's metrics once
// The counts come from pg_stat_user_functions (psql as the owner, with
// track_functions on for that session only); the reads run as an admin.
import { describe, expect, it } from "vitest"

import { insertAsset, psql } from "./coverage-fixtures"
import { admin as knowledgeAdmin, service, world } from "./knowledge-fixtures"

/**
 * Calls of each named function made by `sql`, run as `userId` (aal2), or as
 * the owner when `userId` is null (private functions).
 */
function callsDuring(userId: string | null, sql: string, fns: string[]) {
  const names = fns.map((f) => `'${f}'`).join(",")
  const snapshot = () =>
    Object.fromEntries(
      psql(
        `select funcname || '=' || calls from pg_stat_user_functions
         where schemaname in ('public', 'private') and funcname in (${names})`
      )
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const [k, v] = l.split("=")
          return [k, Number(v)]
        })
    ) as Record<string, number>
  const before = snapshot()
  const claims = JSON.stringify({
    sub: userId,
    role: "authenticated",
    aal: "aal2",
  })
  psql(
    userId
      ? `set track_functions = 'all';
    select set_config('request.jwt.claims', '${claims}', false);
    set role authenticated;
    ${sql};
    reset role;
    select pg_stat_force_next_flush();`
      : `set track_functions = 'all';
    ${sql};
    select pg_stat_force_next_flush();`
  )
  const after = snapshot()
  return Object.fromEntries(
    fns.map((f) => [f, (after[f] ?? 0) - (before[f] ?? 0)])
  ) as Record<string, number>
}

describe("metrics_overview reads each venue once", () => {
  it("calls metrics_venue_json once per active venue", async () => {
    const admin = await knowledgeAdmin()
    const active = Number(
      psql(`select count(*) from public.venues where active`)
    )
    const calls = callsDuring(
      admin.id,
      "select length(public.metrics_overview(30)::text) > 0",
      ["metrics_venue_json"]
    )
    // Before the repair: three per venue (the aggregate and both sort keys).
    expect(calls.metrics_venue_json).toBe(active)
  })

  it("lists the same numbers as each venue's own metrics", async () => {
    const admin = await knowledgeAdmin()
    const claims = JSON.stringify({
      sub: admin.id,
      role: "authenticated",
      aal: "aal2",
    })
    // One transaction, so now() and the data are the same for both reads.
    const same = psql(`begin;
      select set_config('request.jwt.claims', '${claims}', true);
      set local role authenticated;
      select (
        select jsonb_agg(v - 'slots' - 'flow' order by v ->> 'venueName', v ->> 'venueId')
        from (select public.venue_metrics(x.id, 30) as v from public.venues x where x.active) s
      ) = public.metrics_overview(30) -> 'venues';
      commit;`)
    expect(
      same
        .split("\n")
        .filter((l) => l === "t" || l === "f")
        .at(-1)
    ).toBe("t")
  })
})

describe("media_duplicate_suppressed asks about the original only", () => {
  it("tests only the original's acceptance, and keeps the rule", async () => {
    const w = await world("r6-dupes")
    const original = await insertAsset(service, {
      uploader: w.staffA.id,
      venue: w.venue,
    })
    const copy = await insertAsset(service, {
      uploader: w.staffA.id,
      venue: w.venue,
    })
    psql(`begin;
      set local session_replication_role = replica;
      update public.media_assets set duplicate_of_asset_id = '${original.id}'
      where id = '${copy.id}';
      commit;`)
    const ask = (asset: string) =>
      callsDuring(
        null,
        `select private.media_duplicate_suppressed('${asset}')`,
        ["asset_is_accepted"]
      )
    // Before the repair: once for every photo not deleted, in any venue.
    expect(ask(original.id).asset_is_accepted).toBe(0)
    expect(ask(copy.id).asset_is_accepted).toBe(1)
    // The rule itself: a copy is suppressed only once its original counts.
    const suppressed = () =>
      psql(`select private.media_duplicate_suppressed('${copy.id}')::text`)
    expect(suppressed()).toBe("false")
    // Once the original is accepted (a place photo here), the copy is.
    psql(`with s as (
        insert into public.knowledge_subjects (venue_id, kind, label, created_by)
        values ('${w.venue}', 'area', 'Dupes ' || left(md5(random()::text), 6), '${w.admin.id}')
        returning id, venue_id, label
      ), l as (
        insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
        select '${original.id}', s.venue_id, s.id, 'area', s.label, '${w.staffA.id}' from s
        returning id, venue_id, asset_id
      )
      insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, decided_by)
      select l.id, l.venue_id, l.asset_id, 'accepted', '${w.admin.id}' from l`)
    expect(suppressed()).toBe("true")
  })
})
