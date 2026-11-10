# Venue onboarding records

B10-03 keeps one onboarding record per active venue. The records live in the programme folder, not in this repository, because they carry production venue IDs. This page describes their format and the checks that keep them honest.

## Record format

A record is JSON (`b10-onboarding/1`), one file per venue named `<venue UUID>.json`. Its fields are listed in `lib/ops/onboarding.ts` (`ONBOARDING_FIELDS`). Each field is exactly one of:

- `{ "value": ..., "source": "..." }`: a recorded value and where it came from;
- `{ "notApplicable": "reason" }`;
- `{ "notRecorded": { "owner": "<role>", "dueBy": "wave_entry" | "wave_exit" | "b10_exit" } }`.

Nothing is filled by inference. Records hold roles and counts only; named people stay in the owner's own record.

Observation logs (`b10-observations/1`, one per venue) record observed attempts without names. The destination checklist (`b10-destinations/1`) holds each B10-07 check as outstanding with what it waits for, or as a result with an evidence path.

## Commands

```sh
# Create identity-only records, empty logs and the checklist (never overwrites):
pnpm exec tsx scripts/ops/b10-records.ts init --roster <roster file> --crosswalk <crosswalk proposal> --out <dir>
# Check them:
pnpm exec tsx scripts/ops/b10-records.ts lint --roster <roster file> --dir <dir>
```

The lint fails when:

- a field is missing, unknown, or in no allowed shape;
- an identity value differs from the roster;
- a record names a venue outside the roster;
- any text contains an email address;
- an outstanding destination check names nothing it waits for.
