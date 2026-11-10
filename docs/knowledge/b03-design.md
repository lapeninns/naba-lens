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
| B03-01 | A versioned question registry: one row per question key, one per version (value schema, guidance, evidence and confirmation rule, sensitivity, freshness, ownership). All 39 catalogue keys mapped, plus four proposed keys. | 2 tables, 1 validation function, seed                                             | None: version 1 of every key restates today's catalogue and rules |
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
public.knowledge_questions                        -- one row per key; never deleted
  key text pk references amenity_catalogue (key)  -- or a proposed key (below)
  family text in ('presence', 'facility', 'accessibility', 'policy',
                  'service', 'schedule_event', 'connectivity')
  subject_type text in ('venue')                  -- §2; widened per key later
  lifecycle text in ('supported', 'presence_only', 'unsupported', 'superseded', 'retired')
  superseded_by text[]                            -- keys that replace it, when superseded
  owner_role text in ('venue_manager', 'admin')   -- who keeps the answer current
  created_at, created_by

public.knowledge_question_versions                -- append-only
  key text, version integer >= 1, primary key (key, version)
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
  material_fields text[]                          -- fields whose change invalidates a confirmation (§9.2)
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
  pins that they agree (§3.6).
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
    Moving a key to `unsupported`, `superseded` or `retired` is an owner
    decision and a migration (OD-11). The working-list function refuses keys
    that are not `supported` or `presence_only`.

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
  with `detail.availability.state = 'temporarily_unavailable'`. The resolver
  reads the detail; the legacy check value stays meaningful for old readers.
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
  (§12). The lifecycle column changes only through a version row with
  `change_kind = 'lifecycle'`, never by update.
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
- A Yes on `step_free_entrance` never changes any other accessibility key,
  and a No on one entrance does not mean no entrance is step-free when other
  entrances exist: the headline is "at least one observed entrance is
  step-free" (Yes), "every entrance the venue lists was observed with steps"
  (No, requires every entrance subject to be in the detail), otherwise
  Unknown. A test pins this.

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
  - the No rule needs every listed entrance; with an entrance missing from the
    detail the headline is Unknown;
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
- every zone the question version requires (`requires_zones`, per key);
- a confirmation by the authority the version names (`policy_authority`:
  venue manager by default, admin when `policyScope = 'organisation'`;
  OD-14);
- `authority.statedOn` and `source`.

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
- A schedule is stated by a contribution and becomes current with it, so the
  B01 decisions (confirm, decline, dispute) apply. A changed schedule is a
  new version that supersedes the old one from its `effective_from`; the old
  version stays for history.

### 6.2 Recurring Sunday service (semantic case)

`sunday_roast` (when added): `service.v1` Offered, with a weekly schedule on
Sundays, the window the venue states, `effective_from` the date it starts,
optionally `effective_to`. A dated exception (`cancelled` on one Sunday)
removes that occurrence only. After `effective_to` the service reads as
"Not offered from {date}" and opens a recheck (§7) rather than going silent.
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
  basis text in ('observed_on', 'confirmed_at', 'effective_to', 'event_end')
  created_at, created_by, note
```

Proposed defaults, all **owner to confirm** (OD-15); none is a venue fact:

| Class           | Basis                              | Internal max age  | Public max age    | Recheck lead |
| --------------- | ---------------------------------- | ----------------- | ----------------- | ------------ |
| `fixture`       | `observed_on`                      | 365 days          | 180 days          | 30 days      |
| `offering`      | `observed_on`                      | 90 days           | 60 days           | 14 days      |
| `schedule`      | `effective_to`, else `observed_on` | 90 days           | 30 days           | 14 days      |
| `policy`        | `confirmed_at`                     | 180 days          | 90 days           | 30 days      |
| `accessibility` | `observed_on`                      | 180 days          | 90 days           | 30 days      |
| `event`         | `event_end`                        | ends at the event | ends at the event | none         |

A question version names one policy per use, or none (`unrated`, today's
behaviour for every key).

### 7.2 Observation date

- New contributions may carry `observed_on` (a local date): the day the
  person checked. The capture form defaults it to today; the person may
  choose an earlier date up to 30 days back (OD-15). It is recorded as
  stated, by the person, never inferred from upload, save, file metadata or
  migration times (plan §16).
- Without `observed_on`, a policy based on it treats the answer as
  `unrated` for that use: no expiry, and the reader says so. It never falls
  back to a save time.

### 7.3 Read-time computation

- The resolver computes `freshness_state` (`current`, `due_soon`,
  `expired`, `unrated`) and `next_check_due` per use from the registry
  version, the policy and the dates, at read time. A late job can never keep
  an expired answer eligible.
- An expired answer for a use reads as `unavailable / stale / expired` for
  that use. The value is kept and shown to managers as the previous answer;
  nothing is cleared or deleted.
- The B01 reader's `freshness_state` and `next_check_due` columns already
  exist and are `unrated`/null. Filling them, and expiry changing status,
  is a behaviour change for v1 consumers, so it applies only to keys whose
  version names a policy, enabled per key after WS5 agrees (OD-15). The four
  pilot keys stay unrated until then.

### 7.4 Recheck tasks

```text
public.knowledge_recheck_tasks
  id uuid pk, venue_id, check_id
  cause text in ('due_soon', 'expired', 'schedule_ended', 'temporary_until_passed', 'evidence_lost', 'schema_changed')
  due_at timestamptz, use text
  owner_role text, assignee_id uuid null           -- the existing assignment flow assigns it
  state text in ('open', 'done', 'cancelled'), closed_by uuid null, closed_at null
  created_at
  unique (check_id, cause, due_at, use)            -- idempotent creation
```

- A scheduled job (the existing internal cleanup route's pattern, run by the
  same scheduler) calls `private.knowledge_open_rechecks(p_now)` every hour;
  it is idempotent by the unique key. A new contribution on the check closes
  open tasks (`done`), recording which contribution closed them.
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
- A contribution closes the task and makes the answer current again.
- No `observed_on`: unrated, never expired by save time.
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
  unique (legacy_fact_id, legacy_revision, question_key)

public.knowledge_reconciliation_runs
  id uuid pk, kind text in ('legacy', 'external'), mode text in ('dry_run', 'apply')
  started_by, started_at, finished_at, counts jsonb, conflicts jsonb, source_revisions jsonb
```

### 8.2 Rules

- **Nothing becomes current by itself.** An applied mapping or an imported
  assertion creates a B01 contribution with `contributor_basis =
'legacy_fact'` or `'external_source'` (an additive value in the
  `knowledge_contributions` check, in a new migration), answer from the
  source, `observed_on` null, awaiting confirmation. A manager decides it
  with B01's decisions. A confirmation is never copied from the source
  (`identities.md` §7).
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
- Credit hash and C-tests unchanged (proposals are not credit inputs; only
  B01 adoption is).

---

## 9. B03-07: corrections, withdrawals, schema upgrades and history

### 9.1 Corrections

- `public.knowledge_correct(p_check_id, p_slot_revision, p_idempotency_key, p_headline, p_detail, p_reason)`:
  manager or admin. Creates a contribution of kind `correction` and adopts
  it through B01's path, with a decision that records `before` and `after`
  (headline and detail) and `selection_rule = 'correction'`.
- A correction to a **material field** (`material_fields` of the version;
  the headline is always material) invalidates the previous confirmation:
  the new answer needs confirmation by its rule. A correction to a
  non-material field (a typo in internal text) keeps the confirmation and
  records `material = false`.
- Staff cannot correct; they send a change report (B01).
- Schema: `correction` is an additive value in the `knowledge_contributions`
  kind check, and `before`, `after`, `material` and `selection_rule` go
  in the decision's `detail`, both in a new migration.

### 9.2 Withdrawals

- `public.knowledge_withdraw(p_check_id, p_slot_revision, p_idempotency_key, p_reason)`:
  manager or admin. Records a `withdrawn` decision; the resolver reads the
  slot as `unavailable / withdrawn / answer_withdrawn` (B01's state) without
  changing `amenity_submissions` or the check's progress, so no credit input
  moves. The value stays in history. A later contribution can make a new
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

### 9.6 Tests

- Before and after values and the selection rule are recorded for a
  correction; a material correction drops the confirmation, a non-material
  one keeps it.
- A withdrawal reads withdrawn for every audience and moves no credit input.
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

| #     | Decision                                                                                                                         | Design default until decided                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| OD-11 | Add the five proposed keys; supersede `sports_screen`; mark `swimming_pool` unsupported; retire anything                         | Registry version 1 only; no new key, no lifecycle change, nothing retired                  |
| OD-12 | Per key: confirmation, sensitivity and family where §3.4 proposes a change from today; which presence-only keys get detail later | §3.4 proposals stay unapplied; B01's seven rules unchanged                                 |
| OD-13 | Who creates subjects; whether any key needs independent per-subject answers                                                      | Managers and admins create subjects; one answer per venue and key                          |
| OD-14 | Policy condition and exception types; who confirms venue and organisation policies; who commits schedules and fixture showings   | Venue manager confirms venue policies and schedules; admin for organisation scope          |
| OD-15 | Freshness durations per class and use; observation-date rules; when expiry may change v1 reader status                           | No freshness policy on any key; pilot keys unrated                                         |
| OD-16 | Venue timezone source (a venue column or a fixed estate timezone); the broadcaster list                                          | `Europe/London` for every venue (the estate's helpers already use it); no broadcaster list |
| OD-17 | Which legacy mappings are exact; precedence order for suggestions; which external sources may be declared                        | No exact mappings; precedence as §8.2 for ordering only; no sources                        |
| OD-18 | Who may correct and withdraw; whether a withdrawal needs a second person                                                         | Manager or admin, one person, reason required                                              |

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
`public.knowledge_submit` (overload only, old signature kept). Never
re-created: the credit trigger `media_assets_amenity_evidence_lost`, the
credit functions, the menu and coverage write paths.

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
| An entrance observation never becomes whole-venue certification   | §4.3                       | Required `scope`; no venue-wide key                                 | Manager confirms              | §4.5                   |

## 14. Changelog

**Draft 1 (10 Nov 2026):** first B03 server design from plan §8, the B01 and
B02 designs and the knowledge docs, at `ebd41c48`.
