# B06 design (WS5): consumer access and website integration

Status: design draft 2 (proposal), 10 Nov 2026. Repairs the design-gate review
(reviewer 5dd2f40c: M1 and lows 1 to 3) and the proposal review of the first
repair (B06-1 to B06-4). It is a self-contained replacement for draft 1. It
is not yet reviewed, and it does not qualify any implementation or authorise
any enablement. Changelog: §15. Findings map:
`qa/b06-b07-design/findings-resolution.md`.

Authors: WS5 consumers (draft 1, session a9813544); draft 2 prepared by a pool
worker from the review evidence, read-only. No NabaLens, website, NabaPresence
or provider code, data or configuration was changed, no SQL was executed, and
no test, build or network call was made to write it.

Plan: §11 (B06-01 to B06-06), §16 (delivery dimension), §17 (V11, V12, V13),
§18 (per-batch gate), §19 (rollback). Builds on:

- the internal reader v1 contract, `docs/knowledge/internal-reader-api.md`
  (NabaLens `task/b03-ws5-reader`, now at `973cfd5c`);
- WS1's B00 contracts and B03 design (`docs/knowledge/access-and-rights.md`
  §8, `state-model.md` §4.6, `b03-design.md` §3.2, §3.8, §7, §9);
- `contracts/b00-03-destination-inventory.md` (crosswalk §1a, website
  generations A to D, NabaPresence §3);
- `contracts/b04-design.md` §9 (menu read, `menu_lookup`, `nabalensItemId`);
- `contracts/b05-design.md` §2 to §4 (grants, derivatives, the asset-use
  registry). §9 of this document is WS5's sign-off on B05-m3;
- `contracts/b07-design.md` (draft 2 in this folder), which consumes the
  destination feed, epochs and receipts defined here.

Source evidence:

| Repository        | Ref                                                                 | What was read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NabaLens          | `9bd92504` + WS5 `23e0c0fd` (draft 1)                               | reader `_reader/**`, routes, contract doc; B03-c migration `20261110102123` (`knowledge_slot_state_b03`, re-created `knowledge_reader_answers_v1`); `vercel.json` crons                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| NabaLens          | WS5 `973cfd5cb743ad254f217ee7c4d4c9376129b91b` (draft 2, read-only) | `20261107120000_amenity_catalogue.sql` (`amenity_check_events` at :133, its append-only triggers at :266-271, `venue_amenity_checks.template_key` and its guard at :48, :64, :225, `media_assets_amenity_evidence_lost` at :614-657); `20261109145234_knowledge_b01_schema.sql` (`knowledge_events` at :191, `knowledge_note_definition_change` at :347-372); `20261109145934_knowledge_b01_functions.sql` (`private.knowledge_event` at :76, `media_assets_knowledge_evidence_withdrawn` at :1636-1665); `20261110103713_knowledge_b03d_schedules.sql` (event kinds at :584-588); `20261110104955` (freshness states); `20261110110831_knowledge_b03g_corrections_and_history.sql` (`knowledge_slot_state_b03` at :134, `knowledge_decision_detailed` at :680-706, `knowledge_withdraw` at :730-791, `knowledge_correct` at :793-960, `knowledge_upgrade_run` at :998-1090); `app/api/knowledge/_reader/source.ts`; `vercel.json` |
| TheOldCrownLP     | `origin/main` `8de6a303` (10 Nov 2026; the baseline was `c0e243db`) | `AGENTS.md`; `docs/CONTENT.md`, `docs/RELEASE.md`; `src/lib/agent/agent-data.ts`, `mcp-server.ts`; `app/api/{venue,hours,menus}.json/route.ts`; `app/mcp/route.ts`; `middleware.ts`; `config/content.json`, `config/content/pages/contact.json`; `src/lib/site/blog-articles.ts` (draft 1; not re-read)                                                                                                                                                                                                                                                                                                                                         |
| Next.js 16.4 docs | NabaLens `node_modules/next/dist/docs`                              | `revalidateTag`, `updateTag` (draft 1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Reviews           | programme `evidence/`                                               | `b06-b07-b08-b10-design-reviews.md`; `b06-b07-pool-proposal.md` (`68ea5995…`); `b06-b07-proposal-review.md` (`d0250a41…`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Draft 1 is `contracts/b06-design.md` (`57505847…`). It stays untouched. The
unfinished WS5 draft-2 replacement script was not run; its intent (M1 and
lows 1 to 3) is written out in full below.

---

## 1. Summary

B06 lets an approved website show NabaLens answers, and take them away again,
without ever showing something NabaLens has withdrawn.

| Task   | Outcome                                                                                                                         | Main deliverables                                                                                                                                                                                                                                                             | Owner                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| B06-01 | A consumer registry in the database and a versioned field manifest per destination, approved per field by the owner              | `knowledge_consumers`, `knowledge_consumer_credentials`, `knowledge_consumer_scopes`, `knowledge_manifest_versions`, `knowledge_field_manifest`; shadow comparison report                                                                                                    | WS5 (schema and routes), WS2 (admin screens), owner (approvals) |
| B06-02 | A hardened reader and a separate public-safe projection, in one answer shape, with immutable publication tuples and live eligibility overlays | `audience=public` on the answers route, `public.knowledge_public_answers_v1` (WS1 SQL to this spec), schema `1.1` qualification object, shared rate limiter, DB registry, destination feed and snapshot                                                               | WS5, WS1                                                        |
| B06-03 | A cheap transactional dirty mark, a per-venue drain that writes immutable publication tuples, publication epochs, and an attempt-fenced delivery worker with receipts | `knowledge_publication_dirty`, mark triggers, `knowledge_publication_drain_venue`, `knowledge_publication_epochs`, `knowledge_publications`, `knowledge_publication_revisions`, `knowledge_publication_events`, `knowledge_delivery_jobs`, sweep and backstop, `/api/internal/knowledge-delivery` | WS5 (WS1 reviews triggers on its tables)                        |
| B06-04 | Old Crown `agent-data.ts`, JSON routes and MCP read approved fields                                                             | Website module `nabalens.ts`, additive `facilities` in `venue.json` and `get_venue_info`, `nabalensItemId` on menu items, `AGENT_API_VERSION` `1.1.0`                                                                                                                         | Website owner                                                   |
| B06-05 | Cache, invalidation, outage, correction, withdrawal and restore behave as specified                                             | Website revalidation route with `revalidateTag(tag, { expire: 0 })`, an applied-state record with compare-and-set, cache headers within the five-minute budget, last-good snapshot and epoch rules                                                                            | Website owner, WS5                                              |
| B06-06 | Cross-repository fixture journey, privacy checks and live readback                                                              | Contract fixtures in both repositories, the journey in §8, the repair cases in §7.3, privacy negative assertions, the authorised live case                                                                                                                                    | WS6 with the coordinator                                        |

Seven design choices carry the batch:

1. **Pull with pushed invalidation.** The website reads NabaLens server-side
   with its own credential. NabaLens pushes only a signed "something changed"
   ping. No answer content travels in a push, so a delayed or replayed push
   can never carry stale content.
2. **Publication revisions, not answer revisions, for public consumers.**
   A publication revision rises whenever anything a public consumer could see
   changes, including a changed reason or detail at an equal answer revision
   (the read-time states from B03). It does not move on internal churn.
3. **Immutable tuples, live eligibility.** A publication revision names one
   immutable stored tuple `(epoch, destination, venue, field, revision,
   digest, state, payload)`. A read returns a tuple's payload only when the
   live projection in the same database snapshot still matches it and every
   live gate passes. Otherwise it returns a value-free **eligibility
   overlay** (`settling` or `withdrawn`), never a second content under the
   same revision. Wall-clock `readAt` is never a version.
4. **Shadow before switch.** Every website field starts in `shadow`: NabaLens
   computes what it would publish and a report compares it with the website's
   own approved copy. Only an owner approval moves a field to `enabled`. This
   follows the Old Crown rule "When sources disagree, stop and ask"
   (`docs/CONTENT.md`).
5. **Three receipts, kept apart and fenced.** `acknowledged` (the website
   accepted the ping), `applied` (the website says it holds the revision),
   `verified` (NabaLens read the public page, JSON or MCP and saw it). None is
   inferred from another (plan §11 delivery rules). Only the current,
   unexpired delivery attempt can record any of them.
6. **Epochs for restore.** Every identity a consumer holds (tuple, cursor,
   receipt, job) is scoped to a publication epoch. A database restore opens a
   new epoch under an owner-controlled acceptance step, and consumers reset
   from a complete authorised snapshot. Numeric rebasing is not used.
7. **One registry.** Consumers, B05 media destinations and the field manifest
   share the destination key. B05's `media_use_destinations` is the
   destination registry; B06 adds consumers and fields that reference it.

## 2. What exists today (evidence)

### 2.1 NabaLens

- The internal reader v1 is credentialed and server-to-server only: bearer
  `nlr_<consumerId>_<secret>`, SHA-256 digest, two rotation slots, scopes per
  venue, audience, purpose and question (`_reader/credentials.ts`). The
  registry is environment configuration (`KNOWLEDGE_READER_CONSUMERS`), and
  revocation needs a configuration redeploy. The ledger (decision 7) and the
  contract (§2) require a database registry before B06.
- The reader's only data access is one call to the STABLE wrapper
  `public.knowledge_reader_answers_v1` through the service client
  (`_reader/source.ts`): one call, one snapshot. B06's public read keeps that
  shape.
- The rate limiter is per server instance and does not count failed
  authentication (contract §8; ledger review note). A shared limiter is
  required before B06.
- Audience `internal` only. `public` is reserved. Purposes
  `operations_lookup`, `pilot_verification`; B04 adds `menu_lookup`.
- B03-c withholds qualified answers (`stale` / `qualified_answer`) and
  incomplete policies (`not_confirmed` / `policy_incomplete`) from v1. B03
  §3.8 says a later reader version returns the qualifier: that is schema
  `1.1` here (§4.4).
- B03 registry versions carry `sensitivity`, `publishable_fields` (empty
  until B06) and `public_media` (`never` by default) (`b03-design.md` §3.2,
  A30).
- Access and rights §8 lists six conditions for any public field. The public
  projection (§4.3) enforces all six.
- Revision: `venue_amenity_checks.revision` plus `knowledge_events` per
  `(venue_id, question_key)`. Read-time states (expiry, `due_soon`,
  `basis_missing`, `temporary_until_passed`) change an answer without
  changing its revision. The ETag already hashes reason and detail
  (`23e0c0fd` pins it).
- **Event tables at `973cfd5c`.** `public.knowledge_events` has non-null
  `venue_id` and `question_key`, nullable `check_id`, and no trigger of its
  own. Every B01 to B03 command writes it through `private.knowledge_event`,
  including B03-g withdrawal and both kinds of correction
  (`knowledge_decision_detailed` writes `decision_recorded`). Definition
  changes insert one row per working-list venue in **one statement**
  (`knowledge_note_definition_change`). `knowledge_upgrade_run` writes one
  event per candidate in a loop, so one transaction can hold many event
  statements. `public.amenity_check_events` has non-null `venue_id` and
  `check_id` and no question key; its only triggers are the append-only and
  no-truncate guards. A check's question key is
  `venue_amenity_checks.template_key`, which the check guard makes immutable.
- **Credit and evidence triggers that write these tables.**
  `media_assets_amenity_evidence_lost` (a credit input) updates checks and
  inserts `evidence_lost` amenity events inside the media writer's
  transaction; `media_assets_knowledge_evidence_withdrawn` writes
  `evidence_withdrawn` knowledge events. Any B06 trigger on the event tables
  therefore runs inside staff capture, manager decisions, media deletion and
  the recheck job.
- Inputs that change a public digest without any event row: registry
  versions (`publishable_fields`), freshness policies, value lists, B05
  grants, destination activity and the manifest. B06 commands write marks for
  the ones it owns; the rest are caught by the backstop (§5.5) and, for
  correctness, by read-time gating (§4.7).
- Crons run from `vercel.json` (Vercel Cron with the `CLEANUP_SECRET` bearer
  pattern). The shortest current schedule is every five minutes; Vercel Cron
  supports every minute (NabaPresence uses `* * * * *`).

### 2.2 The Old Crown website (`8de6a303`)

- `src/lib/agent/agent-data.ts` is the single source for `venue.json`,
  `hours.json`, `menus.json`, the MCP tools and `llms.txt`
  (`AGENT_API_VERSION = '1.0.0'`). Its header says nothing is published that
  a guest cannot already read on the site.
- `app/api/venue.json/route.ts` and `app/api/menus.json/route.ts` are
  `dynamic = 'force-static'`: their content is fixed at build time and changes
  only with a deployment. `hours.json` revalidates hourly. `jsonResponse`
  sends `public, max-age=0, s-maxage=300, must-revalidate`; the 9 Nov
  readback saw `menus.json` at `s-maxage=1800, stale-while-revalidate=3600`
  (from the CDN strategy, `src/lib/cdnStrategy.ts`).
- `/mcp` is `force-dynamic`, stateless, tools `get_venue_info`,
  `get_opening_hours`, `get_menu`, `get_booking_options`.
- **All four pilot facts are already published as owner copy.** Facilities
  come from the owner answers of 29 Oct 2026
  (`tasks/onsite-checklist-20261029-2011/owner-facts-2026-10-29.md`, cited in
  `docs/CONTENT.md`): "Free parking", "Step-free entrance and accessible
  toilet", "WiFi" (`config/content/pages/contact.json:27-31`,
  `config/content.json:409-425`, homepage copy, FAQ and blog articles).
  `venueInfo()` does not carry facilities as structured fields today.
- `docs/CONTENT.md`: facts change only on an owner instruction or an
  existing approved source; "When sources disagree, stop and ask; do not pick
  one." Menus, allergen modules and `page-copy.ts` are hash-pinned
  (`tests/menu-allergens/protected-content.json`).
- Release: `pnpm run verify` on the committed head (local gate, posted as
  `local-ci/verify`), Vercel preview, Codex review, production deployment of
  `main`, then `pnpm run smoke:live` (`docs/RELEASE.md`). Agents never deploy,
  push or change Vercel settings from the repository (`AGENTS.md`).
- The website has no shared state store today. The applied-state record
  (§5.7, §6.4) is new website work and an owner decision (OD-B6-10).

### 2.3 Next.js 16 cache invalidation

`revalidateTag(tag, "max")` marks data stale and serves stale content while it
refetches. For a withdrawal that must disappear, a route handler must call
`revalidateTag(tag, { expire: 0 })`: the next request blocks on a fresh fetch.
`updateTag` would do the same but works only in Server Actions
(`revalidateTag.md`, `updateTag.md`). The website's revalidation route (§6.3)
therefore uses `{ expire: 0 }`. A data-cache entry is last-writer-wins, so
it cannot order two overlapping refetches by itself; that is why the
applied-state record has compare-and-set (§5.7).

## 3. B06-01: consumer registry and field manifest

### 3.1 Sub-tasks

| ID      | Deliverable                                                                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B06-01a | Consumer registry tables (B06-m1) and a cut-over from the environment registry, with the environment form kept readable for one release as a fallback that the admin can switch off |
| B06-01b | Admin commands and reads: create consumer, issue credential (shown once), rotate, revoke, disable, set scopes                                                                       |
| B06-01c | Field manifest per destination (B06-m3): a version header plus the version's complete field set; per field: website field, question key, authority, publishable fields, state `shadow`, `enabled` or `disabled`, approver |
| B06-01d | Shadow comparison report: for each `shadow` field, the website's recorded claim and what NabaLens would publish, with `agrees`, `differs` or `nabalens_unavailable`                 |
| B06-01e | Old Crown destination rows: `old_crown_website` (public, venue Old Crown) and `old_crown_website_preview` (public, fixtures only); the crosswalk row needs X8                       |
| B06-01f | Website manifest file in the website repository (`config/nabalens-manifest.json`), owner-reviewed, matching the NabaLens manifest field for field                                   |

### 3.2 Acceptance criteria

1. Revoking a credential or disabling a consumer refuses its next request
   (no redeploy). Rotation keeps at most two live credentials per consumer.
2. A consumer can only hold scopes for venues inside its destination's venue
   (or organisation-wide destinations), and only audiences its kind allows
   (`website` and `provider_sync` consumers: `public`; `internal_tool`:
   `internal`).
3. No answer reaches a public consumer for a field that is not `enabled` in
   that destination's latest manifest version. A `shadow` field is computed
   for the report and returns `not_permitted` to the consumer.
4. Enabling a field records the approver, the approved claim text the website
   held, the comparison result and the manifest version. A field whose
   comparison reads `differs` cannot be enabled without an owner decision
   recorded with a reason.
5. Every manifest change is a new version (append-only). A version lists its
   **complete** field set: a field absent from the latest version is treated
   as `disabled`, and a version with no field rows is valid and means "no
   fields". Disabling or dropping a delivered field produces a withdrawal
   tombstone (§5.4).
6. A venue's destination row requires an approved crosswalk row (X8). Names,
   slugs or similar text never select a venue (`b00-03` §1a).

### 3.3 Data model (B06-m1 and part of B06-m3)

```sql
create table public.knowledge_consumers (
  id text primary key check (id ~ '^[a-z0-9-]{3,40}$'),  -- the consumerId in the credential
  label text not null,
  kind text not null check (kind in ('internal_tool', 'website', 'provider_sync')),
  destination_key text references public.media_use_destinations (key),  -- required for website and provider_sync
  disabled_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((kind = 'internal_tool') = (destination_key is null))
);

create table public.knowledge_consumer_credentials (
  id uuid primary key default gen_random_uuid(),
  consumer_id text not null references public.knowledge_consumers (id),
  sha256 bytea not null unique check (length(sha256) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
-- A trigger refuses a third credential that is neither revoked nor expired.

create table public.knowledge_consumer_scopes (
  consumer_id text not null references public.knowledge_consumers (id),
  venue_id uuid not null references public.venues (id),
  audience text not null check (audience in ('internal', 'public')),
  purpose text not null check (purpose in ('operations_lookup', 'pilot_verification',
    'menu_lookup', 'website_publication', 'provider_suggestion')),
  question_keys text[],              -- null = every key the audience may read
  schema_majors integer[] not null default '{1}',
  primary key (consumer_id, venue_id, audience, purpose)
);

-- One header per manifest version, so a version with no fields exists.
create table public.knowledge_manifest_versions (
  destination_key text not null references public.media_use_destinations (key),
  manifest_version integer not null check (manifest_version >= 1),
  created_by uuid not null references public.profiles (id),
  reason text not null check (length(reason) between 1 and 600),
  created_at timestamptz not null default now(),
  primary key (destination_key, manifest_version)
);

-- The complete field set of one version; rows are never updated or deleted.
create table public.knowledge_field_manifest (
  destination_key text not null,
  manifest_version integer not null,
  field_key text not null check (field_key ~ '^[a-z][a-zA-Z0-9.]{1,80}$'), -- e.g. facilities.onsiteParking
  question_key text not null,
  authority text not null check (authority in ('nabalens', 'destination_owner')),
  publishable_fields text[] not null,  -- subset of the registry version's publishable_fields
  state text not null check (state in ('shadow', 'enabled', 'disabled')),
  destination_claim text,              -- the website's approved copy at approval time, for the report
  comparison text check (comparison in ('agrees', 'differs', 'nabalens_unavailable')),
  decided_by uuid references public.profiles (id),
  decision_reason text,
  created_at timestamptz not null default now(),
  primary key (destination_key, manifest_version, field_key),
  foreign key (destination_key, manifest_version)
    references public.knowledge_manifest_versions (destination_key, manifest_version)
);
```

- **Latest version** of a destination is `max(manifest_version)` over
  `knowledge_manifest_versions`, never over field rows.
- `public.knowledge_manifest_set(p_destination_key, p_expected_version,
  p_fields jsonb, p_reason)` (admin, security definer) is the only writer. In
  one transaction it refuses unless the latest version equals
  `p_expected_version`, inserts the header and every field row of the new
  version, and inserts a `*` dirty mark (§5.4) for every venue the
  destination covers.
- All tables: RLS on, no client policies; admin commands are security definer
  functions, consumer reads are service role only. Update and delete are
  revoked on the manifest tables, and a `BEFORE UPDATE OR DELETE` and
  `BEFORE TRUNCATE` guard refuses them. Credentials are never stored, only
  digests; the plain credential is returned once from
  `knowledge_consumer_issue_credential` and never logged.

### 3.4 Old Crown field manifest, proposed for owner approval (OD-B6-3)

The website already states each of these from the owner answers of 29 Oct.
NabaLens's v1 value is Yes, No or Not applicable, so it can confirm presence
only. Words such as "Free" stay owner copy with `authority =
destination_owner`.

| Website field (new, additive) | Question key         | Published fields | Website copy today                            | Proposed first state                                                                                           |
| ----------------------------- | -------------------- | ---------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `facilities.onsiteParking`    | `onsite_parking`     | `value`          | "Free parking" (presence plus a charge claim) | `shadow`, then the **first field enabled** (ordinary sensitivity, observable, presence only)                   |
| `facilities.guestToilets`     | `guest_toilets`      | `value`          | not stated on its own                         | `shadow`                                                                                                       |
| `facilities.stepFreeEntrance` | `step_free_entrance` | `value`          | "Step-free entrance"                          | `shadow`; enabling needs a venue-manager confirmation (B01 rule) and OD-12 for accessibility (`b03-design.md`) |
| `facilities.guestWifi`        | `guest_wifi`         | `value`          | "WiFi"                                        | `shadow`; enabling also needs `redaction_proof = recorded` on the current answer (access and rights §8.5)      |

"Accessible toilet" is a different question key (`accessible_toilet`), not
on the B01 working list; it stays owner copy. B03-a's condition stands:
nothing treats v1 `ordinary` sensitivity on accessibility or dogs keys as
decided before OD-12.

## 4. B06-02: hardened reader and public-safe projection

### 4.1 Sub-tasks

| ID      | Deliverable                                                                                                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B06-02a | Reader reads the database registry (§3.3); revocation on the next request                                                                                                                                                         |
| B06-02b | Shared rate limiter in Postgres, also bounding failed authentication, keyed on the platform client address (§4.6)                                                                                                                 |
| B06-02c | `private.knowledge_public_projection` and `public.knowledge_public_answers_v1(p_destination_key, p_venue_id, p_keys)` (WS1 SQL, this spec)                                                                                         |
| B06-02d | `audience=public` on `GET /api/knowledge/v1/venues/{venueId}/answers`, same answer shape, narrower allowlist, plus the `publication` and `eligibility` objects (§4.5, §4.7)                                                        |
| B06-02e | Schema `1.1`: an optional `qualification` object for qualified answers, served only to consumers that declare `1.1`                                                                                                               |
| B06-02f | Public menu read: `GET /api/knowledge/v1/venues/{venueId}/menu?audience=public` over B04's `menu_trading_read_v1`, fields with `authority = nabalens` only (B04 §9.5)                                                             |
| B06-02g | Destination feed and snapshot for consumers that track publications (B07's NabaPresence; optional for websites): `GET /api/knowledge/v1/destinations/{key}/publications?venueId=&epoch=&after=&limit=` and `GET /api/knowledge/v1/destinations/{key}/snapshot?venueId=` (§4.8) |
| B06-02h | Public media route `GET /api/public-media/{publicationId}/{rendition}` (§9.2)                                                                                                                                                     |
| B06-02i | Public JSON schema `docs/knowledge/public-projection-v1.schema.json` listing the public-only details `publication_withdrawn` and `publication_settling`, the `publication`, `eligibility` and `snapshot.epoch` objects; recorded fixtures (§7.2) |

### 4.2 Acceptance criteria

1. A public response contains exactly the public allowlist (§4.5); nothing
   from the internal allowlist that §4.5 does not list.
2. Every public answer satisfies all six conditions of access and rights §8,
   evaluated at read time in one snapshot: available slot; field in the
   registry version's `publishable_fields`; field `enabled` in the
   destination's latest manifest version and the destination active; media
   only as an approved derivative with a grant; for `guest_wifi`, redaction
   proof recorded; staff text only as a reviewed field approved for public use
   (none in B06).
3. Read outcomes per field follow §4.7 exactly:
   - a caller without scope for the venue, key, audience or purpose, or a
     field never delivered to this destination in the current epoch, reads
     `not_permitted` (no value, no revision, no tombstone);
   - a delivered field whose stored tuple still matches the live projection
     and passes every live gate returns that tuple (value, or the settled
     tombstone `withdrawn` / `publication_withdrawn` with its revision);
   - a delivered field that now fails a live gate returns a value-free
     `withdrawn` / `publication_withdrawn` overlay at once, before any drain;
   - a delivered field whose live projection differs from its stored tuple
     returns a value-free `unavailable` / `publication_settling` overlay.
4. A consumer that declares schema `1.0` never receives `qualification`; a
   qualified answer reads `stale` / `qualified_answer` for it, exactly as
   B03-c does today.
5. The limiter returns `429` with `Retry-After` across instances, and refuses
   a burst of failed authentications from one client with the same `401` body
   as any other failure (it reveals nothing). A client cannot change its
   failed-auth bucket by sending its own `x-forwarded-for`.
6. All reader responses stay `private, no-store`; only the website's own
   responses are publicly cached.
7. No public read, feed or snapshot is served unless the current epoch is
   `accepted` and matches the deployment's epoch setting (§5.8); otherwise
   `503 publication_paused`, which consumers treat as an outage.

### 4.3 The public projection and wrapper (specification for WS1)

`private.knowledge_public_projection(p_epoch_id uuid, p_destination_key text,
p_venue_id uuid, p_keys text[], p_now timestamptz)` is `STABLE SECURITY
DEFINER`, `set search_path = ''`, executable by no client role. It is the
**single** definition of what a public consumer may see. The drain (§5.4),
the read wrapper and the feed (§4.8) all call it, so the publication path and
the read path cannot disagree. Per field of the destination at the venue
(filtered to `p_keys` when not null) it returns:

- `field_key`, `question_key`;
- `manifest_state`: the field's state in the latest manifest version, or
  `absent`;
- `destination_active`;
- `gates_pass`: all six access-and-rights conditions at `p_now`;
- `live_state`: `shadow`, `published`, `unavailable` or `withdrawn`, by the
  transition table in §5.4;
- `payload`: the public-safe projection (below), or null when `live_state`
  is `shadow` or `withdrawn`;
- `digest`: `sha256` of the canonical JSON `{deliveryState: live_state,
  payload}` (keys sorted, no insignificant whitespace, timestamps as UTC ISO
  8601 truncated to the second);
- `answer_revision` (audit only).

It reads `private.knowledge_slot_state_b03(p_venue_id, keys, p_now)` (never
the tables), the registry version in force, the latest manifest version, the
destination row (`active`) and the delivered-field register (§5.3). For media
it reads nothing (media has its own read, B05 §4.5).

The **payload** holds only: `status`, `reason`, `detail`, `value`,
`qualification` in the `1.1` form filtered to the field's
`publishable_fields`, `confirmedBy` (role, when confirmed), `nextCheckDue`
and `freshnessState` (public use). Because `nextCheckDue` and the public
freshness state are publicly visible, a change in either is a digest change
and a new revision (design choice 2). It never holds `finding`,
`limitations`, `reason_text`, contribution or submission IDs, evidence
counts, `redaction_proof`, save times, user IDs or names.

`public.knowledge_public_answers_v1(p_destination_key text, p_venue_id uuid,
p_keys text[])`, `STABLE SECURITY DEFINER`, `service_role` only, one call one
snapshot, same venue checks and `NLK06` as the v1 reader wrapper. In that one
snapshot it reads the current epoch, the stored heads and tuples
(`knowledge_publications`, `knowledge_publication_revisions`), calls the
projection once with `p_now = statement_timestamp()`, and applies §4.7 per
field. It returns per key: `question_key`, `outcome` (`not_permitted`,
`settled`, `settling`, `withdrawn_overlay`), the stored tuple identity
`(epoch_id, epoch_ordinal, publication_revision, digest, delivery_state,
scope_seq, published_at)` when delivered, the stored `payload` only when
`outcome = 'settled'`, plus the snapshot fields `snapshot_revision` and
`read_at = statement_timestamp()`.

`private.knowledge_public_digest(destination, venue, key)` from draft 1
becomes a thin wrapper returning the projection's `digest`.

### 4.4 Schema `1.1`: qualification

Available answers gain an optional field for consumers declaring `1.1`:

```json
"qualification": {
  "qualifier": "conditional",
  "until": null,
  "conditions": [{ "type": "time_window", "label": "Until 9pm" }]
}
```

- `qualifier` is `conditional` or `temporarily_unavailable` (B03 §3.8).
- `conditions` are typed conditions from active value-list items only, and
  only those named in the field's `publishable_fields`; free text never.
- A `1.1` consumer sees a qualified Yes as `available` with
  `qualification`; a `1.0` consumer keeps seeing `stale` /
  `qualified_answer`. This is the additive versioning rule of contract §10.
  The stored payload is in the `1.1` form; the `1.0` rendering is derived
  from it deterministically, so both renderings name the same tuple.
- Value lists are empty today (B03-c), so until the owner supplies them a
  Conditional policy has no publishable conditions and stays incomplete.

### 4.5 Public allowlist

| Field                                          | Public     | Notes                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`, `status`, `unavailable.{reason,detail}` | yes        | Reasons as contract §4. Two public-only details: `publication_withdrawn` under `withdrawn`, `publication_settling` under `unavailable`. Both are in the public JSON schema and the website validator (§7.2)                                                                                 |
| `value`                                        | yes        | Only when `eligibility.kind = 'settled'` and available                                                                                                                                                                                                                                      |
| `qualification`                                | `1.1` only | §4.4                                                                                                                                                                                                                                                                                        |
| `revision`                                     | yes        | **The publication revision**, not the answer revision (§5.2). Resolves contract §11's open point: internal churn and the `not_enabled` revision never reach a public consumer. Absent when `not_permitted`                                                                                  |
| `publication`                                  | yes        | `{ "epoch": { "id", "ordinal" }, "revision", "digest", "state" }`: the immutable tuple identity (absent when `not_permitted`)                                                                                                                                                              |
| `eligibility`                                  | yes        | `{ "kind": "settled" \| "settling" \| "withdrawn", "asOfRevision" }`. `asOfRevision` is the stored head revision the overlay was computed against. Value-free unless `settled`                                                                                                           |
| `provenance`                                   | reduced    | `{ "confirmedBy": "venue_manager" \| "admin" \| null }`; no IDs, counts, save times or self-confirmation flag                                                                                                                                                                               |
| `freshness`                                    | reduced    | `{ "publishedAt", "nextCheckDue", "state" }` for the public use; `publishedAt` is when NabaLens stored this tuple, never an observation time                                                                                                                                               |
| `summary`, `conditions`                        | no         | Staff text; null in B06 for every field                                                                                                                                                                                                                                                     |
| `snapshot`                                     | yes        | `{ epoch: { id, ordinal }, revision, complete, etag, readAt, validUntil }`: `revision` is the destination-venue snapshot revision (§5.2); `complete` is always `true` for this read; `readAt` is for freshness and diagnostics only, never ordering; `validUntil` is the earliest of `readAt + snapshotTtl` (OD-B6-5, default 24 h) and every settled answer's `nextCheckDue` |

### 4.6 Shared rate limiter

- `private.knowledge_rate_take(p_bucket text, p_limit int, p_window_seconds
  int) returns integer` (seconds to wait, or 0), on an unlogged table keyed by
  `(bucket, window_start)`; a nightly cleanup deletes old windows. Unlogged
  is acceptable: losing counters on a crash fails open briefly, never closed
  on good consumers.
- Buckets: `consumer:<id>` (60 per minute; the burst stays per instance) and
  `fail:<sha256 of the client address>` (20 failed authentications per 5
  minutes, then `401` for 5 minutes without checking credentials).
- **Client address (low 1).** On Vercel the address is the platform-set
  `x-vercel-forwarded-for` header, falling back to `x-real-ip`. The reader
  never reads a client-supplied `x-forwarded-for` hop for this purpose. If
  neither platform header is present (a non-Vercel runtime), the bucket is
  `fail:unknown`, shared by every such request, which can only fail closed.
  Only the digest, never the address, is stored or logged. A test sends
  rotating `x-forwarded-for` values from one platform address and gets one
  bucket.
- Concurrency stays per instance (4). B10 may add a shared cap.

### 4.7 Read evaluation per field

The wrapper evaluates each requested field for the authenticated consumer of
destination D at venue V in one snapshot. H is the stored head for (current
epoch, D, V, field) and T the tuple at `H.publication_revision`. L is the
projection row at `statement_timestamp()`.

| # | Condition (first match wins)                                                                                  | Outcome              | Body                                                                                                       |
| - | ------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1 | Caller lacks scope for V, the key, `public` or its purpose (V unknown or inactive: the existing `404`)        | `not_permitted`      | No value, no revision, no publication or eligibility object                                                |
| 2 | H absent, or `H.delivery_state = 'shadow'` (never delivered in this epoch)                                    | `not_permitted`      | As 1. A field enabled but not yet drained is still `not_permitted`                                         |
| 3 | `L.live_state = 'withdrawn'` and `H.delivery_state <> 'withdrawn'`                                            | `withdrawn_overlay`  | `withdrawn` / `publication_withdrawn`, `publication` = T's identity, `eligibility {withdrawn, asOfRevision: H.rev}`, no value |
| 4 | `L.live_state = H.delivery_state` and `L.digest = H.digest = T.digest`                                         | `settled`            | T's payload (value or settled tombstone), `publication` = T, `eligibility {settled, asOfRevision: H.rev}`  |
| 5 | Otherwise (live differs from stored: the drain has not run, or a transient mismatch)                          | `settling`           | `unavailable` / `publication_settling`, `publication` = T's identity, `eligibility {settling, asOfRevision: H.rev}`, no value |

- A live gate failure on a delivered field (rights lost, redaction proof
  gone, field disabled or dropped, destination inactive, answer withdrawn)
  makes `L.live_state = 'withdrawn'` (§5.4), so it is row 3 at once.
- The same revision never carries two contents: row 4 returns only the
  stored payload, and rows 3 and 5 return no value.
- An overlay is not a publication. It has no revision of its own and never
  enters the feed (§4.8).

### 4.8 Destination feed and snapshot (B06-02g)

Both routes require a `provider_sync` or `website` consumer with scope for
the venue and the destination's feed purpose. Both run one STABLE wrapper
call in one snapshot and are gated like reads (§4.2.7).

**Feed** `GET …/destinations/{key}/publications?venueId=&epoch=&after=&limit=`
(limit at most 100). The feed is one stream per `(epoch, destination, venue)`
ordered by `scope_seq` (§5.2), which is gap-free and commit-ordered under the
venue lock.

- `epoch` differs from the current accepted epoch: `409 epoch_changed` with
  the current `{id, ordinal}`. The consumer must bootstrap from the snapshot.
- `after` is above the scope's committed `snapshot_revision`: `409
  cursor_ahead`. Within one epoch this can only follow a restore without a
  new epoch; the consumer halts and alerts (§5.8.5).
- Otherwise the items with `scope_seq > after` in order, each the tuple
  identity `(seq, fieldKey, questionKey, publicationRevision, state,
  digest)` and:
  - when the tuple is the field's current head and §4.7 gives `settled`: the
    payload fields B07 needs (`value`, `qualification` for `1.1`,
    `confirmedBy`, `validUntil`, `evidence` as public derivative publication
    IDs only when a B05 grant names this destination, `permittedUse`);
  - when the tuple is no longer the head: `superseded: true`, value-free;
  - when the tuple is the head but §4.7 gives `settling` or
    `withdrawn_overlay`: the page **ends before this item**.
- The body carries `coveredThrough` (the last returned seq, or `after` if
  none) and `more`. A consumer may advance its cursor only to
  `coveredThrough`. An item that cannot be settled is outside the covered
  prefix and is fetched again later; the drain settles it within a tick, and
  a blocked drain shows as lag (B06-03f), never as a skipped item.

**Snapshot** `GET …/destinations/{key}/snapshot?venueId=` returns, for the
current epoch, every field ever delivered to the destination at the venue in
that epoch (head tuples, settled tombstones included) with the same item
shape, plus `fence` = the scope's `snapshot_revision` in the same snapshot and
`complete: true`. If any head is `settling` or `withdrawn_overlay`, it
returns `409 settling` with `Retry-After` instead; a partial snapshot is
never returned. Consumers bootstrap from it for a new link, a new epoch or a
reset, and set their cursor to `fence`.

## 5. B06-03: publication intent, ordering, epochs and the delivery worker

### 5.1 Sub-tasks

| ID      | Deliverable                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B06-03a | B06-m3 tables in §5.3: `knowledge_publication_epochs`, `knowledge_delivered_fields`, `knowledge_publications` (heads), `knowledge_publication_revisions` (immutable tuples), `knowledge_destination_snapshots`, `knowledge_publication_events`, `knowledge_delivery_jobs`, `private.knowledge_publication_dirty`, with the guards and grants listed there                                                         |
| B06-03b | Producer: two statement-level dirty-mark triggers (on `knowledge_events` and `amenity_check_events`) that write only the dirty table and can never abort the writer; `*` marks from B06 and B05 commands; `public.knowledge_publication_drain_venue` (one venue, one transaction); the read-time sweep and the 15-minute backstop (§5.4, §5.5)                                                                     |
| B06-03c | Worker route `/api/internal/knowledge-delivery` (cron every minute, `CLEANUP_SECRET` bearer pattern): drains a bounded set of venues, one RPC per venue, then claims jobs with a lease and a fresh attempt ID, pings the destination, records fenced receipts, verifies by readback (§5.6)                                                                                                                           |
| B06-03d | The same worker drives B05 media deliveries through `media_use_publications` and `media_use_record_receipt`, with the same attempt fencing (§9.1)                                                                                                                                                                                                                                                                    |
| B06-03e | Single-item reconciliation: `knowledge_publication_reconcile(destination, venue, field)` (admin) writes a mark for the field's question key and a readback-only job for the scope                                                                                                                                                                                                                                  |
| B06-03f | Admin delivery status read (WS2 screen): per destination and field, the current epoch, desired, attempted, acknowledged, applied and verified revisions, outstanding readback, last error, the oldest mark age per venue and any halt                                                                                                                                                                             |
| B06-03g | `POST /api/knowledge/v1/receipts` for consumers that report their own delivery state (B07's NabaPresence): the consumer's own destination only, receipt kinds only, epoch-scoped, idempotent and monotonic (§5.9); B07 adds the provider kinds. It is the only write a consumer credential can make, and it changes no answer, contribution or credit                                                              |
| B06-03h | Epochs and restore: `knowledge_publication_epoch_open`, `knowledge_publication_epoch_accept`, the deployment epoch setting and the RB-12 B06 section (§5.8)                                                                                                                                                                                                                                                         |

### 5.2 Identities and ordering rules

- **Epoch.** One row of `knowledge_publication_epochs` is live (`pending` or
  `accepted`) at a time. Every head, tuple, sequence, snapshot revision,
  event, job, cursor and receipt carries its `epoch_id`. Consumers compare
  epochs by `ordinal` and require the `id` to match; numbers from different
  epochs are never compared (§5.8).
- **Publication revision** per `(epoch, destination_key, venue_id,
  field_key)`. It starts at 1 in each epoch and rises by exactly 1 each time
  the stored digest (§4.3: delivery state plus payload) changes. Only the
  drain changes it. So a changed reason, detail, `nextCheckDue` or public
  freshness state at an equal answer revision gets a new revision, and so
  does enabling a field whose answer is unchanged (`shadow` →
  `published`). An internal-only change gets none, and neither does an
  answer change under a tombstone.
- **Tuple immutability.** Each revision is one row of
  `knowledge_publication_revisions`, written once by the drain with its
  payload and never updated. The head row in `knowledge_publications` only
  points at the latest revision. A read or feed returns content only from a
  tuple (§4.7, §4.8).
- **Scope sequence and snapshot revision** per `(epoch, destination_key,
  venue_id)`. Every non-shadow tuple gets the next `scope_seq` (1, 2, 3, …)
  in the drain transaction that writes it, by incrementing
  `knowledge_destination_snapshots.snapshot_revision`. So the snapshot
  revision is the highest committed `scope_seq` of the scope: it rises
  whenever any delivered field's tuple changes, in the same transaction, and
  never on shadow-only changes. The drain is the only producer of tuples
  and sequences; it holds the venue's lock until commit, and an epoch open
  excludes every drain through the epoch lock (§5.4, §5.8), so sequence *n+1*
  can only commit after sequence *n* is visible. That is why the feed cursor
  cannot skip an unseen commit: there is no allocation across scopes or
  before the lock, and the consumer additionally rejects a page with a gap
  (B07 §4.5).
- **No decrease, no delete.** `BEFORE UPDATE` triggers on
  `knowledge_publications` and `knowledge_destination_snapshots` refuse a key
  change, a lower revision and any increase other than +1.
  `knowledge_publication_revisions` refuses every update. `BEFORE DELETE`
  and `BEFORE TRUNCATE` triggers refuse on all B06-m3 tables except the
  dirty table, and delete is revoked from every role. These guards sit on
  B06 tables, so tripping one aborts only the drain or a B06 command.
- **Tombstones.** A delivered field becomes `withdrawn` at the next revision
  when its latest manifest version leaves it `disabled` or `shadow`, drops
  it, its destination is inactive, any live gate fails, or its answer is
  withdrawn (B03-g). Re-enabling continues from the next revision. A field
  that was never delivered gets no tombstone. Fields delivered in an earlier
  epoch stay in the delivered-field register, so a new epoch re-emits their
  tombstone at revision 1 (§5.8.3).
- **Pings.** A push carries only `(epoch, destination, venue,
  snapshotRevision, eventId, digest)`, and the website always refetches
  (unchanged from draft 1 apart from the epoch).
- **`readAt` is not a version.** It is the database statement time of the
  read, kept for freshness (`validUntil`) and diagnostics. Ordering uses
  epochs, snapshot revisions, publication revisions and the consumer's own
  request order (§5.7).

### 5.3 Data model (B06-m3)

```sql
-- Epochs (§5.8). At most one live epoch.
create table public.knowledge_publication_epochs (
  id uuid primary key default gen_random_uuid(),
  ordinal integer not null unique check (ordinal >= 1),
  reason text not null check (reason in ('initial', 'restore', 'reset')),
  state text not null check (state in ('pending', 'accepted', 'retired')),
  external_record text not null check (length(external_record) between 1 and 200), -- RB-12 / release evidence reference; never a secret
  opened_by uuid not null references public.profiles (id),
  opened_at timestamptz not null default now(),
  accepted_by uuid references public.profiles (id),
  accepted_at timestamptz,
  retired_at timestamptz,
  check (state <> 'pending' or (accepted_at is null and retired_at is null)),
  check (state <> 'accepted' or (accepted_at is not null and retired_at is null)),
  check (state <> 'retired' or retired_at is not null),
  check (accepted_by is null or accepted_by <> opened_by)
);
create unique index knowledge_publication_epochs_one_live
  on public.knowledge_publication_epochs ((true)) where state in ('pending', 'accepted');

-- Every field ever delivered to a destination at a venue, across epochs. Never deleted.
create table public.knowledge_delivered_fields (
  destination_key text not null references public.media_use_destinations (key),
  venue_id uuid not null references public.venues (id),
  field_key text not null,
  question_key text not null,
  first_delivered_at timestamptz not null default now(),
  primary key (destination_key, venue_id, field_key)
);

-- Heads: the latest tuple per field in an epoch. Monotonic.
create table public.knowledge_publications (
  epoch_id uuid not null references public.knowledge_publication_epochs (id),
  destination_key text not null references public.media_use_destinations (key),
  venue_id uuid not null references public.venues (id),
  field_key text not null,
  question_key text not null,
  delivery_state text not null check (delivery_state in ('shadow', 'published', 'unavailable', 'withdrawn')),
  publication_revision bigint not null check (publication_revision >= 1),
  digest bytea not null check (length(digest) = 32),
  updated_at timestamptz not null default now(),
  primary key (epoch_id, destination_key, venue_id, field_key)
);

-- Immutable publication tuples.
create table public.knowledge_publication_revisions (
  epoch_id uuid not null,
  destination_key text not null,
  venue_id uuid not null,
  field_key text not null,
  publication_revision bigint not null check (publication_revision >= 1),
  delivery_state text not null check (delivery_state in ('shadow', 'published', 'unavailable', 'withdrawn')),
  digest bytea not null check (length(digest) = 32),
  payload jsonb check (payload is null or jsonb_typeof(payload) = 'object'), -- public-safe only (§4.3); null for withdrawn
  scope_seq bigint check (scope_seq >= 1),   -- null exactly for shadow tuples
  answer_revision bigint,                    -- audit only; never sent to public consumers
  created_at timestamptz not null default now(),   -- publishedAt
  primary key (epoch_id, destination_key, venue_id, field_key, publication_revision),
  unique (epoch_id, destination_key, venue_id, scope_seq),
  check ((delivery_state = 'shadow') = (scope_seq is null)),
  foreign key (epoch_id, destination_key, venue_id, field_key)
    references public.knowledge_publications (epoch_id, destination_key, venue_id, field_key)
);
create index knowledge_publication_revisions_feed
  on public.knowledge_publication_revisions (epoch_id, destination_key, venue_id, scope_seq)
  where scope_seq is not null;

-- Per scope: the sequence high-water and delivery progress.
create table public.knowledge_destination_snapshots (
  epoch_id uuid not null references public.knowledge_publication_epochs (id),
  destination_key text not null,
  venue_id uuid not null,
  snapshot_revision bigint not null default 0 check (snapshot_revision >= 0), -- = highest committed scope_seq
  attempted_revision bigint,
  acknowledged_revision bigint,
  applied_revision bigint,
  verified_revision bigint,
  verified_at timestamptz,
  last_error text,
  halted_reason text check (halted_reason in ('revision_regressed', 'epoch_regressed')),
  primary key (epoch_id, destination_key, venue_id)
);

create table public.knowledge_publication_events (   -- append-only
  id bigint generated always as identity primary key, -- diagnostics only; never a cursor
  epoch_id uuid not null,
  destination_key text not null,
  venue_id uuid not null,
  field_key text,                          -- null for snapshot-level receipts
  kind text not null check (kind in ('desired', 'attempted', 'acknowledged', 'applied',
    'verified', 'error', 'ignored_stale', 'reconciled', 'superseded', 'covered')),
    -- B07 extends this check with the provider_* kinds (b07-design.md §7.7)
  revision bigint not null,                -- publication revision (field) or snapshot revision (scope)
  digest bytea,
  job_id uuid,
  attempt_id uuid,
  provider_ref text,                       -- consumer-reported receipts only (§5.9); opaque
  provider_detail text,
  close_reason text,
  error_code text,
  created_at timestamptz not null default now()
);
create unique index knowledge_publication_events_receipt_once
  on public.knowledge_publication_events (job_id, attempt_id, kind, revision)
  where job_id is not null;
create unique index knowledge_publication_events_consumer_receipt_once
  on public.knowledge_publication_events (epoch_id, destination_key, venue_id, field_key, revision, kind, provider_ref)
  where provider_ref is not null;

create table public.knowledge_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  epoch_id uuid not null references public.knowledge_publication_epochs (id),
  destination_key text not null,
  venue_id uuid not null,
  target_revision bigint not null,         -- a snapshot revision
  phase text not null check (phase in ('ping', 'readback', 'done', 'superseded', 'covered', 'failed')),
  claim text not null default 'free' check (claim in ('free', 'leased')),
  attempt_id uuid,                         -- the current (or last) attempt; the only ownership fence
  lease_owner text,                        -- diagnostics only
  lease_until timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (epoch_id, destination_key, venue_id, target_revision),
  check (claim = 'free' or (attempt_id is not null and lease_until is not null)),
  check (phase in ('ping', 'readback') or claim = 'free')
);
create index knowledge_delivery_jobs_due on public.knowledge_delivery_jobs (next_attempt_at)
  where phase in ('ping', 'readback');

-- Dirty marks: the producer's only in-transaction write (§5.4).
create table private.knowledge_publication_dirty (
  venue_id uuid not null,
  subject text not null,                   -- 'question:<key>', 'check:<check_id>' or '*' (whole venue)
  writer_xid xid8 not null default pg_current_xact_id(),
  marked_at timestamptz not null default statement_timestamp(),
  primary key (venue_id, subject, writer_xid)
);
create index knowledge_publication_dirty_age
  on private.knowledge_publication_dirty (marked_at, venue_id);
```

Rights and guards:

- RLS on every table above, no policies. `revoke all` from `public`,
  `anon`, `authenticated` and `service_role` on every table; the
  `service_role` reaches them only through the security definer functions
  named in this section, each `set search_path = ''` with every object
  schema-qualified, and each with `execute` granted to `service_role` only
  (admin commands additionally check the admin role, as the existing
  knowledge commands do).
- The dirty table has no foreign keys, checks or triggers, so the mark insert
  has no failure mode of its own. Only the two trigger functions insert into
  it, `knowledge_manifest_set`, the destination and grant commands and the
  sweep insert `*` or `question:` marks, and only the drain deletes. No
  client role, and not `service_role` directly, can read or write it.
- The immutability and no-delete guards of §5.2 apply to the other tables.
- Receipt writes are monotonic per kind: a receipt with a revision lower than
  the stored one is recorded as `ignored_stale` and changes nothing (as B05
  §4.5).

### 5.4 Producer: dirty marks and the per-venue drain

The producer is split so that nothing heavy runs inside a domain write.

**Dirty mark, in the writer's transaction.**

```sql
create function private.knowledge_events_publication_mark()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into private.knowledge_publication_dirty (venue_id, subject)
    select distinct n.venue_id, 'question:' || n.question_key
    from new_rows n
    on conflict do nothing;
  exception when others then
    raise warning 'knowledge_publication_mark_failed' using detail = sqlstate;
  end;
  return null;
end;
$$;

create trigger knowledge_events_publication_mark
  after insert on public.knowledge_events
  referencing new table as new_rows
  for each statement execute function private.knowledge_events_publication_mark();

create function private.amenity_check_events_publication_mark()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into private.knowledge_publication_dirty (venue_id, subject)
    select distinct n.venue_id, 'check:' || n.check_id::text
    from new_rows n
    where n.kind in ('submitted', 'reopened', 'evidence_lost', 'archived', 'restored')
    on conflict do nothing;
  exception when others then
    raise warning 'knowledge_publication_mark_failed' using detail = sqlstate;
  end;
  return null;
end;
$$;

create trigger amenity_check_events_publication_mark
  after insert on public.amenity_check_events
  referencing new table as new_rows
  for each statement execute function private.amenity_check_events_publication_mark();

revoke all on function private.knowledge_events_publication_mark() from public, anon, authenticated, service_role;
revoke all on function private.amenity_check_events_publication_mark() from public, anon, authenticated, service_role;
```

- Both source columns are `not null` at `973cfd5c`. Neither trigger reads
  any other table, computes a digest or enqueues anything. The drain, not the
  trigger, maps a check to its question key. Statement triggers have no
  `WHEN` clause, so the kind filter is inside the select.
- The key includes the writer's transaction ID, so concurrent writers on the
  same venue and subject never conflict or wait on each other, and several
  events in one transaction leave one mark per subject. A multi-row insert (a
  definition change across every working-list venue) fires once.
- **Failure isolation, stated precisely.** A fault in B06 publication code
  (projection, digest, drain, worker) cannot abort or roll back a domain
  write, because none of that code runs in the writer's transaction. The
  mark insert runs in one `begin … exception when others` block per
  statement, never per row; on failure it raises a warning
  (`knowledge_publication_mark_failed`, SQLSTATE only) and returns, so the
  capture, decision, amenity write, media deletion with its evidence-lost
  credit trigger, definition change or recheck job commits without its mark.
  What PostgreSQL does not let this isolate, and which would abort the writer
  whether or not B06 existed: statement cancellation and `statement_timeout`
  (`query_canceled` is not caught by `others`), `assert_failure`, a crash, a
  full disk or out-of-memory, and a shared-resource failure such as a lock
  timeout. Each exception block is one subtransaction. Transactions that run
  many event statements (`knowledge_upgrade_run`, B03-f reconciliation
  loops) therefore open one subtransaction per statement; above 64 in one
  transaction PostgreSQL's subtransaction cache overflows, which costs
  throughput but not correctness. Case R3b (§7.3) measures it on the owned
  stack before WS1 accepts the trigger.
- A lost mark delays a push only: the public wrapper evaluates every read at
  read time (§4.7), the website revalidates every 120 s (§6.4), and the
  backstop marks every delivered venue every 15 minutes (§5.5).
- **Marks from B06 and B05 commands.** `knowledge_manifest_set`, destination
  activation and deactivation, B05 grant and withdrawal commands, and
  `knowledge_publication_reconcile` insert their marks (`*` or
  `question:<key>`) as ordinary statements in their own transaction, so a
  change and its mark commit together or not at all.

**Drain, one venue per transaction.** The worker route (§5.6) first calls
`public.knowledge_publication_dirty_venues(p_limit)` (STABLE, `service_role`
only) for the venues with marks, oldest mark first, at most 20 per tick. It
then calls `public.knowledge_publication_drain_venue(p_venue_id)` **once per
venue as a separate RPC**. Each RPC is its own transaction at PostgreSQL's
default `READ COMMITTED`; a single function cannot commit per venue, so the
per-venue boundary is the RPC, not a loop inside SQL. Each venue's call has
`statement_timeout = 10s` and `lock_timeout = 2s` set locally. A venue whose
call fails or times out is skipped for this tick; the others continue.

```sql
create function public.knowledge_publication_drain_venue(p_venue_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_epoch public.knowledge_publication_epochs;
  v_subjects text[];
  v_keys text[];
  v_all boolean;
  v_now timestamptz;
  v_proj jsonb;
begin
  perform set_config('statement_timeout', '10000', true);
  perform set_config('lock_timeout', '2000', true);
  -- (1) Epoch fence, then the venue lock; both held until commit.
  perform pg_advisory_xact_lock_shared(hashtextextended('nabalens:b06:epoch', 0));
  if not pg_try_advisory_xact_lock(hashtextextended('nabalens:b06:venue:' || p_venue_id::text, 0)) then
    return jsonb_build_object('status', 'busy');
  end if;
  select e.* into v_epoch from public.knowledge_publication_epochs e where e.state in ('pending', 'accepted');
  if not found then
    return jsonb_build_object('status', 'no_epoch');
  end if;
  -- (2) One statement: delete and return the marks visible to it.
  with gone as (
    delete from private.knowledge_publication_dirty d where d.venue_id = p_venue_id returning d.subject
  )
  select array_agg(distinct g.subject) into v_subjects from gone g;
  if v_subjects is null then
    return jsonb_build_object('status', 'empty');
  end if;
  -- (3) Subjects to question keys (template_key is immutable).
  v_all := '*' = any (v_subjects);
  select array_agg(distinct k) into v_keys from (
    select substr(s, 10) as k from unnest(v_subjects) s where s like 'question:%'
    union
    select c.template_key from unnest(v_subjects) s
    join public.venue_amenity_checks c
      on c.venue_id = p_venue_id and s ~ '^check:[0-9a-f-]{36}$' and c.id = substr(s, 7)::uuid
  ) x;
  -- (4) One later statement: the complete projection of every affected field.
  v_now := clock_timestamp();
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_proj
  from private.knowledge_publication_affected(v_epoch.id, p_venue_id,
         case when v_all then null else v_keys end, v_now) p;
  -- (5) Writes from v_proj and B06 tables only.
  return private.knowledge_publication_apply(v_epoch.id, p_venue_id, v_proj);
end;
$$;
```

1. **Locks.** The shared epoch lock lets drains run concurrently with each
   other but never with an epoch open (§5.8), which takes it exclusively.
   The venue lock serialises every producer of tuples for the venue. Writers
   never take either lock, so a drain never makes a capture wait. A held
   venue lock answers `busy` at once (another drain owns the venue).
2. **Marks.** Under `READ COMMITTED` the delete sees only marks of writers
   that committed before the statement began. A mark of a writer still open,
   or one that commits after the delete starts, is invisible to it, is not
   deleted, and is drained next tick. Rows of in-progress writers are never
   waited on.
3. **Key mapping.** `question:` subjects give keys directly; `check:`
   subjects map through `venue_amenity_checks.template_key`.
4. **Projection, one snapshot.** `private.knowledge_publication_affected`
   returns, in the single snapshot of that one `SELECT`, the projection
   (§4.3) of the full affected field set, plus each field's current head.
   The set is, for every destination covering the venue, the union of the
   latest manifest fields (any state) whose key is affected, the fields with
   a head in the current epoch whose key is affected, and the delivered-field
   register rows whose key is affected; for `*`, every such field regardless
   of key. A marked write that committed before step 2 is therefore visible
   here. A write that commits between step 2 and step 4 may also be visible;
   its own mark survives and the next drain recomputes an equal digest, so it
   produces no second revision.
5. **Apply.** `private.knowledge_publication_apply` reads only `v_proj` and
   B06 tables. Per field it takes the new delivery state from the transition
   table below; where the new digest differs from the head it inserts the
   next tuple (revision 1 when there is no head), with the next `scope_seq`
   unless the new state is `shadow`, updates the head, records the field in
   the delivered-field register on its first non-shadow tuple, and writes a
   `desired` event. Per destination whose `snapshot_revision` rose it
   enqueues one job at the new revision (`on conflict do nothing`) and moves
   that scope's older jobs that are still `ping` and `free` to `superseded`
   (§5.6). Shadow fields get tuples for the report but never move the
   snapshot revision and never enqueue.
6. **Commit or roll back together.** Mark deletes, heads, tuples, the
   register, events, snapshot revisions and jobs commit in one transaction.
   If anything raises, all of it rolls back, the marks remain, and the venue
   is retried next tick. The age of the oldest mark per venue appears on the
   delivery status read (B06-03f) and alerts after 5 minutes (B10-01).

**Delivery-state transition table** (computed per field by the projection;
"gates" are the six access-and-rights conditions; "answer" is the B03 status
through the public projection; "delivered" means the field is in the
delivered-field register, which gains a row with the field's first
non-shadow tuple in any epoch, so within one epoch it equals "has a
non-shadow tuple" and in a fresh epoch it carries every earlier delivery):

| # | Delivered before | Destination active | Latest manifest state            | Gates and answer                     | New live state             | Revision                       |
| - | ---------------- | ------------------ | -------------------------------- | ------------------------------------ | -------------------------- | ------------------------------ |
| 1 | no               | any                | absent or `disabled`             | any                                  | no row (or `shadow` kept)  | unchanged                      |
| 2 | no               | yes                | `shadow`                         | any                                  | `shadow`                   | next if digest changed         |
| 3 | no               | no                 | `shadow` or `enabled`            | any                                  | `shadow`                   | next if digest changed         |
| 4 | any              | yes                | `enabled`                        | gates pass, answer available         | `published`                | next if digest changed         |
| 5 | any              | yes                | `enabled`                        | gates pass, answer unavailable (any reason) | `unavailable`       | next if digest changed         |
| 6 | no               | yes                | `enabled`                        | answer withdrawn (B03-g), or a gate fails | `shadow` (not delivered) | next if digest changed       |
| 7 | yes              | yes                | `enabled`                        | answer withdrawn (B03-g), or a gate fails | `withdrawn` (tombstone) | next if digest changed        |
| 8 | yes              | no                 | any                              | any                                  | `withdrawn` (tombstone)    | next if not already withdrawn  |
| 9 | yes              | yes                | absent, `disabled` or `shadow`   | any                                  | `withdrawn` (tombstone)    | next if not already withdrawn  |

- Row 6 keeps a never-delivered field undelivered, so it reads
  `not_permitted` (§4.7 row 2) and nothing reveals a revision for it. Its
  first non-shadow tuple appears only when rows 4 or 5 apply.
- A withdrawn head under rows 7 to 9 has an equal digest
  (`{withdrawn, null}`), so repeated drains add nothing.
- Re-enabling a withdrawn field moves it by rows 4, 5 or 7 to the next
  revision, never to 1.

**Mark lifecycle:** written (writer commits) → visible → deleted by one
drain statement → either committed with that drain's recomputation, or
restored by its rollback and retried next tick. A mark lost by trigger
failure is re-created by the backstop.

### 5.5 Read-time sweep and backstop

- **Read-time sweep.** `public.knowledge_publication_sweep(p_now, p_limit)`
  (worker tick, bounded to 500 fields) inserts `question:<key>` marks for
  delivered fields whose stored `nextCheckDue`, due-soon boundary or
  qualifier `until` has passed. The drain does the rest. A late sweep cannot
  leave an expired answer readable, because §4.7 evaluates freshness at read
  time and returns `settling` until the drain stores the new tuple; the
  sweep only makes the website refetch sooner.
- **Backstop.** Every 15 minutes the sweep inserts a `*` mark for each venue
  that has any manifest field in `shadow` or `enabled`, any head not
  `withdrawn`, or any delivered-field register row without a current-epoch
  head. So a lost mark, including a lost disable mark, and any input
  that writes no event (registry, freshness policy, value list, grant) costs
  at most one interval of push latency and never correctness. It also covers
  loads that bypass triggers (`session_replication_role = replica`, RB-12;
  B05's replica-mode caveat). An unchanged digest produces no revision and no
  job.
- The 15-minute figure is a healthy-system target. A venue whose drain stays
  `busy` or keeps failing keeps its marks; the oldest-mark age and the
  failing venue are visible on B06-03f and alert after 5 minutes, and
  meanwhile reads of its delivered fields return `settling` or a withdrawal
  overlay rather than stale content.

### 5.6 Worker and attempt-fenced receipts

**Tick order.** Each tick runs the drain for up to 20 venues (one RPC each,
§5.4), then the sweep, then claims up to 20 jobs.

**Claim.** One statement per tick:

```sql
update public.knowledge_delivery_jobs j
set claim = 'leased', attempt_id = gen_random_uuid(), lease_owner = $worker,
    lease_until = clock_timestamp() + interval '60 seconds', attempts = j.attempts + 1
where j.id in (
  select id from public.knowledge_delivery_jobs
  where phase in ('ping', 'readback')
    and ((claim = 'free' and next_attempt_at <= clock_timestamp())
         or (claim = 'leased' and lease_until < clock_timestamp()))
  order by (phase = 'ping') desc, next_attempt_at
  for update skip locked
  limit 20)
returning j.*;
```

Ping work is claimed before readback work. A reclaim always
mints a new `attempt_id`; `lease_owner` is diagnostics only and never part
of a fence.

**Fence.** Every job transition goes through one function,
`public.knowledge_delivery_record(p_job_id, p_attempt_id, p_kind,
p_revision, p_detail)`. It runs `update … where id = p_job_id and
attempt_id = p_attempt_id and claim = 'leased' and lease_until >
clock_timestamp()` and applies the transition only if that row matched. If
not (an expired lease, a reclaimed job, a replayed result from an earlier
claim by the same worker identity), it writes one `ignored_stale` event with
the attempt ID and changes nothing else. The unique index on `(job_id,
attempt_id, kind, revision)` makes a repeated identical call a no-op.

**Job phases.**

| From                     | Event (fenced by the current attempt)                                                      | To                                   | Snapshot progress recorded                           |
| ------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| `ping` / free            | claimed                                                                                     | `ping` / leased (attempt *a*)        | `attempted` event; `attempted_revision`              |
| `ping` / leased *a*      | `2xx` echoing epoch and a revision ≥ target                                                 | `readback` / free, due now           | `acknowledged` event; `acknowledged_revision`, `acknowledged_at` |
| `ping` / leased *a*      | ping failed or timed out (5 s)                                                              | `ping` / free, backoff               | `error`                                              |
| `ping` / leased *a*      | lease expired                                                                               | reclaimable; next claim mints *b*    | none; a result from *a* is `ignored_stale`           |
| `ping` / free            | a newer job for the scope was enqueued                                                      | `superseded`                         | `superseded`                                         |
| `readback` / free        | claimed                                                                                     | `readback` / leased (attempt *c*)    | none                                                 |
| `readback` / leased *c*  | status route reports the current epoch and `appliedSnapshotRevision` ≥ target               | stays leased                         | `applied` event; `applied_revision`                  |
| `readback` / leased *c*  | surfaces show epoch E and snapshot S ≥ target, and every enabled field matches the tuples current at S | `done`                     | `verified` at S; `verified_revision`, `verified_at`; every job of the scope with target ≤ S in `ping` or `readback` becomes `covered` |
| `readback` / leased *c*  | the website reports a field suppressed (settling) at S, or NabaLens's own head is `settling` | `readback` / free, backoff          | none; **no ping**                                    |
| `readback` / leased *c*  | mismatch (a value differs from the tuples at S)                                             | `readback` / free, backoff           | `error readback_mismatch`; never re-pings            |
| `readback` / leased *c*  | lease expired                                                                               | reclaimable as `readback`            | none                                                 |
| `ping` or `readback`     | 24 h since creation without `verified`                                                      | `failed`                             | `error`; operator alert (B10-01)                     |
| any of a retired epoch   | epoch open                                                                                  | `superseded`                         | `superseded`                                         |

- The phase moves from `ping` to `readback` in the same fenced call that
  records `acknowledged`, so a crash after acknowledgement resumes readback
  on restart and never pings again for that job. A crash after the ping but
  before the acknowledgement is recorded leaves the job in `ping`; the next
  attempt re-pings, which is harmless (content-free ping, repeated `eventId`
  is already done at the website).
- Acknowledgement never counts as applied or verified. Within its epoch a
  job in `readback` is never superseded; it leaves `readback` only as
  `done`, as `covered` by a verified snapshot at or above its target, or as
  `failed`. Only an epoch open retires it, because every old-epoch identity
  is void after a reset. Collapsing
  therefore removes only obsolete ping work, never outstanding readback
  evidence.
- Verification compares against the immutable tuples current at the
  observed snapshot S (the tuple with the highest `scope_seq` ≤ S per
  field), so "the expected value at S" is deterministic even after later
  drains.
- Every ping carries the scope's *current* snapshot revision at claim time.
- **Backoff:** 30 s, 60 s, 120 s, 240 s, then every 15 minutes, with jitter.
- **Regression.** If the status route reports the current epoch with
  `appliedSnapshotRevision` above NabaLens's own snapshot revision, or an
  epoch ordinal above NabaLens's current one, the worker sets the scope's
  `halted_reason` (`revision_regressed` or `epoch_regressed`), records
  `error`, alerts (RB-12) and stops delivering to that scope until a new
  epoch is accepted (§5.8). A website reporting an older epoch is pinged
  normally; its next fetch resets it.
- Idempotence at the consumer: the ping carries an `eventId`; the website
  treats a repeated `eventId`, or an equal epoch with a revision at or below
  its applied revision, as already done.

### 5.7 Consumer application rules (website and any other cache)

Every consumer that caches public answers keeps, per `(destination,
venue)`, one **applied-state record** written only by compare-and-set on a
record version:

`{ epoch: {id, ordinal}, snapshotRevision, appliedAtCounter, requestCounter,
regressionLatched, fields: { fieldKey: { state: value | tombstone |
suppressed | absent, revision, digest, payload, suppressedAsOf,
suppressedAtCounter } } }`

1. **Request order.** Before each fetch the consumer increments
   `requestCounter` by CAS and tags the request with the new value *c*. A
   request tagged *c* was issued after everything the record held when *c*
   was taken. This is the only ordering of reads the consumer uses; it never
   compares `readAt` values.
2. **Epoch.** A response whose epoch ordinal is below the record's is
   refused entirely. A higher ordinal resets the record: all fields are
   replaced by the response's fields, every field absent from the response
   becomes `absent` (its local value is cleared), suppression is cleared,
   and `snapshotRevision` takes the response's value. An equal ordinal with
   a different epoch ID sets `regressionLatched` (§5.8.5).
3. **Negatives first, always.** For every field whose eligibility is
   `withdrawn` or `settling`, or whose settled tuple is a tombstone, the
   consumer removes the value at once, whatever the response's snapshot
   revision: `suppressed` with `suppressedAsOf = max(previous,
   asOfRevision)` and `suppressedAtCounter = requestCounter` at that moment
   (or `tombstone` for a settled tombstone).
4. **Positives only forward.** If the response's snapshot revision is below
   the record's, no positive content is applied. If it is lower and *c* is
   greater than `appliedAtCounter` (the request was issued after the higher
   revision was applied), the consumer sets `regressionLatched` instead.
   Otherwise each settled positive field is applied unless it is
   suppressed; a suppressed field is cleared only by a settled tuple with
   `revision > suppressedAsOf`, or by a settled tuple from a request with
   *c* > `suppressedAtCounter`. An in-flight response issued before the
   suppression can therefore never clear it, and an equal-revision payload
   is never treated as a replacement publication. Then `snapshotRevision`
   and `appliedAtCounter = c` are stored.
5. **Completeness.** The answers read is complete for the consumer's field
   set; a field the consumer holds that the response omits (scope removed)
   becomes `absent`.
6. **Latch.** While `regressionLatched` is set the consumer applies
   negatives only, serves last-good positives until their `validUntil`, then
   nothing for migrated fields, and alerts. Only a new epoch clears it.

Proof sketch for rule 4's first clause: a suppression was computed in a
snapshot whose head for the field was `asOfRevision`. Heads only rise, so a
settled tuple with a higher revision comes from a snapshot after that
revision committed, which is after the suppression's snapshot, and it passed
the live gates there.

### 5.8 Epochs, restore and complete consumer recovery

1. **Initial epoch.** B06-m3 creates epoch 1 (`initial`, `pending`). The
   owner accepts it during the release (X1), after the shadow report. Until
   then reads, feeds and deliveries answer `publication_paused`.
2. **Deployment fence.** The NabaLens deployment has two server settings
   held outside the database: `NABALENS_PUBLICATION_READS` (`on`/`off`) and
   `NABALENS_PUBLICATION_EPOCH` (the accepted epoch's ID). Public reads, the
   feed, the snapshot, receipts and the delivery worker run only when reads
   are `on` and the database's accepted epoch ID equals the setting. A
   database restore cannot change these settings, so a restored database is
   fenced from consumers until RB-12 moves them.
3. **RB-12, B06 section (restore).**
   1. Before the restored database takes traffic, set
      `NABALENS_PUBLICATION_READS=off` (X1). Consumers now see an outage and
      serve last-good snapshots within `validUntil`.
   2. Re-apply every credential revocation and consumer disable recorded
      after the backup point (B10 audit log), because the registry was
      restored with the data.
   3. Read each consumer's highest observed `(epoch, snapshotRevision)` or
      cursor from its own records (website status route; NabaPresence via its
      owner) into the RB-12 record. This is evidence for the acceptance
      step, not an input to numbering.
   4. Run `public.knowledge_publication_epoch_open('restore', p_min_ordinal,
      p_external_record)` (admin). It takes the epoch lock exclusively (so it
      waits for running drains), retires the live epoch, moves that epoch's
      `ping` and `readback` jobs to `superseded`, inserts a new `pending`
      epoch with `ordinal = greatest(max(ordinal) + 1, p_min_ordinal)`,
      where `p_min_ordinal` is one above the highest ordinal in the RB-12
      external record, and inserts a `*` mark for every venue with a manifest
      field or a delivered-field register row.
   5. The drain builds the new epoch from scratch: every enabled field gets
      revision 1 from its live state, and every field in the delivered-field
      register that is no longer enabled gets a `withdrawn` tombstone at
      revision 1. Fields delivered after the backup point are unknown to
      the restored register; consumers clear them by rule 5.7.2 (absent from
      the complete reset snapshot).
   6. The owner reviews the reset report (per destination: fields
      published, unavailable and withdrawn, compared with the consumer
      high-water evidence from step 3; manifests, rights and destination
      scopes rechecked) and runs `public.knowledge_publication_epoch_accept(
      p_epoch_id, p_external_record)`. The acceptor must differ from the
      opener (OD-B6-11).
   7. Set `NABALENS_PUBLICATION_EPOCH` to the new ID, then
      `NABALENS_PUBLICATION_READS=on` (X1). Record the epoch ID and ordinal
      in the RB-12 external record.
4. **Consumer recovery.** The website resets by rule 5.7.2 on its first
   read in the new epoch. NabaPresence's feed answers `409 epoch_changed`;
   it bootstraps from the complete snapshot under its claim fence, treats
   every key it held but the snapshot omits as withdrawn at source, closes
   eligible pre-send work, keeps in-flight attempts and provider audit rows,
   and never clears Google automatically (B07 §4.6). Every later cursor,
   receipt and job is scoped to the new epoch, and new revisions become
   reviewable there.
5. **A restore without a new epoch** (a missed runbook step) fails closed:
   the website latches on a lower revision from a request issued after it
   applied a higher one (rule 5.7.4); NabaPresence's feed answers `409
   cursor_ahead` and its intake halts; the worker halts the scope on
   `revision_regressed`. None of these resumes without a new accepted epoch.
6. **Reset without restore.** `epoch_open('reset', …)` is the same procedure
   without steps 3.1 to 3.3, for a deliberate full re-delivery.

### 5.9 Receipts route (B06-03g)

`POST /api/knowledge/v1/receipts`, body `{ epoch, destination, venueId,
fieldKey, publicationRevision, kind, providerRef, providerDetail,
closeReason, at }`. The consumer's own destination and scoped venues only;
`kind` from the receipt kinds (B07 adds the provider kinds); idempotent on
`(epoch, destination, venue, field, revision, kind, providerRef)`; a receipt
for another epoch, or below the stored revision for its kind, is
`ignored_stale`. `providerRef` is an opaque consumer ID, never a provider
token or account name. It changes no answer, contribution, credit, head,
tuple or job.

## 6. B06-04 and B06-05: the Old Crown website (website owner tasks)

These are tasks for the website owner in `TheOldCrownLP`, under that
repository's `AGENTS.md`, `docs/CONTENT.md` and `docs/RELEASE.md`: a task folder,
an owner instruction for every fact, `pnpm run verify` on the committed head,
Chrome DevTools MCP QA for any page change, Vercel preview and Codex review,
and deploy only by the owner. WS5 supplies the contract, the JSON schema and
recorded fixtures; it changes nothing in that repository.

### 6.1 Sub-tasks

| ID      | Website deliverable                                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B06-04a | `src/lib/agent/nabalens.ts` (server-only): fetch the public projection with `NABALENS_READER_CREDENTIAL` and `NABALENS_VENUE_ID` (Vercel env, server-side), `schema=1.0` first, a 3-second timeout, strict validation against the published JSON schema including the public-only details `publication_withdrawn` and `publication_settling` and the `publication`, `eligibility` and `snapshot.epoch` objects, `next: { tags: ['nabalens:<venueId>'], revalidate: 120 }`; every response goes through the applied-state record (§5.7) before anything renders |
| B06-04b | `config/nabalens-manifest.json`: the enabled fields and their copy, matching NabaLens's manifest; reviewed like any approved-source change                                                                                                                                                                                                                                                                         |
| B06-04c | `agent-data.ts`: additive `facilities` in `venueInfo()` from enabled fields in the applied-state record only, plus `knowledge: { source: 'nabalens', epoch, snapshotRevision, validUntil }`; owner copy unchanged for every other field                                                                                                                                                                            |
| B06-04d | MCP: `get_venue_info` returns the same `facilities` (one source, as today); tool names and input schemas unchanged; `AGENT_API_VERSION` `1.1.0`; `openapi.json` and `llms.txt` updated                                                                                                                                                                                                                             |
| B06-04e | Pages that show a migrated field read it from the same function, so the page and the agent surfaces agree on one snapshot revision (plan B06-04)                                                                                                                                                                                                                                                                   |
| B06-04f | Menus (after B04 and an owner switch per field): `nabalensItemId` on menu entries; the menu JSON is hash-pinned, so each change follows the protected-file review                                                                                                                                                                                                                                                  |
| B06-05a | `venue.json` from `force-static` to `revalidate = 120` with the tag; JSON responses for migrated data at `s-maxage=60, must-revalidate` and no long `stale-while-revalidate`; `menus.json` brought within the budget when menu fields migrate                                                                                                                                                                      |
| B06-05b | `POST /api/nabalens/revalidate` and `GET /api/nabalens/status` (§6.3)                                                                                                                                                                                                                                                                                                                                              |
| B06-05c | Outage, expiry, unsupported-version, epoch and latch behaviour (§6.4)                                                                                                                                                                                                                                                                                                                                               |
| B06-05d | The applied-state record (§5.7) in a store with compare-and-set shared by every website instance (OD-B6-10). The fixture journey may use a single-instance in-memory store                                                                                                                                                                                                                                        |

### 6.2 Field rendering rules

| Public answer                                     | Website shows                                                                | Agent JSON and MCP                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| settled available Yes                             | the approved copy for the field (for example "Parking on site")              | `{ "status": "available", "answer": "yes", "revision": n }`                            |
| settled available No                              | the approved "No" copy, or nothing if the owner chose that                   | `answer: "no"`                                                                         |
| settled Not applicable                            | nothing                                                                      | `answer: "not_applicable"`                                                             |
| settled unavailable (any reason)                  | nothing for the fact, or "Ask the pub" where the owner approved that wording | `{ "status": "unavailable", "reason": "...", "note": "Not confirmed. Call the pub." }` |
| `withdrawn` (settled tombstone or overlay)        | nothing; any cached copy is replaced                                         | as unavailable; the revision is kept                                                   |
| `settling` overlay, or a suppressed field         | nothing                                                                      | as unavailable with reason `publication_settling`                                      |

An unavailable field is never filled from the owner copy for the same field
once that field is `enabled`: the authority moved, and the fallback would
resurrect a withdrawn claim.

### 6.3 Revalidation and status routes

- `POST /api/nabalens/revalidate`, body `{ destination, venueId, epoch,
  snapshotRevision, eventId, digest, sentAt }`, header
  `x-nabalens-signature: sha256=<HMAC-SHA256 of the raw body>` with a shared
  secret held in both projects' server env (`NABALENS_WEBHOOK_SECRET`).
  Refuses a bad signature, a `sentAt` more than 5 minutes off, or a venue
  other than its own. On success: `revalidateTag('nabalens:<venueId>', {
  expire: 0 })`, store the `eventId`, answer `202 { acknowledgedRevision,
  epoch }`. It never accepts content.
- `GET /api/nabalens/status`, the same signature over the query, answers `{
  epoch, appliedSnapshotRevision, validUntil, suppressedFields,
  regressionLatched }` read from the applied-state record only (low 3). It
  never fetches from NabaLens, never applies anything and never changes the
  applied revision. No answer content.
- Both routes: `Cache-Control: no-store`, no CORS, never cached by the CDN
  (a website test asserts the header on both).

### 6.4 Cache, expiry, outage, withdrawal and restore

- **Budget for withdrawal within five minutes** (plan §17 objective). The
  change and its mark commit together (0 s). The public read returns a
  withdrawal overlay at once for any read after that commit (§4.7), so the
  website's next fetch removes the value even before the drain. The drain
  runs at the next worker tick (within 60 s) and writes the tombstone; the
  ping in the same tick expires the tag at once; the website's public JSON
  is cached at most 60 s at the CDN. Typical end to end: under 2.5 minutes.
  If every ping fails, the website's own `revalidate = 120` plus `s-maxage =
  60` still bounds the stale window to about 3 minutes. If the drain is
  blocked, the overlay still removes the value and the delivery status shows
  the lag. Measured, not assumed (§8 step 7).
- **Ordering.** The website applies responses only by the rules of §5.7:
  epoch, snapshot revision, publication revision and its own request order.
  It never orders by `readAt`.
- **Last good snapshot.** If NabaLens fails, times out or answers
  `publication_paused`, the website may serve its last applied state until
  that state's `validUntil`, and never a snapshot older than one it has
  applied. After `validUntil` every migrated field reads unavailable ("Not
  confirmed"). The website never falls back to the pre-migration owner copy
  for an enabled field.
- **Unsupported version.** A response whose `schema` major differs, or that
  fails validation, is treated as an outage for that read (last good
  snapshot rules), logged, and alerted. It is never partly applied.
- **Withdrawal.** A `withdrawn` field disappears at the next read: by the
  overlay before the drain, by the tombstone after it (§4.7).
- **Restore.** A new epoch resets the record (§5.7.2); a regression latches
  it (§5.7.6).
- External crawler caches are outside the guarantee (plan §11).

## 7. B06-06 verification

### 7.1 Tests by family

| Family                         | Cases                                                                                                                                                                                                                                                                                                                       | Where                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| V01 roles                      | Revoked credential and disabled consumer refused next request; `website` consumer cannot ask for `internal`; `internal_tool` cannot ask for `public`                                                                                                                                                                        | NabaLens unit and security                       |
| V02 venue                      | Old Crown credential at another venue's ID, similar names, the two White Horse venues: same `404`                                                                                                                                                                                                                           | NabaLens security                                |
| V11 privacy                    | Exact key sets for the public body, answer, provenance, freshness, publication and eligibility; negative assertions over body, stored payloads, feed items, website page HTML, website JSON, MCP output, NabaLens and website logs: staff names, IDs and emails, finding and limitation text, Wi-Fi strings and test notes, asset IDs, storage paths, contribution IDs, save times | Both repositories plus the journey               |
| V12 reader                     | Public conditions 1 to 6 each failing alone (a never-delivered field reads `not_permitted`; a delivered field reads the withdrawal overlay, then the tombstone); `shadow` returns `not_permitted`; `1.0` vs `1.1` qualified answer; limiter across two simulated instances; failed-auth bucket on the platform header with a spoofed `x-forwarded-for`; each row of §4.7; an unauthorised caller never sees a tombstone revision; `publication_paused` outside an accepted epoch | NabaLens unit and security                       |
| V13 website                    | Old and new compatible versions (`1.0` client against a `1.1` server); invalidation; expired snapshot; outage; correction; removal; page, JSON and MCP agree on one snapshot revision; a replayed old ping changes nothing; schema fixtures with `publication_withdrawn` and `publication_settling` validate; each rule of §5.7 including a delayed older positive after a withdrawal overlay; epoch reset clears omitted fields; latch; status route `no-store` and read-only | Website Jest with recorded fixtures; the journey |
| Ordering                       | Digest change at equal answer revision bumps the publication revision; internal-only change does not; tombstone survives disable and re-enable; stale receipt `ignored_stale`; two workers never deliver the same job at once (lease)                                                                                       | NabaLens security                                |
| Producer isolation             | A raising projection, digest, drain or apply function never aborts capture, manager decision, amenity submit, media deletion (with the evidence-lost credit trigger), the recheck job or a definition change; existing trigger effects match the baseline; a forced mark failure commits the writer with one warning      | NabaLens security (database)                     |
| Producer, ordering and recovery repairs | Cases R1 to R27 (§7.3)                                                                                                                                                                                                                                                                                       | NabaLens security (database), website Jest, journey |

### 7.2 Contract fixtures

NabaLens publishes `docs/knowledge/public-projection-v1.schema.json` and a set
of recorded responses: available; each unavailable reason; the settled
withdrawn tombstone; the `withdrawn` / `publication_withdrawn` overlay; the
`unavailable` / `publication_settling` overlay; `not_permitted`; `1.1`
qualified; `publication_paused`; a feed page that ends before an unsettled
item; `epoch_changed`; `cursor_ahead`; a complete snapshot. The website copies
them under `tests/fixtures/nabalens/` and pins their hashes in its
protected-content manifest, so any drift is a reviewed change on both sides.
The website's validator rejects any detail outside the schema, so
`publication_withdrawn` and `publication_settling` must be listed (low 2).

### 7.3 Repair acceptance cases

| ID   | Trigger                                                                                                                            | Expected                                                                                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1   | Projection, digest, drain or apply function replaced by one that raises                                                            | Capture, decision, amenity submit, media deletion with the evidence-lost credit trigger, recheck job and definition change each commit; existing trigger effects match the baseline; marks remain; after the fix the next tick publishes |
| R2   | Mark insert forced to fail (test-only reject on the dirty table; table renamed)                                                    | Writer commits; one `knowledge_publication_mark_failed` warning; backstop publishes within 15 min                                                                                                             |
| R3   | Definition change inserts N rows across venues                                                                                     | One trigger call, one subtransaction, one mark per venue; each venue drained by its own RPC with its complete field set                                                                                      |
| R3b  | `knowledge_upgrade_run` with 200 candidates in one transaction                                                                     | Commits; subtransaction count and duration recorded; WS1 accepts or asks for a change before B06-m3 lands                                                                                                     |
| R4   | Two sessions insert events for the same venue and key; the first left open                                                        | The second commits without waiting; two marks with distinct `writer_xid`                                                                                                                                       |
| R5   | Writer W1 commits before the drain's delete; W2 commits after the delete and before the projection; W3 stays open across the drain | W1 is in this drain; W2's mark survives, W2 may appear in this projection and the next drain adds no second revision; W3's mark survives and publishes next tick                                                |
| R6   | Two drains of one venue at once                                                                                                    | One drains, one answers `busy`; revision +1 exactly once                                                                                                                                                        |
| R7   | One venue's lock held (or drain past `statement_timeout`) while another venue is healthy                                           | The healthy venue drains in the same tick; the blocked venue keeps its marks; its mark age shows on B06-03f and alerts after 5 min; its delivered fields read `settling` or the withdrawal overlay, never stale content |
| R8   | Drain raises after the delete                                                                                                      | Marks restored; no tuple, event, snapshot change or job                                                                                                                                                          |
| R9   | Shadow → enabled with the answer unchanged                                                                                         | Publication +1, snapshot +1, one job, pinged                                                                                                                                                                    |
| R10  | Disable, then re-enable                                                                                                            | `withdrawn` at n+1, then n+2; update of a tuple, delete, truncate and decrease refused                                                                                                                          |
| R11  | Field dropped from the manifest, including a version with no field rows (last field removed); destination deactivated              | Tombstone at +1 in each case; the empty version is the latest version                                                                                                                                           |
| R12  | Disable mark lost, venue has no enabled field left                                                                                 | Public read gives the withdrawal overlay at once; backstop tombstones within 15 min                                                                                                                            |
| R13  | An older positive response delayed until after a withdrawal overlay was applied                                                    | The website keeps the field suppressed; no value reappears                                                                                                                                                      |
| R14  | Reversed `readAt` timestamps on two responses                                                                                      | No effect on ordering; outcome decided by epoch, revisions and request order                                                                                                                                   |
| R15  | Transient digest mismatch that reverts before the drain                                                                            | Read gives `settling`; the consumer suppresses; a refetch issued after the suppression returns the same tuple settled and clears it; no new revision; no same-revision payload replaces another                  |
| R16  | Internal note only                                                                                                                 | Mark drained; no revision, no job                                                                                                                                                                                |
| R17  | Amenity event of kind `assigned` or `notes_updated`                                                                                | No mark                                                                                                                                                                                                          |
| R18  | Restore a backup older than both consumer cursors and older than a post-backup tombstone, then RB-12                               | Reads paused; new epoch pending then accepted; the website resets and clears the field the backup still shows as published; NabaPresence rejects the old epoch, bootstraps, closes pre-send work for the omitted key, keeps in-flight rows, raises the review item where a confirmed value exists, and makes new revisions reviewable; no provider mutation |
| R19  | R18 with an inactive destination and with a destination whose last field was dropped                                              | Their delivered fields read the tombstone at revision 1 in the new epoch; no value                                                                                                                              |
| R20  | Restore without a new epoch                                                                                                        | Website latches; feed `409 cursor_ahead`, intake halts; worker `revision_regressed`; nothing resumes until an accepted epoch                                                                                  |
| R21  | Old-epoch feed request, receipt or ping                                                                                            | `409 epoch_changed`; receipt `ignored_stale`; job `superseded`                                                                                                                                                  |
| R22  | Crash after acknowledgement, then restart                                                                                          | Job resumes in `readback`; no second ping; acknowledgement alone never sets `applied` or `verified`                                                                                                             |
| R23  | Stale result from an earlier claim by the same worker identity after a reclaim                                                     | `ignored_stale` with the old attempt ID; only the current attempt advances the job                                                                                                                              |
| R24  | Readback sees a suppressed (settling) field                                                                                        | Readback rescheduled; no ping                                                                                                                                                                                    |
| R25  | Newer job enqueued while an older job is in `readback`                                                                             | Older job stays in `readback` until a verified snapshot ≥ its target covers it                                                                                                                                 |
| R26  | Tuples committed in different scopes out of order (venue A seq 5 commits after venue B seq 9)                                      | Each scope's feed is gap-free; no cursor in either scope skips an item                                                                                                                                         |
| R27  | Status route called during a refetch                                                                                               | Answers from the record only; `no-store`; the applied revision is unchanged by the call                                                                                                                         |

## 8. Cross-repository fixture journey (B06-06)

Run by WS6 and the coordinator: NabaLens on the owned stack (spare6), the
website from a local build of the website's B06 branch pointed at it with
fixture credentials, destination `old_crown_website_preview`, a fixture venue,
a fixture epoch accepted by a second fixture admin. No production data,
credential or deployment is involved.

| Step | Action                                                                                                     | Exact assertion                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Seed the venue, crosswalk row, destination, consumer, manifest with `facilities.onsiteParking` in `shadow` | Public read gives `not_permitted`; the shadow report shows the website claim "Free parking" against NabaLens `unknown`                                                                  |
| 2    | Staff captures `onsite_parking` Yes with a photo                                                           | Internal reader `available`; shadow report `agrees` (presence); public read still `not_permitted`                                                                                       |
| 3    | Owner (fixture admin) enables the field                                                                    | Before the drain: still `not_permitted`. After the next drain: publication revision 1, snapshot revision 1, one delivery job                                                           |
| 4    | Worker tick                                                                                                | Events `attempted`, `acknowledged`, `applied`, `verified` at revision 1, all with the same attempt ID; `venue.json` and MCP `get_venue_info` both show Yes at epoch 1, snapshot revision 1 |
| 5    | Manager reopens the check (correction)                                                                     | Revision 2, `stale` / `recheck_requested`; website shows no parking claim; JSON and MCP show unavailable at revision 2                                                                  |
| 6    | Replay the revision 1 ping                                                                                 | Website answers already done; readback still revision 2                                                                                                                                 |
| 7    | Staff re-captures; then the owner disables the field (withdrawal)                                          | Revision 3 available, then the withdrawal overlay before the drain and revision 4 `withdrawn` / `publication_withdrawn` after it; time from the disable commit to `verified` recorded, including the drain; must be under 5 minutes |
| 8    | Stop NabaLens                                                                                              | Website serves snapshot 4 until `validUntil`, then unavailable; never revision 3 content                                                                                                |
| 9    | Website requests `schema=2.0` (forced)                                                                     | Website logs and alerts; serves last good snapshot; no partial application                                                                                                              |
| 10   | Qualified answer: attach a temporarily unavailable detail                                                  | `1.0` website: unavailable `stale` / `qualified_answer`; a `1.1` probe: available with `qualification`                                                                                  |
| 11   | Image: grant a ready dish photo to the preview destination                                                 | `media_use_publications` returns it; website renders `/api/public-media/{publicationId}/800`; withdraw; the route answers `410` within the budget                                       |
| 12   | Privacy sweep over every response, stored payload, feed item and log captured in steps 1 to 11             | All V11 negative assertions hold                                                                                                                                                        |

The restore cases (R18 to R21) run separately on the owned stack with a
local backup, never against a shared or production database.

## 9. B05 destination sign-off (B05-m3) and public derivatives

### 9.1 Sign-off

WS5 signs off `media_use_destinations` and `media_use_deliveries` as designed
in `b05-design.md` §2.4 and §4.4, with three conditions for B05-m3:

1. **Add `applied_revision bigint`** to `media_use_deliveries`, between
   `acknowledged_revision` and `verified_revision`. Plan B06-05 requires
   applied and verified revisions recorded separately, and B05 §4.5 already
   lists `applied` as a receipt kind.
2. **`media_use_record_receipt` takes `p_attempt_id uuid`** and is idempotent
   on `(delivery_id, kind, revision, attempt_id)`; the event log stores it.
   When B06's worker drives a media delivery, the receipt is accepted only
   for the current, unexpired attempt of the job, under the same fence as
   §5.6; any other attempt is recorded as `ignored_stale`.
3. **`media_use_publications` returns storage keys, not URLs.** WS5 builds the
   public URL from the opaque `publicationId` (§9.2). No signed URL ever
   leaves NabaLens.

Also confirmed: destination keys are never reused; `label` is public-safe
text; deactivating a destination stops new publication while withdrawals and
the sweep continue (B05 §4.6); a deactivation writes a `*` mark (§5.4).
B06's consumer table references `media_use_destinations.key`, so there is one
registry.

### 9.2 Public derivative delivery

`GET /api/public-media/{publicationId}/{rendition}` on NabaLens: no
credential; `publicationId` is random; it checks at request time that the
delivery's `desired_state = 'published'`, the grant is in force and the
derivative is ready, then streams the derivative from the private bucket.
Otherwise `410 Gone`. `Cache-Control: public, max-age=60, s-maxage=240`, so a
withdrawn image leaves the CDN within the five-minute budget. No asset ID,
original or EXIF ever leaves (B05-03 profiles). This is the default; OD-B6-6
offers a website-side proxy instead.

## 10. Migration and compatibility

| Batch   | Contents                                                                                                       | Behaviour change                                                                 | Rollback                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B06-m1  | Consumer registry tables; registry read cut-over with the environment fallback                                 | None for current consumers once their rows exist                                 | Switch back to the environment registry (setting); tables stay                                                                                                                  |
| B06-m2  | `knowledge_public_projection`, `knowledge_public_answers_v1`, `knowledge_public_digest` (WS1)                  | None until a manifest field is enabled                                           | Revoke execute                                                                                                                                                                  |
| B06-m3  | Manifest versions, epochs (epoch 1 `pending`), heads, tuples, register, snapshots, events, jobs, dirty table, the two mark triggers, drain, sweep | Marks and shadow tuples only; nothing is served until epoch 1 is accepted and the deployment settings are set | Drop the two mark triggers (they write only the dirty table, so domain writes are unaffected); reads off by setting; tables, tuples and tombstones stay |
| B06-app | Routes, worker, cron entry, admin screens                                                                      | Worker idle until a destination is active and an epoch is accepted               | Remove the cron entry, or set reads off; withdrawals keep running only while the cron and reads are on                                                                         |
| Website | B06-04, B06-05                                                                                                 | None until env and manifest enable a field                                       | Revert the manifest entry; the website shows owner copy only where the field was never enabled, and nothing where it was                                                       |

Release order (plan §11): NabaLens migrations and app first, reads off;
the website release, with every field still in `shadow`; accept epoch 1 and
verify both while every field is in `shadow` (shadow report, readback of
`knowledge.snapshotRevision` and `knowledge.epoch`); then enable
`facilities.onsiteParking` alone; then the other fields one by one.

Compatibility:

- Internal reader v1 is unchanged for existing consumers. `audience=public` is
  new; `1.1` is opt-in; the public-only details, `publication`, `eligibility`
  and `snapshot.epoch` exist only in the public audience.
- `venue.json` and MCP gain fields; nothing is removed or renamed. Existing
  agent tests (`tests/agent/agent-protocols.client.test.ts`) must keep
  passing unchanged.
- The B01 and B03 resolver, credit and evidence functions are not re-created.
  The two new triggers on `knowledge_events` and `amenity_check_events` write
  only the dirty table inside an exception block; `knowledge_events` has no
  other trigger, and `amenity_check_events` keeps its append-only and
  no-truncate guards unchanged. A lifecycle test pins that every existing
  trigger, including `media_assets_amenity_evidence_lost` and
  `media_assets_knowledge_evidence_withdrawn`, behaves the same.

## 11. Owner decisions

| ID       | Decision                                                                                               | Default until decided                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| X1       | Production migrations, NabaLens deployment and the publication deployment settings                    | Not requested; reads off                                                                                                    |
| X4       | Named internal reader operator who issues and rotates credentials; public-use granter                  | Coordinator issues fixture credentials only; no production credential                                                       |
| X7       | Website deploy authority for Old Crown; Vercel env for the credential and webhook secret               | No deployment; work stops at a reviewed PR                                                                                  |
| X8       | Old Crown crosswalk row (`9240a6e7…` ↔ oldcrowngirton.com)                                             | No production destination row                                                                                               |
| OD-B6-1  | Delivery model: pull with pushed invalidation (this design) vs build-time snapshots                    | Pull with invalidation                                                                                                      |
| OD-B6-2  | Allow `venue.json` to stop being `force-static` (route behaviour change under the website's AGENTS.md) | Required for B06-04; without it the fields can change only by deployment, which misses the five-minute objective            |
| OD-B6-3  | The Old Crown field manifest (§3.4), the copy per state, and which field goes first                    | `facilities.onsiteParking` first, presence only; "Free" stays owner copy                                                    |
| OD-B6-4  | Whether pages (contact facilities list) migrate together with the agent surfaces                       | Agent surfaces and the contact list together, field by field                                                                |
| OD-B6-5  | Snapshot validity during an outage                                                                     | 24 hours                                                                                                                    |
| OD-B6-6  | Public images served by NabaLens (`/api/public-media`) or proxied by the website                       | Served by NabaLens                                                                                                          |
| OD-B6-7  | Whether the group site (LapenInnsLP) shows NabaLens facts                                              | Not in B06 (B10-07)                                                                                                         |
| OD-B6-8  | Prince of Wales claim registry precedence                                                              | Not in B06 (B10-07; inventory row 6)                                                                                        |
| OD-B6-9  | Live withdrawal exercise on the production site                                                        | Measured on a preview deployment with fixture data; production gets readback and one correction only with explicit approval |
| OD-B6-10 | The website's shared store with compare-and-set for the applied-state record (§5.7) and who operates it | No field is enabled on a multi-instance deployment until it exists; the fixture journey uses a single-instance store        |
| OD-B6-11 | Who may open and who may accept a publication epoch, and the RB-12 external record that holds epoch IDs | Opener and acceptor are different admins, acceptance needs X1; until named, no epoch is accepted and nothing is served      |

## 12. Integration ownership (one PR per repository per batch)

| Repository and branch                              | Owner                                   | Contents                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NabaLens `codex/b06-publication`                   | Integration agent, from worker branches | WS5: B06-m1, B06-m3 migrations (new tables, the two mark triggers, drain, sweep, epochs), routes, worker, limiter, unit and security tests; WS1: B06-m2 projection and wrapper, review of the triggers on its tables and of R3b; WS4: B05-m3 with §9's conditions; WS2: admin screens (consumers, manifest and shadow report, delivery status, epochs) |
| TheOldCrownLP, a `feat/nabalens-facilities` branch | Website owner                           | B06-04 and B06-05, including the applied-state record, under its own release gate                                                                                                                                                                                                                                  |

The coordinator serialises NabaLens migrations with B03-d to B03-g and B05.
Neither repository's gate qualifies the other (plan §18).

## 13. Live case and authorisations

The B06 exit gate needs one authorised live case:

1. Owner approves the crosswalk row (X8) and the manifest entry (OD-B6-3).
2. X4 issues a production credential for `old_crown_website`; X7 sets it and
   the webhook secret in the website's Vercel env.
3. Production migrations and NabaLens deployment (X1); website deployment
   (X7), with every field in `shadow`; epoch 1 accepted under OD-B6-11.
4. Readback: the shadow report on production data, then enable
   `facilities.onsiteParking`; verify `venue.json`, MCP and the contact page
   on oldcrowngirton.com show the same epoch and snapshot revision; record
   `verified` with timestamps.
5. Correction and withdrawal on production only with OD-B6-9 approval.

Each step is a separate request at the time; nothing here is pre-authorised.

## 14. Risks for the register

| Risk                                                                      | Control                                                                                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| NabaLens says Yes where the website says "Free parking" (meaning differs) | Field manifest maps presence only; shadow report; owner copy keeps the charge claim                                                               |
| A replayed ping or receipt revives content                                | Pings carry no content; snapshot revisions monotonic at the website; receipts monotonic and attempt-fenced in NabaLens                            |
| Read-time expiry not pushed                                               | Sweep plus the website's own 120 s revalidate; the public read returns `settling` until the drain stores the new tuple                           |
| `revalidateTag` with `"max"` serves stale                                 | `{ expire: 0 }` required in the website route; a website test pins it                                                                             |
| Credential leak                                                           | Server-side env only; revocation at the next request; two-slot rotation                                                                           |
| Website and NabaLens manifests drift                                      | Website manifest checked at build against the shadow report's field list; drift fails the website check                                           |
| Publication code slows or fails domain writes                             | Writers only insert a mark in a statement-level exception block; all computation runs in the per-venue drain; R1 to R3b                           |
| One revision shown with two contents during drain lag                     | Immutable tuples; live mismatch returns a value-free overlay (§4.7); no ordering by `readAt`                                                      |
| An older in-flight response re-shows a withdrawn value                    | Negative overlays applied at once; suppression cleared only by a higher settled revision or a later-issued request (§5.7)                        |
| A restore lowers revisions or loses tombstones                            | Epochs, deployment fence, complete reset snapshot, durable delivered-field register, regression latch (§5.8)                                     |
| A stale delivery attempt records a receipt                                | Attempt ID plus unexpired lease on every transition; readback durable after acknowledgement (§5.6)                                               |
| A blocked venue drain hides lag                                           | Per-venue RPC; mark age on B06-03f with an alert after 5 min                                                                                      |

## 15. Changelog

- Draft 1 (10 Nov 2026): first design.
- Draft 2 (proposal, 10 Nov 2026): repairs the design-gate review and the
  proposal review; replaces the first repair proposal, which was not
  approved, and does not use WS5's unfinished replacement script.
  - M1: statement-level dirty-mark triggers with one exception block per
    statement; a per-venue drain, one RPC and one `READ COMMITTED`
    transaction per venue, with its exact lock, delete and one-snapshot
    projection boundaries; precise failure-isolation limits (§5.4).
  - Low 1: failed-auth bucket on `x-vercel-forwarded-for` / `x-real-ip`
    (§4.6). Low 2: `publication_withdrawn` and `publication_settling` in the
    schema, fixtures and validator (§4.5, §7.2). Low 3: the status route is
    read-only and `no-store` (§6.3).
  - B06-1 (proposal review): complete dirty-table DDL, rights and drain
    function (§5.3, §5.4).
  - B06-2: immutable tuples with stored payloads, value-free eligibility
    overlays, consumer application rules without `readAt` ordering (§4.7,
    §5.2, §5.7); the feed emits settled items only (§4.8).
  - B06-3: publication epochs, the deployment fence, RB-12's B06 section,
    complete reset snapshots, a durable delivered-field register, manifest
    version headers for empty versions, the regression latch; numeric
    rebase removed (§3.3, §5.8).
  - B06-4: attempt-fenced job transitions; acknowledgement moves the job to
    a durable readback phase; collapse never discards readback (§5.6).
  - Pre-application findings D4 to D10 from the first proposal folded in
    (check subject, statement triggers, per-venue lock, delivery state in
    the digest, tombstone coverage and backstop, settling, restore).
