# B03 server design (WS1): complete venue knowledge

Owner: WS1 (knowledge domain). Status: **draft 1, for review**. Docs only: no
B03 code or migration exists.

- **Baseline:** `task/b03-ws1-domain`, cut from `ebd41c48` (B02 server code,
  passed code review; database suites still to run on spare6).
- **Inputs:** programme plan §8 (B03-01 to B03-07 and the required semantic
  cases), §16 (representation, state and migration contract) and §19
  (rollback); `b01-design.md`; `b02-design.md`; `identities.md`;
  `access-and-rights.md`; `state-model.md`; `internal-reader-api.md`.
- **Rules kept here:**
  - **No venue fact or policy is invented.** Every venue-specific value
    (entrances, zones, dog rules, roast times, subscriptions, fees) comes from
    a contribution, a manager statement or a declared source. §10 lists what
    the owner and the venues must supply. Durations and authorities proposed
    here are product defaults, marked **owner to confirm**.
  - **Additive and reversible.** New tables and new question versions. No
    existing row is rewritten. The B01 and B02 migrations are frozen; every
    change is a new migration with a rollback note.
  - **One resolver.** `private.knowledge_slot_state` stays the only place an
    answer's status is decided (B01 §5). B03 extends it; nothing reads around
    it.
  - **Unknown is safer than invented certainty** (plan §8). A mapping,
    upgrade or expiry that cannot be made exactly produces Unknown, needs
    checking or a proposal, never a confident answer.
  - **Credit is untouched.** No B03 function writes a credit input except
    through B01's adoption path, unchanged. The credit-function hash
    (`b78b9daeb8ede1fec0b7224d99348659`) and the C-tests run on every batch.

Short names used below: D3 is the disclosure default (staff see their own
data and first names only; managers and admins see attribution); OD-n are
owner decisions (§11); B01 and B02 sections are cited as "B01 §n" and
"B02 §n".

---

## 1. Summary

| Task   | Proposal                                                                                                                                                                                                                     | New database objects                                                              | Behaviour change by default                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| B03-01 | A versioned question registry: one row per question key, one per version (value schema, guidance, evidence and confirmation rule, sensitivity, freshness, ownership). All 39 catalogue keys mapped, plus five proposed keys. | 2 tables, 1 validation function, seed                                             | None: version 1 of every key restates today's catalogue and rules |
| B03-02 | Facility and accessibility detail on a contribution: scope (which entrance or area), availability, fees, measurements only when supplied, limitations. No key certifies a whole venue.                                       | Subjects table, contribution detail table, schema validators                      | Only for keys moved to a detail version (OD-12)                   |
| B03-03 | Policy values with zones, typed conditions, exceptions and the confirming authority. A policy missing a required condition or authority can't become publishable.                                                            | Policy schema, publishability check, error `policy_incomplete`                    | Only for policy keys moved to version 2                           |
| B03-04 | Services and schedules in a venue timezone, with effective dates, weekly or monthly recurrence and dated exceptions. Sport is split into screens, subscriptions and fixture showings.                                        | Schedules, schedule exceptions, occurrence read, 4 proposed keys                  | None until the new keys are enabled                               |
| B03-05 | Freshness per claim class and use, computed when read. Expiry changes eligibility at once and opens an owned recheck task; the previous answer stays.                                                                        | Freshness policies, recheck tasks, a scheduled job                                | None until a key's version names a policy (OD-15)                 |
| B03-06 | Reconcile legacy amenity facts, findings and declared external sources through reviewed mappings that create proposals, never answers. Contradictions stay open until decided.                                               | External source registry, source assertions, legacy mappings, reconciliation runs | None: dry runs first; apply creates proposals only                |
| B03-07 | Corrections, withdrawals and schema upgrades as recorded decisions with before and after values and the selection rule; history can be rebuilt for any past moment.                                                          | Correction and withdrawal commands, upgrade runs, history read                    | New commands only                                                 |

---

## 2. Conventions

Every B03 change follows B02 §2: security definer functions with
`search_path = ''`, the caller's profile and grant re-read on every call,
reads as one `stable` statement (joining the T9b catalogue guard), RLS on new
tables with no client policies, append-only where a table records history,
`(time, key)` cursors, new error codes in the `NL` class and never
`unavailable`, and the scope guard's banned terms avoided.

Added for B03:

- **Answer slot.** B01 keeps one slot per venue and question
  (`venue_amenity_checks`). B03 keeps that: the headline answer stays per
  venue and question. Detail that names a place inside the venue (an
  entrance, a room, a garden) is part of the answer's value and refers to a
  **subject** (§4.1); it does not create more slots. A future need for
  independent per-subject answers (for example one current answer per room)
  is a new question key with `subject_type` set, decided per key (OD-13).
- **Values are typed.** Every contribution and adopted submission keeps the
  B01 `answer` (Yes, No, Not applicable, Unknown) for the headline, and may
  add a structured detail checked against the question version's value
  schema (§3.3). The headline is never derived from free text.
- **Time.** Stored instants are UTC. Venue-local times (opening windows,
  schedules) are stored as local wall-clock time plus an IANA timezone, and
  converted when read. Save times are never observation times (B01
  `identities.md` §7); B03 adds an explicit observation date (§7.2).
- **Sources.** Every assertion names its source kind: `staff_finding`,
  `manager_statement`, `legacy_fact`, `external_source`. Only the first two
  can become the current answer, and only through B01's decisions (§8).

---

## 3. B03-01: versioned question registry

### 3.1 Need

Today a question is spread across `amenity_catalogue` (wording, brief,
evidence rule, `catalogue_version`) and `knowledge_question_rules`
(confirmation, self-confirmation, automatic completion, text and redaction
flags, `rule_version`; seven keys only). Neither records the value type,
sensitivity, freshness, ownership or a question's lifecycle (supported,
unsupported, retired). B03-02 to B03-07 need all of these per version.

### 3.2 Data model

```text
public.knowledge_questions                        -- one row per key; never changed or deleted
  key text pk references amenity_catalogue (key)  -- or a proposed key (below)
  created_at, created_by

public.knowledge_question_versions                -- append-only
  key text, version integer >= 1, primary key (key, version)
  family text in ('presence', 'facility', 'accessibility', 'policy',
                  'service', 'schedule_event', 'connectivity')
  subject_type text in ('venue')                  -- §2; widened per key later
  owner_role text in ('venue_manager', 'admin')   -- who keeps the answer current
  catalogue_version integer                       -- the amenity_catalogue version it restates
  rule_version integer null                       -- the knowledge_question_rules version, when one exists
  value_schema text, value_schema_version integer -- §3.3
  guidance jsonb                                  -- { question, captureBrief, staffHelp, publicLabel: null }
  evidence_rule text in ('photo', 'video', 'either', 'both', 'none')
  confirmation text in ('none', 'venue_manager', 'admin', 'policy_authority')
  self_confirmation_allowed boolean
  sensitivity text in ('ordinary', 'sensitive_claim', 'restricted_detail')
  freshness jsonb                                 -- { internal: policy id | null, public: policy id | null } (§7)
  publishable_fields text[] not null default '{}' -- empty until B06 grants (access-and-rights §8)
  material_fields text[]                          -- fields whose change invalidates a confirmation (§9.1)
  requires_zones boolean not null default false   -- policy keys: zones needed for completeness (§5.2)
  lifecycle text in ('supported', 'presence_only', 'unsupported', 'superseded', 'retired')
  superseded_by text[] null                       -- keys that replace it, when superseded
  effective_from timestamptz
  change_kind text in ('initial', 'wording', 'rule', 'schema', 'lifecycle')
  change_note text, created_at, created_by
```

- `amenity_catalogue` stays the source of check rows (`amenity_enable_venue`,
  `amenity_add_checks`) and of the wording staff see today. The registry
  references it; it does not replace it. A wording change still goes
  through the catalogue CSV and its generated migration, and the same
  migration adds a registry version with `change_kind = 'wording'`.
- `knowledge_question_rules` stays the confirmation source the B01 functions
  read. A registry version records which `rule_version` it restates. B03
  migrations that change a rule add both rows in one migration, and a test
  pins that they agree (§3.7).
- **Confirmation mapping.** The B01 functions read only
  `knowledge_question_rules.confirmation` (`none` or `venue_manager`).
  Registry `none` and `venue_manager` map to the same rule value.
  `policy_authority` maps to `venue_manager` in the rule row, and the
  policy completeness check (§5.2) adds the recorded authority on top.
  `admin` needs a new rule value `admin`: B03-c adds it to the rule
  table's check and re-creates `knowledge_decide` and
  `knowledge_resolve_conflict` so a venue manager's confirmation is refused
  where the rule names an admin. A test pins the mapping for every key.
- **Proposed keys** (B03-04 and B03-02) are added to `amenity_catalogue`
  through its CSV first, so every registry key is a catalogue key. Adding a
  key is an owner decision (OD-11).
- **Lifecycle values.**
  - `supported`: answers and detail as its version defines.
  - `presence_only`: the headline answer is supported; the detail the
    capture brief asks for is not modelled in B03 and stays staff text.
  - `unsupported`: kept readable; no new contributions; not on any working
    list. Used for a key whose meaning is unclear for the estate.
  - `superseded`: its meaning moved to narrower keys (`superseded_by`); old
    answers stay readable under their version; new contributions go to the
    new keys.
  - `retired`: no longer asked anywhere; history kept.
    Lifecycle and `superseded_by` are fields of the version, so moving a
    key to `unsupported`, `superseded` or `retired` is a new version
    (`change_kind = 'lifecycle'`), an owner decision and a migration
    (OD-11). The working-list function refuses keys whose latest version is
    not `supported` or `presence_only`.

### 3.3 Value schemas (closed set, versioned in code and SQL)

| Schema                 | Headline                                                   | Structured detail (all optional unless the version requires a field)                                                                                                             |
| ---------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presence.v1`          | Yes, No, Not applicable, Unknown                           | None (today's B01 answer)                                                                                                                                                        |
| `facility.v1`          | As `presence.v1`                                           | `locations[]` (subject refs or a short label), `availability` (§4.2), `fees` (§4.2), `limitations` (staff text, internal), `howToRequest`                                        |
| `accessibility.v1`     | As `presence.v1`                                           | `facility.v1` plus `scope` (required: which entrance, route or facility the observation covers), `features{}` (typed per key, §4.3), `measurements[]` (only when measured, §4.3) |
| `policy.v1`            | Allowed, Not allowed, Conditional, Not applicable, Unknown | `zones[]`, `conditions[]`, `exceptions[]`, `policyScope` (venue or organisation), `authority` (§5)                                                                               |
| `service.v1`           | Offered, Not offered, Temporarily unavailable, Unknown     | `schedule` (a schedule id, §6), `channels[]` (internal), `fees`, `limitations`                                                                                                   |
| `schedule_event.v1`    | Committed, Not committed, Cancelled, Unknown               | `event` (title, local date and time window, timezone), `commitment` (who committed and when), `limitations`                                                                      |
| `connectivity.wifi.v1` | As `presence.v1`                                           | Today's internal test notes (`private.amenity_wifi_metadata`), plus `cost` (free, paid, unknown). Credentials are never collected (access-and-rights §4).                        |

- Validation is one SQL function,
  `private.knowledge_validate_value(p_schema text, p_version integer, p_headline text, p_detail jsonb) returns jsonb`,
  raising `invalid_value` (22023) with a field list. The TypeScript
  validator mirrors it, and a unit test runs the same fixtures through both.
- A headline outside a schema's set is refused. `policy.v1`'s
  "Conditional" and `service.v1`'s "Temporarily unavailable" are stored as
  a B01 answer plus detail, so no enum or check constraint on
  `amenity_submissions` changes (B01 §2.2): Conditional is answer `yes` with
  `detail.stance = 'conditional'`; Temporarily unavailable is answer `yes`
  with `detail.availability.state = 'temporarily_unavailable'`. The stored
  `yes` is therefore not safe to show on its own: §3.8 specifies what each
  existing consumer returns for these qualified answers.
- Free text stays internal (`staff_text_internal`) until a reviewed public
  field exists (B06).

### 3.4 The 39 catalogue keys

Family and lifecycle are WS1's proposals from each key's own catalogue
wording and brief (`20261107120000_amenity_catalogue.sql`). Confirmation is
the B01 rule where one exists, otherwise the proposed default; every
non-B01 confirmation, sensitivity and freshness class is **owner to
confirm** (OD-12, OD-14, OD-15). Freshness classes are defined in §7.1.

| #   | Key                     | Category            | Proposed family / schema                  | Lifecycle (proposed)                                                                              | Confirmation                                        | Sensitivity       | Freshness class |
| --- | ----------------------- | ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------- | --------------- |
| 1   | `pool_table`            | Games               | facility                                  | supported                                                                                         | none                                                | ordinary          | fixture         |
| 2   | `darts`                 | Games               | facility                                  | supported                                                                                         | none                                                | ordinary          | fixture         |
| 3   | `fruit_machine`         | Games               | facility                                  | presence_only (restrictions stay staff text)                                                      | none                                                | ordinary          | fixture         |
| 4   | `snooker`               | Games               | facility                                  | supported                                                                                         | none                                                | ordinary          | fixture         |
| 5   | `board_games`           | Games               | facility                                  | supported                                                                                         | none                                                | ordinary          | offering        |
| 6   | `arcade`                | Games               | facility                                  | supported                                                                                         | none                                                | ordinary          | fixture         |
| 7   | `sports_screen`         | Entertainment       | presence (today)                          | **superseded** by `sports_screens`, `sports_subscription`, `sports_fixture_showing` (§6.4), OD-11 | manager resolves disputes (B01)                     | ordinary          | fixture         |
| 8   | `live_music`            | Entertainment       | service + schedule                        | supported                                                                                         | venue_manager                                       | ordinary          | schedule        |
| 9   | `pub_quiz`              | Entertainment       | service + schedule                        | supported                                                                                         | venue_manager                                       | ordinary          | schedule        |
| 10  | `fireplace`             | Entertainment       | facility (seasonal availability)          | supported                                                                                         | none                                                | ordinary          | fixture         |
| 11  | `guest_wifi`            | Connectivity        | connectivity.wifi                         | supported                                                                                         | none (B01)                                          | restricted_detail | offering        |
| 12  | `charging`              | Connectivity        | facility                                  | supported                                                                                         | none                                                | ordinary          | fixture         |
| 13  | `step_free_entrance`    | Accessibility       | accessibility (scope = entrance)          | supported                                                                                         | venue_manager (B01)                                 | sensitive_claim   | accessibility   |
| 14  | `accessible_parking`    | Accessibility       | accessibility                             | supported                                                                                         | venue_manager                                       | sensitive_claim   | accessibility   |
| 15  | `accessible_seating`    | Accessibility       | accessibility                             | supported                                                                                         | venue_manager                                       | sensitive_claim   | accessibility   |
| 16  | `accessible_toilet`     | Accessibility       | accessibility                             | supported                                                                                         | venue_manager                                       | sensitive_claim   | accessibility   |
| 17  | `hearing_loop`          | Accessibility       | accessibility (working check)             | supported                                                                                         | venue_manager                                       | sensitive_claim   | offering        |
| 18  | `braille_menu`          | Accessibility       | facility (how to request)                 | supported                                                                                         | venue_manager                                       | sensitive_claim   | offering        |
| 19  | `onsite_parking`        | Arrival             | facility                                  | supported                                                                                         | none (B01)                                          | ordinary          | fixture         |
| 20  | `street_parking`        | Arrival             | facility (restrictions set by others)     | presence_only (charges and limits stay staff text, OD-12)                                         | none                                                | ordinary          | offering        |
| 21  | `cycle_parking`         | Arrival             | facility                                  | supported                                                                                         | none                                                | ordinary          | fixture         |
| 22  | `ev_charging`           | Arrival             | facility                                  | supported                                                                                         | none                                                | ordinary          | offering        |
| 23  | `dogs_inside`           | Pets                | policy                                    | supported                                                                                         | venue_manager (B01)                                 | sensitive_claim   | policy          |
| 24  | `dogs_outside`          | Pets                | policy                                    | supported                                                                                         | venue_manager (B01)                                 | sensitive_claim   | policy          |
| 25  | `dog_water`             | Pets                | facility                                  | supported                                                                                         | none                                                | ordinary          | offering        |
| 26  | `dog_treats`            | Pets                | facility (offering with charge)           | supported                                                                                         | none                                                | ordinary          | offering        |
| 27  | `outdoor_seating`       | Outdoor             | facility                                  | supported                                                                                         | none                                                | ordinary          | fixture         |
| 28  | `covered_seating`       | Outdoor             | facility                                  | supported                                                                                         | none                                                | ordinary          | fixture         |
| 29  | `outdoor_heating`       | Outdoor             | facility (seasonal availability)          | supported                                                                                         | none                                                | ordinary          | offering        |
| 30  | `high_chairs`           | Family              | facility                                  | supported                                                                                         | none                                                | ordinary          | offering        |
| 31  | `baby_changing`         | Family              | facility (which facility it is in)        | supported                                                                                         | none                                                | ordinary          | fixture         |
| 32  | `play_area`             | Family              | facility (access conditions as detail)    | supported                                                                                         | venue_manager (access conditions are house rules)   | ordinary          | fixture         |
| 33  | `guest_toilets`         | Facilities          | facility                                  | supported                                                                                         | none (B01)                                          | ordinary          | fixture         |
| 34  | `gender_neutral_toilet` | Facilities          | facility                                  | supported                                                                                         | venue_manager (brief asks the duty lead to confirm) | ordinary          | fixture         |
| 35  | `onsite_bar`            | Facilities          | facility                                  | supported                                                                                         | none                                                | ordinary          | fixture         |
| 36  | `private_room`          | Facilities          | facility; hire terms are a policy (OD-12) | presence_only (booking terms stay staff text)                                                     | venue_manager                                       | ordinary          | fixture         |
| 37  | `takeaway_pickup`       | Service             | facility (collection point)               | supported; the takeaway service itself is `takeaway_service` (§6)                                 | none                                                | ordinary          | fixture         |
| 38  | `curbside_pickup`       | Service             | service (process and hours)               | supported                                                                                         | venue_manager                                       | ordinary          | schedule        |
| 39  | `swimming_pool`         | Lodging and leisure | facility; access rules are a policy       | **unsupported** until an estate venue needs it (OD-11)                                            | venue_manager                                       | ordinary          | fixture         |

Proposed outcomes for the 39 keys: 34 supported, 3 presence-only
(`fruit_machine`, `street_parking`, `private_room`), 1 superseded
(`sports_screen`), 1 unsupported (`swimming_pool`) and 0 retired. Every
key's registry version 1 is `supported` with `presence.v1` (or
`connectivity.wifi.v1`) until the owner allows these outcomes (OD-11,
OD-12). **No key is retired by default:** retiring needs an owner decision,
and nothing in source shows a key the estate does not use.

Proposed new keys (each needs OD-11 before it reaches the catalogue):

| Key                      | Family             | Why                                                                          |
| ------------------------ | ------------------ | ---------------------------------------------------------------------------- |
| `sunday_roast`           | service + schedule | Plan §8 names it; no catalogue key covers a recurring food service           |
| `takeaway_service`       | service + schedule | `takeaway_pickup` is a collection point, not the service and its hours       |
| `sports_screens`         | facility           | Screen presence only (§6.4)                                                  |
| `sports_subscription`    | service            | Broadcaster subscriptions held, without any promise to show a fixture (§6.4) |
| `sports_fixture_showing` | schedule_event     | A dated commitment to show one fixture (§6.4)                                |

That is five proposed keys; `sports_screen` (7) is the only existing key they
supersede.

### 3.5 Server functions

- `public.knowledge_question(p_key, p_version default null) returns jsonb`:
  the registry version (latest by default) for any active user; guidance
  and the schema description, never other people's data.
- `public.knowledge_registry(p_lifecycle text[] default null) returns jsonb`:
  admin only, every key with its latest version and lifecycle.
- No write function: registry rows change only by migration (OD-11 decides
  whether an admin screen should edit guidance later).

### 3.6 Migration and rollback

- **B03-a:** create the two tables; seed version 1 for all 39 keys, each
  restating `catalogue_version = 1` and, for the seven B01 keys,
  `rule_version = 1`, with `value_schema = 'presence.v1'` (or
  `connectivity.wifi.v1` for `guest_wifi`), `lifecycle = 'supported'`,
  `freshness = {internal: null, public: null}` and empty
  `publishable_fields`. Nothing reads the registry yet, so behaviour is
  unchanged.
- Later batches add version 2 rows per key as each family is enabled
  (§12). Version rows are never updated; a lifecycle change is a new version
  with `change_kind = 'lifecycle'`.
- Rollback: the tables are additive; dropping the B03 readers returns to
  the B01 view. Version rows are never deleted.

### 3.7 Tests

- Every `amenity_catalogue` key has exactly one registry row, and its latest
  version's `catalogue_version` equals the catalogue's.
- Every `knowledge_question_rules` row has a registry version restating it,
  with the same confirmation and self-confirmation flags (drift guard).
- The §3.4 outcome table is pinned in a test so an unreviewed lifecycle
  change fails.
- `knowledge_validate_value` and the TypeScript validator agree on a shared
  fixture set, including every invalid case.
- A working-list enable of an `unsupported`, `superseded` or `retired` key
  is refused (`knowledge_key_not_supported`, new `NL` code).

### 3.8 Qualified answers and existing consumers (review M1)

A **qualified answer** is a current answer stored as B01 `yes` whose detail
narrows it: a policy with `stance = 'conditional'`, or a facility or service
with `availability.state = 'temporarily_unavailable'`. Every other B03
headline has an exact B01 equivalent (Not offered and Not committed are
`no`; Cancelled is `no` with detail), so only these two need a rule. The
resolver gains a `qualifier` column (`conditional`,
`temporarily_unavailable` or null); no stored row changes.

What each existing consumer returns for a qualified answer:

| Consumer                                                                                                                                              | Today                                 | For a qualified answer                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.knowledge_reader_answers_v1` (internal reader, WS5)                                                                                           | `status = available`, `value = yes`   | **Withheld:** `status = 'unavailable'`, `reason = 'stale'`, `detail = 'qualified_answer'`, `value` null and no detail fields. v1 never reports a qualified answer as Yes. A later reader version (WS5, B06) returns the qualifier and detail.                                                                                                                                   |
| `private.knowledge_slot_json`, so `knowledge_working_list`, `knowledge_check` and `knowledge_to_confirm` (staff and manager screens)                  | `answerInUse.value = yes`, available  | The B01 fields read as **needs checking**: `status = 'unavailable'`, `reason = 'stale'`, `detail = 'qualified_answer'`, `answerInUse.available = false`. A new `answerInUse.qualified` object (`{ qualifier, detail }`, audience-filtered as §4.5) carries the real answer for B03-aware screens. A screen that ignores the new object shows needs checking, never a plain Yes. |
| Legacy check reads: `amenity_venue_state`, `amenity_checks_for_venue`, `amenity_check`, `amenity_check_submissions`, and `lib/server/amenities` views | `answer = yes`, `progress = complete` | Stored rows unchanged (`answer = 'yes'`, `progress = 'complete'`; no credit input moves). The read functions are re-created to present the check as `progress = 'needs_recheck'` with a `recheck_reason` per qualifier (A19) and a `qualification` column Only the presented value changes.                                                                                     |
| Coverage, menus, credit                                                                                                                               | Do not read answer values             | Unchanged.                                                                                                                                                                                                                                                                                                                                                                      |

- **Precedence.** `qualified_answer` is the weakest reason: a slot that is
  also withdrawn, disputed, expired, `basis_missing`, `schema_changed` or
  `policy_incomplete` reads with that reason, and `answerInUse.qualified`
  stays present as the previous answer (A22).
- **Gate.** A key may move to a version whose schema allows a qualifier
  (`policy.v1`, `facility.v1`, `accessibility.v1`, `service.v1`) only in a
  migration that also re-creates the three consumers above, or after one
  already has. Until then the validator refuses `conditional` and
  `temporarily_unavailable` for that key.
- **Tests.** For a Conditional `dogs_inside` and a temporarily unavailable
  `outdoor_heating`:
  - the v1 reader returns unavailable / stale / `qualified_answer` with a
    null value;
  - `knowledge_check` shows needs checking in the B01 fields and the
    qualifier in `answerInUse.qualified`;
  - every legacy read presents `needs_recheck` while psql shows the stored
    row still `yes` / `complete`;
  - the credit hash and C-tests are unchanged;
  - a plain Yes on the same keys reads exactly as today in all three.

---

## 4. B03-02: facility and accessibility detail

### 4.1 Subjects

```text
public.knowledge_subjects                         -- append-only; retire, never delete
  id uuid pk, venue_id uuid
  kind text in ('entrance', 'route', 'area', 'room', 'facility_point')
  label text (1..80)                              -- "Main entrance", "Garden gate"
  created_by, created_at, retired_at null, retired_by null
```

- A subject names a place a venue already has; it is never created by a
  migration or import. Managers and admins create and retire subjects at
  their venue (`knowledge_subject_add`, `knowledge_subject_retire`). Staff
  may suggest one inside a contribution as a free label, which a manager
  turns into a subject when deciding (OD-13).
- Subjects are internal. A public label needs a reviewed field in B06.

### 4.2 Shared detail fields

| Field          | Shape                                                                                                                                      | Rule                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `locations[]`  | Subject ids or a staff label                                                                                                               | A label is stored as written and never matched to a subject automatically                  |
| `availability` | `{ state: 'available' \| 'on_request' \| 'seasonal' \| 'temporarily_unavailable', until?: date, schedule?: schedule id, note?: internal }` | `temporarily_unavailable` needs `until` or a note; it is not removal (§6.5)                |
| `fees`         | `{ kind: 'free' \| 'charged' \| 'not_recorded', amount?: { value, currency: 'GBP' }, unit?: text }`                                        | `not_recorded` is the default; a charge is never inferred from "paid" wording in free text |
| `limitations`  | Staff text, internal                                                                                                                       | As B01                                                                                     |
| `howToRequest` | Staff text, internal                                                                                                                       | As B01                                                                                     |

### 4.3 Accessibility detail and the entrance rule

- `scope` is **required** on every `accessibility.v1` value: which subject
  (an entrance, a route, a toilet) the observation covers.
- `features{}` is a typed set per key, for example for `step_free_entrance`:
  `level_threshold`, `ramp`, `handrail`, `automatic_door`, each Yes, No or
  Not checked. "Not checked" is distinct from No.
- `measurements[]` appear only when someone measured:
  `{ feature, value, unit ('mm' \| 'cm' \| 'degrees'), measuredOn: date, method: 'tape' \| 'gauge' \| 'other' }`.
  No measurement is ever derived from a photo or video.
- **No whole-venue certification.** There is no key, field or derived value
  meaning "the venue is accessible". The resolver returns per-key answers
  only. `step_free_entrance = Yes` with `scope = <main entrance>` means that
  entrance was observed step-free; it says nothing about routes inside,
  toilets, seating or other entrances. Readers (internal now, public in B06)
  must show the scope with the answer; the reader allowlist carries `scope`
  wherever it carries the value.
- A Yes on `step_free_entrance` never changes any other accessibility key.
- **The headline is checked when it is sent**, never overridden later.
  `knowledge_submit` (and `knowledge_correct`) validate a
  `step_free_entrance` value against the venue's active entrance subjects
  at send time:
  - **Yes** needs at least one entrance in the detail observed step-free;
  - **No** needs at least one active entrance subject at the venue, and
    every active entrance subject listed in the detail as observed with
    steps;
  - **Unknown** is always accepted;
  - anything else is refused with `invalid_value` naming `entrances`.
- The resolver reports the headline as sent. If a manager adds an entrance
  subject after a No, the No is not rewritten: a `scope_changed` recheck
  opens (§7.4).

### 4.4 Storage

```text
public.knowledge_contribution_details             -- append-only
  contribution_id uuid pk references knowledge_contributions (id)
  venue_id uuid, schema text, schema_version integer
  detail jsonb                                    -- validated by knowledge_validate_value
  observed_on date null                           -- §7.2
  created_at
```

- The detail belongs to the contribution. On adoption the submission links
  back through `amenity_submissions.source_contribution_id` (B01), so the
  current answer's detail is found without copying it into
  `amenity_submissions`. No column or constraint on any credit input changes.
- `knowledge_submit` gains an overload with `p_detail jsonb` and
  `p_observed_on date` (B02's pattern: the old signature stays). The detail
  is validated against the slot's registry version in force at send time,
  and the version is recorded on the contribution.
- Older answers have no detail row; the resolver reports their detail as
  `not_recorded`, never as empty facts.

### 4.5 Reads, authorisation and tests

- The resolver gains `detail_schema`, `detail` (filtered per audience) and
  `observed_on` columns; `knowledge_slot_json` and the reader carry them.
  Internal reader allowlist per field per key (access-and-rights §3 pattern).
- D3: staff see detail on their own contributions and on the current answer
  of their venue (as B01's finding text); subjects' labels are venue-internal;
  measurements and fees are internal until publishable.
- Writes as B01: staff send, managers decide; accessibility keys need
  confirmation (§3.4).
- Tests:
  - an entrance-only observation never changes another accessibility key and
    no reader output contains a venue-wide accessibility value;
  - a No is refused when the venue has no entrance subject, or when any
    active entrance subject is missing from the detail; a Yes is refused
    without a step-free entrance in the detail; Unknown is accepted;
  - adding an entrance subject after a No leaves the No as sent and opens one
    `scope_changed` recheck;
  - a measurement without `measuredOn` and `method` is refused;
  - "Not checked" survives a round trip and is not shown as No;
  - an old answer without detail reads as `not_recorded`;
  - another venue's subject id in a detail is refused (not found).

---

## 5. B03-03: policy conditions and confirming authority

### 5.1 Value

`policy.v1` (dogs inside and outside now; play-area rules and private-room
terms when OD-12 allows):

```text
{ stance: 'allowed' | 'not_allowed' | 'conditional' | 'not_applicable' | 'unknown',
  zones: [ { subject?: id, label?: text, stance } ],
  conditions: [ { type, value?, note? } ],      -- type from a closed list (below)
  exceptions: [ { type, note? } ],
  policyScope: 'venue' | 'organisation',
  authority: { basis: 'venue_manager' | 'admin', statedOn: date, source: 'in_person' | 'written_policy', reference?: text } }
```

- Condition and exception types are a closed list the owner supplies
  (OD-14), for example on a lead, area only, maximum number, times, at staff
  discretion, assistance dogs. WS1 does not decide which apply to any venue,
  and does not assume any legal position; a type exists only so a venue's
  statement can be recorded in a structured way.
- Zones refer to subjects or labels. "Allowed in the bar, not in the
  restaurant" is two zones, not text.

### 5.2 Publishability

`private.knowledge_policy_complete(p_check_id) returns jsonb` lists what is
missing for the answer in use:

- a stance other than Unknown;
- for `conditional`, at least one condition;
- zones, when the question version sets `requires_zones`;
- a confirmation by the authority the version names (`policy_authority`:
  venue manager by default, admin when `policyScope = 'organisation'`;
  OD-14);
- `authority.statedOn` and `source`.

A pending policy finding is evaluated as if adopted on its content only
(`authority` then means the stated basis and source are missing; who
confirms is checked when someone confirms).

The resolver treats an incomplete policy as `not_confirmed` (detail
`policy_incomplete`), and B06 publication refuses it with
`policy_incomplete` (`NLK10`, detail = missing list). Internally the
manager sees exactly what is missing.

### 5.3 Photo and policy (semantic case)

A photo can support an observation (a water bowl, a sign) while the policy
stays unresolved. Policy keys carry `evidence_rule = 'none'` or `'either'`
by version, and a photo never satisfies `policy_authority`: a staff
contribution with a photo on `dogs_inside` stays awaiting confirmation, and
`dog_water` can be current at the same time. A test pins both.

### 5.4 Authority

- The confirming authority is recorded on the decision (B01
  `knowledge_decisions.decider_basis`, `self_confirmed`) plus
  `authority.source`. A manager's own statement may be self-confirmed where
  the rule allows (B01 default for dogs keys).
- `policy_authority` maps to the B01 rule as §3.2 describes: venue
  manager in `knowledge_question_rules`, plus the recorded authority.
- Organisation-level policies (a group-wide rule) need an admin and apply to
  every venue only when each venue's slot adopts the same contribution; there
  is no cascading write (OD-14).

### 5.5 Tests

- A conditional policy without conditions, without required zones, or
  without the named authority's confirmation is `not_confirmed /
policy_incomplete` and listed as such.
- A staff photo never confirms a policy; an observation key using the same
  photo can be current.
- An organisation-scope policy confirmed by a venue manager is refused
  (`self_confirmation_not_permitted` or `not_permitted`, by rule).
- Every refusal maps to a 4xx code; none is retryable.

---

## 6. B03-04: services and schedules

### 6.1 Schedules

```text
public.knowledge_schedules                        -- append-only versions
  id uuid pk, venue_id uuid, question_key text
  contribution_id uuid                            -- the contribution that stated it
  supersedes uuid null                            -- the version it replaces
  timezone text                                   -- IANA; default the venue's (OD-16)
  effective_from date, effective_to date null     -- inclusive local dates
  recurrence jsonb                                -- weekly { days[] } | monthly { nth, day } | dated { dates[] }
  windows jsonb                                   -- [ { start: 'HH:MM', end: 'HH:MM' } ]; end <= start means past midnight
  created_at

public.knowledge_schedule_exceptions              -- append-only
  id uuid pk, schedule_id uuid, local_date date
  kind text in ('cancelled', 'changed_window', 'extra')
  windows jsonb null, note text null (internal), contribution_id uuid, created_at
```

- Recurrence is deliberately small: weekly days, monthly nth weekday, or a
  list of dates. No free iCalendar rules.
- `public.knowledge_occurrences(p_check_id, p_from date, p_to date) returns table (local_date, starts_at timestamptz, ends_at timestamptz, state)`
  expands a schedule with its exceptions in the schedule's timezone, so a
  window crossing a clock change keeps its local times. At most 92 days per
  call.
- **One shared expansion (WS3's B04 ask, A27).** The expansion is one pure
  function, `private.schedule_occurrences(p_timezone, p_effective_from,
p_effective_to, p_recurrence, p_windows, p_exceptions, p_from, p_to)`,
  which reads no table (`stable` only because timezone data can change).
  `knowledge_occurrences` and `knowledge_schedule_preview` are thin wrappers
  over it, and B04 calls it for menu availability windows, its own and those
  that follow a B03 service schedule. A TypeScript mirror
  (`expandScheduleOccurrences`) and a shared fixture file
  (`tests/fixtures/knowledge/occurrences.json`: both UK clock changes, a
  window past midnight on a change night, a cancelled Sunday, the
  `effective_to` cut-off) run through both. Built in B03-d.
- **`effective_to` has one meaning:** the last local date the service is
  offered. From the next day the service reads Not offered, as the venue
  stated. It is never staleness and never drives freshness (§7.1).
- A schedule is stated by a contribution and becomes current with it, so the
  B01 decisions (confirm, decline, dispute) apply. A changed schedule is a
  new version that supersedes the old one from its `effective_from`; the old
  version stays for history.

### 6.2 Recurring Sunday service (semantic case)

`sunday_roast` (when added): `service.v1` Offered, with a weekly schedule on
Sundays, the window the venue states, `effective_from` the date it starts,
optionally `effective_to`. A dated exception (`cancelled` on one Sunday)
removes that occurrence only. From the day after `effective_to` the service
reads Not offered (§6.1). A `schedule_ended` recheck task asks the manager
whether it continues under a new schedule; until someone answers, the
reading stays Not offered, which is what the venue said.
The times, start date and exceptions are all venue-supplied (§10).

### 6.3 Takeaway and entertainment

- `takeaway_service`: service with a schedule; `channels[]` (internal) record
  how guests order; `takeaway_pickup` stays the collection point facility.
- `live_music`, `pub_quiz`: service with a schedule, or dated events through
  `schedule_event.v1` for one-off nights.

### 6.4 Sport: three separate claims

| Claim             | Key                      | Value                                                                                  | What it never implies                     |
| ----------------- | ------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| Screens           | `sports_screens`         | `facility.v1`: present, locations                                                      | Any subscription or any fixture           |
| Subscriptions     | `sports_subscription`    | `service.v1`: `broadcasters[]` from a list the owner supplies (OD-16), effective dates | That any particular fixture will be shown |
| A fixture showing | `sports_fixture_showing` | `schedule_event.v1`: fixture title, local date and window, committed by a manager      | Anything beyond that fixture              |

- "A sports subscription without a promise to show every fixture" is the
  default reading of `sports_subscription`; only a dated
  `sports_fixture_showing` is a commitment.
- `sports_screen` (existing) becomes `superseded`. Its old answers stay
  readable under version 1. Reconciliation (§8) may propose
  `sports_screens = Yes` from a current `sports_screen = Yes` for a manager
  to decide; it never proposes a subscription or a showing.
- A fixture showing expires at the end of its window (§7).

### 6.5 Temporary unavailability and removal

| Situation                               | Representation                                                                                   | Reads as                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Temporarily out of use (heater broken)  | A new contribution with `availability.state = 'temporarily_unavailable'` and `until` or a note   | Available: No (temporarily), previous Yes kept |
| Back in use                             | A new contribution with `available`                                                              | Available: Yes                                 |
| Removed for good                        | A new current answer No (or Not offered) with `effective_from`; the schedule gets `effective_to` | No from that date; history shows the change    |
| `until` passes with no new contribution | Recheck opens (§7); the answer reads "needs checking" rather than silently returning to Yes      | Needs checking                                 |

### 6.6 Authorisation and tests

- Staff may send schedules and exceptions as contributions; a manager
  confirms (schedules are operational commitments; OD-14). Only managers
  and admins create `sports_fixture_showing` commitments.
- Tests:
  - weekly roast with a cancelled Sunday and an end date: occurrences over 8
    weeks match a hand-computed list;
  - a window across the October and March clock changes keeps its local
    times;
  - a window past midnight belongs to its start date;
  - a subscription without a showing never yields a fixture occurrence;
  - a schedule version change keeps old occurrences readable for past dates;
  - temporary unavailability past `until` reads as needs checking.

---

## 7. B03-05: freshness and recheck

### 7.1 Policies

```text
public.knowledge_freshness_policies               -- append-only versions
  id text, version integer, primary key (id, version)
  claim_class text in ('fixture', 'offering', 'schedule', 'policy', 'accessibility', 'event')
  use text in ('internal', 'public')
  max_age interval, recheck_lead interval
  basis text in ('observed_on', 'stated_on', 'event_end')
  created_at, created_by, note
```

Proposed defaults, all **owner to confirm** (OD-15); none is a venue fact:

| Class           | Basis                              | Internal max age  | Public max age    | Recheck lead |
| --------------- | ---------------------------------- | ----------------- | ----------------- | ------------ |
| `fixture`       | `observed_on`                      | 365 days          | 180 days          | 30 days      |
| `offering`      | `observed_on`                      | 90 days           | 60 days           | 14 days      |
| `schedule`      | `observed_on`                      | 90 days           | 30 days           | 14 days      |
| `policy`        | `stated_on` (`authority.statedOn`) | 180 days          | 90 days           | 30 days      |
| `accessibility` | `observed_on`                      | 180 days          | 90 days           | 30 days      |
| `event`         | `event_end`                        | ends at the event | ends at the event | none         |

A question version names one policy per use, or none (`unrated`, today's
behaviour for every key). A policy's freshness runs from the date the
authority stated it (`authority.statedOn`), not from when a manager pressed
confirm. `effective_to` never drives freshness: it ends a service (§6.1).

### 7.2 Observation date

- New contributions may carry `observed_on` (a local date): the day the
  person checked. The capture form defaults it to today; the person may
  choose an earlier date up to 30 days back (OD-15). It is recorded as
  stated, by the person, never inferred from upload, save, file metadata or
  migration times (plan §16).
- The contribution also records `observed_on_source`: `form_default`
  when the person left today's date, `chosen` when they set it. Both count
  as the basis by default; OD-15 decides whether `form_default` should.
- **A missing basis never means "never expires".** On a key whose version
  names a freshness policy for a use, an answer without its basis date
  (`observed_on`, or `authority.statedOn` for policies) reads
  `unavailable / stale / basis_missing` for that use, and a
  `basis_missing` recheck opens. This includes answers given before the key
  gained a policy. Only keys with no policy for that use are `unrated`.

### 7.3 Read-time computation

- The resolver computes `freshness_state` (`current`, `due_soon`,
  `expired`, `unrated`) and `next_check_due` per use from the registry
  version, the policy and the dates, at read time. A late job can never keep
  an expired answer eligible.
- An expired answer for a use reads as `unavailable / stale / expired` for
  that use, and an answer with no basis date reads
  `unavailable / stale / basis_missing` (§7.2). The value is kept and shown to managers as the previous answer;
  nothing is cleared or deleted.
- The B01 reader's `freshness_state` and `next_check_due` columns already
  exist and are `unrated`/null. Filling them, and expiry changing status,
  is a behaviour change for v1 consumers, so it applies only to keys whose
  version names a policy, enabled per key after WS5 agrees (OD-15). The four
  pilot keys stay unrated until then.
- **Enabling a policy on an existing key** takes three steps: (1) a dry run,
  `public.knowledge_freshness_preview(p_key, p_policy)` (admin, no write),
  counts per venue and use the answers that would read `expired` or
  `basis_missing` and the recheck tasks that would open; (2) the owner
  reviews that count; (3) a migration adds the version naming the policy.

### 7.4 Recheck tasks

```text
public.knowledge_recheck_tasks
  id uuid pk, venue_id, check_id
  cause text in ('due_soon', 'expired', 'basis_missing', 'schedule_ended', 'temporary_until_passed',
                 'evidence_lost', 'schema_changed', 'scope_changed')
  due_at timestamptz, use text
  owner_role text                                  -- assignee: the check's current assignee, read at query time (§14 A11)
  state text in ('open', 'done', 'cancelled'), closed_by uuid null, closed_at null
  created_at
  unique (check_id, cause, due_at, use)            -- idempotent creation
```

- A scheduled job (the existing internal cleanup route's pattern, run by the
  same scheduler) calls `private.knowledge_open_rechecks(p_now)` every hour;
  it is idempotent by the unique key.
- **Closing (review M4).** A task closes (`done`) only when the resolver
  reads the slot current and fresh again for the task's use, checked by
  `private.knowledge_close_rechecks(p_check_id)` after every adoption,
  confirmation and reaffirmation, and by the hourly job. A contribution that
  is still awaiting confirmation, or that is declined, leaves the task open.
  The task records the decision that satisfied it.
- Tasks are owned by the question's `owner_role` at the venue (venue manager
  by default) and appear in B02's manager triage as a fourth queue
  (`rechecks`), which re-creates B02's `manager_triage_summary` in a new
  migration.
- Rollback: stop the job; tasks stay; read-time freshness can be switched
  off per key by a version with no policy.

### 7.5 Tests

- An answer one second past `max_age` reads expired with the job stopped.
- Expiry keeps the value for managers and opens exactly one task, even when
  the job runs twice.
- A contribution awaiting confirmation leaves the task open; when it is
  declined the task stays open; when it is confirmed (or adopted on a key
  needing no confirmation) and fresh, the task closes.
- No basis date on a key with a policy: `basis_missing` for that use and one
  recheck, never "never expires"; on a key without a policy: unrated.
- A policy's age runs from `authority.statedOn`, not from its confirmation
  time.
- `observed_on_source` is recorded as `form_default` or `chosen`.
- Internal current while public expired for the same answer.
- The four pilot keys are unchanged (no policy).

---

## 8. B03-06: reconciliation of legacy facts, findings and external sources

### 8.1 Sources

```text
public.knowledge_external_sources                 -- declared by an admin
  id uuid pk, kind text in ('venue_website', 'google_business_profile', 'booking_site', 'operator_document', 'other')
  label text, venue_id uuid null, declared_by, declared_at, retired_at null

public.knowledge_source_assertions               -- append-only, imported
  id uuid pk, source_id uuid, venue_id uuid, question_key text
  headline text null, detail jsonb null           -- validated like a contribution
  retrieved_at timestamptz, source_revision text  -- a hash or version of what was read
  excerpt text null (internal), import_run_id uuid, created_at

public.knowledge_legacy_mappings                  -- reviewed
  id uuid pk, legacy_fact_id uuid, legacy_revision integer
  question_key text, mapping_kind text in ('exact', 'candidate', 'none')
  reviewed_by, reviewed_at, reason text
  index (legacy_fact_id, legacy_revision, question_key)  -- append-only; latest review in force (§14 A13)

public.knowledge_reconciliation_runs
  id uuid pk, kind text in ('legacy', 'external'), mode text in ('dry_run', 'apply')
  started_by, started_at, finished_at, counts jsonb, conflicts jsonb, source_revisions jsonb
```

### 8.2 Rules

- **Nothing becomes current by itself.** An applied mapping or an imported
  assertion creates a B01 contribution with `contributor_basis` set to
  `legacy_fact` or `external_source` (additive values in the
  `knowledge_contributions` check, in a new migration), the answer from the
  source and `observed_on` null. A confirmation is never copied from the
  source (`identities.md` §7).
- **Always awaiting confirmation (review L4).** An imported proposal never
  completes automatically, whatever the key's rule says
  (`unassigned_auto_complete` never applies). A manager or admin decides it
  with B01's decisions.
- **Sender and D3.** The contribution's `contributed_by` is the admin who
  ran the apply. Staff see "Imported from {source label}" with no person's
  name; managers and admins also see the admin's name and the run.
- **Only onto an empty slot (review M3).** An import can be adopted only on
  a slot whose check has no stored current submission
  (`venue_amenity_checks.current_submission_id` is null). This is the stored
  state, not the resolver's status: a withdrawn or expired answer still has
  a current submission, so an import cannot be adopted over it either. Where
  the slot has one, an agreeing import
  is recorded as `seen` (corroboration) and a disagreeing one opens the
  dispute (below); choosing the import over the answer in use is refused by
  default (OD-19). This keeps imports out of credit (§9.6).
- **Legacy facts.**
  - `presence = 'unknown'` maps to nothing ("not checked", not "unable to
    establish").
  - `present` or `absent` maps only through a reviewed `exact` mapping. The
    candidates in source are `toilets` → `guest_toilets`,
    `accessible_toilet` → `accessible_toilet` and `outdoor_seating` →
    `outdoor_seating` (OD-17). Broad keys (`parking`, `dog_facilities`,
    `family_facilities`) never establish a narrower key.
  - Legacy `facts` and `policy` text become internal narrative on the
    proposal (`limitations`), never structured detail.
  - Legacy keys with no knowledge meaning (`exterior_signage`, `entrance`,
    `dining_area`, `service_area`, `bar_area`) are `none`.
  - **Every legacy row stays readable (review L5).**
    `public.knowledge_legacy_narrative(p_venue_id)` (manager or admin)
    returns each legacy fact as historical narrative, whatever its mapping
    (`exact`, `candidate` or `none`): key, presence, `facts` and
    `policy` text, and `confirmed_at` labelled "saved as confirmed in
    Coverage", never as a knowledge confirmation.
- **External sources.** An import reads a declared source, records each
  assertion with its `source_revision`, and proposes it. A second import of
  the same revision is a no-op; a changed revision adds new assertions and
  proposals.
- **Contradictions are kept.** When two sources (or a source and a finding)
  disagree, both stay as undecided contributions and the slot reads
  `disputed` through B01's dispute path, until a manager chooses or keeps
  the answer in use. No precedence rule auto-resolves.
- **Precedence only orders suggestions** (OD-17): a recent on-site finding
  first, then a manager statement, then an external source, then a legacy
  fact. It sets the order a manager sees, nothing else.

### 8.3 Runs

- `public.knowledge_reconcile(p_kind, p_mode, p_venue_id default null)`,
  admin only. `dry_run` writes the run row with counts (mapped, skipped,
  conflicting) and the list of proposals it would create; `apply` requires
  a dry run for the same scope within 24 hours whose `source_revisions`
  still match (each legacy fact's `revision`, each source's revision), or it
  refuses with `reconcile_source_changed`.
- Apply is idempotent and resumable: every proposal carries an idempotency
  key derived from (source row, revision, question key), so a rerun creates
  nothing twice.

### 8.4 Tests

- Legacy `unknown` creates nothing; `present` on `parking` creates nothing
  for `onsite_parking` or `street_parking`.
- An exact mapping creates one awaiting-confirmation proposal, never a
  current answer and never a confirmation.
- A legacy fact changed after the dry run blocks apply.
- Apply twice creates the proposals once.
- A source and a finding that disagree read as disputed until decided; both
  remain in history after the decision.
- An imported proposal on a confirmation-free key still awaits
  confirmation; staff see the source label and no name.
- An import on a slot with a current answer cannot be adopted (C-B03-4);
  an agreeing one is recorded as seen.
- A `none` mapping's legacy text is returned by
  `knowledge_legacy_narrative`.
- Credit hash and C-tests unchanged (C-B03-4, §9.6).

---

## 9. B03-07: corrections, withdrawals, schema upgrades and history

### 9.1 Corrections

- `public.knowledge_correct(p_check_id, p_slot_revision, p_idempotency_key, p_headline, p_detail, p_reason)`:
  a manager account or an admin. Staff, including staff holding a legacy
  grant, cannot correct; they send a change report (B01). The grant holders
  are excluded because they are credit participants (§9.6).
- A correction to a **material field** (`material_fields` of the version;
  the headline is always material) creates a contribution of kind
  `correction` and adopts it through B01's path, with a decision recording
  `before` and `after` (headline and detail) and
  `selection_rule = 'correction'`. It invalidates the previous
  confirmation: the new answer needs confirmation by its rule. The new
  submission's `submitted_by` is the corrector.
- A correction to a non-material field (a typo in internal text) creates no
  submission: a decision with `material = false`, `before` and `after`,
  and a detail row the resolver reads for the current answer. The
  confirmation stays.
- Schema: `correction` is an additive value in the `knowledge_contributions`
  kind check, and `before`, `after`, `material` and `selection_rule` go
  in the decision's `detail`, both in a new migration.

### 9.2 Withdrawals

- `public.knowledge_withdraw(p_check_id, p_slot_revision, p_idempotency_key, p_reason)`:
  manager or admin. Records a `withdrawn` decision; the resolver reads the
  slot as `unavailable / withdrawn / answer_withdrawn` (B01's state) without
  changing `amenity_submissions`, the check's progress or
  `amenity_check_events`, so no credit input moves (§9.6). The value stays in history. A later contribution can make a new
  answer current.
- Schema: `withdrawn` is an additive value in the `knowledge_decisions`
  decision check, and the resolver gains one branch for it, in a new
  migration.

### 9.3 Schema upgrades

- A new registry version with `change_kind = 'schema'` names an upgrade
  rule per old schema: `lossless` (for example `presence.v1` Yes →
  `facility.v1` Yes with detail `not_recorded`) or `needs_checking`.
- `public.knowledge_upgrade_run(p_key, p_mode)`, admin only, with dry run
  and apply like §8.3. Lossless upgrades add a derived detail row tagged
  `upgraded_from` and keep the answer current under the new version.
  Otherwise the old answer stays readable under its own version and the slot
  reads `stale / schema_changed` with a recheck (§7.4).
- Old contributions keep their recorded schema and version forever; reads
  always interpret a value under the version it was given under (plan §8:
  "old source versions retained").

### 9.4 History reconstruction

- `public.knowledge_slot_history(p_check_id, p_at timestamptz) returns jsonb`:
  manager or admin. Rebuilds the answer in use at `p_at` from append-only
  events and decisions: the submission current then, its confirmation
  state, its detail and version, and the rule that selected it
  (`adopted`, `confirmation`, `conflict_choice`, `correction`, `withdrawal`,
  `expiry`).
- The current answer is always what the history read returns for `now()`;
  a test compares the two for every fixture.

### 9.5 Concurrency

- Every command takes the slot revision the caller saw and an idempotency
  key (B01 §11). A correction racing a send or a decision meets
  `amenity_conflict`; a retry with the same key replays.
- Lock order is B01's (profile, key, assets, check).

### 9.6 Credit effects (review M3)

The credit count gives one unit per check per London month to the
`submitted_by` of the check's latest `submitted` answer in that month
(`private.monthly_venue_completion_counts`, unchanged; hash
`b78b9daeb8ede1fec0b7224d99348659`). Only staff with a venue membership in
the month are participants. B03 does not change that function, so each path
is designed around it:

| Path                                    | Creates a submission?                 | `submitted_by`                               | New unit for anyone                                                                                                 | Effect on the earlier answer's author                                                                                                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Material correction (§9.1)              | Yes, through B01 adoption             | The corrector: a manager account or an admin | None: neither is a participant. Staff holding a legacy grant may not correct (§9.1), because they are participants. | Closed months unchanged. In the same London month the author's unit for that check moves to the corrector, who is not a participant, so the author loses it and the venue's participant total drops by one, as for any later answer today. **OD-20** decides whether that is acceptable. |
| Non-material correction (§9.1)          | No (a decision and a detail row only) | —                                            | None                                                                                                                | None                                                                                                                                                                                                                                                                                     |
| Withdrawal (§9.2)                       | No, and no `amenity_check_events` row | —                                            | None                                                                                                                | None: the author's unit stands                                                                                                                                                                                                                                                           |
| Legacy or external import, adopted (§8) | Yes, through B01 adoption             | The admin who ran the import                 | None: admins are not participants                                                                                   | None: an import can be adopted only on a slot with no current answer (§8.2), so nobody is displaced                                                                                                                                                                                      |
| Schema upgrade (§9.3)                   | No (a derived detail row)             | —                                            | None                                                                                                                | None                                                                                                                                                                                                                                                                                     |

Edge case recorded for B08: a manager account converted from staff during a
month can still count in that month (B02 F8), so its correction in that
month could score. OD-20 covers it.

C-tests added (with the credit-function hash check on every batch):

- **C-B03-1:** a material correction by a manager account and one by an
  admin create no unit for the corrector; the author's unit in a closed
  month is unchanged; in the open month it moves exactly as a manager
  re-answer does today (pinned, so OD-20 can change it deliberately).
- **C-B03-2:** a staff account with a legacy grant is refused
  `knowledge_correct`.
- **C-B03-3:** a non-material correction, a withdrawal and a schema upgrade
  leave every participant's counts unchanged.
- **C-B03-4:** an adopted import (legacy and external) creates no unit and
  is refused (`import_slot_has_answer`) on a slot with a stored current
  submission, including one whose answer was withdrawn (§9.2) and one whose
  answer reads expired or `basis_missing` (§7.3).

### 9.7 Tests

- Before and after values and the selection rule are recorded for a
  correction; a material correction drops the confirmation, a non-material
  one keeps it.
- A withdrawal reads withdrawn for every audience and moves no credit input.
- C-B03-1 to C-B03-4 (§9.6).
- Lossless and needs-checking upgrades; an old answer still reads under its
  own version after a schema change.
- History at each event time equals a snapshot taken at that time.
- Two concurrent corrections: one wins, the other gets `amenity_conflict`
  and nothing partial is written.

---

## 10. What the owner and the venues must supply

WS1 supplies structure only. These come from people:

| Item                                                                                             | Supplied by                   | Until supplied                            |
| ------------------------------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------- |
| Entrances, routes, rooms and areas (subjects) per venue                                          | Venue manager                 | Detail refers to staff labels only        |
| Dog and other house policies, zones, conditions and exceptions                                   | Venue manager or the owner    | Policy keys stay Unknown or not confirmed |
| Organisation-wide policies, if any                                                               | Owner                         | None assumed                              |
| Sunday roast, takeaway, quiz and live music schedules, start and end dates, exceptions           | Venue manager                 | Service keys stay Unknown                 |
| Broadcaster subscriptions held and fixture showing commitments                                   | Venue manager                 | Sport keys stay Unknown                   |
| Fees and charges (pool, parking, EV, room hire)                                                  | Venue manager                 | `fees.kind = 'not_recorded'`              |
| Measurements (thresholds, ramps)                                                                 | Whoever measures, with method | No measurements                           |
| Declared external sources and who may import them                                                | Owner (admin declares)        | No imports                                |
| Review of legacy fact mappings                                                                   | Admin with the venue manager  | No legacy fact is used                    |
| Freshness durations, authorities, sensitivity, condition types, broadcaster list, venue timezone | Owner (§11)                   | Proposed defaults stay unapplied          |

---

## 11. Owner decisions

| #     | Decision                                                                                                                                                                                                                                                                                                      | Design default until decided                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-11 | Add the five proposed keys; supersede `sports_screen`; mark `swimming_pool` unsupported; retire anything                                                                                                                                                                                                      | Registry version 1 only; no new key, no lifecycle change, nothing retired                                                                                                                                                                                         |
| OD-12 | Per key: confirmation, sensitivity and family where §3.4 proposes a change from today; which presence-only keys get detail later                                                                                                                                                                              | §3.4 proposals stay unapplied; B01's seven rules unchanged. Registry version 1 records `ordinary` sensitivity for every key except `guest_wifi`; nothing may treat that as decided for the accessibility or dogs keys, for publication or redaction, before OD-12 |
| OD-13 | Who creates subjects; whether any key needs independent per-subject answers                                                                                                                                                                                                                                   | Managers and admins create subjects; one answer per venue and key                                                                                                                                                                                                 |
| OD-14 | Policy condition and exception types; who confirms venue and organisation policies; who commits schedules and fixture showings                                                                                                                                                                                | Venue manager confirms venue policies and schedules; admin for organisation scope                                                                                                                                                                                 |
| OD-15 | Freshness durations per class and use; observation-date rules; when expiry may change v1 reader status                                                                                                                                                                                                        | No freshness policy on any key; pilot keys unrated                                                                                                                                                                                                                |
| OD-16 | Venue timezone source (a venue column or a fixed estate timezone); the broadcaster list                                                                                                                                                                                                                       | `Europe/London` for every venue (the estate's helpers already use it); no broadcaster list                                                                                                                                                                        |
| OD-17 | Which legacy mappings are exact; precedence order for suggestions; which external sources may be declared                                                                                                                                                                                                     | No exact mappings; precedence as §8.2 for ordering only; no sources                                                                                                                                                                                               |
| OD-18 | Who may correct and withdraw; whether a withdrawal needs a second person                                                                                                                                                                                                                                      | Manager account or admin (not legacy grant holders), one person, reason required                                                                                                                                                                                  |
| OD-19 | Whether an import may be chosen over a current answer                                                                                                                                                                                                                                                         | No: imports are adopted only onto an empty slot                                                                                                                                                                                                                   |
| OD-20 | Whether a material correction in the same month should move the author's unit to the corrector, a non-participant, so the venue's participant total drops too (today's rule for any later answer). A material correction is also how a stale or changed answer is refreshed, so this happens in normal upkeep | Today's rule applies; B08 may change the credit policy                                                                                                                                                                                                            |

B02's open decisions (OD-2 to OD-10) and the matrix questions (Q1 to Q14) are
unchanged by this design.

---

## 12. Migration plan and rollback

Each batch is additive, with a rollback note, and runs the B02 §7.3 checks
(security suites, B01 knowledge suites, credit baseline and C-tests, the
credit-function hash, T9b and T11a guards).

| Batch | Contents                                                                                                                                       | Default behaviour change                | Rollback                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| B03-a | Registry tables and version 1 seed; `knowledge_validate_value`; registry reads                                                                 | None                                    | Drop the readers; tables stay                                                        |
| B03-b | Subjects, contribution details, `knowledge_submit` overload with detail and `observed_on`; resolver and reader detail columns (additive in v1) | None until a key gets a detail version  | Clients call the old signature; versions without detail restore the B01 view per key |
| B03-c | Policy schema and completeness check; `policy_incomplete`                                                                                      | Only for policy keys moved to version 2 | A version back to `presence.v1` for the key                                          |
| B03-d | Schedules, exceptions, occurrences; new keys after OD-11                                                                                       | None until a key is on a working list   | Disable the working-list rows; schedules stay                                        |
| B03-e | Freshness policies, read-time freshness, recheck tasks and job                                                                                 | None until a version names a policy     | Stop the job; a version with no policy per key                                       |
| B03-f | External sources, assertions, legacy mappings, reconciliation runs, contribution basis values                                                  | None: dry runs, then proposals only     | Stop runs; proposals stay undecided or are declined by a manager                     |
| B03-g | Corrections, withdrawals, schema upgrade runs, history read                                                                                    | New commands only                       | Commands unused; decisions stay in history                                           |

Re-created existing functions are named per batch before it is built, as in
B02 §7.1. Expected: `private.knowledge_slot_state` (B03-b, B03-e),
`private.knowledge_slot_json`, `public.knowledge_check` and
`public.knowledge_reader_answers_v1` (additive columns),
`public.knowledge_set_working_list` (lifecycle check) and
`public.knowledge_submit` (overload only, old signature kept); the legacy
check reads `amenity_venue_state`, `amenity_checks_for_venue`,
`amenity_check` and `amenity_check_submissions` (presented value only,
§3.8; B03-c); `knowledge_decide` and `knowledge_resolve_conflict` (admin
rule value, B03-c); B02's `manager_triage_summary` (rechecks queue,
B03-e). Never
re-created: the credit trigger `media_assets_amenity_evidence_lost`, the
credit functions, the menu and coverage write paths.

### 12.1 Owner decisions by batch

| Batch | Needs before it is enabled                                        |
| ----- | ----------------------------------------------------------------- |
| B03-a | Nothing                                                           |
| B03-b | OD-12, OD-13                                                      |
| B03-c | OD-14 (and OD-12 for the keys moved to a policy version)          |
| B03-d | OD-11, OD-16, OD-14                                               |
| B03-e | OD-15, and WS5's agreement for v1 reader changes                  |
| B03-f | OD-17 (and OD-19 for imports)                                     |
| B03-g | Nothing to build; OD-18 and OD-20 before the commands are enabled |

Building on fixtures never waits for an owner decision: every batch is
built and tested with its defaults inert, and a decision is needed only to
enable it for real venues.

### 12.2 Exit gate (plan §8)

The B03 exit gate needs OD-11, OD-14, OD-15 and OD-17 decided, the §10
venue data supplied for the reconciled records, and X2 (contact with Old
Crown staff and manager) for the real records. Until then, every family is
built and tested on fixtures only, and no venue record is reconciled.

---

## 13. Required semantic cases (plan §8) and where each is covered

| Case                                                              | Section                    | Representation                                                      | Responsible actor             | Unknown path tested    |
| ----------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------- | ----------------------------- | ---------------------- |
| Yes, No, Not applicable, Unknown                                  | §3.3                       | Headline answer (B01)                                               | Staff, manager                | B01 suites             |
| Awaiting confirmation, needs checking, stale, disputed, withdrawn | §5, §7, §8, §9             | Resolver status and detail                                          | Manager                       | §7.5, §8.4, §9.6       |
| Rapidly changing offerings versus slower facilities               | §7.1                       | Freshness classes `offering` and `fixture`                          | Owner sets durations          | §7.5                   |
| Temporary unavailability versus permanent removal                 | §6.5                       | `availability.state` with `until`; new No with `effective_from`     | Staff send, manager decides   | §6.6                   |
| Policy confirmed by a person with authority                       | §5.2, §5.4                 | `policy_authority`, decision basis                                  | Venue manager or admin        | §5.5                   |
| A photo supporting an observation while policy stays unresolved   | §5.3                       | Observation key current, policy key not confirmed                   | Manager                       | §5.5                   |
| Recurring Sunday service with a dated exception and an end date   | §6.2                       | Weekly schedule, `cancelled` exception, `effective_to`              | Venue manager                 | §6.6                   |
| A sports subscription without a promise to show every fixture     | §6.4                       | `sports_subscription` separate from `sports_fixture_showing`        | Venue manager                 | §6.6                   |
| Different internal and public views of Wi-Fi information          | §3.3, access-and-rights §4 | `restricted_detail`; internal notes never public; per-use freshness | Admin grants public use (B06) | B01 reader tests, §7.5 |
| Old source versions retained through question-schema changes      | §9.3                       | Per-contribution schema version; upgrade runs                       | Admin runs upgrades           | §9.6                   |
| An entrance observation never becomes whole-venue certification   | §4.3                       | Required `scope`; no venue-wide key; No checked at send time        | Manager confirms              | §4.5                   |
| A conditional policy or temporary outage never reads as plain Yes | §3.8                       | `qualifier`; v1 withheld, B01 fields needs checking                 | Manager                       | §3.8                   |

## 14. Answers to the B03 UI asks (A1 to A18)

Asked in the B03 UI design §11.2. Each answer gives the shape, who may call
it, what D3 lets each audience see, and the batch that builds it. Nothing
here is enabled before its batch's owner decisions (§12.1).

### 14.1 Shared write rule: request keys

B03's own keyed writes (places, schedule exceptions, sources, mapping
reviews, corrections, withdrawals) record their first result in a new
append-only `public.knowledge_write_commands` table, with the same rules as
B02 R10: the active-account check first, the key's advisory lock, then a
replay for the same actor, command and request hash (`replayed: true`), or
`idempotency_key_reused` for anything else. A refused write records nothing.
B01's `knowledge_commands` stays untouched.

### 14.2 Answers

| #   | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Who may call it; D3                                                                                                                                                                                                           | Batch                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| A1  | `my_venue_capabilities` (B02 R8) is re-created per batch to add, from the same predicates as the gates: `canManagePlaces` (manager or admin at the venue), `canStatePolicy` (manager or admin), `canStateOrgPolicy` (admin), `canCommitShowing` (manager or admin), `canCorrect` and `canWithdraw` (manager account or admin, not a staff account with a legacy grant, §9.1), `canReadHistory` (manager or admin), and for admins only `canDeclareSources` and `canRunReconciliation`. The R8 equivalence matrix grows with each flag.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The caller's own capabilities only                                                                                                                                                                                            | b, c, d, f, g (each flag with its write)   |
| A2  | `public.knowledge_subjects(p_venue_id uuid default null) returns jsonb` → `{ items: [{ subjectId, kind, label, active, addedOn, addedBy? }] }`. Writes: `knowledge_subject_add(p_venue_id, p_kind, p_label, p_idempotency_key) → { subjectId, replayed }` and `knowledge_subject_retire(p_subject_id, p_reason, p_idempotency_key) → { retired, replayed }`, keyed as §14.1. An active place with the same kind and label (case-insensitive) is `place_exists` with its id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Read: staff of the venue see active places (kind, label) for the capture form; managers and admins also see retired ones and `addedBy` (first name for managers, full name for admins). Writes: manager or admin of the venue | b                                          |
| A3  | The finding keeps its label as written. A manager creates the place separately (A2); later findings pick it. Decisions do not relink labels in B03 (details are append-only). OD-13 can add a relinking decision later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                                             | b                                          |
| A4  | `public.knowledge_value_list(p_list text) returns jsonb` → `{ list, items: [{ code, label, needsValue, valueKind }] }` for `policy_condition_types` and `policy_exception_types`, from a new `knowledge_value_list_items` table seeded **empty**; the owner supplies the items (OD-14) and a migration adds them. Retired items are omitted from the list but still read on old answers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Any active user; labels only                                                                                                                                                                                                  | c                                          |
| A5  | `knowledge_check` gains `policyMissing: string[]` on `answerInUse` and on each pending finding (evaluated as if that finding were adopted), and `knowledge_to_confirm` items gain the same. Codes: `stance`, `conditions`, `zones`, `authority`, `stated_on`. An empty array means complete; the field is absent on non-policy keys.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Staff see codes on their own findings and on the answer in use; managers and admins on everything. Codes only, never names                                                                                                    | c                                          |
| A6  | `knowledge_check` gains `timezone` (IANA name) from `private.venue_timezone(p_venue_id)`, which returns `Europe/London` for every venue under the OD-16 default. If OD-16 chooses a venue column, only that function changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Anyone who may read the check                                                                                                                                                                                                 | d                                          |
| A7  | **A schedule is sent inline** in `p_detail` on `knowledge_submit` (`service.v1` detail: `schedule: { effectiveFrom, effectiveTo, recurrence, windows }`, the timezone taken from A6). The schedule row is created when the contribution is adopted; until then it exists only in the detail. **A single-date exception** on a schedule in use is a separate command, `knowledge_schedule_exception(p_check_id, p_slot_revision, p_idempotency_key, p_schedule_id, p_local_date, p_kind, p_windows, p_note) → { exceptionId, slotRevision, replayed }`, keyed as §14.1. It records a `schedule_exception_added` knowledge event (an additive event kind), so the slot revision moves.                                                                                                                                                                                                                                                                                                        | Inline schedules: anyone who may send a finding. Exceptions: manager or admin (schedules are the venue's commitments, OD-14); staff send a change report instead                                                              | d                                          |
| A8  | `public.knowledge_schedule_preview(p_schedule jsonb, p_timezone text, p_from date, p_to date) returns table (local_date, starts_at, ends_at, state)`: `stable`, no write, the same validator as the send, at most 92 days.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Any active user                                                                                                                                                                                                               | d                                          |
| A9  | The A4 read with `p_list = 'broadcasters'`, seeded empty until the owner supplies the list (OD-16).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Any active user                                                                                                                                                                                                               | d                                          |
| A10 | `knowledge_check` and working-list rows gain `freshness: [{ use: 'internal' \| 'public', state: 'current' \| 'due_soon' \| 'expired' \| 'basis_missing' \| 'unrated', nextCheckDue, basis: 'observed_on' \| 'stated_on' \| 'event_end' \| null, basisDate }]`, one entry per use. Before B03-e both entries read `unrated`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Anyone who may read the check. `basisDate` is a date, never who observed                                                                                                                                                      | b (fields, unrated), e (values)            |
| A11 | `public.my_rechecks() returns jsonb` → `{ items: [{ taskId, checkId, venueId, questionKey, question, cause, use, dueAt }] }`: open tasks on checks assigned to the caller at their current venue. `public.knowledge_check_rechecks(p_check_id) returns jsonb` → the check's open tasks. **Assignment:** a task's assignee is the check's current assignee, read at query time (the existing assignment and R10's keyed writes); §7.4's `assignee_id` column is dropped from the model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `my_rechecks`: the caller's own. Per check: managers and admins see every task; staff see tasks on checks assigned to them, and otherwise a count                                                                             | e                                          |
| A12 | Yes. `manager_triage_summary` gains a `suggestions` queue counting undecided imported proposals (`legacy_fact`, `external_source`); the `findings` queue stops counting them. `knowledge_to_confirm` items gain `source` (`staff_finding`, `manager_statement`, `legacy_fact`, `external_source`). The B03-e re-creation (rechecks) and this one are separate migrations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Managers and admins (as B02 R3)                                                                                                                                                                                               | f                                          |
| A13 | Admin only, all in B03-f: `knowledge_source_declare(p_kind, p_label, p_venue_id, p_idempotency_key) → { sourceId, replayed }`; `knowledge_source_retire(p_source_id, p_reason, p_idempotency_key)`; `knowledge_sources(p_include_retired boolean) → { items }`; `knowledge_legacy_mappings(p_venue_id, p_cursor) → { items: [{ legacyFactId, legacyRevision, legacyKey, presence, mappings: [{ questionKey, kind, reason, reviewedBy, reviewedAt }] }], nextCursor }`; `knowledge_mapping_review(p_legacy_fact_id, p_legacy_revision, p_question_key, p_kind, p_reason, p_idempotency_key)`; `knowledge_reconciliation_runs(p_cursor) → { items, nextCursor }`; `knowledge_reconciliation_run(p_run_id) → { counts, wouldCreate[], conflicts[], sourceRevisions }`. Mapping reviews are append-only; the latest review for (fact, revision, key) is in force, so §8.1's unique constraint becomes a non-unique index.                                                                       | Admins; reviewer names shown to admins only                                                                                                                                                                                   | f                                          |
| A14 | `knowledge_question` returns `materialFields` with every other version field (§3.5). Built now.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Any active user                                                                                                                                                                                                               | a                                          |
| A15 | `private.knowledge_contribution_view` is re-created so `stateReason` gains `corrected` and `withdrawn` for the author's adopted answer that a correction replaced or a withdrawal took out of use; `managerNote` carries the correction or withdrawal reason, as it already does for a decline (the manager's form says the reason is shown to the person). My findings and My contributions read through it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | The author only (as B01)                                                                                                                                                                                                      | g                                          |
| A16 | `public.knowledge_slot_events(p_check_id, p_cursor, p_limit) returns jsonb` (limit 1 to 50, `(time, key)` cursor) → `{ items: [{ eventId, at, kind, actor: { id, name, basis }, before, after, material, selectionRule, reason }], nextCursor }`. `kind` covers contributions, adoptions, confirmations, declines, revokes, reaffirms, corrections, withdrawals, schedule exceptions and upgrades. `before` and `after` are audience-filtered headline and detail. Expiry is computed when read, so it is not an event; the history-at-time read (§9.4) shows it.                                                                                                                                                                                                                                                                                                                                                                                                                           | Managers and admins (`canReadHistory`). Staff keep their own findings view                                                                                                                                                    | g                                          |
| A17 | See §14.3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                             | per code                                   |
| A18 | Refused: `invalid_value` (400) with field path `detail.entrances` and problem `no_entrances_listed`. Unknown is accepted. The UI can offer "Add the venue's entrances under Places, or send Couldn't establish".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                             | b                                          |
| A19 | Legacy reads (B03-c): for a qualified answer they present `progress = 'needs_recheck'` and a new `qualification` column (`conditional` or `temporarily_unavailable`, else null), with `recheck_reason` worded per qualifier: "The answer in use has conditions. Open the check to see them." and "The answer in use is temporarily unavailable. Open the check to see until when." (the UI design's wording, §2.6; B03-d) `canReopen` is computed from the **stored** row (stored `progress = 'complete'` with a current submission), so a manager can still reopen. B03-c leaves the view `private.amenity_check_rows` and `amenity_my_checks` unchanged (A21); a new view, `private.amenity_check_rows_presented`, feeds `amenity_checks_for_venue` and `amenity_check`, which are dropped and re-created with the added `qualification` column, as is `amenity_check_submissions` (per submission). The TypeScript views keep Reopen for a qualified answer and never list it as a task. | As today's legacy reads                                                                                                                                                                                                       | c                                          |
| A20 | The parameter is `p_observed_on_source` (`form_default` or `chosen`), with `p_detail` and `p_observed_on`, on the 19-argument `knowledge_submit` overload. Both date fields are required together.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | —                                                                                                                                                                                                                             | b                                          |
| A21 | Confirmed: `amenity_my_checks` stays on stored rows and is not re-created. It lists the caller's checks whose stored progress is not complete; a qualified answer is stored complete, so it stays off the staff task list, which is right (nothing is assigned to do).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                             | none                                       |
| A22 | Precedence (§3.8): every other unavailable reason wins over `qualified_answer`. A slot that is also withdrawn, disputed, expired, `basis_missing`, `schema_changed` or `policy_incomplete` reads with that reason, and `answerInUse.qualified` stays present as the previous answer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | As §3.8                                                                                                                                                                                                                       | c                                          |
| A23 | `adoptable: boolean` on imported items in `knowledge_to_confirm` and on pending findings in `knowledge_check`: true only when the check has no stored current submission (§8.2). The UI gates Confirm on it; the server refuses regardless (`import_slot_has_answer`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Managers and admins                                                                                                                                                                                                           | f                                          |
| A24 | `rechecksClosed: [{ taskId, use }]` on the results of the 19-argument `knowledge_submit`, `knowledge_decide` and `knowledge_resolve_conflict`: the tasks this command closed (§7.4). Empty until B03-e. The 16-argument `knowledge_submit` result is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | The caller's own result                                                                                                                                                                                                       | e                                          |
| A25 | `knowledge_check` does not return a schedule id today. B03-d adds `answerInUse.scheduleId` (the schedule version in use) for `knowledge_schedule_exception`'s `p_schedule_id`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Anyone who may read the check                                                                                                                                                                                                 | d                                          |
| A26 | No, by default: a typed entrance ("somewhere else", a label without a place) cannot satisfy a step-free Yes or No. `detail.entrances` takes places only, so a Yes needs a listed entrance. The person can send Couldn't establish and name the entrance in the finding, and a manager adds the place (A2). OD-13 decides whether a label may count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | —                                                                                                                                                                                                                             | b                                          |
| A27 | WS3 (B04): occurrence expansion is one shared pure function, `private.schedule_occurrences`, with a TS mirror and shared fixtures (§6.1). B04 calls it for menu availability windows instead of keeping a copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Definer functions only (revoked from clients)                                                                                                                                                                                 | d                                          |
| A28 | WS4 K1: `private.knowledge_evidence_for_assets(p_asset_ids uuid[], p_now timestamptz) returns table (asset_id, venue_id, check_id, question_key, role, slot_status, slot_reason, freshness)`, at most 100 ids, no names, values or notes. `role` is `current_answer`, `pending_finding` or `earlier_answer`, by R9's predicates (`private.asset_removal_effects`) without its viewer filter; a test pins that both agree for the uploader. `freshness` is the A10 per-use shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Definer functions only, after the caller's own gate                                                                                                                                                                           | c (shape; freshness `unrated`), e (values) |
| A29 | WS4 K2: `private.knowledge_public_media_eligible(p_venue_id, p_question_key, p_now) returns jsonb { eligible, reason }`, plus a set form over up to 500 `(venue_id, question_key)` pairs. Eligible only when the slot is available, its public freshness is `current` or `due_soon` (or `unrated` where the key has no public policy), the version's `public_media` is `with_grant`, the key is not a redaction key (`guest_wifi`), and a policy answer is complete (`private.knowledge_policy_complete`, B03-c). Anything missing reads not eligible.                                                                                                                                                                                                                                                                                                                                                                                                                                      | Definer functions only                                                                                                                                                                                                        | e                                          |
| A30 | WS4 K3: version field `public_media text not null default 'never' check (public_media in ('never', 'with_grant'))`, returned by `knowledge_question` as `publicMedia`. Every version 1 reads `never`; only a migration after owner approval changes it, as for the other registry fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | As `knowledge_question`                                                                                                                                                                                                       | c                                          |
| A31 | WS4 K4: confirmed, the legacy `evidence_lost` check event names the asset: its detail is `{ submissionId, assetId }` (`20261107120000_amenity_catalogue.sql:645-646`), as `evidence_withdrawn` knowledge events do. `private.asset_evidence_events(p_asset_id) returns jsonb` lists both kinds for the asset with venue name, question text, time and the slot's current status.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Definer functions only; WS4 gates managers and admins                                                                                                                                                                         | e                                          |
| A32 | WS4 K5: confirmed. `knowledge_submit` never derives `observed_on`: it is stated by the caller with its source, both or neither (A20), and never read from asset metadata or times. Recheck tasks carry no asset id; A31 is the link.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                             | —                                          |
| A33 | Added in B03-c: a version field `features jsonb` (`[{ key, label, measurable }]`, at most 40, keys `[a-z_]{1,40}`, unique), returned by `knowledge_question` as `features`. Owner-supplied under OD-12, so every version 1 is empty. The value schema stays key-agnostic; the send's question check (`private.knowledge_detail_venue_problems`, with the key's latest version) refuses a feature the version does not list, and a measurement of a feature not marked `measurable`, as `not_allowed` at `detail.features.<key>` or `detail.measurements[i].feature`.                                                                                                                                                                                                                                                                                                                                                                                                                        | As `knowledge_question`                                                                                                                                                                                                       | c                                          |
| A34 | Rule: `detail.scope` is the place the observation covers. When `entrances[]` lists at least one place, `scope` may be left out and the answer covers the listed entrances; nothing is derived or stored for it. With no entrances listed, a Yes or No still needs a `scope`. The builder's default (the first step-free entrance for Yes, the first listed for No) is also accepted, but leaving `scope` out is simpler. Confirmed: `entrances[]` takes places only (`subjectId`), so a typed "Somewhere else" can never be in it and never counts towards Yes or No (A26).                                                                                                                                                                                                                                                                                                                                                                                                                 | —                                                                                                                                                                                                                             | c                                          |

### 14.3 Error codes (A17)

None of these is retryable; only `unavailable` (503) is.

| Message                                   | SQLSTATE | `KnowledgeErrorCode`                             | HTTP | Detail                            |
| ----------------------------------------- | -------- | ------------------------------------------------ | ---- | --------------------------------- |
| `invalid_value`                           | 22023    | `invalid_input` with `fieldErrors` keyed by path | 400  | `{ fields: [{ path, problem }] }` |
| `unknown_value_schema`                    | 22023    | `invalid_input`                                  | 400  | —                                 |
| `knowledge_question_not_found`            | P0002    | `not_found`                                      | 404  | —                                 |
| `policy_incomplete`                       | NLK10    | `state_conflict`                                 | 409  | `{ missing: [codes] }` (A5)       |
| `knowledge_key_not_supported`             | NLK11    | `state_conflict`                                 | 409  | `{ key, lifecycle }`              |
| `reconcile_source_changed`                | NLK12    | `state_conflict`                                 | 409  | `{ changed: [source refs] }`      |
| `place_exists`                            | NLK13    | `state_conflict`                                 | 409  | `{ subjectId }`                   |
| `import_slot_has_answer`                  | NLK14    | `state_conflict`                                 | 409  | —                                 |
| `idempotency_key_reused`                  | P0001    | `state_conflict`                                 | 409  | —                                 |
| A staff account correcting or withdrawing | 42501    | `not_permitted`                                  | 403  | —                                 |

**Field path format:** a dot path from the value's root, with array indexes
in brackets, for example `headline`, `detail.entrances`,
`detail.entrances[0].stepFree`, `detail.schedule.windows[1].end`. `problem`
is a short code (`required`, `not_allowed`, `invalid`, `too_long`, `out_of_range`,
`no_entrances_listed`, `unknown_subject`). The TypeScript mapper keys
`fieldErrors` by the path.

### 14.4 B05-m5 (WS4's B05 §1.5, S1 to S6), acknowledged

WS1 will build B05-m5 in B05 to WS4's specification, in its own migration,
for WS4 to review against B05 §1.10. Nothing is built in B03.

- **S1:** `media_contribution_group_members.position` check widened to 1..30
  (existing rows already satisfy it).
- **S2:** `contribution_group_add` counts live members for
  `contribution_group_full` (live limit 10, OD-7); the manager-era rule
  (`20261110095909`) is kept. To confirm with WS4: which `failed` reasons
  are permanent. Default until then: every `failed` or deleted member is not
  live.
- **S3:** `media_asset_links`, append-only with the no-truncate guard and no
  client policies, written only by S4.
- **S4:** `contribution_group_replace(p_group_id, p_failed_asset_id,
p_new_asset_id)`, creator only, idempotent per pair; a different new asset
  for the same failed member is `idempotency_key_reused`; B02's refusal codes.
- **S5:** `contribution_group` gains `replacesAssetId` on every member, the
  per-member dimensions and `summary` for the creator, the venue's manager
  (`private.can_manage_venue`) and admins, and `creatorFirstName` only for
  colleagues. WS4's two helpers are called behind a missing-function check
  (`to_regprocedure`), reading `null` until B05-m1 and B05-m2 exist.
- **S6:** the R5 feed photo row gains `use` from
  `private.media_asset_use_summary(asset_id, 'uploader')`.
- No credit function, evidence trigger or community read is re-created.

---

## 15. Changelog

**Draft 1 (10 Nov 2026):** first B03 server design from plan §8, the B01 and
B02 designs and the knowledge docs, at `ebd41c48`.

**Draft 2 (10 Nov 2026):** the review's requested changes.

- **M1:** §3.8 specifies each existing consumer's output for Conditional
  and temporarily unavailable answers (v1 reader withholds; screens' B01
  fields read needs checking; legacy reads present needs recheck without
  changing stored rows), with a gate and tests. The step-free headline is
  validated when sent (§4.3).
- **M2:** policy freshness runs from `authority.statedOn`; a missing basis
  date on a key with a policy reads `basis_missing`, never "never expires";
  `observed_on_source` is recorded.
- **M3:** §9.6 states `submitted_by` and the credit effect of corrections,
  withdrawals, imports and upgrades; corrections by legacy grant holders
  are refused, imports adopt only onto an empty slot; C-B03-1 to C-B03-4;
  OD-19 and OD-20.
- **M4:** recheck tasks close only when the slot is current and fresh again.
- **Lows:** five proposed keys; lifecycle, `superseded_by` and
  `requires_zones` on the version; `policy_authority` and `admin` mapped to
  `knowledge_question_rules`; one meaning for `effective_to`; the step-free
  No needs a listed entrance; imports always await confirmation with the D3
  sender rule; legacy rows stay readable as narrative; OD-to-batch table and
  exit gate (§12.1, §12.2).

**Draft 2, amendment (10 Nov 2026), design accepted at `a4208ae0`:**

- An empty slot means no stored current submission; C-B03-4 covers imports
  after a withdrawal and after expiry.
- §12.1 lists what each batch needs before it is enabled; building on
  fixtures never waits.
- Enabling a freshness policy on an existing key starts with a dry-run count
  of the rechecks it would open (§7.3).
- OD-20 states that the venue's participant total drops too, and that a
  material correction is also how answers are refreshed.
- New §14 answers the B03 UI asks A1 to A18; recheck tasks follow the
  check's assignee; mapping reviews are append-only with the latest in force.

**Draft 2, second amendment (10 Nov 2026):** answers A19 to A26 from the B03
UI design (legacy-read qualification, the observation-date parameter,
`amenity_my_checks`, reason precedence, `adoptable`, `rechecksClosed`,
the schedule id, typed entrances); the OD-12 note on version 1's
sensitivity; family, subject type and owner role are version fields (B03-b).

**B03-b as built (10 Nov 2026):** the answer in use carries its structured
detail as `answerInUse.detail`, with `answerInUse.detailRecorded` and
`answerInUse.observedOn`; the slot's top-level `detail` stays B01's text.
Pending findings carry `detail` and `observedOn`. The 19-argument send
returns `rechecksClosed: []` until B03-e. A date inside detail that is not a
real calendar date is `invalid`, never a database error. The B03 migrations
are re-timed to sort after B02's `20261110095909`: B03-a is now
`20261110100502` and B03-b `20261110100504`.

**Cross-batch asks (10 Nov 2026):** A27 (WS3's B04: one shared occurrence
expansion, §6.1, built in B03-d); A28 to A32 (WS4's B05 asks K1 to K5,
scheduled in B03-c and B03-e); §14.4 acknowledges B05-m5 (S1 to S6), built
later in B05.

**B03-c as built (10 Nov 2026), flagged for WS5 and the reviewer:** changes
v1 reader output for qualified and incomplete policy answers (§3.8, §5.2) and
re-creates `knowledge_decide` and `knowledge_resolve_conflict` (admin rule
value, organisation-scope policies). The resolver change is a wrapper,
`private.knowledge_slot_state_b03`, over the unchanged B01
`private.knowledge_slot_state`; it changes only a slot that would read
available (policy incomplete first, then qualified), so every other reason
keeps precedence (A22). Value lists are seeded empty. Also K1's shape (A28),
K3 (A30), A33 and A34, and `private.knowledge_detail_venue_problems` reads
only arrays (a malformed list in a facility detail was a database error).

**B03-b review M1 fixed (10 Nov 2026):** the venue check behind the
19-argument send ran the step-free rule on `step_free_entrance` whatever the
version's schema, so on version 1 a plain Yes or No with no detail was
refused there but accepted by the 16-argument send. The check now takes the
version's schema: presence and Wi-Fi get none, place checks run for facility,
accessibility and policy details, and the step-free rule and feature checks
for accessibility only (`private.knowledge_detail_venue_problems_for`).

**B03-d as built (10 Nov 2026):** schedules (§6, A6 to A9, A25, A27).

- The shared expansion is `private.schedule_occurrences` with its shape
  checks (`private.schedule_problems`, `private.schedule_window_problems`,
  `private.schedule_exception_problems`); the TypeScript mirror is
  `lib/server/knowledge/schedules.ts` (`expandScheduleOccurrences`), and
  `tests/fixtures/knowledge/occurrences.json` runs through both. A local time
  in a spring gap is read with the offset before the change, a repeated
  autumn time with the offset after it, as Postgres reads them. A cancelled
  date is returned with `state = 'cancelled'` (so a screen can show it);
  B04 drops those rows for availability.
- A schedule sent in a `service.v1` detail becomes a
  `knowledge_schedules` row when its finding is adopted, from either side:
  the adoption decision, or the detail row stored just after a send that was
  adopted at once. `knowledge_adopt` is not re-created.
- `knowledge_schedule_exception`: one exception per date on the schedule in
  use; a second is `schedule_exception_exists` (`state_conflict`); another
  schedule is `knowledge_not_current`. Errors `invalid_range` and
  `invalid_timezone` map to field errors.
- **Decision to confirm:** §6.1's "from the day after `effective_to` the
  service reads Not offered" changes reader output, so it is not built in
  B03-d; it is proposed with B03-e's `schedule_ended` recheck, with WS5's
  agreement. Until then an ended schedule simply yields no occurrences.
- §6.6 "only managers and admins commit a fixture showing" is carried by the
  key's confirmation rule (venue manager) when `sports_fixture_showing` is
  added under OD-11.
- B03-c review low: the legacy presented `recheck_reason` takes the UI
  design's per-qualifier wording (b03-ui-design §2.6).

**B03-e as built (10 Nov 2026), flagged for WS5 and the reviewer:**
freshness and rechecks (§7, A10, A11, A24), with WS4's K1 values, K2 and K4
(A28, A29, A31).

- `knowledge_freshness_policies` is seeded empty and no version names a
  policy (OD-15), so every answer still reads `unrated` and the v1 reader's
  output is unchanged today. For a key whose latest version names a policy,
  the reader fills `freshness_state` and `next_check_due` (internal use)
  and an expired or basis-missing answer reads `unavailable / stale /
expired` or `basis_missing`. Precedence for an otherwise available slot:
  expired, basis_missing, policy_incomplete, qualified_answer (A22).
- Due is local midnight of the basis date plus `max_age` (the event's end for
  `event_end`); `due_soon` from due minus the lead. The computation is one
  pure function, `private.knowledge_freshness_entry`.
- Recheck tasks: `due_soon`, `expired` (not when that due date already has an
  open task), `basis_missing`, `temporary_until_passed` and
  `schedule_ended` are opened by `private.knowledge_open_rechecks`;
  `evidence_lost`, `schema_changed` and `scope_changed` are reserved for
  B03-g. A task closes only when the slot reads available and current (or
  unrated) for its use, from triggers on adoption, confirmation, reaffirmation
  and a stored detail row, and from the job. `rechecksClosed` lists the tasks
  the command closed; a replay returns none.
- **The job's schedule is not added.** `public.knowledge_run_rechecks()`
  (service role) is the entry; the internal route and its cron entry are
  added when OD-15 enables freshness, with the scope guard's handler list.
- The manager triage read returns a `rechecks` row; the TypeScript
  `getManagerTriage` keeps B02's three queues and adds a separate
  `rechecks` summary, so B02 screens are unchanged.
- `private.knowledge_slot_state_b03` gained `p_now` (default `now()`) so
  K2 and the job can read at a given time.

**B03-f as built (10 Nov 2026):** reconciliation (§8, A12, A13, A23).

- Admin only: `knowledge_source_declare`, `knowledge_source_retire`,
  `knowledge_source_import` (what a source said at one revision; a revision
  imports once; each line is validated as a finding under the key's latest
  version, with paths under `assertions[i]`), `knowledge_mapping_review`
  (for the fact's current revision only), `knowledge_reconcile` (dry run,
  then apply within 24 hours with the same source revisions, else
  `reconcile_source_changed`; without a dry run `reconcile_dry_run_required`,
  both NLK12), `knowledge_sources`, `knowledge_legacy_mappings`,
  `knowledge_reconciliation_runs` and `knowledge_reconciliation_run`.
  Managers and admins: `knowledge_legacy_narrative`.
- A proposal is a finding awaiting confirmation, sent by the admin who ran
  the apply; it never completes at import. An agreeing import is recorded as
  `seen`; a disagreeing one leaves the slot disputed. Confirming or choosing
  an import while the check has a stored current submission is
  `import_slot_has_answer` (NLK14). Pending findings and to-confirm items
  carry `source`, and imports also `sourceLabel` and `adoptable`. The
  manager triage read has a `suggestions` row; `findings` no longer counts
  imports. TypeScript adds a separate `suggestions` summary beside B02's
  queues.
- **Decision to confirm (basis):** §8.2 named additive `contributor_basis`
  values `legacy_fact` and `external_source`. Adoption copies that basis
  into `amenity_submissions.submitter_basis`, whose check is a released
  constraint (T11a), so the import keeps `contributor_basis = 'admin'` (the
  admin did run it) and its origin is recorded in
  `knowledge_contribution_sources`. No released constraint changes.
- **Decision to confirm (evidence):** an imported Yes keeps the key's
  evidence rule, so it can be confirmed only with evidence. A legacy fact's
  own ready photos and videos are attached as its evidence; an external
  source has none, so its Yes stays a suggestion a manager can decline or
  answer afresh. Owner to confirm with OD-17 and OD-19.
- `knowledge_write_commands.venue_id` became nullable for an
  organisation-wide source.

**B03-g as built (10 Nov 2026), flagged for WS5 and the reviewer:**
corrections, withdrawals, schema upgrades and history (§9, A1, A15, A16).

- The v1 reader reads a withdrawn answer as `unavailable / withdrawn /
answer_withdrawn` (ahead of every reason but `not_enabled`) and an answer
  under a replaced schema without a lossless rule as `stale /
schema_changed`. Nothing is withdrawn and no schema version exists, so
  nothing changes today. The B01 resolver is unchanged; the wrapper reads a
  `withdrawn` decision on the answer in use.
- `knowledge_correct` and `knowledge_withdraw`: a manager account or an
  admin; staff and staff holding a legacy grant get `not_venue_manager`
  (C-B03-2). A material correction carries the answer's evidence and
  observation date onto a `correction` contribution adopted through B01's
  `knowledge_adopt`, without its confirmation; the decision's new `detail`
  column records `before`, `after`, `material` and `selectionRule`. A
  non-material correction (a detail field outside `material_fields`) adds a
  `knowledge_detail_corrections` row that every read overlays; an unchanged
  value is `nothing_to_correct`. Credit (§9.6) was checked as designed: in
  the open month the author's unit moves to the corrector, who is not a
  participant (`private.completion_staff_venue_memberships` holds staff
  memberships only); a withdrawal moves nothing.
- `knowledge_upgrade_run` (admin): dry run then apply within 24 hours; a
  lossless rule adds one derived detail row (`derived_from_version`), a
  needs-checking answer gets one `schema_changed` recheck for that key only.
- `knowledge_slot_history(p_check_id, p_at)` and `knowledge_slot_events`
  for managers and admins (`canReadHistory`); `canCorrect` and
  `canWithdraw` added to the capabilities read.
- **For WS2:** the database now returns `stateReason` `corrected` and
  `withdrawn`, and a corrector's own feed can show kind `correction`. The
  TypeScript unions are unchanged so existing exhaustive maps compile; the
  wider types are `StateReasonB03` and `ContributionKindB03`.
- Decision detail is written at insert (`knowledge_decisions` stays
  append-only).
