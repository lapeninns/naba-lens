# Venue onboarding records

B10-03 keeps one onboarding record per active venue. The records live in the programme folder, not in this repository, because they carry production venue IDs. This page describes their format and the checks that keep them honest.

## Scope

Records cover NabaLens's own data model only: the venue, its accounts, its knowledge working list and amenity checks, menus, coverage and targets, devices, training and the wave. Websites, NabaPresence and every other external destination are out of scope since the owner scope correction of 11 Nov 2026. Each record states that boundary in one fixed field, `scope.external_destinations`, and the lint refuses any other wording. Out of scope means not complete, not done.

## Record format

A record is JSON (`b10-onboarding/2`), one file per venue named `<venue UUID>.json`. Its fields are listed in `lib/ops/onboarding.ts` (`ONBOARDING_FIELDS`), by section:

| Section                       | Fields                                                                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Identity                    | venue UUID, slug, name and active flag, exactly as in the production roster                                                                                                                                 |
| B Accounts                    | manager accounts, staff by department (FOH, BOH, unassigned), staff holding a legacy manager grant, admins acting for the venue, capability matrix rows, one-account gaps                                   |
| C Knowledge                   | amenities enabled (date; one-way), active amenity checks by progress, keys open on the working list, the selected question set                                                                              |
| D Confirmers and review       | confirming role per family, freshness policies (OD-15), recheck owner, To confirm cadence                                                                                                                   |
| E Menus, coverage and targets | active menu versions, menu field authority (OD-B4-1), coverage checklist items by status, target policy, the venue monthly target and staff targets this London month, B01 fallback switches (SW-04, SW-05) |
| F Devices                     | physical device evidence only (X3)                                                                                                                                                                          |
| G Consumers                   | internal reader consumers holding the venue; the fixed external-destinations boundary                                                                                                                       |
| H Training and wave           | sessions held (B10-05 modules), wave, observation window, readiness decision                                                                                                                                |
| S Sign-off                    | product owner and venue manager dates                                                                                                                                                                       |

Each field is exactly one of:

- `{ "value": ..., "source": "..." }`: a recorded value and where it came from;
- `{ "notApplicable": "reason" }`;
- `{ "notRecorded": { "owner": "<role>", "dueBy": "wave_entry" | "wave_exit" | "b10_exit" } }`.

Nothing is filled by inference. Records hold roles and counts only; named people stay in the owner's own record (OD-B10-3).

Observation logs (`b10-observations/1`, one per venue) record observed attempts without names.

## Aggregate read (B10-03c)

`scripts/ops/b10-onboarding-aggregate.sql` is a read-only query (a read-only transaction that is rolled back) returning one JSON row per active venue: counts, question keys and dates only. It needs a role that can read `private.*`; run it on an owned isolated stack first, and on production only with the owner's approval, by the coordinator. `apply-aggregate` fills the eleven aggregate fields (`AGGREGATE_FIELDS`) from it, each with the source you give, raises the record version and refuses a row with any other shape or for another venue.

## Commands

```sh
# Create identity-only records and empty logs (never overwrites):
pnpm exec tsx scripts/ops/b10-records.ts init --roster <roster file> --out <dir>
# Carry schema-1 records to schema 2 (drops the external-destination fields):
pnpm exec tsx scripts/ops/b10-records.ts upgrade --roster <roster file> --from <dir of v1 records> --out <dir>
# Fill records from an aggregate read:
psql "$DB" -X -q -t -A -f scripts/ops/b10-onboarding-aggregate.sql > aggregate.json
pnpm exec tsx scripts/ops/b10-records.ts apply-aggregate --from <records dir> --aggregate aggregate.json --source "aggregate read <env> <UTC time>" --out <dir>
# Check them:
pnpm exec tsx scripts/ops/b10-records.ts lint --roster <roster file> --dir <dir>
```

The lint fails when:

- a field is missing, unknown, or in no allowed shape;
- an identity value or the active flag differs from the roster;
- a record names a venue outside the roster, or is not schema 2;
- the external-destinations boundary is missing or reworded;
- any text contains an email address;
- an existing destination checklist (kept from before the scope correction) has an outstanding check that names nothing it waits for.
