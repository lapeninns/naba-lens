# Knowledge identities and source authority

Status: B00-03 domain part, contract draft for review. Owner: WS1 knowledge
domain. The consumer API's versioning and destination inventory belong to WS5
and the B00 baseline agent (`internal-reader-api.md`, programme inventory).
Source baseline: `f8c49430`. Items marked **owner to confirm** are defaults.

Evidence used here is source and seed only, plus the aggregated 9 November
read-only readback where stated. No production query was made for this
document.

## 1. Rules

1. Identity is an immutable ID. A name, slug, title, question wording, file
   name or label never establishes identity, however similar.
2. A mapping between two identities is an explicit, reviewed record with a
   reason. It is never inferred from similar names or shared words.
3. When a mapping is ambiguous, it stays unmapped and the consumer sees
   Unknown. Downgrading to Unknown is always safer than guessed certainty.
4. Identity never changes when wording, evidence rules or ownership change.
   A change of meaning gets a new identity.

Examples of similar names that are **not** identity: "Old Crown" and
"The Old Crown, Girton"; "The White Horse Inn, Swavesey" and "The White
Horse, Waterbeach" (two venues); legacy `parking` and `onsite_parking`; legacy
`toilets` and `guest_toilets`; two menu items called "Chicken Tikka" in
different sections; two staff with the same display name.

## 2. Venue identity

| Item                                     | Identity                   | Notes                                                                      |
| ---------------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| Venue                                    | `public.venues.id` (UUID)  | The only key every knowledge record and every reader request uses.         |
| Venue name                               | Not identity               | Display only. May change.                                                  |
| Venue slug (`supabase/seed/venues.json`) | Not identity for knowledge | The file is intentionally empty in source; real names come from the owner. |

**Old Crown.** Its venue ID is not in source or seed. The 9 November readback
found the venue with `v.name ilike '%Old Crown%'`, which is a name match and
does not establish identity. The B00-01 baseline then read the production
venue roster read-only:

- Old Crown is `9240a6e7-5eaf-426b-b272-214f95c08ab0`, slug
  `the-old-crown-girton`, name "The Old Crown, Girton", active.
- There are 10 active venues.

Every pilot step (working-list enablement, reader credential scope) takes that
UUID explicitly. An admin confirms it is the intended venue at enablement.
The four pilot check IDs are read by that venue ID and key at pilot time
(open item O1).

**Similar names.** The roster has two distinct venues with similar names:

- `the-white-horse-inn-swavesey` ("The White Horse Inn, Swavesey",
  `ac950f68-…`);
- `the-white-horse-waterbeach` ("The White Horse, Waterbeach", `2c697c82-…`).

They are the reference case for venue isolation (V02). Isolated test fixtures
reproduce the pair with their own UUIDs and similar names. Tests assert that
the same question at the two venues never shares answers, evidence or reader
results, and that no lookup by name or slug exists.

### 2.1 External destinations

No shared venue identity exists today between NabaLens, the venue websites and
NabaPresence (B00-03 destination inventory). Rules:

1. The NabaLens venue UUID is the stable venue key for all knowledge data.
2. Every external destination (a venue website, its JSON or MCP surface, a
   NabaPresence location, any later consumer) needs an **approved crosswalk
   record** before any data flows to it. A record holds the destination and
   its own identifier, the NabaLens venue UUID, the approver, the approval date
   and the evidence used.
3. A crosswalk is never derived from a name, slug, domain or address
   similarity. An unapproved or ambiguous destination receives nothing.
4. The website side (for example TheOldCrownLP) keeps its own identifiers; it
   holds the NabaLens UUID only through the approved crosswalk. WS5's consumer
   registry scopes credentials by UUID (`internal-reader-api.md` §2).

## 3. Subject and answer slot identity

- **Subject.** In B01 the subject of every question is the venue itself
  (`subject_type = 'venue'`, `subject_id = venues.id`). B03 adds subjects such
  as an area or a room, and B04 adds menu items and variants, each by its own
  stable ID.
- **Answer slot.** One slot per (venue, subject, question). In B01 this is
  (venue, question) and maps one to one to `public.venue_amenity_checks`,
  which is unique on `(venue_id, template_key)`
  (`20261107120000_amenity_catalogue.sql`). The check's `id` is the slot's
  stable ID at that venue. Archiving and restoring keep the same row
  (`amenity_add_checks` restores in place), so slot identity survives.
- A check's `id`, `venue_id` and `template_key` are immutable
  (`private.venue_amenity_checks_guard`).

## 4. Question identity

- **Question key:** `public.amenity_catalogue.key`, `^[a-z0-9_]{1,40}$`. The
  key is the identity. Category, question wording, capture brief, evidence
  rule and `is_core` are versioned attributes (`catalogue_version`).
- Every submission snapshots `template_version` and `evidence_rule`, so an
  answer is always read against the definition it was given under. The reader
  reports it as `questionVersion`.
- A key is never reused for a different meaning. If a question's meaning
  changes, B03-01's registry adds a new key and records the relationship.
- `coverage_amenity_templates.key` (Coverage) is a separate namespace. Its
  keys are not question identities for knowledge (§7).

## 5. Other identities

| Thing                                                       | Identity                                                     | Not identity                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| Finding that became an answer                               | `amenity_submissions.id`                                     | Its idempotency key (that identifies a request) |
| Proposal, Couldn't-establish finding, change report, detail | `knowledge_contributions.id` (new)                           | Idempotency key                                 |
| Confirmation and other decisions                            | `knowledge_decisions.id` (new)                               | —                                               |
| Asset                                                       | `media_assets.id`, with `venue_id` fixed at upload           | File name, labels                               |
| Person                                                      | `profiles.id`                                                | Display name, email, job title                  |
| Request                                                     | Idempotency key plus actor plus command (one result per key) | —                                               |

## 6. Pilot key crosswalk

All four keys are core catalogue entries (`is_core = true`), created by
`amenity_enable_venue` for every enabled venue.

| Pilot key            | Catalogue (version 1)                           | Evidence rule | Legacy Coverage keys whose media may be attached (`LEGACY_COVERAGE_MATCHES`) | Legacy fact equivalence                                                                                                                                                                                                                 | Old Crown check    |
| -------------------- | ----------------------------------------------- | ------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `onsite_parking`     | Arrival: "Is there on-site guest parking?"      | photo         | `parking`                                                                    | **None (ambiguous).** Legacy `parking` means "the car park or nearby parking" and also feeds `street_parking`. A legacy parking fact cannot say whether parking is on site.                                                             | Exists (see below) |
| `step_free_entrance` | Accessibility: "Is there a step-free entrance?" | video         | `access_routes`, `entrance`                                                  | **None (ambiguous).** `access_routes` covers any step-free route, ramp or handrail, which is broader than an entrance. `entrance` is a Coverage _service_ photo entry ("the main entrance as a guest arrives"), not a fact about steps. | Exists             |
| `guest_toilets`      | Facilities: "Are there customer toilets?"       | photo         | `toilets`                                                                    | **Candidate only.** Legacy `toilets` ("clean guest toilets") is the closest match. It still needs an explicit reviewed mapping in B03-06 before any legacy fact is used.                                                                | Exists             |
| `guest_wifi`         | Connectivity: "Is guest Wi-Fi available?"       | both          | none                                                                         | **None.** No legacy key exists.                                                                                                                                                                                                         | Exists             |

**Old Crown checks.** The 9 November readback reported Amenities enabled and
39 active checks, all `needs_capture`, answer `to_check` and unassigned, with
0 submissions. The catalogue has 39 keys, and a venue has at most one check per
key, so every catalogue key, including the four pilot keys, has exactly one
check at Old Crown. Their check IDs are not in source; they are read by venue
ID and key at pilot time (open item O1). The readback was aggregated, so it
does not say which keys its seven legacy facts cover (open item O2). All seven
were `presence = unknown` and unconfirmed, so no legacy claim exists to map.

Media-attachment matches (`LEGACY_COVERAGE_MATCHES`) decide only which earlier
Coverage photos a manager may attach as evidence. They are not fact
equivalence and are never used as such.

## 7. Legacy facts mapping (`venue_amenity_facts`)

Legacy keys and catalogue keys are many to many. The full source relation
(`private.amenity_legacy_coverage_keys`, inverted):

| Legacy key                                        | Catalogue keys it relates to                         |
| ------------------------------------------------- | ---------------------------------------------------- |
| `parking`                                         | `onsite_parking`, `street_parking`                   |
| `access_routes`                                   | `step_free_entrance`                                 |
| `entrance`                                        | `step_free_entrance` (photo entry, never a fact)     |
| `toilets`                                         | `guest_toilets`                                      |
| `accessible_toilet`                               | `accessible_toilet`                                  |
| `outdoor_seating`                                 | `outdoor_seating`, `covered_seating`                 |
| `dog_facilities`                                  | `dogs_inside`, `dogs_outside`, `dog_water`           |
| `family_facilities`                               | `high_chairs`, `baby_changing`, `play_area`          |
| `bar_area`                                        | `onsite_bar`                                         |
| `exterior_signage`, `dining_area`, `service_area` | none                                                 |
| (none)                                            | `guest_wifi` and 24 other catalogue keys (25 in all) |

Semantic differences that block automatic use:

- Legacy `presence = 'unknown'` means **not verified yet**: the default row
  that Coverage setup inserts for a venue. The new Unknown means **someone tried and
  could not establish the answer**. A legacy `unknown` therefore maps to "not
  checked", never to "unable to establish".
- Legacy `present`/`absent` on a broad key (`parking`, `dog_facilities`)
  never establishes a narrower catalogue key.
- `venue_amenity_facts.confirmed_at` is the time a manager saved the fact as
  confirmed. Any later unconfirmed save clears it, and earlier free text is
  overwritten (no history). It is never an observation time and never a
  knowledge confirmation.
- `venue_amenity_checks.answered_at` and `amenity_submissions.created_at`
  are save times, never observation times.

**B01 decision:** legacy facts are not an input to the resolver. They change
no slot status. B03-06 may add explicit, reviewed mapping rows
(legacy fact id → catalogue key, with reviewer, reason and dry-run output);
until then the resolver ignores them. This is the plan §16 rule: existing task
completion and legacy confirmation never manufacture a knowledge confirmation.

## 8. Source authority and field-level fallback

In B01 NabaLens has one authoritative source per field, and there is no
fallback between sources. A field missing from the authoritative record is
reported missing.

| Answer field                              | Authoritative source                                                                                              | Fallback                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Value                                     | The current assertion: the submission named by `venue_amenity_checks.current_submission_id`, through the resolver | None. Without a current assertion the value is Unknown.      |
| Finding, limitations, reason (staff text) | The same submission                                                                                               | None. Never merged across submissions.                       |
| Question version, evidence rule           | The same submission's snapshots                                                                                   | None                                                         |
| Evidence counts and availability          | That submission's `amenity_submission_assets` joined to `media_assets`                                            | None                                                         |
| Confirmation                              | `knowledge_decisions` for that submission ID and the rule version in force                                        | None. Legacy `confirmed_at` and task completion never count. |
| Saved time                                | That submission's `created_at` (as `savedAt`)                                                                     | None                                                         |
| Observation time                          | Not collected in B01                                                                                              | None: `observedAt` is always null                            |
| Wi-Fi test notes                          | That submission's `internal_metadata`                                                                             | None. Never in reader output (see access rules).             |
| Redaction proof                           | That submission's new `redaction_confirmed` column (rows from B01 on)                                             | None. Older rows are "not recorded".                         |
| Venue website data                        | Not a source. The website is a consumer.                                                                          | —                                                            |
| Legacy facts                              | Not a source in B01 (§7)                                                                                          | —                                                            |

Later batches add sources (declared external sources in B03-06, menu imports in
B04). Each gets an explicit precedence rule per field before it is used.

## 9. Versioning owned by WS1

- **Question version:** `amenity_catalogue.catalogue_version`, snapshotted on
  every submission and contribution.
- **Rule version:** `knowledge_question_rules.rule_version` (new). Confirmation
  requirements and reader text allowlists are read from the version in force.
  A confirmation records the rule version it satisfied.
- **Resolver version:** the reader entry point is versioned in its name
  (`knowledge_reader_answers_v1`). An incompatible change adds `_v2` and both
  run until WS5 retires v1. Additive columns stay within v1.
- The HTTP API major and minor versions are WS5's (`internal-reader-api.md`
  §10).

## 10. Open items

| ID  | Item                                                                                                                                                | Default until resolved                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| O1  | Old Crown's four pilot check IDs, read by venue UUID `9240a6e7-5eaf-426b-b272-214f95c08ab0` and key; admin confirmation of the venue at enablement. | Pilot enablement and reader credentials are not created.  |
| O2  | Which seven legacy fact keys exist at Old Crown.                                                                                                    | Irrelevant to B01: legacy facts are not a resolver input. |
| O3  | Whether `guest_toilets` ↔ legacy `toilets` should become a reviewed mapping in B03-06.                                                              | Unmapped.                                                 |
