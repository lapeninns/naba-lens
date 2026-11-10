# B04-a (S1): menu sources, field authority and the crosswalk

Implements B04-01 (b04-design §4, build step §19.2 S1). Inert: no venue is
enabled, no real mapping is populated and no field is switched to NabaLens.

## Objects

Migration `supabase/migrations/20261110150000_menu_b04a_sources_crosswalk.sql`
(additive; sorts after every migration on the B02 integration baseline):

| Object                  | Notes                                                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `menu_sources`          | Declared by venue id only. Retire-once guard; never deleted.                                                                                                                                                                                                          |
| `menu_source_snapshots` | Append-only. `(source, revision)` unique; same bytes again is a no-op, other bytes `snapshot_revision_conflict`. `captured_at` stays null when unknown.                                                                                                               |
| `menu_field_authority`  | Append-only chain per `(venue, field, channel)`; the row nobody supersedes is in force. Seeded with the §4.4 defaults for every existing venue as `basis = 'design_default'` (no approver). Venues created later read the same defaults until an admin records a row. |
| `menu_crosswalk`        | Append-only rows; each supersedes the previous row of its `(source, locator)`.                                                                                                                                                                                        |
| `menu_crosswalk_heads`  | The row in force per `(source, locator)` (primary key: one identity per source entry). Partial unique index over confirmed/carried heads: one source entry per `(item, variant, channel)`. A trigger keeps each head equal to its row.                                |
| `menu_source_commands`  | Request-key replay (B03 §14.1), append-only.                                                                                                                                                                                                                          |

No client can read or write the tables; everything goes through the
functions below. No existing table, row or function changes, and the credit
function is untouched.

## Functions (TypeScript in `lib/server/menus/crosswalk.ts`)

| SQL                                                                                                         | Caller                     | Server function         |
| ----------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------- |
| `menu_declare_source(p_venue, p_kind, p_label, p_locator, p_request_key)`                                   | admin                      | `declareMenuSource`     |
| `menu_record_snapshot(p_source, p_revision, p_sha256, p_captured_at, p_document, p_request_key)`            | admin                      | `recordMenuSnapshot`    |
| `menu_crosswalk_propose(p_snapshot, p_request_key)`                                                         | admin                      | `proposeMenuCrosswalk`  |
| `menu_crosswalk_decide(p_row, p_expected, p_status, p_item, p_variant, p_channel, p_reason, p_request_key)` | admin (OD-B4-2 default)    | `decideMenuCrosswalk`   |
| `menu_set_field_authority(p_venue, p_field, p_channel, p_authority, p_source, p_reason, p_request_key)`     | admin                      | `setMenuFieldAuthority` |
| `menu_manifest(p_venue)` (STABLE)                                                                           | admin; the venue's manager | `readMenuManifest`      |

Every command returns `jsonb` and replays its first result for the same
`p_request_key` (uuid), actor and arguments. `lib/menus/trading/crosswalk.ts`
holds the pure side: closed sets, the §4.4 defaults, the snapshot validator,
locator rules, the content hash input, the matcher (`proposeCrosswalk`), the
decision rules and the manifest types and CSV export.

## Rules

- **Proposals only.** The matcher writes `proposed`, `ambiguous`, `carried`,
  `needs_review` and `not_on_source`; never `confirmed`. Exact source keys are
  used only for `menu_design` and `nabalens` sources; otherwise names and
  aliases (the import matcher's `nameKey`) give candidates. Several
  candidates, or a name the source repeats, give `ambiguous` with every
  candidate (at most 20) listed.
- **Variants** are proposed only for entries confirmed (or carried) to an item,
  and only among that item's variants on the active version. Variant locators
  are `<entry>#variant=<name>` (`#2`… for repeats). A rejected entry sends its
  confirmed variants back to `needs_review`. Running the matcher again on the
  same snapshot adds only the missing variant rows.
- **Carry.** On a newer snapshot of the same source, a confirmed row with the
  same locator and content hash becomes `carried` with the original reviewer;
  a changed hash gives `needs_review`; a missing locator gives `not_on_source`.
  An older snapshot cannot be proposed (`snapshot_not_latest`).
- **Decisions** need the row in force and its head revision
  (`crosswalk_stale`, 40001). Conflicts are `crosswalk_conflict`; an item of
  another venue is `menu_item_wrong_venue`; an item must be on the active menu.
- **Authority switches are inert.** `nabalens` is refused
  (`authority_switch_not_enabled`) for every field except `identity` and
  `photos` until B04-05's reconciliation report exists. A source authority
  must cite a live source of the same venue and a matching kind.
- **Manifest.** Managers see authorities, sources (no locator), coverage
  counts and per-entry outcomes; only admins see reasons, approvers, locators,
  source price text and the review list with evidence. Outcomes per active
  entry and source: `confirmed`, `needs_review`, `not_on_source` (the source
  has rows, none names the item) or `unmatched` (no crosswalk run yet).
  `priceDisagreement` flags differing source price text; nothing resolves it.

## Not yet verified (needs a database)

`tests/security/menus-crosswalk.test.ts` is written and not run here: roles,
venue isolation, uniqueness, same-name ambiguity, variants, carry,
immutability, the credit hash, T9b volatility, and TS/SQL parity of the name
key, content hash, snapshot validator and matcher. The coordinator runs it
with the migration lint (`supabase db lint`) and drift checks.
