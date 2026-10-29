# Venue seed data

`venues.json` holds the organisation's **owner-confirmed** venues. It is intentionally
an empty list: venue names must come from the owner and must not be invented by
developers or agents.

Format (one object per venue; `slug` is lowercase words joined by hyphens):

```json
[{ "name": "Owner-confirmed venue name", "slug": "owner-confirmed-venue-name" }]
```

Load it into a database with `pnpm seed:venues` (upserts by `slug`, never deletes;
see the root README). Local development instead uses the `DEV FIXTURE` venues in
`../seed.sql`, which are applied by `supabase db reset` and must never be loaded
into staging or production.
