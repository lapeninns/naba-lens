# S2-METRICS worker report

Branch `fa/s2-metrics` (team-08). Spec §18, AC39. Nothing pushed, deployed or run on a hosted project; the isolated stack (`--ports 600`) is stopped.

## Checklist results

| ID                      | Result       | Notes                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S18-required-coverage   | Built        | `venue_metrics.coverage` is `coverage_slots`' own per-category counts (nothing recounted). Manager and admin see "n of N" with the percentage after it.                                                                                                                                                                              |
| S18-item-coverage       | Built        | Per category. A dish or space has one photo requirement in R1, so its item coverage equals its slot coverage. A facility is complete when its fact is currently confirmed and, where the catalogue asks for a photo, the photo is covered.                                                                                           |
| S18-review-delay        | Built        | Median and 90th percentile from ready for review (labelled and processed) to the first decision, by kind. Processing time (reserve to ready) is separate, from the new `media_state_times` (measured from this migration on).                                                                                                        |
| S18-label-correction    | Built (dish) | Dish photos a person proposed a dish for; corrected when the reviewer chose another dish or variant. By capture route from the `submitted` event; earlier photos read "Before recording began". Area and amenity labels have no correction path.                                                                                     |
| S18-needs-label-backlog | Built        | Count, oldest and how many are over 7 days (FA-4's manager queue), duplicates left out.                                                                                                                                                                                                                                              |
| S18-useful-contrib      | Built        | First public acceptance on a slot, or one after earlier photos stopped being current. Extras, the same photo accepted again, references, duplicates and back-filled decisions never count. Staff read their own (`my_contribution_metrics`).                                                                                         |
| S18-content-use         | Built        | Exports (packages made, downloads completed, files) and publications (published, photos, withdrawn), separately.                                                                                                                                                                                                                     |
| S18-reliability         | Built        | Failed, never-finished and stuck uploads, recovered failures, phone-reported failures and retries, failed export downloads, failed destination actions; failed jobs on the admin overview. Technical apart from editorial retakes.                                                                                                   |
| S18-exclusions          | Partly built | Metrics read `coverage_slots`, so future menus and retired subjects are out and sold-out slots stay in (flagged). Tested: a reference photo and an extra photo don't move coverage. Duplicates leaving coverage and the sold-out hook are S2-INT.                                                                                    |
| S18-no-leaderboard      | Built        | No per-person number on manager or admin metrics; staff read only their own.                                                                                                                                                                                                                                                         |
| S18-display-conflict    | Built        | n of N with % secondary and filters (period, category) on manager and admin; staff wording untouched.                                                                                                                                                                                                                                |
| S18.3-instrumentation   | Partly built | Recorded: flow started (route), batch grouped, slot chosen, Match later, Not for a slot, sent receipt (route, outcome), sending failure (stage), retry. Decisions, corrections, requirements met and export/publication results come from their own histories. Not yet called: I'm not sure (S2-ADD) and the request route (S2-REQ). |
| S18.3-no-location       | Built        | One field allowlist enforced in the database (`event_field_not_allowed`), in the server (`cleanEvents`) and checked by tests; values are ids, enums, counts and `^[a-z][a-z_]{0,39}$` codes only.                                                                                                                                    |
| AC39                    | Built        | "How this is counted" lists every slot by state and re-derives n of N; the security test reproduces every category's numbers from the slot list and against `coverage_slots`.                                                                                                                                                        |

## Migrations (`20261118117000`-`117100`)

- `117000_metrics_instrumentation.sql`: `product_events` (RLS on, no grants), `private.product_event_fields()`, `public.record_product_events(jsonb)`; `media_state_times` with two triggers on `media_assets` (insert, and a real change of `upload_state` into ready or failed).
- `117100_metrics_reads.sql`: `private.metrics_scope`, `metrics_days`, `metrics_acceptances`, `metrics_venue_json`; `public.venue_metrics(p_venue_id, p_days)`, `public.metrics_overview(p_days)`, `public.my_contribution_metrics(p_days)`.

Both applied on a clean `db reset` of my stack after all Sprint 1 migrations. They depend on no other Sprint 2 migration. They read (never redefine) `coverage_slots_json`, `knowledge_fact_rows`, `ops_venue_backlog`, `asset_needs_labels`, `venue_role_of`.

Access: `venue_metrics` serves an admin (second step passed) naming any venue, or the venue's manager by `private.venue_role_of(auth.uid(), venue) = 'manager'`; staff, other venues, the inactive and anon are refused. `metrics_overview` is admins only. `my_contribution_metrics` is the caller's own. `record_product_events` needs a role at the named venue (admins any venue) and a named photo of their own or at a venue they manage; at most 50 events; replays (same client event id) are stored once.

## Files

Mine: `lib/metrics/{model,events,track,fixtures}.ts`, `lib/server/metrics/index.ts`, `app/_metrics/actions.ts`, `components/nabalens/metrics/{metrics-report,metrics-overview,copy,hrefs}.ts(x)`, `app/manager/metrics/{page,loading,error}.tsx`, `app/admin/metrics/{page,loading,error}.tsx`, `app/(dev)/ui-preview/gallery/blocks/metrics.tsx`, the two migrations, tests below, this report.

Outside my ownership, kept small:

- `app/staff/_shell/add-host.tsx` (S2-ADD): `trackFlow` calls in `startMatch`, `decideMatch`, `sendMatched` (route per file), `handleReady` and `onUnfinished`; registers the sender.
- `components/nabalens/upload-dialog.tsx` (S1-UPLOAD): `trackFlow` on Retry and Retry all.
- `components/nabalens/status-chip.tsx`: seven `coverage_*` chip states (Covered, Check due, Awaiting review, Another photo requested, Missing, Not here, No photo needed).
- `components/nabalens/manager/overview/overview-body.tsx` (S2-MGR): a Metrics row after Team targets. `tests/ui/manager-overview.test.tsx` expects it.
- `app/admin/coverage/page.tsx` (S2-ADMIN): a Metrics button in the header.
- `tests/unit/scope-guard.test.ts`: `/manager/metrics` and `/admin/metrics` added to the page allow-list.
- `app/(dev)/ui-preview/gallery/{page,fixtures}.tsx`: the Metrics section.
- `lib/db/types.ts`: my additions only. `docs/design-system/catalogue.md`: two rows. `docs/plans/full-app-v1/checklist.md`: my rows.

## Checks

Reported in the final message (typecheck, ESLint, Prettier, unit suite, security files on stack 600xx).

## Assumptions

- **Periods** are the last 7, 30 or 90 days (default 30); the database accepts 1 to 366.
- **Ready for review** is the later of the label time and the upload's ready time; uploads finished before this migration use their reserve time, so their review delay reads slightly long.
- **Useful contributions** use the review history: a dish photo's public interval runs from the transaction that leaves it accepted at public level until one that doesn't (level changes included); area and amenity photos until their next decision, label removal or deletion. "Outdated" means no longer current; a photo still current but due a freshness check isn't treated as outdated (no event marks that moment for spaces).
- **Label correction** covers dish labels only: area and amenity labels have no reviewer correction in R1.
- **Words.** "Covered" is used for the numerator (not "Approved", which the scope guard bans outside Publishing); explanations say "accepted for public use".
- **Admin nav** has no Metrics item (the bar is full, S1-EXPORT's note); `/admin/metrics` is reached from Coverage and the AppShell marks Coverage. The manager bar is S2-MGR's; Metrics is a row on Overview.
- **Event retention** is not limited yet; a cleanup belongs with the S1-OPS retention setting.

## For Sprint 3 and the other Sprint 2 tasks

- **Routes:** `/manager/metrics?days=7|30|90&category=food|drinks|spaces|facilities|other`; `/admin/metrics` (all venues) and `/admin/metrics?venue=<id>&days=&category=`.
- **Test ids and hooks:** `data-slot="metrics-report"`, `metrics-filters`, `reproduced` (the AC39 line); sections by id `attention`, `coverage`, `completeness`, `review`, `use`, `reliability`, `how-counted`, `flow`; coverage rows `data-category`; `details[data-state=<state>]` in How this is counted; overview rows `data-venue`; Overview row `li[data-link="metrics"]`.
- **AC39 journey:** open `/manager/metrics`, read the Photo coverage row for a category, open How this is counted, count the Covered slots and the counted states; the `reproduced` line says the same n of N.
- **S2-ADD:** call `trackFlow({ name: "label_uncertain", route, batchId })` from I'm not sure, and keep the existing calls when reworking Match.
- **S2-REQ:** when Add opens from a request, set the route to `"request"` (`matchFlow.current.route` in `add-host.tsx`, or pass it to `trackFlow`).
- **S2-STAFF:** Me can show the person's own useful contributions with `loadMyContributions` (`lib/server/metrics`); words in `METRICS_COPY.usefulNote`. No comparisons.
- **S2-MGR / S2-ADMIN:** the Overview cards can reuse `loadVenueMetrics` / `loadMetricsOverview` and `OfNumber`; link "every number" to `metricsHrefs`.
- **S2-INT:** nothing to change here: when coverage ignores duplicates and reads sold out, metrics follow.
- **Seed data:** none added; the security test builds its own venues (`met-a`, `met-b`).
